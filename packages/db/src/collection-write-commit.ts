import { Effect, Exit, Semaphore } from "effect";
import type {
  CollectionKey,
  CollectionRuntimeError,
  CollectionStoreEvent,
} from "./collection-contract.js";
import {
  cloneOptimisticRowStack,
  clonePendingMutationEntry,
  cloneStoredRow,
  restoreOptimisticState,
  type CollectionState,
  type OptimisticRowStack,
  type PendingMutationEntry,
  type StoredRow,
} from "./collection-state.js";

export interface CollectionStateSnapshot<A extends object, K extends CollectionKey> {
  readonly rows: ReadonlyMap<K, StoredRow<A, K>>;
  readonly pendingMutations: ReadonlyMap<string, PendingMutationEntry<A, K>>;
  readonly optimisticRows: ReadonlyMap<K, OptimisticRowStack<A, K>>;
  readonly version: number;
}

export const snapshotCollectionState = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
): CollectionStateSnapshot<A, K> => ({
  rows: new Map(Array.from(state.rows, ([key, row]) => [key, cloneStoredRow(row)])),
  pendingMutations: new Map(
    Array.from(state.pendingMutations, ([id, entry]) => [
      id,
      clonePendingMutationEntry(entry, { preserveActiveAttempt: true }),
    ]),
  ),
  optimisticRows: new Map(
    Array.from(state.optimisticRows, ([key, stack]) => [key, cloneOptimisticRowStack(stack)]),
  ),
  version: state.version.get(),
});

export const restoreCollectionStateSnapshot = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  snapshot: CollectionStateSnapshot<A, K>,
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

const durableCommitSemaphores = new WeakMap<object, Semaphore.Semaphore>();

const durableCommitSemaphore = (state: CollectionState<any, any, any>): Semaphore.Semaphore => {
  const existing = durableCommitSemaphores.get(state);
  if (existing) {
    return existing;
  }

  const semaphore = Semaphore.makeUnsafe(1);
  durableCommitSemaphores.set(state, semaphore);
  return semaphore;
};

export const withCollectionDurableCommitPermit = <A, E, R>(
  state: CollectionState<any, any, any>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Semaphore.withPermit(durableCommitSemaphore(state), effect);

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
  options: CollectionWriteCommitOptions<A, K, E, R>,
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  withCollectionDurableCommitPermit(
    options.state,
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const previousState = snapshotCollectionState(options.state);
        options.apply();
        const persistExit = yield* restore(options.persistEffect).pipe(Effect.exit);
        if (Exit.isFailure(persistExit)) {
          restoreCollectionStateSnapshot(options.state, previousState);
          return yield* Effect.failCause(persistExit.cause);
        }
        yield* options.publishEffect({
          _tag: "CollectionWritten",
          collection: options.collection,
          mutations: options.mutations,
        });
      }),
    ),
  );
