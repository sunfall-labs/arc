import { EffectInputCallbackError } from "@sunfall/arc-core";
import { Effect, Data, Schema, SchemaAST } from "effect";
import { AsyncResult } from "effect/reactivity";
import type {
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionOrigin,
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

const failCodec = (
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string,
): never => {
  throw new CollectionSnapshotCodecError({ operation, path, reason });
};

const assertCodec: (
  condition: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string,
) => asserts condition = (
  condition: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string,
) => {
  if (!condition) {
    failCodec(operation, path, reason);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isObjectValue = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const cloneValue = <A>(value: A): A => cloneCollectionValue(value);

export const validateCollectionKey = <K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): K => {
  assertCodec(
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value)),
    operation,
    path,
    "Expected a string or finite number collection key.",
  );
  return value as K;
};

const validateKey = validateCollectionKey;

const validateString = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): string => {
  assertCodec(typeof value === "string", operation, path, "Expected a string.");
  return value;
};

const validateNumber = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): number => {
  assertCodec(
    typeof value === "number" && Number.isFinite(value),
    operation,
    path,
    "Expected a finite number.",
  );
  return value;
};

const validateOrigin = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): CollectionOrigin => {
  assertCodec(
    value === "local" || value === "remote",
    operation,
    path,
    "Expected collection origin to be 'local' or 'remote'.",
  );
  return value;
};

const validateObjectValue = <A extends object>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): A => {
  assertCodec(isObjectValue(value), operation, path, "Expected a non-null object value.");
  return cloneValue(value) as A;
};

const validateRecord = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  label: string,
): Record<string, unknown> => {
  assertCodec(isRecord(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateArray = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  label: string,
): ReadonlyArray<unknown> => {
  assertCodec(Array.isArray(value), operation, path, `Expected ${label}.`);
  return value;
};

export const validateCollectionRowSnapshot = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
): CollectionRowSnapshot<A, K> => {
  const row = validateRecord(value, operation, path, "a collection row snapshot");
  const synced = row.synced;
  assertCodec(
    typeof synced === "boolean",
    operation,
    `${path}.synced`,
    "Expected a boolean sync flag.",
  );
  return {
    key: validateKey<K>(row.key, operation, `${path}.key`),
    value: validateObjectValue<A>(row.value, operation, `${path}.value`),
    synced,
    origin: validateOrigin(row.origin, operation, `${path}.origin`),
  };
};

export const validateCollectionSnapshot = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$",
): CollectionSnapshot<A, K> => {
  const snapshot = validateRecord(value, operation, path, "a collection snapshot");
  const rows = validateArray(snapshot.rows, operation, `${path}.rows`, "a row snapshot array");
  const decodedRows = rows.map((row, index) =>
    validateCollectionRowSnapshot<A, K>(row, operation, `${path}.rows[${index}]`),
  );
  const rowKeys = new Set<CollectionKey>();
  decodedRows.forEach((row, index) => {
    assertCodec(
      !rowKeys.has(row.key),
      operation,
      `${path}.rows[${index}].key`,
      `Duplicate row key '${String(row.key)}' in collection snapshot.`,
    );
    rowKeys.add(row.key);
  });

  return {
    name: validateString(snapshot.name, operation, `${path}.name`),
    rows: decodedRows,
    updatedAt: validateNumber(snapshot.updatedAt, operation, `${path}.updatedAt`),
  };
};

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

export const validateCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
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

export const decodeCollectionOutputValuesEffect = <A extends object>(
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
  decodeCollectionOutputValuesEffect(definition.options.output, values, operation, path);

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

export const validateCollectionSnapshotDefinitionEffect = <
  A extends object,
  K extends CollectionKey,
>(
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

export const validateCollectionHydrationPayload = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
): CollectionHydrationPayload => {
  const payload = validateRecord(value, operation, "$", "a collection hydration payload");
  const collections = validateArray(
    payload.collections,
    operation,
    "$.collections",
    "a collection snapshot array",
  );
  const decodedCollections = collections.map((snapshot, index) =>
    validateCollectionSnapshot(snapshot, operation, `$.collections[${index}]`),
  );
  const names = new Set<string>();
  decodedCollections.forEach((snapshot, index) => {
    assertCodec(
      !names.has(snapshot.name),
      operation,
      `$.collections[${index}].name`,
      `Duplicate collection '${snapshot.name}' in collection hydration payload.`,
    );
    names.add(snapshot.name);
  });
  return {
    collections: decodedCollections,
  };
};

export const validateCollectionHydrationPayloadEffect = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionHydrationPayload(value, operation),
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

export const storedRowFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionRowSnapshot<A, K>,
): StoredRow<A, K> => {
  const row = validateCollectionRowSnapshot<A, K>(snapshot, "hydrate", "$.row");
  return {
    key: row.key,
    value: row.value,
    synced: row.synced,
    origin: row.origin,
  };
};

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

export const collectionSnapshotFromValues = <A extends object, K extends CollectionKey>(
  name: string,
  values: ReadonlyArray<A>,
  getKey: (value: A) => K,
  updatedAt: number,
): CollectionSnapshot<A, K> => ({
  name,
  rows: values.map((value) => ({
    key: getKey(value),
    value: cloneValue(value),
    synced: true,
    origin: "remote",
  })),
  updatedAt,
});

export const collectionSnapshotFromValuesEffect = <A extends object, K extends CollectionKey>(
  name: string,
  values: ReadonlyArray<A>,
  getKey: (value: A) => K,
  updatedAt: number,
): Effect.Effect<CollectionSnapshot<A, K>, EffectInputCallbackError> =>
  Effect.try({
    try: () => collectionSnapshotFromValues(name, values, getKey, updatedAt),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: `Collection.snapshot(${name}).getKey`,
        cause,
        guidance:
          "Collection snapshot key callbacks must be synchronous, pure, and total. Move Effectful work into collection loaders or mutation handlers.",
      }),
  });

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
): CollectionSnapshot<A, K> =>
  applyValidatedCollectionSnapshotState(
    state,
    validateCollectionSnapshot<A, K>(value, "hydrate"),
    options,
  );

export const hydrateCollectionSnapshotStateEffect = <A extends object, K extends CollectionKey, E>(
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

export const encodeCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  value: CollectionSnapshot<A, K>,
): Effect.Effect<string, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => {
      const snapshot = validateCollectionSnapshot<A, K>(value, "encode");
      const encoded = JSON.stringify(snapshot);
      assertCodec(
        typeof encoded === "string",
        "encode",
        "$",
        "Expected JSON.stringify to return a string.",
      );
      return encoded;
    },
    catch: catchSnapshotCodecError("encode", "$"),
  });

export const decodeCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  encoded: string,
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionSnapshot<A, K>(JSON.parse(encoded), "decode"),
    catch: catchSnapshotCodecError("decode", "$"),
  });
