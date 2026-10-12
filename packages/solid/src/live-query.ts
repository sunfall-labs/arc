// `@sunfall/arc-solid/live-query`: the Component binding for live queries.
// A separate entry so apps without live queries never load `@sunfall/arc-db`.
import { EffectInputCallbackError, runWithRuntime } from "@sunfall/arc-core";
import { Query, QueryEvaluationError } from "@sunfall/arc-db";
import { buildQuery } from "@sunfall/arc-db/internal";
import { isServer } from "@solidjs/web";
import { Cause, Effect, Fiber, Option } from "effect";
import type { AsyncResult } from "effect/reactivity";
import {
  createMemo,
  createRenderEffect,
  isHydrating,
  onCleanup,
  onSettled,
  untrack,
  type Accessor,
} from "solid-js";
import { Component } from "./component.js";

const isContractViolation = (error: unknown): boolean =>
  error instanceof EffectInputCallbackError || error instanceof QueryEvaluationError;

/** Re-causes contract violations as defects, leaving only declared failures typed. */
const renderFailureCause = <E>(cause: Cause.Cause<E>): Cause.Cause<LiveQuery.RenderError<E>> =>
  Cause.fromReasons(
    cause.reasons.map((reason) =>
      Cause.isFailReason(reason) && isContractViolation(reason.error)
        ? Cause.makeDieReason(reason.error)
        : reason,
    ),
  ) as Cause.Cause<LiveQuery.RenderError<E>>;

const settledFailure = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): Cause.Cause<LiveQuery.RenderError<E>> | undefined =>
  result._tag === "Failure" && !result.waiting ? renderFailureCause(result.cause) : undefined;

/**
 * Live queries in a Component: `LiveQuery.bind` is the setup-time binding,
 * like `Component.resource`, for a `Query` from `@sunfall/arc-db`.
 */
export namespace LiveQuery {
  /**
   * Failures a live query read can throw to `<Errored>`: its sources' declared
   * errors. Contract violations (a throwing callback, an invalid query plan)
   * are defects instead.
   */
  export type RenderError<E> = Exclude<E, EffectInputCallbackError | QueryEvaluationError>;

  /** Options for `LiveQuery.bind`. */
  export interface Options {
    /** Preload the query's sources when the instance mounts. Defaults to true. */
    readonly preload?: boolean;
  }

  /**
   * Instance-bound live query over the rows of one or more Resources, from
   * `LiveQuery.bind`.
   *
   * Rows are recomputed when a source's rows change, and the query is rebuilt
   * when a signal or prop read by the query factory changes. Status chrome reads
   * `waiting()` and `failure()`, like every other binding. If no source load
   * ever succeeded and the latest failed, `rows()` throws that failure to the
   * nearest `<Errored>`, which is why it joins the Component's `E`.
   */
  export interface Handle<T, E = never> {
    /** Current rows (always the last good rows). */
    readonly rows: Accessor<ReadonlyArray<T>>;
    /** True while any source is loading. */
    readonly waiting: Accessor<boolean>;
    /** The settled source-load failure, if the latest load failed. */
    readonly failure: Accessor<Cause.Cause<RenderError<E>> | undefined>;
    /** Ensures every source has loaded. */
    preload(): Effect.Effect<void, E | QueryEvaluationError>;
    /** Reloads every source. */
    refresh(): Effect.Effect<void, E | QueryEvaluationError>;
  }

  /** A query factory, or a prebuilt `Query.Live`. */
  export type Input<T, E, R> = Query.Factory<T, E, R> | Query.Live<T, E, R>;

  /**
   * Binds a live query over the rows of Resources (`Query` from
   * `@sunfall/arc-db`) to the current Component instance and returns its
   * handle. Pass a query factory or a prebuilt `Query.Live`; the sources'
   * declared load errors join the component's `E` and their services join
   * `R`. The factory runs tracked: a signal or prop it reads rebuilds the
   * query. Sources preload on mount unless `preload` is false.
   *
   * @example
   * ```tsx
   * import { LiveQuery } from "@sunfall/arc-solid/live-query";
   *
   * const open = yield* LiveQuery.bind((query) =>
   *   query
   *     .from({ project: ProjectsRef })
   *     .where(({ project }) => project.status === "active")
   *     .select(({ project }) => project),
   * );
   * ```
   */
  export const bind = <T, E = never, R = never>(
    input: Input<T, E, R>,
    options: Options = {},
  ): Effect.Effect<Handle<T, E>, RenderError<E>, R> =>
    Effect.map(Component.instance, (current) =>
      bindLiveQuery(current, input, options),
    ) as Effect.Effect<Handle<T, E>, RenderError<E>, R>;
}

/**
 * Binds a live query under the instance's owner: the factory runs tracked (its
 * signal and prop reads rebuild the query), sources preload on mount (after
 * hydration settles on a hydrating client, never on the server), and
 * preloading restarts when the source set changes.
 */
const bindLiveQuery = <T, E, R>(
  instance: Component.Instance,
  input: LiveQuery.Input<T, E, R>,
  options: LiveQuery.Options,
): LiveQuery.Handle<T, E> =>
  instance.run(() => {
    const { runtime } = instance;
    // The factory runs tracked so its signal/prop reads rebuild the query;
    // building the live state is untracked so source reads stay inside the
    // live query instead of re-running this memo.
    const live = createMemo<Query.Live<T, E, R>>(() => {
      if (typeof input !== "function") {
        return input;
      }
      const builder = runWithRuntime(runtime, () => buildQuery(input));
      return untrack(() => runWithRuntime(runtime, () => Query.live<T, E, R>(() => builder)));
    });

    // Preloading is a side effect, so it runs in the apply phase whenever the
    // query (and with it the source set) changes. A server render only reads:
    // the route preload loads what it renders. A hydrating client first
    // renders what the server rendered, so its first preload waits until the
    // hydration pass settles (a load it started would flip `waiting` first).
    let preloadFiber: Fiber.Fiber<void, unknown> | undefined;
    const interrupt = (): void => {
      const fiber = preloadFiber;
      preloadFiber = undefined;
      if (fiber !== undefined) {
        void runtime.runFork(Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void)));
      }
    };
    const start = (effect: Effect.Effect<void, unknown, unknown> | undefined): void => {
      interrupt();
      if (enabled && effect !== undefined) {
        preloadFiber = runtime.runFork(
          Effect.scoped(runtime.provide(effect)).pipe(Effect.catchCause(() => Effect.void)),
        );
      }
    };
    const enabled = !isServer && options.preload !== false;
    let deferred = enabled && isHydrating();
    let pending: Effect.Effect<void, unknown, unknown> | undefined;
    createRenderEffect(
      () => live().preload(),
      (effect) => {
        if (deferred) {
          pending = effect;
          return;
        }
        start(effect);
      },
    );
    // Registered on every side, so the server and client create the same owner
    // tree (and with it the same hydration keys).
    onSettled(() => {
      if (!deferred) {
        return;
      }
      deferred = false;
      start(pending);
      pending = undefined;
    });
    onCleanup(interrupt);

    const result = () => runWithRuntime(runtime, () => live().state.get());
    const bind = <A, E2>(effect: Effect.Effect<A, E2, unknown>): Effect.Effect<A, E2> =>
      Effect.scoped(runtime.provide(effect));
    return {
      rows: () => {
        const current = result();
        if (
          current._tag === "Failure" &&
          !current.waiting &&
          Option.isNone(current.previousSuccess)
        ) {
          instance.fail(renderFailureCause(current.cause));
        }
        return runWithRuntime(runtime, () => live().rows.get());
      },
      waiting: () => result().waiting,
      failure: () => settledFailure(result()),
      preload: () => bind(Effect.suspend(() => live().preload())),
      refresh: () => bind(Effect.suspend(() => live().refresh())),
    };
  });
