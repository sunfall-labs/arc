import { runWithRuntime, type EffectUiRuntime } from "@effect-ui/core";
import {
  Collection,
  Query,
  type AnyCollection,
  type CollectionDefinition,
  type CollectionIndexValue,
  type CollectionKey,
  type CollectionLoadState,
  type CollectionRow,
  type LiveQuery,
  type LiveQueryState,
  type QueryFactory
} from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

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
export interface CollectionHandle<A extends object, K extends CollectionKey, E = unknown, R = never> {
  readonly rows: Accessor<ReadonlyArray<CollectionRow<A, K>>>;
  readonly state: Accessor<CollectionLoadState<E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  get(key: K): CollectionRow<A, K> | undefined;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
}

/** Options for Solid live-query hooks. */
export interface UseLiveQueryOptions {
  /** Preload all query sources on mount. Defaults to true. */
  readonly preload?: boolean;
}

/**
 * Solid-facing handle for a live query over one or more collections.
 *
 * Data is recomputed when source collections change. Loading/refetch work stays
 * Effect-first through the returned methods.
 */
export interface LiveQueryHandle<T, E = unknown, R = never> {
  readonly data: Accessor<ReadonlyArray<T>>;
  readonly state: Accessor<LiveQueryState<T, E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
}

type LiveQueryInput<T, E, R> = QueryFactory<T> | LiveQuery<T, E, R>;

const subscribeCollection = (
  runtime: EffectUiRuntime<unknown, unknown>,
  collection: AnyCollection,
  notify: () => void
): (() => void) => {
  const version = runWithRuntime(runtime, () => collection.version());
  const state = runWithRuntime(runtime, () => collection.state());
  const unsubscribeVersion = version.subscribe(notify);
  const unsubscribeState = state.subscribe(notify);
  return () => {
    unsubscribeVersion();
    unsubscribeState();
  };
};

const stateError = <E>(state: CollectionLoadState<E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;

const liveStateError = <T, E>(state: LiveQueryState<T, E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;

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
export const useCollection = <A extends object, K extends CollectionKey, E = unknown, R = never>(
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
    error: createMemo(() => stateError(state())),
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

/**
 * Subscribes a Solid component to a live query.
 *
 * Pass either a query factory or a prebuilt `LiveQuery`. The hook tracks all
 * source collections and recomputes `data` when they change.
 *
 * @example
 * ```tsx
 * const openProjects = useLiveQuery((query) =>
 *   query.from({ project: Projects })
 *     .where(({ project }) => project.status === "open")
 *     .select(({ project }) => project)
 * );
 * ```
 */
export const useLiveQuery = <T, E = unknown, R = never>(
  input: LiveQueryInput<T, E, R>,
  options: UseLiveQueryOptions = {}
): LiveQueryHandle<T, E, R> => {
  const runtime = useRuntime();
  const [tick, setTick] = createSignal(0);
  const live = runWithRuntime(runtime, () =>
    typeof input === "function"
      ? Query.live<T, E, R>(input)
      : input
  );

  const cleanups = live.sources.map((source) =>
    subscribeCollection(runtime, source, () => setTick((value) => value + 1))
  );

  if (options.preload !== false) {
    void runtime.runFork(
      live.preloadEffect().pipe(
        Effect.catch(() => Effect.void)
      )
    );
  }

  onCleanup(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  });

  const data = () => {
    tick();
    return runWithRuntime(runtime, () => live.evaluate());
  };

  const state = (): LiveQueryState<T, E> => {
    tick();
    const currentData = data();

    for (const source of live.sources) {
      const sourceState = runWithRuntime(runtime, () => source.state().get());
      if (sourceState._tag === "Failure") {
        return {
          _tag: "Failure",
          waiting: false,
          error: sourceState.error as E,
          data: currentData
        };
      }
    }

    const waiting = live.sources.some((source) => {
      const sourceState = runWithRuntime(runtime, () => source.state().get());
      return sourceState._tag === "Initial" || sourceState._tag === "Pending";
    });

    return waiting
      ? { _tag: "Pending", waiting: true, data: currentData }
      : { _tag: "Success", waiting: false, data: currentData };
  };

  return {
    data,
    state,
    waiting: createMemo(() => state().waiting),
    error: createMemo(() => liveStateError(state())),
    preloadEffect: () => live.preloadEffect(),
    refetchEffect: () => live.refetchEffect()
  };
};

export { Collection, Query };
