// Internal Solid binding behind `Component.liveQuery(...)`.
import {
  EffectInputCallbackError,
  runWithRuntime,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
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

/**
 * Failures a live query read can throw to `<Errored>`: its sources' declared
 * errors. Contract violations (a throwing callback, an invalid query plan)
 * are defects instead.
 */
export type LiveQueryRenderError<E> = Exclude<E, EffectInputCallbackError | QueryEvaluationError>;

const isContractViolation = (error: unknown): boolean =>
  error instanceof EffectInputCallbackError || error instanceof QueryEvaluationError;

/** Re-causes contract violations as defects, leaving only declared failures typed. */
const renderFailureCause = <E>(cause: Cause.Cause<E>): Cause.Cause<LiveQueryRenderError<E>> =>
  Cause.fromReasons(
    cause.reasons.map((reason) =>
      Cause.isFailReason(reason) && isContractViolation(reason.error)
        ? Cause.makeDieReason(reason.error)
        : reason,
    ),
  ) as Cause.Cause<LiveQueryRenderError<E>>;

const settledFailure = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): Cause.Cause<LiveQueryRenderError<E>> | undefined =>
  result._tag === "Failure" && !result.waiting ? renderFailureCause(result.cause) : undefined;

/** What the binding needs from the Component instance it runs in. */
export interface LiveQueryInstance {
  readonly runtime: AnySunfallArcRuntime<never>;
  run<A>(f: () => A): A;
  fail(cause: Cause.Cause<unknown>): never;
}

/** Options for `Component.liveQuery`. */
export interface LiveQueryOptions {
  /** Preload the query's sources when the instance mounts. Defaults to true. */
  readonly preload?: boolean;
}

/**
 * Instance-bound live query over the rows of one or more Resources, from
 * `Component.liveQuery`.
 *
 * Rows are recomputed when a source's rows change, and the query is rebuilt
 * when a signal or prop read by the query factory changes. Status chrome reads
 * `waiting()` and `failure()`, like every other binding. If no source load
 * ever succeeded and the latest failed, `rows()` throws that failure to the
 * nearest `<Errored>`, which is why it joins the Component's `E`.
 */
export interface LiveQueryHandle<T, E = never> {
  /** Current rows (always the last good rows). */
  readonly rows: Accessor<ReadonlyArray<T>>;
  /** True while any source is loading. */
  readonly waiting: Accessor<boolean>;
  /** The settled source-load failure, if the latest load failed. */
  readonly failure: Accessor<Cause.Cause<LiveQueryRenderError<E>> | undefined>;
  /** Ensures every source has loaded. */
  preload(): Effect.Effect<void, E | QueryEvaluationError>;
  /** Reloads every source. */
  refresh(): Effect.Effect<void, E | QueryEvaluationError>;
}

/** A query factory, or a prebuilt `Query.Live`. */
export type LiveQueryInput<T, E, R> = Query.Factory<T, E, R> | Query.Live<T, E, R>;

/**
 * Binds a live query under the instance's owner: the factory runs tracked (its
 * signal and prop reads rebuild the query), sources preload on mount (after
 * hydration settles on a hydrating client, never on the server), and
 * preloading restarts when the source set changes.
 */
export const bindLiveQuery = <T, E, R>(
  instance: LiveQueryInstance,
  input: LiveQueryInput<T, E, R>,
  options: LiveQueryOptions,
): LiveQueryHandle<T, E> =>
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
