import type {
  CollectionKey,
  CollectionMutation,
  CollectionTransaction,
} from "./collection-contract.js";
import {
  pendingEntryFromSnapshot,
  pendingMutationSnapshot,
  pendingMutationSnapshots,
} from "./collection-snapshot-codec.js";
import {
  bumpCollectionState,
  type CollectionState,
  type PendingMutationEntry,
  type StoredRow,
} from "./collection-state.js";
import { cloneFrozenCollectionTransaction } from "./collection-value-detachment.js";

const transactionIdPattern = /^ctx_(\d+)$/;

export const createCollectionTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  collection: string,
  mutations: ReadonlyArray<CollectionMutation<A, K>>,
): CollectionTransaction<A, K> =>
  cloneFrozenCollectionTransaction({
    id: `ctx_${++state.nextTransactionId}`,
    collection,
    mutations,
  });

export const advanceCollectionTransactionIdentity = (
  state: CollectionState<any, any, any>,
  id: string,
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

export { pendingEntryFromSnapshot, pendingMutationSnapshot, pendingMutationSnapshots };

export const enqueuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  mutation: CollectionTransaction<A, K>,
  rollbackRows: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  createdAt: number,
): PendingMutationEntry<A, K> => {
  const existing = state.pendingMutations.get(mutation.id);
  if (existing) {
    return existing;
  }

  const entry: PendingMutationEntry<A, K> = {
    transaction: cloneFrozenCollectionTransaction(mutation),
    rollbackRows: new Map(rollbackRows),
    createdAt,
    attempts: 0,
    activeAttempt: undefined,
  };
  state.pendingMutations.set(mutation.id, entry);
  bumpCollectionState(state);
  return entry;
};

export const dequeuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  id: string,
): void => {
  if (state.pendingMutations.delete(id)) {
    bumpCollectionState(state);
  }
};

export const recordPendingMutationAttempt = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>,
): CollectionTransaction<A, K> => {
  entry.attempts += 1;
  return entry.transaction;
};
