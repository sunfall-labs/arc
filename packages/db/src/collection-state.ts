import { Signal, type TimelineCollectionCause, type WritableSignal } from "@sunfall/arc-core";
import { batchSignalWrites } from "@sunfall/arc-core/internal";
import { Semaphore, type Deferred } from "effect";
import { AsyncResult } from "effect/reactivity";
import type {
  CollectionDefinition,
  CollectionKey,
  CollectionRuntimeError,
  CollectionOrigin,
  CollectionRow,
} from "./collection-contract.js";
import { cloneCollectionValue, detachCollectionRow } from "./collection-value-detachment.js";
import type { CollectionIndexCacheEntry } from "./collection-index-materialization.js";

export interface StoredRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  value: A;
  synced: boolean;
  origin: CollectionOrigin;
}

export interface CollectionLoadAttempt {
  readonly generation: number;
  readonly force: boolean;
  readonly deferred: Deferred.Deferred<void, any>;
}

/** One row change an Action's optimistic transaction layers over the synced base. */
export type OptimisticRowMutation<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Insert"; readonly key: K; readonly value: A }
  | { readonly _tag: "Update"; readonly key: K; readonly changes: Partial<A> }
  | { readonly _tag: "Delete"; readonly key: K };

/**
 * A patch owned by one Action submission. `committed` patches wait for the
 * patches below them to settle before they fold into the base.
 */
export interface OptimisticRowPatch<A extends object, K extends CollectionKey> {
  readonly transactionId: string;
  readonly mutation: OptimisticRowMutation<A, K>;
  committed: boolean;
}

export interface OptimisticRowStack<A extends object, K extends CollectionKey> {
  base: StoredRow<A, K> | undefined;
  readonly patches: Array<OptimisticRowPatch<A, K>>;
}

export interface CollectionState<A extends object, K extends CollectionKey, E> {
  /** Collection name, used for signal labels and `Timeline` causes. */
  readonly name: string;
  /** Visible rows: the synced base with optimistic patches applied. */
  readonly rows: Map<K, StoredRow<A, K>>;
  /** Synced base and pending Action patches for each optimistically patched key. */
  readonly optimisticRows: Map<K, OptimisticRowStack<A, K>>;
  readonly indexCache: Map<string, CollectionIndexCacheEntry<A, K>>;
  readonly version: WritableSignal<number>;
  /** The latest load; contract violations are recorded as defects, so it fails only with `E`. */
  readonly loadState: WritableSignal<AsyncResult.AsyncResult<void, E>>;
  loadGeneration: number;
  activeLoad: CollectionLoadAttempt | undefined;
  initialized: boolean;
  initialDataError: CollectionRuntimeError<E> | undefined;
  persistenceRestored: boolean;
  /** Serializes durable commits (direct writes, hydrate, restore) against this state. */
  readonly commitPermit: Semaphore.Semaphore;
  /** True while this store runs the definition's `follow` stream. */
  following: boolean;
  /** True while this store runs the definition's `sync.changes` stream. */
  followingChanges: boolean;
  /** Source snapshot (by reference) that the synced rows were last loaded from. */
  syncedSource: unknown;
}

export const makeCollectionState = <A extends object, K extends CollectionKey, E>(
  name: string,
): CollectionState<A, K, E> => ({
  name,
  rows: new Map(),
  optimisticRows: new Map(),
  indexCache: new Map(),
  version: Signal.make(0, { name: `${name}.version` }),
  loadState: Signal.make<AsyncResult.AsyncResult<void, E>>(AsyncResult.initial(), {
    name: `${name}.loadState`,
  }),
  loadGeneration: 0,
  activeLoad: undefined,
  initialized: false,
  initialDataError: undefined,
  persistenceRestored: false,
  commitPermit: Semaphore.makeUnsafe(1),
  following: false,
  followingChanges: false,
  syncedSource: undefined,
});

const collectionCause = (
  state: CollectionState<any, any, any>,
  event: TimelineCollectionCause["event"],
): TimelineCollectionCause => ({ _tag: "Collection", collection: state.name, event });

/** Publishes a row change: the one write path for a collection's version signal. */
export const bumpCollectionState = (state: CollectionState<any, any, any>): void => {
  state.indexCache.clear();
  batchSignalWrites(
    () => state.version.update((value) => value + 1),
    collectionCause(state, "change"),
  );
};

/** Restores a captured version after rolling rows back to a snapshot. */
export const restoreCollectionVersion = (
  state: CollectionState<any, any, any>,
  version: number,
): void => {
  state.indexCache.clear();
  batchSignalWrites(() => state.version.set(version), collectionCause(state, "change"));
};

/** The one write path for a collection's load state. */
export const commitCollectionLoadState = <E>(
  state: CollectionState<any, any, E>,
  loadState: AsyncResult.AsyncResult<void, E>,
): void => {
  batchSignalWrites(() => state.loadState.set(loadState), collectionCause(state, "sync"));
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
    mutation: cloneCollectionValue(patch.mutation),
    committed: patch.committed,
  })),
});

export const restoreOptimisticState = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  rows: ReadonlyMap<K, StoredRow<A, K>>,
  optimisticRows: ReadonlyMap<K, OptimisticRowStack<A, K>>,
): void => {
  state.rows.clear();
  for (const [key, row] of rows) {
    state.rows.set(key, cloneStoredRow(row));
  }

  state.optimisticRows.clear();
  for (const [key, stack] of optimisticRows) {
    state.optimisticRows.set(key, cloneOptimisticRowStack(stack));
  }
};

const applyOptimisticMutationToRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K> | undefined,
  mutation: OptimisticRowMutation<A, K>,
): StoredRow<A, K> | undefined => {
  switch (mutation._tag) {
    case "Insert":
      return {
        key: mutation.key,
        value: cloneCollectionValue(mutation.value),
        synced: false,
        origin: "local",
      };
    case "Update":
      // A row the base no longer has stays gone: the update has nothing to patch.
      return row === undefined
        ? undefined
        : {
            key: mutation.key,
            value: cloneCollectionValue({ ...row.value, ...mutation.changes } as A),
            synced: false,
            origin: "local",
          };
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

/** Layers `mutation` over the row's current patches as part of `transactionId`. */
export const applyOptimisticRowMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transactionId: string,
  mutation: OptimisticRowMutation<A, K>,
): void => {
  let stack = state.optimisticRows.get(mutation.key);
  if (!stack) {
    stack = { base: cloneRollbackRow(state.rows.get(mutation.key)), patches: [] };
    state.optimisticRows.set(mutation.key, stack);
  }
  stack.patches.push({ transactionId, mutation, committed: false });
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

const optimisticTransactionKeys = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transactionId: string,
): ReadonlyArray<K> =>
  Array.from(state.optimisticRows)
    .filter(([, stack]) => stack.patches.some((patch) => patch.transactionId === transactionId))
    .map(([key]) => key);

/**
 * Commits a transaction's patches: each folds into the synced base as soon as
 * the patches below it settle, and the next sync replaces it.
 */
export const commitOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transactionId: string,
): void => {
  const keys = optimisticTransactionKeys(state, transactionId);
  if (keys.length === 0) {
    return;
  }
  for (const key of keys) {
    for (const patch of state.optimisticRows.get(key)!.patches) {
      if (patch.transactionId === transactionId) {
        patch.committed = true;
      }
    }
  }
  rebaseOptimisticRows(state, keys);
};

/** Drops a transaction's patches and rebases the patches other transactions still own. */
export const rollbackOptimisticTransaction = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  transactionId: string,
): void => {
  const keys = optimisticTransactionKeys(state, transactionId);
  if (keys.length === 0) {
    return;
  }
  for (const key of keys) {
    const stack = state.optimisticRows.get(key)!;
    const remaining = stack.patches.filter((patch) => patch.transactionId !== transactionId);
    stack.patches.splice(0, stack.patches.length, ...remaining);
  }
  rebaseOptimisticRows(state, keys);
};

/** Distinct transactions with patches that have not committed yet. */
export const pendingOptimisticTransactionCount = (
  state: CollectionState<any, any, any>,
): number => {
  const ids = new Set<string>();
  for (const stack of state.optimisticRows.values()) {
    for (const patch of stack.patches) {
      if (!patch.committed) {
        ids.add(patch.transactionId);
      }
    }
  }
  return ids.size;
};

/** The synced base rows, without optimistic patches: what snapshots carry. */
export const collectionBaseRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
): ReadonlyArray<StoredRow<A, K>> => {
  const rows: Array<StoredRow<A, K>> = [];
  for (const [key, row] of state.rows) {
    if (!state.optimisticRows.has(key)) {
      rows.push(row);
    }
  }
  for (const stack of state.optimisticRows.values()) {
    if (stack.base) {
      rows.push(stack.base);
    }
  }
  return rows;
};
