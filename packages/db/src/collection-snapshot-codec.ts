import { Effect, Data } from "effect";
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
  bumpCollectionState,
  type CollectionState,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";

export type CollectionSnapshotCodecOperation =
  | "decode"
  | "encode"
  | "hydrate"
  | "snapshot";

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

const cloneValue = <A>(value: A, seen = new WeakMap<object, unknown>()): A => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as A;
  }

  const existing = seen.get(value);
  if (existing) {
    return existing as A;
  }

  if (Array.isArray(value)) {
    const output: Array<unknown> = [];
    seen.set(value, output);
    for (const entry of value) {
      output.push(cloneValue(entry, seen));
    }
    return output as A;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    output[key] = cloneValue(entry, seen);
  }
  return output as A;
};

const validateKey = <K extends CollectionKey>(
  value: unknown,
  operation: CollectionSnapshotCodecOperation,
  path: string
): K => {
  assertCodec(
    typeof value === "string" || typeof value === "number",
    operation,
    path,
    "Expected a string or number collection key."
  );
  return value as K;
};

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
  const rollbackRows = validateArray(
    pending.rollbackRows,
    operation,
    `${path}.rollbackRows`,
    "a rollback row array"
  );
  return {
    transaction: validateCollectionTransaction<A, K>(pending.transaction, operation, `${path}.transaction`),
    rollbackRows: rollbackRows.map((rollback, index) =>
      validateCollectionRollbackRow<A, K>(rollback, operation, `${path}.rollbackRows[${index}]`)
    ),
    createdAt: validateNumber(pending.createdAt, operation, `${path}.createdAt`),
    attempts: validateNumber(pending.attempts, operation, `${path}.attempts`)
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
  return {
    name: validateString(snapshot.name, operation, `${path}.name`),
    rows: rows.map((row, index) =>
      validateCollectionRowSnapshot<A, K>(row, operation, `${path}.rows[${index}]`)
    ),
    pendingMutations: pendingMutations.map((pending, index) =>
      validateCollectionPendingMutation<A, K>(pending, operation, `${path}.pendingMutations[${index}]`)
    ),
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

export const validateCollectionHydrationPayload = (
  value: unknown,
  operation: CollectionSnapshotCodecOperation = "hydrate"
): CollectionHydrationPayload => {
  const payload = validateRecord(value, operation, "$", "a collection hydration payload");
  const collections = validateArray(payload.collections, operation, "$.collections", "a collection snapshot array");
  return {
    collections: collections.map((snapshot, index) =>
      validateCollectionSnapshot(snapshot, operation, `$.collections[${index}]`)
    )
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

export const cloneStoredRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>
): StoredRow<A, K> => ({
  key: row.key,
  value: cloneValue(row.value),
  synced: row.synced,
  origin: row.origin
});

export const restoreStoredRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>
): void => {
  for (const [key, row] of snapshots) {
    if (row) {
      state.rows.set(key, cloneStoredRow(row));
    } else {
      state.rows.delete(key);
    }
  }
  bumpCollectionState(state);
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
    transaction: pending.transaction,
    rollbackRows: new Map(pending.rollbackRows.map((rollback) => [
      rollback.key,
      rollback.row ? storedRowFromSnapshot(rollback.row) : undefined
    ])),
    createdAt: pending.createdAt,
    attempts: pending.attempts
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

const applyValidatedCollectionSnapshotState = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions,
  advanceTransactionIdentity: (id: string) => void
): CollectionSnapshot<A, K> => {
  if (options.replace !== false) {
    state.rows.clear();
    state.pendingMutations.clear();
  }

  for (const row of snapshot.rows) {
    state.rows.set(row.key, storedRowFromSnapshot(row));
  }

  for (const pending of snapshot.pendingMutations) {
    advanceTransactionIdentity(pending.transaction.id);
    state.pendingMutations.set(pending.transaction.id, pendingEntryFromSnapshot(pending));
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
  Effect.map(
    validateCollectionSnapshotEffect<A, K>(value, "hydrate"),
    (snapshot) =>
      applyValidatedCollectionSnapshotState(
        state,
        snapshot,
        options,
        advanceTransactionIdentity
      )
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
