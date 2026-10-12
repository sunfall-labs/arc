import {
  EffectInputCallbackError,
  runWithRuntime,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import { CollectionSnapshotCodecError, QueryEvaluationError } from "@sunfall/arc-db";
import {
  bindCollectionRuntime,
  makeCollectionReactivePreloadController,
} from "@sunfall/arc-db/internal";
import type { Component } from "@sunfall/arc-solid";
import { Cause, Effect, Option } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { isServer } from "@solidjs/web";
import { createRenderEffect, isHydrating, onCleanup, onSettled, type Accessor } from "solid-js";

/**
 * Failures a collection or live query read can throw to `<Errored>`: its
 * declared errors. Contract violations (a throwing callback, a row the output
 * schema rejects, an invalid query plan) are defects instead.
 */
export type RenderError<E> = Exclude<
  E,
  EffectInputCallbackError | CollectionSnapshotCodecError | QueryEvaluationError
>;

const isContractViolation = (error: unknown): boolean =>
  error instanceof EffectInputCallbackError ||
  error instanceof CollectionSnapshotCodecError ||
  error instanceof QueryEvaluationError;

/** Re-causes contract violations as defects, leaving only declared failures typed. */
export const renderFailureCause = <E>(cause: Cause.Cause<E>): Cause.Cause<RenderError<E>> =>
  cause.reasons.some((reason) => Cause.isFailReason(reason) && isContractViolation(reason.error))
    ? (Cause.fromReasons(
        cause.reasons.map((reason) =>
          Cause.isFailReason(reason) && isContractViolation(reason.error)
            ? Cause.makeDieReason(reason.error)
            : reason,
        ),
      ) as Cause.Cause<RenderError<E>>)
    : (cause as Cause.Cause<RenderError<E>>);

/** The settled failure of the latest load, if it failed. */
export const settledFailure = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): Cause.Cause<RenderError<E>> | undefined =>
  result._tag === "Failure" && !result.waiting ? renderFailureCause(result.cause) : undefined;

export interface SolidDbReactiveBinding<E> {
  /**
   * Reads collection state from the bound runtime's Collection Store. While
   * the source has never loaded and its latest load failed, the read throws
   * that failure to the nearest `<Errored>`.
   */
  read<A>(read: () => A): A;
  bindEffect<A, E2, R>(effect: Effect.Effect<A, E2, R>): Effect.Effect<A, E2>;
  /** The latest load result, read in the bound runtime. */
  readonly result: () => AsyncResult.AsyncResult<unknown, E>;
}

export interface SolidDbReactiveBindingOptions<E, R = never> {
  readonly instance: Component.Instance;
  readonly preload?: boolean | undefined;
  /** Preload work for the current sources; preloading restarts when it changes. */
  readonly load: Accessor<Effect.Effect<void, unknown, R>>;
  /** The sources' latest load result. */
  readonly result: () => AsyncResult.AsyncResult<unknown, E>;
}

/**
 * Shared Solid binding for collection-backed reads.
 *
 * Collection reads track their own Arc signals, which Solid tracks natively,
 * so the binding has no subscriptions or invalidation counters. It owns the
 * runtime seam, mount-time and source-change preloading, the render-time
 * failure throw, and runtime-bound Effects so bindings only describe their
 * domain-specific accessors. Call it under the binding instance's Solid owner.
 */
export const makeSolidDbReactiveBinding = <E, R = never>(
  options: SolidDbReactiveBindingOptions<E, R>,
): SolidDbReactiveBinding<E> => {
  const { instance } = options;
  const runtime: AnySunfallArcRuntime<never> = instance.runtime;
  const preloadController = makeCollectionReactivePreloadController({ runtime });

  // Preloading is a side effect, so it runs in the apply phase whenever the
  // source set (and with it the preload work) changes. A server render only
  // reads: the route preload loads what it renders. A hydrating client first
  // renders what the server rendered, so its first preload waits until the
  // hydration pass settles (a load it started would flip `waiting` first).
  const enabled = !isServer && options.preload !== false;
  let deferred = enabled && isHydrating();
  let pending: Effect.Effect<void, unknown, R> | undefined;
  createRenderEffect(options.load, (preloadEffect) => {
    if (deferred) {
      pending = preloadEffect;
      return;
    }
    preloadController.start(preloadEffect, enabled);
  });
  // Registered on every side, so the server and client create the same owner
  // tree (and with it the same hydration keys).
  onSettled(() => {
    if (!deferred) {
      return;
    }
    deferred = false;
    preloadController.start(pending, enabled);
    pending = undefined;
  });

  onCleanup(() => {
    // Runs synchronously, so the preload generation retires with the owner.
    void Effect.runFork(preloadController.interrupt());
  });

  const result = () => runWithRuntime(runtime, options.result);
  return {
    result,
    read: (read) => {
      const current = result();
      if (
        current._tag === "Failure" &&
        !current.waiting &&
        Option.isNone(current.previousSuccess)
      ) {
        instance.fail(renderFailureCause(current.cause));
      }
      return runWithRuntime(runtime, read);
    },
    bindEffect: (effect) => bindCollectionRuntime(runtime, effect),
  };
};
