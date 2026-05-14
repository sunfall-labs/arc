import { runWithRuntime, type EffectUiRuntime } from "@effect-ui/core";
import {
  type CollectionDefinition,
  type CollectionIndexValue,
  type CollectionKey,
  type CollectionLoadState,
  type CollectionRow,
  type CollectionRuntimeError
} from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { collectionStateError, subscribeCollection } from "./shared.js";

const bindRuntimeEffect = <A, E, R>(
  runtime: EffectUiRuntime<unknown, never>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E> =>
  Effect.scoped(runtime.provide(effect));

/** Options for binding a Collection to Solid reactivity. */
export interface UseCollectionOptions<E = never> {
  /** Start loading on mount. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time preload.
   *
   * The error is `CollectionRuntimeError<E>`, so output-schema and hydration
   * codec failures are reported beside the collection's own `E` channel.
   */
  readonly onPreloadFailure?: (error: CollectionRuntimeError<E>) => void;
}

/**
 * Solid-facing handle for a collection.
 *
 * Accessors read from the nearest Effect UI runtime. Loading and refetching are
 * exposed as Effects so callers can compose or run them at UI boundaries.
 */
export interface CollectionHandle<A extends object, K extends CollectionKey, E = never, R = never> {
  /** Current rows, including optimistic local writes. */
  readonly rows: Accessor<ReadonlyArray<CollectionRow<A, K>>>;
  /** Current load/refetch state with normalized runtime failures. */
  readonly state: Accessor<CollectionLoadState<CollectionRuntimeError<E>>>;
  /** True while the collection is preloading or refetching. */
  readonly waiting: Accessor<boolean>;
  /** Latest load/refetch failure, when the state is `Failure`. */
  readonly error: Accessor<CollectionRuntimeError<E> | undefined>;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Accessor<CollectionRuntimeError<E> | undefined>;
  /** Read one row by key from the current runtime store. */
  get(key: K): CollectionRow<A, K> | undefined;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  /** Read the first row from a named secondary index bucket. */
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  /** Ensure the collection has loaded inside the nearest Solid runtime. */
  preloadEffect(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Force a fresh collection load inside the nearest Solid runtime. */
  refetchEffect(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
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
  options: UseCollectionOptions<E> = {}
): CollectionHandle<A, K, E, R> => {
  const runtime = useRuntime();
  const [tick, setTick] = createSignal(0);
  const [preloadFailure, setPreloadFailure] = createSignal<CollectionRuntimeError<E> | undefined>(undefined);

  const unsubscribe = subscribeCollection(runtime, collection, () => setTick((value) => value + 1));
  if (options.preload !== false) {
    void runtime.runFork(
      collection.preloadEffect().pipe(
        Effect.tap(() => Effect.sync(() => setPreloadFailure(undefined))),
        Effect.catch((error) =>
          Effect.sync(() => {
            setPreloadFailure(() => error);
            options.onPreloadFailure?.(error);
          })
        )
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
    preloadFailure,
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
    preloadEffect: () => bindRuntimeEffect(runtime, collection.preloadEffect()),
    refetchEffect: () => bindRuntimeEffect(runtime, collection.refetchEffect())
  };
};
