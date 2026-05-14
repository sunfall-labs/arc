import { runWithRuntime } from "@effect-ui/core";
import { Query, type LiveQuery, type LiveQueryState, type QueryFactory } from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { liveQueryStateError, subscribeCollection } from "./shared.js";

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
export interface LiveQueryHandle<T, E = never, R = never> {
  readonly data: Accessor<ReadonlyArray<T>>;
  readonly state: Accessor<LiveQueryState<T, E>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | undefined>;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
}

type LiveQueryInput<T, E, R> = QueryFactory<T> | LiveQuery<T, E, R>;

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
export const useLiveQuery = <T, E = never, R = never>(
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
    error: createMemo(() => liveQueryStateError(state())),
    preloadEffect: () => live.preloadEffect(),
    refetchEffect: () => live.refetchEffect()
  };
};
