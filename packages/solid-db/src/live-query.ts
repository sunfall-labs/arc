import {
  collectionReactiveDepsValue,
  selectCollectionReactiveLiveQuery,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type LiveQuery,
  type QueryEvaluationError,
} from "@sunfall/arc-db";
import type { EffectInput } from "@sunfall/arc-core";
import { useRuntime } from "@sunfall/arc-solid";
import { Effect } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { createMemo, type Accessor } from "solid-js";
import { makeSolidDbReactiveBinding } from "./shared.js";

/** Options for Solid live-query hooks. */
export interface UseLiveQueryOptions<E = never, ER = never> {
  /** Solid dependencies that should rebuild the query when they change. */
  readonly deps?: (() => unknown) | undefined;
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
 * Solid-facing handle for a live query over one or more collections.
 *
 * Data is recomputed when source collections change. Pass `deps` when the query
 * factory also reads Solid signals that should rebuild the query.
 */
export interface LiveQueryHandle<T, E = never, ER = never> {
  /** Current live query rows (always the last good rows) from the nearest Solid runtime. */
  readonly data: Accessor<ReadonlyArray<T>>;
  /**
   * Current live query `AsyncResult`: source load results and evaluation
   * failures folded together, `waiting` while any source is loading, and
   * `Failure` keeping the last good rows as `previousSuccess`.
   */
  readonly result: Accessor<AsyncResult.AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError>>;
  /** Failure captured from the automatic mount-time source preload, if enabled. */
  readonly preloadFailure: Accessor<E | QueryEvaluationError | ER | undefined>;
  /** Ensure all query sources have loaded inside the nearest Solid runtime. */
  preloadEffect(): Effect.Effect<void, E | QueryEvaluationError | ER>;
  /** Force a fresh source preload and live query evaluation inside the Solid runtime. */
  refetchEffect(): Effect.Effect<void, E | QueryEvaluationError | ER>;
}

type LiveQueryInput<T, E, R> = CollectionReactiveLiveQueryInput<T, E, R>;

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
export const useLiveQuery = <T, E = never, R = never, ER = never>(
  input: LiveQueryInput<T, E, R>,
  options: UseLiveQueryOptions<E, ER> = {},
): LiveQueryHandle<T, E, ER> => {
  const runtime = useRuntime<ER>();
  // Re-selects the runtime-bound LiveQuery when explicit deps change; the
  // previous selection is reused while deps stay equal.
  const selection = createMemo<CollectionReactiveLiveQuerySelection<T, E, R, typeof runtime>>(
    (previous) =>
      selectCollectionReactiveLiveQuery(
        runtime,
        input,
        collectionReactiveDepsValue(options.deps),
        previous,
      ),
  );
  const live = (): LiveQuery<T, E, R> => selection().live;
  const binding = makeSolidDbReactiveBinding<E | QueryEvaluationError, R, ER>({
    runtime,
    preload: options.preload,
    preloadEffect: () => live().preloadEffect(),
    onPreloadFailure: options.onPreloadFailure,
  });

  const data = () => binding.read(() => live().data.get());

  const result = (): AsyncResult.AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError> =>
    binding.read(() => live().state.get());

  return {
    data,
    result,
    preloadFailure: binding.preloadFailure,
    preloadEffect: () => binding.bindEffect(Effect.suspend(() => live().preloadEffect())),
    refetchEffect: () => binding.bindEffect(Effect.suspend(() => live().refetchEffect())),
  };
};
