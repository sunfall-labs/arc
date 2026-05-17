import {
  collectionReactiveDepsValue,
  selectCollectionReactiveLiveQuery,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type LiveQueryState,
  type QueryEvaluationError,
} from "@sunfall/arc-db";
import type { EffectInput } from "@sunfall/arc-core";
import { useRuntime } from "@sunfall/arc-react";
import { Effect } from "effect";
import { useMemo, useRef } from "react";
import { liveQueryStateError, useReactDbReactiveBinding } from "./shared.js";

/** Options for React live-query hooks. */
export interface UseLiveQueryOptions<E = never, ER = never> {
  /** React dependencies that should rebuild the query when they change. */
  readonly deps?: ReadonlyArray<unknown> | (() => unknown);
  /** Preload all query sources on mount. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time source preload.
   *
   * If this observer fails, the hook ignores that failure after updating
   * `preloadFailure`. Promise-shaped observers are rejected at the EffectInput
   * seam; adapt host Promise work explicitly with `Effect.tryPromise(...)`.
   */
  readonly onPreloadFailure?: (error: E | QueryEvaluationError | ER) => EffectInput<void, unknown>;
}

/**
 * React-facing handle for a live query over one or more collections.
 *
 * Data is recomputed when source collections change. Pass `deps` when the query
 * factory also reads props/state that should rebuild the query.
 */
export interface LiveQueryHandle<T, E = never, ER = never> {
  readonly data: ReadonlyArray<T>;
  readonly state: LiveQueryState<T, E | QueryEvaluationError>;
  readonly waiting: boolean;
  readonly error: E | QueryEvaluationError | undefined;
  readonly preloadFailure: E | QueryEvaluationError | ER | undefined;
  preloadEffect(): Effect.Effect<void, E | QueryEvaluationError | ER>;
  refetchEffect(): Effect.Effect<void, E | QueryEvaluationError | ER>;
}

type LiveQueryInput<T, E, R> = CollectionReactiveLiveQueryInput<T, E, R>;

/**
 * Subscribes a React component to a live query.
 *
 * Pass either a query factory or a prebuilt `LiveQuery`. The hook tracks all
 * source collections and recomputes `data` when they change.
 */
export const useLiveQuery = <T, E = never, R = never, ER = never>(
  input: LiveQueryInput<T, E, R>,
  options: UseLiveQueryOptions<E, ER> = {},
): LiveQueryHandle<T, E, ER> => {
  const runtime = useRuntime<ER>();
  const inputRef = useRef(input);
  inputRef.current = input;
  const deps = collectionReactiveDepsValue(options.deps);
  const liveRef = useRef<CollectionReactiveLiveQuerySelection<T, E, R, typeof runtime> | undefined>(
    undefined,
  );
  liveRef.current = selectCollectionReactiveLiveQuery(
    runtime,
    inputRef.current,
    deps,
    liveRef.current,
  );
  const live = liveRef.current.live;
  const preloadEffect = useMemo(() => Effect.suspend(() => live.preloadEffect()), [live]);
  const binding = useReactDbReactiveBinding<E | QueryEvaluationError, R, ER>({
    runtime,
    sources: () => live.sources,
    preload: options.preload,
    preloadEffect,
    onPreloadFailure: options.onPreloadFailure,
  });

  const data = binding.read(() => live.data.get());
  const state = binding.read(() => live.state.get());

  return {
    data,
    state,
    waiting: state.waiting,
    error: liveQueryStateError(state),
    preloadFailure: binding.preloadFailure,
    preloadEffect: () => binding.bindEffect(Effect.suspend(() => live.preloadEffect())),
    refetchEffect: () => binding.bindEffect(Effect.suspend(() => live.refetchEffect())),
  };
};
