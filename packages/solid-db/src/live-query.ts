import { Query, type QueryEvaluationError } from "@sunfall/arc-db";
import { buildQuery } from "@sunfall/arc-db/internal";
import { runWithRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, type Cause } from "effect";
import { createMemo, untrack, type Accessor } from "solid-js";
import { makeSolidDbReactiveBinding, settledFailure, type RenderError } from "./shared.js";

/** Options for `SolidDb.liveQuery`. */
export interface LiveQueryBindingOptions {
  /** Preload all query sources when the instance mounts. Defaults to true. */
  readonly preload?: boolean;
}

/**
 * Instance-bound live query over one or more collections, from
 * `SolidDb.liveQuery`.
 *
 * Data is recomputed when source collections change, and the query is rebuilt
 * when a signal or prop read by the query factory changes. Status chrome reads
 * `waiting()` and `failure()`, like every other binding. If no source load
 * ever succeeded and the latest failed, `rows()` throws that failure to the
 * nearest `<Errored>`, which is why it joins the Component's `E`.
 */
export interface LiveQueryHandle<T, E = never> {
  /** Current rows (always the last good rows) from the instance runtime. */
  readonly rows: Accessor<ReadonlyArray<T>>;
  /** True while any source is loading. */
  readonly waiting: Accessor<boolean>;
  /** The settled source-load failure, if the latest load failed. */
  readonly failure: Accessor<Cause.Cause<RenderError<E>> | undefined>;
  /** Ensure all query sources have loaded in the instance runtime. */
  preload(): Effect.Effect<void, E | QueryEvaluationError>;
  /** Force a fresh source preload and live query evaluation in the instance runtime. */
  refresh(): Effect.Effect<void, E | QueryEvaluationError>;
}

type LiveQueryInput<T, E, R> = Query.Factory<T, E, R> | Query.Live<T, E, R>;

/**
 * Binds a live query in a Component setup. Pass a query factory or a prebuilt
 * `Query.Live`; the sources' declared load errors join the component's `E`
 * and the query's services join its `R`. The factory
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
  options: LiveQueryBindingOptions = {},
): Effect.Effect<LiveQueryHandle<T, E>, RenderError<E>, R> =>
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
      const binding = makeSolidDbReactiveBinding<E | QueryEvaluationError, R>({
        instance,
        preload: options.preload,
        load: () => live().preload(),
        result: () => live().state.get(),
      });
      const handle: LiveQueryHandle<T, E> = {
        rows: () => binding.read(() => live().rows.get()),
        waiting: () => binding.result().waiting,
        failure: () => settledFailure(binding.result()) as Cause.Cause<RenderError<E>> | undefined,
        preload: () => binding.bindEffect(Effect.suspend(() => live().preload())),
        refresh: () => binding.bindEffect(Effect.suspend(() => live().refresh())),
      };
      return handle;
    });
  }) as Effect.Effect<LiveQueryHandle<T, E>, RenderError<E>, R>;
