import { Effect, Exit } from "effect";
import type {
  CollectionKey,
  CollectionRuntimeError,
  CollectionStoreEvent
} from "./collection-contract.js";
import {
  cloneOptimisticRowStack,
  clonePendingMutationEntry,
  cloneStoredRow,
  restoreOptimisticState,
  type CollectionState,
  type OptimisticRowStack,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";

export interface CollectionStateSnapshot<A extends object, K extends CollectionKey> {
  readonly rows: ReadonlyMap<K, StoredRow<A, K>>;
  readonly pendingMutations: ReadonlyMap<string, PendingMutationEntry<A, K>>;
  readonly optimisticRows: ReadonlyMap<K, OptimisticRowStack<A, K>>;
  readonly version: number;
}

export const snapshotCollectionState = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>
): CollectionStateSnapshot<A, K> => ({
  rows: new Map(Array.from(state.rows, ([key, row]) => [key, cloneStoredRow(row)])),
  pendingMutations: new Map(
    Array.from(state.pendingMutations, ([id, entry]) => [id, clonePendingMutationEntry(entry)])
  ),
  optimisticRows: new Map(
    Array.from(state.optimisticRows, ([key, stack]) => [key, cloneOptimisticRowStack(stack)])
  ),
  version: state.version.get()
});

export const restoreCollectionStateSnapshot = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  snapshot: CollectionStateSnapshot<A, K>
): void => {
  restoreOptimisticState(state, snapshot.rows, snapshot.pendingMutations, snapshot.optimisticRows);
  state.indexCache.clear();
  state.version.set(snapshot.version);
};

interface CollectionWriteCommitOptions<A extends object, K extends CollectionKey, E, R> {
  readonly collection: string;
  readonly state: CollectionState<A, K, E>;
  readonly mutations: number;
  readonly apply: () => void;
  readonly persistEffect: Effect.Effect<void, CollectionRuntimeError<E>, R>;
  readonly publishEffect: (event: CollectionStoreEvent) => Effect.Effect<void>;
}

/**
 * Atomically apply a direct collection write around persistence and event
 * publication.
 *
 * Callers own validation and row ingress. This Module owns the shared commit
 * sequence: capture state, apply row changes, persist the resulting snapshot,
 * restore on persistence failure, and publish one `CollectionWritten` fact on
 * success.
 */
export const commitCollectionWriteEffect = <A extends object, K extends CollectionKey, E, R>(
  options: CollectionWriteCommitOptions<A, K, E, R>
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const previousState = snapshotCollectionState(options.state);
    options.apply();
    const persistExit = yield* Effect.exit(options.persistEffect);
    if (Exit.isFailure(persistExit)) {
      restoreCollectionStateSnapshot(options.state, previousState);
      return yield* Effect.failCause(persistExit.cause);
    }
    yield* options.publishEffect({
      _tag: "CollectionWritten",
      collection: options.collection,
      mutations: options.mutations
    });
  });
