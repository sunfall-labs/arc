import { EffectInputCallbackError } from "@effect-ui/core";
import { Effect, Data, Schema } from "effect";
import type {
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionMutation,
  CollectionOrigin,
  CollectionPendingMutation,
  CollectionRollbackRow,
  CollectionRowSnapshot,
  CollectionSnapshot,
  CollectionTransaction
} from "./collection-contract.js";
import {
  applyCollectionBaseRow,
  bumpCollectionState,
  cloneStoredRow,
  rebaseCollectionBaseRows,
  restoreStoredRows,
  syncOptimisticRowsFromPendingMutations,
  type CollectionState,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";
import {
  cloneCollectionValue,
  cloneFrozenCollectionTransaction,
  collectionValueChanges
} from "./collection-value-detachment.js";

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
export class CollectionSnapshotCodecError extends Data.TaggedError(
  "CollectionSnapshotCodecError"
)<{
  readonly operation: CollectionSnapshotCodecOperation;
  readonly path: string;
  readonly reason: string;
}> {}

const failCodec = (
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string
): never => {
  throw new CollectionSnapshotCodecError({ operation, path, reason });
};

const assertCodec: (
  condition: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string
) => asserts condition = (
  condition: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  reason: string
) => {
  if (!condition) {
    failCodec(operation, path, reason);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isObjectValue = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const cloneValue = <A>(value: A): A => cloneCollectionValue(value);

export const validateCollectionKey = <K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): K => {
  assertCodec(
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value)),
    operation,
    path,
    "Expected a string or finite number collection key."
  );
  return value as K;
};

const validateKey = validateCollectionKey;

const validateString = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): string => {
  assertCodec(typeof value === "string", operation, path, "Expected a string.");
  return value;
};

const validateNumber = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): number => {
  assertCodec(
    typeof value === "number" && Number.isFinite(value),
    operation,
    path,
    "Expected a finite number."
  );
  return value;
};

const validateNonNegativeSafeInteger = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): number => {
  assertCodec(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    operation,
    path,
    "Expected a non-negative safe integer."
  );
  return value;
};

const validateOrigin = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionOrigin => {
  assertCodec(
    value === "local" || value === "remote",
    operation,
    path,
    "Expected collection origin to be 'local' or 'remote'."
  );
  return value;
};

const validateObjectValue = <A extends object>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): A => {
  assertCodec(isObjectValue(value), operation, path, "Expected a non-null object value.");
  return cloneValue(value) as A;
};

const validateChangeObject = <A extends object>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Partial<A> => {
  assertCodec(isObjectValue(value), operation, path, "Expected a non-null changes object.");
  return cloneValue(value) as Partial<A>;
};

const validateRecord = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  label: string
): Record<string, unknown> => {
  assertCodec(isRecord(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateArray = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string,
  label: string
): ReadonlyArray<unknown> => {
  assertCodec(Array.isArray(value), operation, path, `Expected ${label}.`);
  return value;
};

export const validateCollectionRowSnapshot = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionRowSnapshot<A, K> => {
  const row = validateRecord(value, operation, path, "a collection row snapshot");
  const synced = row.synced;
  assertCodec(typeof synced === "boolean", operation, `${path}.synced`, "Expected a boolean sync flag.");
  return {
    key: validateKey<K>(row.key, operation, `${path}.key`),
    value: validateObjectValue<A>(row.value, operation, `${path}.value`),
    synced,
    origin: validateOrigin(row.origin, operation, `${path}.origin`)
  };
};

const validateCollectionMutation = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionMutation<A, K> => {
  const mutation = validateRecord(value, operation, path, "a collection mutation snapshot");
  const tag = mutation._tag;
  switch (tag) {
    case "Insert": {
      const base = {
        _tag: "Insert" as const,
        key: validateKey<K>(mutation.key, operation, `${path}.key`),
        value: validateObjectValue<A>(mutation.value, operation, `${path}.value`)
      };
      return hasOwn(mutation, "previous") && mutation.previous !== undefined
        ? {
            ...base,
            previous: validateObjectValue<A>(mutation.previous, operation, `${path}.previous`)
          }
        : base;
    }
    case "Update":
      return {
        _tag: "Update",
        key: validateKey<K>(mutation.key, operation, `${path}.key`),
        previous: validateObjectValue<A>(mutation.previous, operation, `${path}.previous`),
        value: validateObjectValue<A>(mutation.value, operation, `${path}.value`),
        changes: validateChangeObject<A>(mutation.changes, operation, `${path}.changes`)
      };
    case "Delete":
      return {
        _tag: "Delete",
        key: validateKey<K>(mutation.key, operation, `${path}.key`),
        previous: validateObjectValue<A>(mutation.previous, operation, `${path}.previous`)
      };
  }

  return failCodec(operation, `${path}._tag`, "Expected mutation tag Insert, Update, or Delete.");
};

const validateCollectionTransaction = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionTransaction<A, K> => {
  const transaction = validateRecord(value, operation, path, "a collection transaction snapshot");
  const mutations = validateArray(
    transaction.mutations,
    operation,
    `${path}.mutations`,
    "a mutation array"
  );
  return {
    id: validateString(transaction.id, operation, `${path}.id`),
    collection: validateString(transaction.collection, operation, `${path}.collection`),
    mutations: mutations.map((mutation, index) =>
      validateCollectionMutation<A, K>(mutation, operation, `${path}.mutations[${index}]`)
    )
  };
};

const validateCollectionRollbackRow = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionRollbackRow<A, K> => {
  const rollback = validateRecord(value, operation, path, "a collection rollback row snapshot");
  const key = validateKey<K>(rollback.key, operation, `${path}.key`);
  return hasOwn(rollback, "row") && rollback.row !== undefined
    ? {
        key,
        row: validateCollectionRowSnapshot<A, K>(rollback.row, operation, `${path}.row`)
      }
    : { key };
};

export const validateCollectionPendingMutation = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): CollectionPendingMutation<A, K> => {
  const pending = validateRecord(value, operation, path, "a pending collection mutation snapshot");
  const transaction = validateCollectionTransaction<A, K>(pending.transaction, operation, `${path}.transaction`);
  const rollbackValues = validateArray(
    pending.rollbackRows,
    operation,
    `${path}.rollbackRows`,
    "a rollback row array"
  );
  const rollbackRows = rollbackValues.map((rollback, index) =>
    validateCollectionRollbackRow<A, K>(rollback, operation, `${path}.rollbackRows[${index}]`)
  );
  const mutationKeys = new Set<K>(transaction.mutations.map((mutation) => mutation.key));
  const rollbackKeys = new Set<K>();

  for (const [rollbackIndex, rollback] of rollbackRows.entries()) {
    const rollbackPath = `${path}.rollbackRows[${rollbackIndex}]`;
    assertCodec(
      !rollbackKeys.has(rollback.key),
      operation,
      `${rollbackPath}.key`,
      `Rollback row key ${String(rollback.key)} appears more than once.`
    );
    assertCodec(
      mutationKeys.has(rollback.key),
      operation,
      `${rollbackPath}.key`,
      `Rollback row key ${String(rollback.key)} is not part of the pending transaction.`
    );
    assertCodec(
      rollback.row === undefined || Object.is(rollback.row.key, rollback.key),
      operation,
      `${rollbackPath}.row.key`,
      "Rollback row key must match its rollback entry key."
    );
    rollbackKeys.add(rollback.key);
  }

  for (const key of mutationKeys) {
    assertCodec(
      rollbackKeys.has(key),
      operation,
      `${path}.rollbackRows`,
      `Missing rollback row for pending mutation key ${String(key)}.`
    );
  }

  return {
    transaction,
    rollbackRows,
    createdAt: validateNumber(pending.createdAt, operation, `${path}.createdAt`),
    attempts: validateNonNegativeSafeInteger(pending.attempts, operation, `${path}.attempts`)
  };
};

export const validateCollectionSnapshot = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$"
): CollectionSnapshot<A, K> => {
  const snapshot = validateRecord(value, operation, path, "a collection snapshot");
  const rows = validateArray(snapshot.rows, operation, `${path}.rows`, "a row snapshot array");
  const pendingMutations = snapshot.pendingMutations === undefined
    ? []
    : validateArray(
        snapshot.pendingMutations,
        operation,
        `${path}.pendingMutations`,
        "a pending mutation array"
      );
  const decodedRows = rows.map((row, index) =>
    validateCollectionRowSnapshot<A, K>(row, operation, `${path}.rows[${index}]`)
  );
  const rowKeys = new Set<CollectionKey>();
  decodedRows.forEach((row, index) => {
    assertCodec(
      !rowKeys.has(row.key),
      operation,
      `${path}.rows[${index}].key`,
      `Duplicate row key '${String(row.key)}' in collection snapshot.`
    );
    rowKeys.add(row.key);
  });

  const decodedPendingMutations = pendingMutations.map((pending, index) =>
    validateCollectionPendingMutation<A, K>(pending, operation, `${path}.pendingMutations[${index}]`)
  );
  const pendingTransactionIds = new Set<string>();
  decodedPendingMutations.forEach((pending, index) => {
    const id = pending.transaction.id;
    assertCodec(
      !pendingTransactionIds.has(id),
      operation,
      `${path}.pendingMutations[${index}].transaction.id`,
      `Duplicate pending transaction id '${id}' in collection snapshot.`
    );
    pendingTransactionIds.add(id);
  });

  return {
    name: validateString(snapshot.name, operation, `${path}.name`),
    rows: decodedRows,
    pendingMutations: decodedPendingMutations,
    updatedAt: validateNumber(snapshot.updatedAt, operation, `${path}.updatedAt`)
  };
};

const catchSnapshotCodecError = (
  operation: CollectionSnapshotCodecOperation,
  path: string
) => (error: unknown): CollectionSnapshotCodecError => {
  if (error instanceof CollectionSnapshotCodecError) {
    return error;
  }

  return new CollectionSnapshotCodecError({
    operation,
    path,
    reason: error instanceof Error ? error.message : String(error)
  });
};

export const validateCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$"
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionSnapshot<A, K>(value, operation, path),
    catch: catchSnapshotCodecError(operation, path)
  });

/**
 * Decodes collection output schema failures into the snapshot codec error seam.
 *
 * Public Collection and Query Interfaces should not expose raw schema errors;
 * callers see `CollectionSnapshotCodecError` with the
 * path that failed inside the hydrated or loaded snapshot.
 */
export const decodeCollectionOutputValuesEffect = <A extends object>(
  schema: unknown,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(values);
  }

  const candidateValues = values;
  const isDecodedCollection = Schema.is(schema as Schema.Schema<ReadonlyArray<A>>);
  if (isDecodedCollection(candidateValues as unknown)) {
    return Effect.succeed(values);
  }

  const isDecodedValue = Schema.is(schema as Schema.Schema<A>);
  if (candidateValues.every((value) => isDecodedValue(value as unknown))) {
    return Effect.succeed(values);
  }

  const decodeValues = Schema.decodeUnknownEffect(schema as Schema.Decoder<ReadonlyArray<A>>)(values);
  const decodeRows = Effect.all(
    candidateValues.map((value) => Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(value))
  ).pipe(Effect.map((decoded) => decoded as ReadonlyArray<A>));

  return decodeValues.pipe(
    Effect.catch(() => decodeRows),
    Effect.mapError(catchSnapshotCodecError(operation, path))
  );
};

export const decodeCollectionOutputValuesSync = <A extends object>(
  schema: unknown,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string
): ReadonlyArray<A> => {
  if (!Schema.isSchema(schema)) {
    return values;
  }

  try {
    const candidateValues = values;
    const isDecodedCollection = Schema.is(schema as Schema.Schema<ReadonlyArray<A>>);
    if (isDecodedCollection(candidateValues as unknown)) {
      return values;
    }

    const isDecodedValue = Schema.is(schema as Schema.Schema<A>);
    if (candidateValues.every((value) => isDecodedValue(value as unknown))) {
      return values;
    }

    try {
      return Schema.decodeUnknownSync(schema as Schema.Decoder<ReadonlyArray<A>>)(values);
    } catch {
      return candidateValues.map((value) =>
        Schema.decodeUnknownSync(schema as Schema.Decoder<A>)(value)
      ) as ReadonlyArray<A>;
    }
  } catch (error) {
    throw catchSnapshotCodecError(operation, path)(error);
  }
};

const decodeCollectionDefinitionValuesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> =>
  decodeCollectionOutputValuesEffect(definition.options.output, values, operation, path);

const describeCollectionKey = (key: CollectionKey): string =>
  typeof key === "string" ? JSON.stringify(key) : String(key);

const collectionDefinitionKeyEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<K, EffectInputCallbackError> =>
  Effect.try({
    try: () => definition.getKey(value),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: `Collection.${operation}(${definition.name}).getKey`,
        cause,
        guidance: `Collection snapshot getKey callbacks must be synchronous, pure, and total. The failing value was at ${path}.`
      })
  });

const validateCollectionValueKeyEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshotKey: K,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  keyPath: string,
  valuePath: string
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const valueKey = yield* collectionDefinitionKeyEffect(definition, value, operation, valuePath);
    if (!Object.is(valueKey, snapshotKey)) {
      return yield* Effect.fail(new CollectionSnapshotCodecError({
        operation,
        path: keyPath,
        reason: `Expected snapshot key ${describeCollectionKey(snapshotKey)} to match decoded value key ${describeCollectionKey(valueKey)}.`
      }));
    }
  });

export const validateCollectionSnapshotDefinitionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  value: CollectionSnapshot<A, K>,
  operation: CollectionSnapshotCodecOperation = "hydrate",
  path = "$"
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const snapshot = yield* validateCollectionSnapshotEffect<A, K>(value, operation, path);
    if (snapshot.name !== definition.name) {
      return yield* Effect.fail(new CollectionSnapshotCodecError({
        operation,
        path: `${path}.name`,
        reason: `Expected collection snapshot for '${definition.name}' but received '${snapshot.name}'.`
      }));
    }

    const values: Array<A> = [];

    for (const row of snapshot.rows) {
      values.push(row.value);
    }
    for (const pending of snapshot.pendingMutations) {
      for (const mutation of pending.transaction.mutations) {
        switch (mutation._tag) {
          case "Insert":
            values.push(mutation.value);
            if (mutation.previous !== undefined) {
              values.push(mutation.previous);
            }
            break;
          case "Update":
            values.push(mutation.previous, mutation.value);
            break;
          case "Delete":
            values.push(mutation.previous);
            break;
        }
      }
      for (const rollback of pending.rollbackRows) {
        if (rollback.row) {
          values.push(rollback.row.value);
        }
      }
    }

    const decoded = yield* decodeCollectionDefinitionValuesEffect(definition, values, operation, path);
    let index = 0;
    const nextValue = (): A => decoded[index++] as A;
    const rows: Array<CollectionRowSnapshot<A, K>> = [];
    const pendingMutations: Array<CollectionPendingMutation<A, K>> = [];

    for (const [rowIndex, row] of snapshot.rows.entries()) {
      const value = nextValue();
      const rowPath = `${path}.rows[${rowIndex}]`;
      yield* validateCollectionValueKeyEffect(
        definition,
        row.key,
        value,
        operation,
        `${rowPath}.key`,
        `${rowPath}.value`
      );
      rows.push({ ...row, value });
    }

    for (const [pendingIndex, pending] of snapshot.pendingMutations.entries()) {
      const pendingPath = `${path}.pendingMutations[${pendingIndex}]`;
      if (pending.transaction.collection !== definition.name) {
        return yield* Effect.fail(new CollectionSnapshotCodecError({
          operation,
          path: `${pendingPath}.transaction.collection`,
          reason: `Expected pending mutation for collection '${definition.name}' but received '${pending.transaction.collection}'.`
        }));
      }

      const mutations: Array<CollectionMutation<A, K>> = [];
      for (const [mutationIndex, mutation] of pending.transaction.mutations.entries()) {
        const mutationPath = `${pendingPath}.transaction.mutations[${mutationIndex}]`;
        switch (mutation._tag) {
          case "Insert": {
            const value = nextValue();
            yield* validateCollectionValueKeyEffect(
              definition,
              mutation.key,
              value,
              operation,
              `${mutationPath}.key`,
              `${mutationPath}.value`
            );
            if (mutation.previous === undefined) {
              mutations.push({ ...mutation, value });
            } else {
              const previous = nextValue();
              yield* validateCollectionValueKeyEffect(
                definition,
                mutation.key,
                previous,
                operation,
                `${mutationPath}.key`,
                `${mutationPath}.previous`
              );
              mutations.push({ ...mutation, value, previous });
            }
            break;
          }
          case "Update": {
            const previous = nextValue();
            const value = nextValue();
            yield* validateCollectionValueKeyEffect(
              definition,
              mutation.key,
              previous,
              operation,
              `${mutationPath}.key`,
              `${mutationPath}.previous`
            );
            yield* validateCollectionValueKeyEffect(
              definition,
              mutation.key,
              value,
              operation,
              `${mutationPath}.key`,
              `${mutationPath}.value`
            );
            mutations.push({
              ...mutation,
              previous,
              value,
              changes: collectionValueChanges(previous, value)
            });
            break;
          }
          case "Delete": {
            const previous = nextValue();
            yield* validateCollectionValueKeyEffect(
              definition,
              mutation.key,
              previous,
              operation,
              `${mutationPath}.key`,
              `${mutationPath}.previous`
            );
            mutations.push({ ...mutation, previous });
            break;
          }
        }
      }

      const rollbackRows: Array<CollectionRollbackRow<A, K>> = [];
      for (const [rollbackIndex, rollback] of pending.rollbackRows.entries()) {
        if (!rollback.row) {
          rollbackRows.push(rollback);
          continue;
        }

        const value = nextValue();
        const rollbackPath = `${pendingPath}.rollbackRows[${rollbackIndex}].row`;
        yield* validateCollectionValueKeyEffect(
          definition,
          rollback.row.key,
          value,
          operation,
          `${rollbackPath}.key`,
          `${rollbackPath}.value`
        );
        rollbackRows.push({
          ...rollback,
          row: {
            ...rollback.row,
            value
          }
        });
      }

      pendingMutations.push({
        ...pending,
        transaction: {
          ...pending.transaction,
          mutations
        },
        rollbackRows
      });
    }

    return {
      ...snapshot,
      rows,
      pendingMutations
    };
  });

export const validateCollectionHydrationPayload = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate"
): CollectionHydrationPayload => {
  const payload = validateRecord(value, operation, "$", "a collection hydration payload");
  const collections = validateArray(payload.collections, operation, "$.collections", "a collection snapshot array");
  const decodedCollections = collections.map((snapshot, index) =>
    validateCollectionSnapshot(snapshot, operation, `$.collections[${index}]`)
  );
  const names = new Set<string>();
  decodedCollections.forEach((snapshot, index) => {
    assertCodec(
      !names.has(snapshot.name),
      operation,
      `$.collections[${index}].name`,
      `Duplicate collection '${snapshot.name}' in collection hydration payload.`
    );
    names.add(snapshot.name);
  });
  return {
    collections: decodedCollections
  };
};

export const validateCollectionHydrationPayloadEffect = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate"
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionHydrationPayload(value, operation),
    catch: catchSnapshotCodecError(operation, "$")
  });

export const storedRowSnapshot = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>
): CollectionRowSnapshot<A, K> => ({
  key: row.key,
  value: cloneValue(row.value),
  synced: row.synced,
  origin: row.origin
});

export const storedRowFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionRowSnapshot<A, K>
): StoredRow<A, K> => {
  const row = validateCollectionRowSnapshot<A, K>(snapshot, "hydrate", "$.row");
  return {
    key: row.key,
    value: row.value,
    synced: row.synced,
    origin: row.origin
  };
};

const rollbackRowSnapshot = <A extends object, K extends CollectionKey>(
  key: K,
  row: StoredRow<A, K> | undefined
): CollectionRollbackRow<A, K> =>
  row
    ? { key, row: storedRowSnapshot(row) }
    : { key };

const cloneTransaction = <A extends object, K extends CollectionKey>(
  transaction: CollectionTransaction<A, K>
): CollectionTransaction<A, K> =>
  validateCollectionTransaction(transaction, "snapshot", "$.transaction");

export const pendingMutationSnapshot = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>
): CollectionPendingMutation<A, K> => ({
  transaction: cloneTransaction(entry.transaction),
  rollbackRows: Array.from(entry.rollbackRows, ([key, row]) => rollbackRowSnapshot(key, row)),
  createdAt: entry.createdAt,
  attempts: entry.attempts
});

export const pendingEntryFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionPendingMutation<A, K>
): PendingMutationEntry<A, K> => {
  const pending = validateCollectionPendingMutation<A, K>(snapshot, "hydrate", "$.pendingMutations[]");
  return {
    transaction: cloneFrozenCollectionTransaction(pending.transaction),
    rollbackRows: new Map(pending.rollbackRows.map((rollback) => [
      rollback.key,
      rollback.row ? storedRowFromSnapshot(rollback.row) : undefined
    ])),
    createdAt: pending.createdAt,
    attempts: pending.attempts,
    activeAttempt: undefined
  };
};

export const pendingMutationSnapshots = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>
): ReadonlyArray<CollectionPendingMutation<A, K>> =>
  Array.from(state.pendingMutations.values(), pendingMutationSnapshot);

export const collectionSnapshotFromState = <A extends object, K extends CollectionKey, E, R>(
  definition: { readonly name: string },
  state: CollectionState<A, K, E>,
  updatedAt: number
): CollectionSnapshot<A, K> => {
  state.version.get();
  return {
    name: definition.name,
    rows: Array.from(state.rows.values(), storedRowSnapshot),
    pendingMutations: Array.from(state.pendingMutations.values(), pendingMutationSnapshot),
    updatedAt
  };
};

export const collectionSnapshotFromValues = <A extends object, K extends CollectionKey>(
  name: string,
  values: ReadonlyArray<A>,
  getKey: (value: A) => K,
  updatedAt: number
): CollectionSnapshot<A, K> => ({
  name,
  rows: values.map((value) => ({
    key: getKey(value),
    value: cloneValue(value),
    synced: true,
    origin: "remote"
  })),
  pendingMutations: [],
  updatedAt
});

export const collectionSnapshotFromValuesEffect = <A extends object, K extends CollectionKey>(
  name: string,
  values: ReadonlyArray<A>,
  getKey: (value: A) => K,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<A, K>, EffectInputCallbackError> =>
  Effect.try({
    try: () => collectionSnapshotFromValues(name, values, getKey, updatedAt),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: `Collection.snapshot(${name}).getKey`,
        cause,
        guidance: "Collection snapshot key callbacks must be synchronous, pure, and total. Move Effectful work into collection loaders or mutation handlers."
      })
  });

export const validateCollectionSnapshotStateHydration = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions
): void => {
  snapshot.pendingMutations.forEach((pending, index) => {
    const id = pending.transaction.id;
    if (options.replace === false && state.pendingMutations.has(id)) {
      failCodec(
        "hydrate",
        `$.pendingMutations[${index}].transaction.id`,
        `Pending transaction id '${id}' already exists in the target collection state.`
      );
    }
  });
};

export const validateCollectionSnapshotStateHydrationEffect = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions
): Effect.Effect<void, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionSnapshotStateHydration(state, snapshot, options),
    catch: catchSnapshotCodecError("hydrate", "$")
  });

const applyValidatedCollectionSnapshotState = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
  advanceTransactionIdentity: (id: string) => void
): CollectionSnapshot<A, K> => {
  validateCollectionSnapshotStateHydration(state, snapshot, options);

  if (options.replace !== false) {
    state.rows.clear();
    state.pendingMutations.clear();
    state.optimisticRows.clear();
  }

  const incomingPendingKeys = new Set<K>();
  for (const pending of snapshot.pendingMutations) {
    for (const mutation of pending.transaction.mutations) {
      incomingPendingKeys.add(mutation.key);
    }
  }

  const rebaseKeys = new Set<K>();
  for (const row of snapshot.rows) {
    if (incomingPendingKeys.has(row.key)) {
      if (!state.optimisticRows.has(row.key)) {
        state.rows.set(row.key, cloneStoredRow(storedRowFromSnapshot(row)));
      }
      continue;
    }
    applyCollectionBaseRow(state, storedRowFromSnapshot(row), rebaseKeys);
  }

  for (const pending of snapshot.pendingMutations) {
    advanceTransactionIdentity(pending.transaction.id);
    state.pendingMutations.set(pending.transaction.id, pendingEntryFromSnapshot(pending));
  }

  if (snapshot.pendingMutations.length > 0) {
    syncOptimisticRowsFromPendingMutations(state);
  } else {
    rebaseCollectionBaseRows(state, rebaseKeys);
  }

  state.loadState.set({
    _tag: "Ready",
    waiting: false,
    updatedAt: snapshot.updatedAt
  });
  return snapshot;
};

export const hydrateCollectionSnapshotState = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  value: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
  advanceTransactionIdentity: (id: string) => void
): CollectionSnapshot<A, K> =>
  applyValidatedCollectionSnapshotState(
    state,
    validateCollectionSnapshot<A, K>(value, "hydrate"),
    options,
    advanceTransactionIdentity
  );

export const hydrateCollectionSnapshotStateEffect = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  value: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
  advanceTransactionIdentity: (id: string) => void
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.flatMap(
    validateCollectionSnapshotEffect<A, K>(value, "hydrate"),
    (snapshot) =>
      Effect.try({
        try: () =>
          applyValidatedCollectionSnapshotState(
            state,
            snapshot,
            options,
            advanceTransactionIdentity
          ),
        catch: catchSnapshotCodecError("hydrate", "$")
      })
  );

export const encodeCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  value: CollectionSnapshot<A, K>
): Effect.Effect<string, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => {
      const snapshot = validateCollectionSnapshot<A, K>(value, "encode");
      const encoded = JSON.stringify(snapshot);
      assertCodec(typeof encoded === "string", "encode", "$", "Expected JSON.stringify to return a string.");
      return encoded;
    },
    catch: catchSnapshotCodecError("encode", "$")
  });

export const decodeCollectionSnapshotEffect = <A extends object, K extends CollectionKey>(
  encoded: string
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => validateCollectionSnapshot<A, K>(JSON.parse(encoded), "decode"),
    catch: catchSnapshotCodecError("decode", "$")
  });
