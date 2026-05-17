import {
  collectionReactiveDepsValue,
  selectCollectionReactiveLiveQuery,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type LiveQuery,
  type LiveQueryState,
  type QueryEvaluationError,
} from "@effect-ui/db";
import type { EffectInput } from "@effect-ui/core";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createMemo, type Accessor } from "solid-js";
import {
  liveQueryStateError,
  makeSolidDbReactiveBinding,
  type SolidDbReactiveBinding,
} from "./shared.js";

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
  readonly data: Accessor<ReadonlyArray<T>>;
  readonly state: Accessor<LiveQueryState<T, E | QueryEvaluationError>>;
  readonly waiting: Accessor<boolean>;
  readonly error: Accessor<E | QueryEvaluationError | undefined>;
  readonly preloadFailure: Accessor<E | QueryEvaluationError | ER | undefined>;
  preloadEffect(): Effect.Effect<void, E | QueryEvaluationError | ER>;
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
  let currentSelection: CollectionReactiveLiveQuerySelection<T, E, R, typeof runtime> | undefined;
  let binding: SolidDbReactiveBinding<E | QueryEvaluationError, ER> | undefined;
  const live = (): LiveQuery<T, E, R> => {
    const previous = currentSelection;
    currentSelection = selectCollectionReactiveLiveQuery(
      runtime,
      input,
      collectionReactiveDepsValue(options.deps),
      currentSelection,
    );
    if (currentSelection !== previous) {
      binding?.refreshSources();
    }
    return currentSelection.live;
  };
  binding = makeSolidDbReactiveBinding<E | QueryEvaluationError, R, ER>({
    runtime,
    sources: () => live().sources,
    preload: options.preload,
    preloadEffect: Effect.suspend(() => live().preloadEffect()),
    onPreloadFailure: options.onPreloadFailure,
  });

  const data = () => binding.read(() => live().data.get());

  const state = (): LiveQueryState<T, E | QueryEvaluationError> =>
    binding.read(() => live().state.get());

  return {
    data,
    state,
    waiting: createMemo(() => state().waiting),
    error: createMemo(() => liveQueryStateError(state())),
    preloadFailure: binding.preloadFailure,
    preloadEffect: () => binding.bindEffect(Effect.suspend(() => live().preloadEffect())),
    refetchEffect: () => binding.bindEffect(Effect.suspend(() => live().refetchEffect())),
  };
};
