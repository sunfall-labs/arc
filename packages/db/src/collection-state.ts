import { Signal, type WritableSignal } from "@sunfall/arc-core";
import type { Deferred } from "effect";
import type {
  CollectionDefinition,
  CollectionKey,
  CollectionLoadState,
  CollectionMutation,
  CollectionRuntimeError,
  CollectionOrigin,
  CollectionRow,
  CollectionTransaction,
} from "./collection-contract.js";
import {
  cloneCollectionMutation,
  cloneCollectionTransaction,
  cloneCollectionValue,
  detachCollectionRow,
} from "./collection-value-detachment.js";
import type { CollectionIndexCacheEntry } from "./collection-index-materialization.js";

export interface StoredRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  value: A;
  synced: boolean;
  origin: CollectionOrigin;
}

export interface PendingMutationEntry<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
  readonly rollbackRows: Map<K, StoredRow<A, K> | undefined>;
  readonly createdAt: number;
  attempts: number;
  activeAttempt: PendingMutationAttempt<A, K> | undefined;
}

export interface PendingMutationAttempt<A extends object, K extends CollectionKey> {
  readonly id: number;
  readonly deferred: Deferred.Deferred<CollectionTransaction<A, K>, any>;
}

export interface CollectionLoadAttempt {
  readonly generation: number;
  readonly force: boolean;
  readonly deferred: Deferred.Deferred<void, any>;
}

export interface OptimisticRowPatch<A extends object, K extends CollectionKey> {
  readonly transactionId: string;
  readonly mutation: CollectionMutation<A, K>;
  committed: boolean;
}

export interface OptimisticRowStack<A extends object, K extends CollectionKey> {
  base: StoredRow<A, K> | undefined;
  readonly patches: Array<OptimisticRowPatch<A, K>>;
}

export interface CollectionState<A extends object, K extends CollectionKey, E> {
  readonly rows: Map<K, StoredRow<A, K>>;
  readonly pendingMutations: Map<string, PendingMutationEntry<A, K>>;
  readonly optimisticRows: Map<K, OptimisticRowStack<A, K>>;
  readonly indexCache: Map<string, CollectionIndexCacheEntry<A, K>>;
  readonly version: WritableSignal<number>;
  readonly loadState: WritableSignal<CollectionLoadState<CollectionRuntimeError<E>>>;
  nextTransactionId: number;
  nextMutationAttemptId: number;
  loadGeneration: number;
  activeLoad: CollectionLoadAttempt | undefined;
  initialized: boolean;
  initialDataError: CollectionRuntimeError<E> | undefined;
  persistenceRestored: boolean;
}

export const makeCollectionState = <
  A extends object,
  K extends CollectionKey,
  E,
>(): CollectionState<A, K, E> => ({
  rows: new Map(),
  pendingMutations: new Map(),
  optimisticRows: new Map(),
  indexCache: new Map(),
  version: Signal.make(0),
  loadState: Signal.make<CollectionLoadState<CollectionRuntimeError<E>>>({
    _tag: "Initial",
    waiting: false,
  }),
  nextTransactionId: 0,
  nextMutationAttemptId: 0,
  loadGeneration: 0,
  activeLoad: undefined,
  initialized: false,
  initialDataError: undefined,
  persistenceRestored: false,
});

export const bumpCollectionState = (state: CollectionState<any, any, any>): void => {
  state.indexCache.clear();
  state.version.update((value) => value + 1);
};

export const augmentCollectionRow = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  row: StoredRow<A, K>,
): CollectionRow<A, K> =>
  detachCollectionRow({
    collection: definition.name,
    key: row.key,
    value: row.value,
    synced: row.synced,
    origin: row.origin,
  });

export const markStoredRowsSynced = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  keys: ReadonlyArray<K>,
): void => {
  for (const key of keys) {
    const row = state.rows.get(key);
    if (row) {
      row.synced = true;
    }
  }
  bumpCollectionState(state);
};

export const cloneStoredRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>,
): StoredRow<A, K> => ({
  key: row.key,
  value: cloneCollectionValue(row.value),
  synced: row.synced,
  origin: row.origin,
});

export const cloneRollbackRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K> | undefined,
): StoredRow<A, K> | undefined => (row ? cloneStoredRow(row) : undefined);

export const cloneOptimisticRowStack = <A extends object, K extends CollectionKey>(
  stack: OptimisticRowStack<A, K>,
): OptimisticRowStack<A, K> => ({
  base: cloneRollbackRow(stack.base),
  patches: stack.patches.map((patch) => ({
    transactionId: patch.transactionId,
    mutation: cloneCollectionMutation(patch.mutation),
    committed: patch.committed,
  })),
});

export const clonePendingMutationEntry = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>,
  options: { readonly preserveActiveAttempt?: boolean } = {},
): PendingMutationEntry<A, K> => ({
  transaction: cloneCollectionTransaction(entry.transaction),
  rollbackRows: new Map(
    Array.from(entry.rollbackRows, ([key, row]) => [key, cloneRollbackRow(row)]),
  ),
  createdAt: entry.createdAt,
  attempts: entry.attempts,
  activeAttempt: options.preserveActiveAttempt === true ? entry.activeAttempt : undefined,
});

export const restoreStoredRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
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

export const restoreOptimisticState = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  rows: ReadonlyMap<K, StoredRow<A, K>>,
  pendingMutations: ReadonlyMap<string, PendingMutationEntry<A, K>>,
  optimisticRows: ReadonlyMap<K, OptimisticRowStack<A, K>>,
): void => {
  state.rows.clear();
  for (const [key, row] of rows) {
    state.rows.set(key, cloneStoredRow(row));
  }

  state.pendingMutations.clear();
  for (const [id, entry] of pendingMutations) {
    state.pendingMutations.set(
      id,
      clonePendingMutationEntry(entry, { preserveActiveAttempt: true }),
    );
  }

  state.optimisticRows.clear();
  for (const [key, stack] of optimisticRows) {
    state.optimisticRows.set(key, cloneOptimisticRowStack(stack));
  }
};

export const optimisticMutationKeys = <A extends object, K extends CollectionKey>(
  transaction: CollectionTransaction<A, K>,
): ReadonlyArray<K> => Array.from(new Set(transaction.mutations.map((mutation) => mutation.key)));

const applyOptimisticMutationToRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K> | undefined,
  mutation: CollectionMutation<A, K>,
): StoredRow<A, K> | undefined => {
  switch (mutation._tag) {
    case "Insert":
      return {
        key: mutation.key,
        value: cloneCollectionValue(mutation.value),
        synced: false,
        origin: "local",
      };
    case "Update": {
      const previous = row?.value ?? mutation.previous;
      return {
        key: mutation.key,
        value: cloneCollectionValue({ ...previous, ...mutation.changes } as A),
        synced: false,
        origin: "local",
      };
    }
    case "Delete":
      return undefined;
  }
};

const collapseCommittedOptimisticPatches = <A extends object, K extends CollectionKey>(
  stack: OptimisticRowStack<A, K>,
): void => {
  while (stack.patches[0]?.committed) {
    const [patch] = stack.patches.splice(0, 1);
    if (!patch) {
      return;
    }
    stack.base = applyOptimisticMutationToRow(stack.base, patch.mutation);
    if (stack.base) {
      stack.base.synced = true;
    }
  }
};

const rebaseOptimisticRow = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  key: K,
): void => {
  const stack = state.optimisticRows.get(key);
  if (!stack) {
    return;
  }

  collapseCommittedOptimisticPatches(stack);

  if (stack.patches.length === 0) {
    state.optimisticRows.delete(key);
    if (stack.base) {
      state.rows.set(key, cloneStoredRow(stack.base));
    } else {
      state.rows.delete(key);
    }
    return;
  }

  let row = cloneRollbackRow(stack.base);
  let hasPendingPatch = false;
  for (const patch of stack.patches) {
    const pending = state.pendingMutations.get(patch.transactionId);
    if (pending) {
      pending.rollbackRows.set(key, cloneRollbackRow(row));
    }
    row = applyOptimisticMutationToRow(row, patch.mutation);
    hasPendingPatch = hasPendingPatch || !patch.committed;
    if (row) {
      row.synced = !hasPendingPatch;
      row.origin = "local";
    }
  }

  if (row) {
    state.rows.set(key, row);
  } else {
    state.rows.delete(key);
  }
};

export const rebaseOptimisticRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  keys: ReadonlyArray<K>,
): void => {
  for (const key of keys) {
    rebaseOptimisticRow(state, key);
  }
  bumpCollectionState(state);
};

export const applyOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transaction: CollectionTransaction<A, K>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
): void => {
  for (const mutation of transaction.mutations) {
    let stack = state.optimisticRows.get(mutation.key);
    if (!stack) {
      stack = {
        base: cloneRollbackRow(snapshots.get(mutation.key)),
        patches: [],
      };
      state.optimisticRows.set(mutation.key, stack);
    }
    stack.patches.push({
      transactionId: transaction.id,
      mutation,
      committed: false,
    });
  }
  rebaseOptimisticRows(state, optimisticMutationKeys(transaction));
};

export const applyCollectionBaseRow = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  row: StoredRow<A, K>,
  rebaseKeys: Set<K>,
): void => {
  const stack = state.optimisticRows.get(row.key);
  if (stack) {
    stack.base = cloneStoredRow(row);
    rebaseKeys.add(row.key);
    return;
  }

  state.rows.set(row.key, cloneStoredRow(row));
};

export const deleteCollectionBaseRow = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  key: K,
  rebaseKeys: Set<K>,
): void => {
  const stack = state.optimisticRows.get(key);
  if (stack) {
    stack.base = undefined;
    rebaseKeys.add(key);
    return;
  }

  state.rows.delete(key);
};

export const rebaseCollectionBaseRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  rebaseKeys: Set<K>,
): void => {
  if (rebaseKeys.size > 0) {
    rebaseOptimisticRows(state, Array.from(rebaseKeys));
    return;
  }

  bumpCollectionState(state);
};

const hasOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transaction: CollectionTransaction<A, K>,
): boolean =>
  optimisticMutationKeys(transaction).some((key) =>
    state.optimisticRows.get(key)?.patches.some((patch) => patch.transactionId === transaction.id),
  );

export const commitOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transaction: CollectionTransaction<A, K>,
): boolean => {
  if (!hasOptimisticTransaction(state, transaction)) {
    return false;
  }

  const keys = optimisticMutationKeys(transaction);
  for (const key of keys) {
    const stack = state.optimisticRows.get(key);
    if (!stack) {
      continue;
    }
    for (const patch of stack.patches) {
      if (patch.transactionId === transaction.id) {
        patch.committed = true;
      }
    }
  }
  rebaseOptimisticRows(state, keys);
  return true;
};

export const rollbackOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transaction: CollectionTransaction<A, K>,
): boolean => {
  if (!hasOptimisticTransaction(state, transaction)) {
    return false;
  }

  const keys = optimisticMutationKeys(transaction);
  for (const key of keys) {
    const stack = state.optimisticRows.get(key);
    if (!stack) {
      continue;
    }
    const remaining = stack.patches.filter((patch) => patch.transactionId !== transaction.id);
    stack.patches.splice(0, stack.patches.length, ...remaining);
  }
  rebaseOptimisticRows(state, keys);
  return true;
};

export const syncOptimisticRowsFromPendingMutations = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
): void => {
  const desired = new Map<K, OptimisticRowStack<A, K>>();
  const rebaseKeys = new Set<K>(state.optimisticRows.keys());

  for (const entry of state.pendingMutations.values()) {
    for (const mutation of entry.transaction.mutations) {
      let stack = desired.get(mutation.key);
      if (!stack) {
        const existing = state.optimisticRows.get(mutation.key);
        const rollback = entry.rollbackRows.has(mutation.key)
          ? entry.rollbackRows.get(mutation.key)
          : state.rows.get(mutation.key);
        stack = {
          base: existing ? cloneRollbackRow(existing.base) : cloneRollbackRow(rollback),
          patches: [],
        };
        desired.set(mutation.key, stack);
      }
      stack.patches.push({
        transactionId: entry.transaction.id,
        mutation,
        committed: false,
      });
      rebaseKeys.add(mutation.key);
    }
  }

  state.optimisticRows.clear();
  for (const [key, stack] of desired) {
    state.optimisticRows.set(key, stack);
  }

  rebaseOptimisticRows(state, Array.from(rebaseKeys));
};
