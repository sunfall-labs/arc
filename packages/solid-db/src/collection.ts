import { runWithRuntime } from "@effect-ui/core";
import {
  type CollectionDefinition,
  type CollectionIndexValue,
  type CollectionKey,
  type CollectionLoadState,
  type CollectionRow,
  type CollectionSnapshotCodecError
} from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { collectionStateError, subscribeCollection } from "./shared.js";

/** Options for Solid collection hooks. */
export interface UseCollectionOptions {
  /** Start loading on mount. Defaults to true. */
  readonly preload?: boolean;
}

/**
 * Solid-facing handle for a collection.
 *
 * Accessors read from the nearest Effect UI runtime. Loading and refetching are
 * exposed as Effects so callers can compose or run them at UI boundaries.
 */
export interface CollectionHandle<A extends object, K extends CollectionKey, E = never, R = never> {
  readonly rows: Accessor<ReadonlyArray<CollectionRow<A, K>>>;
  readonly state: Accessor<CollectionLoadState<E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  get(key: K): CollectionRow<A, K> | undefined;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  preloadEffect(): Effect.Effect<void, E | CollectionSnapshotCodecError, R>;
  refetchEffect(): Effect.Effect<void, E | CollectionSnapshotCodecError, R>;
}

/**
 * Subscribes a Solid component to an Effect UI collection.
 *
 * The hook exposes rows, indexed lookups, load state, and Effect-returning
 * preload/refetch methods. It preloads on mount unless `preload` is false.
 *
 * @example
 * ```tsx
 * const projects = useCollection(Projects);
 * const rows = projects.rows();
 * ```
 */
export const useCollection = <A extends object, K extends CollectionKey, E = never, R = never>(
  collection: CollectionDefinition<A, K, E, R>,
  options: UseCollectionOptions = {}
): CollectionHandle<A, K, E, R> => {
  const runtime = useRuntime();
  const [tick, setTick] = createSignal(0);

  const unsubscribe = subscribeCollection(runtime, collection, () => setTick((value) => value + 1));
  if (options.preload !== false) {
    void runtime.runFork(
      collection.preloadEffect().pipe(
        Effect.catch(() => Effect.void)
      )
    );
  }
  onCleanup(unsubscribe);

  const rows = () => {
    tick();
    return runWithRuntime(runtime, () => collection.rows());
  };
  const state = () => {
    tick();
    return runWithRuntime(runtime, () => collection.state().get());
  };

  return {
    rows,
    state,
    waiting: createMemo(() => state().waiting),
    error: createMemo(() => collectionStateError(state())),
    get: (key) => {
      tick();
      return runWithRuntime(runtime, () => collection.get(key));
    },
    index: (index, value) => {
      tick();
      return runWithRuntime(runtime, () => collection.index(index, value));
    },
    firstByIndex: (index, value) => {
      tick();
      return runWithRuntime(runtime, () => collection.firstByIndex(index, value));
    },
    preloadEffect: () => collection.preloadEffect(),
    refetchEffect: () => collection.refetchEffect()
  };
};
