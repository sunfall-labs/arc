import { runWithRuntime, type EffectUiRuntime } from "@effect-ui/core";
import {
  Collection,
  Query,
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

export interface UseCollectionOptions {
  readonly preload?: boolean;
}

export interface CollectionHandle<A extends object, K extends CollectionKey, E = unknown, R = never> {
  readonly rows: Accessor<ReadonlyArray<CollectionRow<A, K>>>;
  readonly state: Accessor<CollectionLoadState<E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  get(key: K): CollectionRow<A, K> | undefined;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  preloadEffect(): Effect.Effect<void, E, R>;
  preload(): Promise<void>;
  refetchEffect(): Effect.Effect<void, E, R>;
  refetch(): Promise<void>;
}

export interface UseLiveQueryOptions {
  readonly preload?: boolean;
}

export interface LiveQueryHandle<T, E = unknown, R = never> {
  readonly data: Accessor<ReadonlyArray<T>>;
  readonly state: Accessor<LiveQueryState<T, E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  preloadEffect(): Effect.Effect<void, E, R>;
  preload(): Promise<void>;
  refetchEffect(): Effect.Effect<void, E, R>;
  refetch(): Promise<void>;
}

type LiveQueryInput<T, E, R> = QueryFactory<T> | LiveQuery<T, E, R>;

const subscribeCollection = (
  runtime: EffectUiRuntime<any, any>,
  collection: CollectionDefinition<any, any, any, any>,
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

export const useCollection = <A extends object, K extends CollectionKey, E = unknown, R = never>(
  collection: CollectionDefinition<A, K, E, R>,
  options: UseCollectionOptions = {}
): CollectionHandle<A, K, E, R> => {
  const runtime = useRuntime();
  const [tick, setTick] = createSignal(0);

  const unsubscribe = subscribeCollection(runtime, collection, () => setTick((value) => value + 1));
  if (options.preload !== false) {
    void runtime.runPromise(collection.preloadEffect() as Effect.Effect<void, E, any>).catch(() => undefined);
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
    preload: () => runtime.runPromise(collection.preloadEffect() as Effect.Effect<void, E, any>),
    refetchEffect: () => collection.refetchEffect(),
    refetch: () => runtime.runPromise(collection.refetchEffect() as Effect.Effect<void, E, any>)
  };
};

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
    void runtime.runPromise(live.preloadEffect() as Effect.Effect<void, E, any>).catch(() => undefined);
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
    preload: () => runtime.runPromise(live.preloadEffect() as Effect.Effect<void, E, any>),
    refetchEffect: () => live.refetchEffect(),
    refetch: () => runtime.runPromise(live.refetchEffect() as Effect.Effect<void, E, any>)
  };
};

export { Collection, Query };
