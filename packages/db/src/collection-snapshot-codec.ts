import { EffectInputCallbackError } from "@sunfall/arc-core";
import { Cause, Data, Effect, Exit, Option, Schema, SchemaAST, SchemaIssue } from "effect";
import { AsyncResult } from "effect/reactivity";
import type {
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionRowSnapshot,
  CollectionSnapshot,
} from "./collection-contract.js";
import {
  applyCollectionBaseRow,
  collectionBaseRows,
  commitCollectionLoadState,
  deleteCollectionBaseRow,
  rebaseCollectionBaseRows,
  type CollectionState,
  type StoredRow,
} from "./collection-state.js";
import {
  CollectionValueReadError,
  cloneCollectionValue,
  collectionExecutableValuePath,
} from "./collection-value-detachment.js";

interface CollectionSnapshotDefinition<A extends object, K extends CollectionKey> {
  readonly name: string;
  readonly options: {
    readonly output?: unknown;
  };
  getKey(value: A): K;
}

export type CollectionSnapshotCodecOperation =
  | "decode"
  | "encode"
  | "load"
  | "hydrate"
  | "mutation"
  | "restore"
  | "snapshot"
  | "write";

/**
 * Typed failure for invalid collection snapshots or hydration payloads.
 *
 * `operation` identifies the codec phase, `path` is a JSONPath-like location
 * in the payload, and `reason` describes the validation failure.
 */
export class CollectionSnapshotCodecError extends Data.TaggedError("CollectionSnapshotCodecError")<{
  readonly operation: CollectionSnapshotCodecOperation;
  readonly path: string;
  readonly reason: string;
}> {}

const isObjectValue = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const cloneValue = <A>(value: A): A => cloneCollectionValue(value);

const CollectionKeySchema = Schema.Union([Schema.String, Schema.Finite]).annotate({
  expected: "a string or finite number collection key",
});

const isCollectionKey = Schema.is(CollectionKeySchema);

/**
 * Row values without an `output` schema: any non-null object, JSON-encoded
 * as `JSON.stringify` would (Dates as ISO strings, `undefined` fields dropped).
 */
const CollectionPlainValueSchema = Schema.Any.check(
  Schema.makeFilter(isObjectValue, { expected: "a non-null object value" }),
);

const uniqueBy = <A>(field: string, identity: (item: A) => unknown, reason: (item: A) => string) =>
  Schema.makeFilter<ReadonlyArray<A>>((items) => {
    const seen = new Set<unknown>();
    for (const [index, item] of items.entries()) {
      const id = identity(item);
      if (seen.has(id)) {
        return { path: [index, field], issue: reason(item) };
      }
      seen.add(id);
    }
    return undefined;
  });

/**
 * The snapshot envelope over a row value schema: `name`, `rows` (unique keys),
 * and a finite `updatedAt`. Persistence passes the collection's row schema so
 * values round-trip through their JSON codec; hydration validates the envelope
 * over plain values and decodes rows against the definition afterwards.
 */
export const collectionSnapshotSchema = (value: Schema.Codec<unknown, unknown>) =>
  Schema.Struct({
    name: Schema.String,
    rows: Schema.Array(
      Schema.Struct({
        key: CollectionKeySchema,
        value,
        synced: Schema.Boolean,
        origin: Schema.Literals(["local", "remote"]),
      }),
    ).check(
      uniqueBy(
        "key",
        (row: { readonly key: CollectionKey }) => row.key,
        (row) => `Duplicate row key '${String(row.key)}' in collection snapshot.`,
      ),
    ),
    updatedAt: Schema.Finite,
  });

const CollectionSnapshotEnvelopeSchema = collectionSnapshotSchema(CollectionPlainValueSchema);

const CollectionHydrationPayloadSchema = Schema.Struct({
  collections: Schema.Array(CollectionSnapshotEnvelopeSchema).check(
    uniqueBy(
      "name",
      (snapshot: { readonly name: string }) => snapshot.name,
      (snapshot) => `Duplicate collection '${snapshot.name}' in collection hydration payload.`,
    ),
  ),
});

const issueFormatter = SchemaIssue.makeFormatterStandardSchemaV1();

const appendIssuePath = (path: string, segments: ReadonlyArray<unknown>): string =>
  segments.reduce<string>((out, segment) => {
    const key =
      typeof segment === "object" && segment !== null && "key" in segment
        ? (segment as { readonly key: PropertyKey }).key
        : segment;
    return typeof key === "number" ? `${out}[${key}]` : `${out}.${String(key)}`;
  }, path);

/** Maps a `SchemaError` to the codec error at the first issue's payload path. */
export const collectionSnapshotCodecErrorFromSchema = (
  error: Schema.SchemaError,
  operation: CollectionSnapshotCodecOperation,
  path = "$",
): CollectionSnapshotCodecError => {
  const [issue] = issueFormatter(error.issue).issues;
  return new CollectionSnapshotCodecError({
    operation,
    path: appendIssuePath(path, issue?.path ?? []),
    reason: issue?.message ?? error.message,
  });
};

const decodeEnvelope = <S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): S["Type"] => {
  const result = Schema.decodeUnknownExit(schema)(value);
  if (Exit.isSuccess(result)) {
    return result.value;
  }
  const error = Cause.findErrorOption(result.cause);
  throw Option.isSome(error) && Schema.isSchemaError(error.value)
    ? collectionSnapshotCodecErrorFromSchema(error.value, operation, path)
    : Cause.squash(result.cause);
};

const detachSnapshotValues = <A extends object, K extends CollectionKey>(
  snapshot: typeof CollectionSnapshotEnvelopeSchema.Type,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): CollectionSnapshot<A, K> => ({
  name: snapshot.name,
  rows: snapshot.rows.map((row, index) => {
    try {
      return { ...row, key: row.key as K, value: cloneValue(row.value as A) };
    } catch (cause) {
      throw new CollectionSnapshotCodecError({
        operation,
        path:
          cause instanceof CollectionValueReadError ? cause.path : `${path}.rows[${index}].value`,
        reason: "Expected collection snapshot values to be readable plain data.",
      });
    }
  }),
  updatedAt: snapshot.updatedAt,
});

export const validateCollectionKey = <K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): K => {
  if (!isCollectionKey(value)) {
    throw new CollectionSnapshotCodecError({
      operation,
      path,
      reason: "Expected a string or finite number collection key.",
    });
  }
  return value as K;
};

/** Validates a snapshot envelope and detaches its row values from the input. */
export const validateCollectionSnapshot = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$",
): CollectionSnapshot<A, K> =>
  detachSnapshotValues(
    decodeEnvelope(CollectionSnapshotEnvelopeSchema, value, operation, path),
    operation,
    path,
  );

const catchSnapshotCodecError =
  (operation: CollectionSnapshotCodecOperation, path: string) =>
  (error: unknown): CollectionSnapshotCodecError => {
    if (error instanceof CollectionSnapshotCodecError) {
      return error;
    }
    return new CollectionSnapshotCodecError({
      operation,
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
  };

const validateCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$",
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionSnapshot<A, K>(value, operation, path),
    catch: catchSnapshotCodecError(operation, path),
  });

/**
 * Decodes collection output schema failures into the snapshot codec error seam.
 *
 * Public Collection and Query Interfaces should not expose raw schema errors;
 * callers see `CollectionSnapshotCodecError` with the
 * path that failed inside the hydrated or loaded snapshot.
 */
/**
 * Collection `output` is either a rows schema (`Schema.Array(Row)`) or a row
 * schema. The AST says which, so values decode one way and failures report the
 * path inside the shape the caller declared.
 */
const outputDecodesRowArray = (schema: Schema.Top): boolean => SchemaAST.isArrays(schema.ast);

/**
 * The codec one row value persists through: the `output` row schema (the
 * element of a rows schema), or plain non-null objects without one.
 */
export const collectionRowValueSchema = (output: unknown): Schema.Codec<unknown, unknown> => {
  if (!Schema.isSchema(output)) {
    return CollectionPlainValueSchema;
  }
  if (!outputDecodesRowArray(output)) {
    return output as Schema.Codec<unknown, unknown>;
  }
  const [element] = (output.ast as SchemaAST.Arrays).rest;
  return element === undefined ? CollectionPlainValueSchema : Schema.make(element);
};

export const decodeCollectionOutputValues = <A extends object>(
  schema: unknown,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(values);
  }

  if (outputDecodesRowArray(schema)) {
    return Schema.is(schema as Schema.Schema<ReadonlyArray<A>>)(values)
      ? Effect.succeed(values)
      : Schema.decodeUnknownEffect(schema as Schema.Decoder<ReadonlyArray<A>>)(values).pipe(
          Effect.mapError(catchSnapshotCodecError(operation, path)),
        );
  }

  const isDecodedRow = Schema.is(schema as Schema.Schema<A>);
  if (values.every((value) => isDecodedRow(value))) {
    return Effect.succeed(values);
  }
  return Effect.forEach(values, (value) =>
    Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(value),
  ).pipe(Effect.mapError(catchSnapshotCodecError(operation, path)));
};

export const decodeCollectionOutputValuesSync = <A extends object>(
  schema: unknown,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): ReadonlyArray<A> => {
  if (!Schema.isSchema(schema)) {
    return values;
  }

  try {
    if (outputDecodesRowArray(schema)) {
      return Schema.is(schema as Schema.Schema<ReadonlyArray<A>>)(values)
        ? values
        : Schema.decodeUnknownSync(schema as Schema.Decoder<ReadonlyArray<A>>)(values);
    }

    const isDecodedRow = Schema.is(schema as Schema.Schema<A>);
    return values.every((value) => isDecodedRow(value))
      ? values
      : values.map((value) => Schema.decodeUnknownSync(schema as Schema.Decoder<A>)(value));
  } catch (error) {
    throw catchSnapshotCodecError(operation, path)(error);
  }
};

const decodeCollectionDefinitionValuesEffect = <A extends object, K extends CollectionKey>(
  definition: CollectionSnapshotDefinition<A, K>,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> =>
  decodeCollectionOutputValues(definition.options.output, values, operation, path);

const describeCollectionKey = (key: CollectionKey): string =>
  typeof key === "string" ? JSON.stringify(key) : String(key);

const collectionDefinitionKeyEffect = <A extends object, K extends CollectionKey>(
  definition: CollectionSnapshotDefinition<A, K>,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): Effect.Effect<K, EffectInputCallbackError> =>
  Effect.try({
    try: () => definition.getKey(value),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: `Collection.${operation}(${definition.name}).getKey`,
        cause,
        guidance: `Collection snapshot getKey callbacks must be synchronous, pure, and total. The failing value was at ${path}.`,
      }),
  });

const validateCollectionValueKeyEffect = <A extends object, K extends CollectionKey>(
  definition: CollectionSnapshotDefinition<A, K>,
  snapshotKey: K,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  keyPath: string,
  valuePath: string,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const valueKey = yield* collectionDefinitionKeyEffect(definition, value, operation, valuePath);
    if (!Object.is(valueKey, snapshotKey)) {
      return yield* Effect.fail(
        new CollectionSnapshotCodecError({
          operation,
          path: keyPath,
          reason: `Expected snapshot key ${describeCollectionKey(snapshotKey)} to match decoded value key ${describeCollectionKey(valueKey)}.`,
        }),
      );
    }
  });

const validateCollectionPlainSnapshotValueEffect = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): Effect.Effect<void, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => {
      const executable = collectionExecutableValuePath(value, path);
      if (executable !== undefined) {
        throw new CollectionSnapshotCodecError({
          operation,
          path: executable.path,
          reason: executable.reason,
        });
      }
    },
    catch: (cause) =>
      cause instanceof CollectionSnapshotCodecError
        ? cause
        : new CollectionSnapshotCodecError({
            operation,
            path: cause instanceof CollectionValueReadError ? cause.path : path,
            reason: "Expected collection snapshot values to be readable plain data.",
          }),
  });

export const validateCollectionSnapshotDefinition = <A extends object, K extends CollectionKey>(
  definition: CollectionSnapshotDefinition<A, K>,
  value: CollectionSnapshot<A, K>,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$",
): Effect.Effect<
  CollectionSnapshot<A, K>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  Effect.gen(function* () {
    const snapshot = yield* validateCollectionSnapshotEffect<A, K>(value, operation, path);
    if (snapshot.name !== definition.name) {
      return yield* Effect.fail(
        new CollectionSnapshotCodecError({
          operation,
          path: `${path}.name`,
          reason: `Expected collection snapshot for '${definition.name}' but received '${snapshot.name}'.`,
        }),
      );
    }

    const values: Array<A> = [];

    for (const row of snapshot.rows) {
      values.push(row.value);
    }
    const decoded = yield* decodeCollectionDefinitionValuesEffect(
      definition,
      values,
      operation,
      path,
    );
    let index = 0;
    const nextValue = (): A => decoded[index++] as A;
    const rows: Array<CollectionRowSnapshot<A, K>> = [];

    for (const [rowIndex, row] of snapshot.rows.entries()) {
      const value = nextValue();
      const rowPath = `${path}.rows[${rowIndex}]`;
      yield* validateCollectionPlainSnapshotValueEffect(value, operation, `${rowPath}.value`);
      yield* validateCollectionValueKeyEffect(
        definition,
        row.key,
        value,
        operation,
        `${rowPath}.key`,
        `${rowPath}.value`,
      );
      rows.push({ ...row, value });
    }

    return { ...snapshot, rows };
  });

export const validateCollectionHydrationPayloadSync = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
): CollectionHydrationPayload => {
  const payload = decodeEnvelope(CollectionHydrationPayloadSchema, value, operation, "$");
  return {
    collections: payload.collections.map((snapshot, index) =>
      detachSnapshotValues(snapshot, operation, `$.collections[${index}]`),
    ),
  };
};

export const validateCollectionHydrationPayload = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionHydrationPayloadSync(value, operation),
    catch: catchSnapshotCodecError(operation, "$"),
  });

export const storedRowSnapshot = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>,
): CollectionRowSnapshot<A, K> => ({
  key: row.key,
  value: cloneValue(row.value),
  synced: row.synced,
  origin: row.origin,
});

const storedRowFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionRowSnapshot<A, K>,
): StoredRow<A, K> => ({
  key: snapshot.key,
  value: snapshot.value,
  synced: snapshot.synced,
  origin: snapshot.origin,
});

export const collectionSnapshotFromState = <A extends object, K extends CollectionKey, E>(
  definition: { readonly name: string },
  state: CollectionState<A, K, E>,
  updatedAt: number,
): CollectionSnapshot<A, K> => {
  state.version.get();
  return {
    name: definition.name,
    rows: collectionBaseRows(state).map(storedRowSnapshot),
    updatedAt,
  };
};

/**
 * Applies a snapshot as the synced base. Optimistic Action patches in the
 * target store stay layered on top: `replace` swaps every base row, while a
 * merge only writes the snapshot's rows.
 */
const applyValidatedCollectionSnapshotState = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
): CollectionSnapshot<A, K> => {
  const rebaseKeys = new Set<K>();
  if (options.replace !== false) {
    state.rows.clear();
    for (const key of state.optimisticRows.keys()) {
      deleteCollectionBaseRow(state, key, rebaseKeys);
    }
  }

  for (const row of snapshot.rows) {
    applyCollectionBaseRow(state, storedRowFromSnapshot(row), rebaseKeys);
  }
  rebaseCollectionBaseRows(state, rebaseKeys);

  commitCollectionLoadState(
    state,
    AsyncResult.success(undefined, { timestamp: snapshot.updatedAt }),
  );
  return snapshot;
};

export const hydrateCollectionSnapshotState = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  value: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.flatMap(validateCollectionSnapshotEffect<A, K>(value, "hydrate"), (snapshot) =>
    Effect.try({
      try: () => applyValidatedCollectionSnapshotState(state, snapshot, options),
      catch: catchSnapshotCodecError("hydrate", "$"),
    }),
  );
