import { Query, type QueryEvaluationError } from "@sunfall/arc-db";
import { buildQuery } from "@sunfall/arc-db/internal";
import { runWithRuntime, type EffectInput } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { createMemo, untrack, type Accessor } from "solid-js";
import { makeSolidDbReactiveBinding } from "./shared.js";

/** Options for `SolidDb.liveQuery`. */
export interface LiveQueryBindingOptions<E = never> {
  /** Preload all query sources when the instance mounts. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time source preload.
   *
   * If this observer fails, the binding ignores that failure after updating
   * `preloadFailure`. Promise-shaped observers are rejected at the EffectInput
   * seam; adapt host Promise work explicitly with `Effect.tryPromise(...)`.
   */
  readonly onPreloadFailure?: (error: E | QueryEvaluationError) => EffectInput<void, unknown>;
}

/**
 * Instance-bound live query over one or more collections, from
 * `SolidDb.liveQuery`.
 *
 * Data is recomputed when source collections change, and the query is rebuilt
 * when a signal or prop read by the query factory changes.
 */
export interface LiveQueryHandle<T, E = never> {
  /** Current rows (always the last good rows) from the instance runtime. */
  readonly rows: Accessor<ReadonlyArray<T>>;
  /**
   * Current live query `AsyncResult`: source load results and evaluation
   * failures folded together, `waiting` while any source is loading, and
   * `Failure` keeping the last good rows as `previousSuccess`.
   */
  readonly result: Accessor<AsyncResult.AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError>>;
  /** Failure captured from the automatic mount-time source preload, if enabled. */
  readonly preloadFailure: Accessor<E | QueryEvaluationError | undefined>;
  /** Ensure all query sources have loaded in the instance runtime. */
  preload(): Effect.Effect<void, E | QueryEvaluationError>;
  /** Force a fresh source preload and live query evaluation in the instance runtime. */
  refresh(): Effect.Effect<void, E | QueryEvaluationError>;
}

type LiveQueryInput<T, E, R> = Query.Factory<T, E, R> | Query.Live<T, E, R>;

/**
 * Binds a live query in a Component setup. Pass a query factory or a prebuilt
 * `Query.Live`; the query's services join the component's `R`. The factory
 * runs tracked: a signal or prop it reads (`props.projectId`) rebuilds the
 * query when it changes.
 *
 * @example
 * ```tsx
 * const openProjects = yield* SolidDb.liveQuery((query) =>
 *   query.from({ project: Projects })
 *     .where(({ project }) => project.status === "open")
 *     .select(({ project }) => project)
 * );
 * ```
 */
export const liveQuery = <T, E = never, R = never>(
  input: LiveQueryInput<T, E, R>,
  options: LiveQueryBindingOptions<E> = {},
): Effect.Effect<LiveQueryHandle<T, E>, never, R> =>
  Effect.map(Component.instance, (instance) => {
    const { runtime } = instance;
    return instance.run(() => {
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
      const binding = makeSolidDbReactiveBinding<E | QueryEvaluationError, R, never>({
        runtime,
        preload: options.preload,
        load: () => live().preload(),
        onPreloadFailure: options.onPreloadFailure,
      });
      const handle: LiveQueryHandle<T, E> = {
        rows: () => binding.read(() => live().rows.get()),
        result: () => binding.read(() => live().state.get()),
        preloadFailure: binding.preloadFailure,
        preload: () => binding.bindEffect(Effect.suspend(() => live().preload())),
        refresh: () => binding.bindEffect(Effect.suspend(() => live().refresh())),
      };
      return handle;
    });
  }) as Effect.Effect<LiveQueryHandle<T, E>, never, R>;
