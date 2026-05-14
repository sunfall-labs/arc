import { runWithRuntime, type EffectUiRuntime } from "@effect-ui/core";
import { Query, type LiveQuery, type LiveQueryState, type QueryEvaluationError, type QueryFactory } from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { liveQueryStateError, subscribeCollection } from "./shared.js";

const bindRuntimeEffect = <A, E, R>(
  runtime: EffectUiRuntime<unknown, never>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E> =>
  Effect.scoped(runtime.provide(effect));

/** Options for Solid live-query hooks. */
export interface UseLiveQueryOptions<E = never> {
  /** Preload all query sources on mount. Defaults to true. */
  readonly preload?: boolean;
  /** Observe failures from the automatic mount-time source preload. */
  readonly onPreloadFailure?: (error: E) => void;
}

/**
 * Solid-facing handle for a live query over one or more collections.
 *
 * Data is recomputed when source collections change. Loading/refetch work stays
 * Effect-first through the returned methods.
 */
export interface LiveQueryHandle<T, E = never, R = never> {
  readonly data: Accessor<ReadonlyArray<T>>;
  readonly state: Accessor<LiveQueryState<T, E | QueryEvaluationError>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | QueryEvaluationError | undefined>;
  readonly preloadFailure: Accessor<E | undefined>;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
}

type LiveQueryInput<T, E, R> = QueryFactory<T, E, R> | LiveQuery<T, E, R>;

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
  options: UseLiveQueryOptions<E> = {}
): LiveQueryHandle<T, E, R> => {
  const runtime = useRuntime();
  const [tick, setTick] = createSignal(0);
  const [preloadFailure, setPreloadFailure] = createSignal<E | undefined>(undefined);
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

  onCleanup(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  });

  const data = () => {
    tick();
    return runWithRuntime(runtime, () => live.data.get());
  };

  const state = (): LiveQueryState<T, E | QueryEvaluationError> => {
    tick();
    return runWithRuntime(runtime, () => live.state.get());
  };

  return {
    data,
    state,
    waiting: createMemo(() => state().waiting),
    error: createMemo(() => liveQueryStateError(state())),
    preloadFailure,
    preloadEffect: () => bindRuntimeEffect(runtime, live.preloadEffect()),
    refetchEffect: () => bindRuntimeEffect(runtime, live.refetchEffect())
  };
};
