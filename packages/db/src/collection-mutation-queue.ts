import type {
  CollectionKey,
  CollectionMutation,
  CollectionPendingMutation,
  CollectionRollbackRow,
  CollectionTransaction
} from "./index.js";
import {
  bumpCollectionState,
  storedRowFromSnapshot,
  storedRowSnapshot,
  type CollectionState,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";

const transactionIdPattern = /^ctx_(\d+)$/;

export const createCollectionTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  collection: string,
  mutations: ReadonlyArray<CollectionMutation<A, K>>
): CollectionTransaction<A, K> => ({
  id: `ctx_${++state.nextTransactionId}`,
  collection,
  mutations
});

export const advanceCollectionTransactionIdentity = (
  state: CollectionState<any, any, any>,
  id: string
): void => {
  const matched = transactionIdPattern.exec(id);
  if (!matched) {
    return;
  }

  const value = Number.parseInt(matched[1] ?? "0", 10);
  if (Number.isSafeInteger(value) && value > state.nextTransactionId) {
    state.nextTransactionId = value;
  }
};

const rollbackRowSnapshot = <A extends object, K extends CollectionKey>(
  key: K,
  row: StoredRow<A, K> | undefined
): CollectionRollbackRow<A, K> =>
  row
    ? { key, row: storedRowSnapshot(row) }
    : { key };

export const pendingMutationSnapshot = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>
): CollectionPendingMutation<A, K> => ({
  transaction: entry.transaction,
  rollbackRows: Array.from(entry.rollbackRows, ([key, row]) => rollbackRowSnapshot(key, row)),
  createdAt: entry.createdAt,
  attempts: entry.attempts
});

export const pendingEntryFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionPendingMutation<A, K>
): PendingMutationEntry<A, K> => ({
  transaction: snapshot.transaction,
  rollbackRows: new Map(snapshot.rollbackRows.map((rollback) => [
    rollback.key,
    rollback.row ? storedRowFromSnapshot(rollback.row) : undefined
  ])),
  createdAt: snapshot.createdAt,
  attempts: snapshot.attempts
});

export const pendingMutationSnapshots = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>
): ReadonlyArray<CollectionPendingMutation<A, K>> =>
  Array.from(state.pendingMutations.values(), pendingMutationSnapshot);

export const enqueuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  mutation: CollectionTransaction<A, K>,
  rollbackRows: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  createdAt: number
): PendingMutationEntry<A, K> => {
  const existing = state.pendingMutations.get(mutation.id);
  if (existing) {
    return existing;
  }

  const entry: PendingMutationEntry<A, K> = {
    transaction: mutation,
    rollbackRows: new Map(rollbackRows),
    createdAt,
    attempts: 0
  };
  state.pendingMutations.set(mutation.id, entry);
  bumpCollectionState(state);
  return entry;
};

export const dequeuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  id: string
): void => {
  if (state.pendingMutations.delete(id)) {
    bumpCollectionState(state);
  }
};

export const recordPendingMutationAttempt = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>
): CollectionTransaction<A, K> => {
  entry.attempts += 1;
  return entry.transaction;
};
