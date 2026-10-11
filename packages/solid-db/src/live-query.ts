import { Query, type QueryEvaluationError } from "@sunfall/arc-db";
import { buildQuery } from "@sunfall/arc-db/internal";
import { runWithRuntime, type EffectInput } from "@sunfall/arc-core";
import { useRuntime } from "@sunfall/arc-solid";
import { Effect } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { createMemo, untrack, type Accessor } from "solid-js";
import { makeSolidDbReactiveBinding } from "./shared.js";

/** Options for Solid live-query hooks. */
export interface UseLiveQueryOptions<E = never, ER = never> {
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
 * Data is recomputed when source collections change, and the query is rebuilt
 * when a signal or prop read by the query factory changes.
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

type LiveQueryInput<T, E, R> = Query.Factory<T, E, R> | Query.Live<T, E, R>;

/**
 * Subscribes a Solid component to a live query.
 *
 * Pass either a query factory or a prebuilt `Query.Live`. The hook tracks all
 * source collections and recomputes `data` when they change. The factory runs
 * tracked: a signal or prop it reads (for example `props.projectId`) rebuilds
 * the query when it changes.
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
  // The factory runs tracked so its signal/prop reads rebuild the query;
  // building the live state is untracked so source collection reads stay
  // inside the live query instead of re-running this memo.
  const live = createMemo<Query.Live<T, E, R>>(() => {
    if (typeof input !== "function") {
      return input;
    }
    const builder = runWithRuntime(runtime, () => buildQuery(input));
    return untrack(() => runWithRuntime(runtime, () => Query.live<T, E, R>(() => builder)));
  });
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
