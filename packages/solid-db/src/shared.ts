import {
  invokeEffectInput,
  runWithRuntime,
  Signal,
  type AnySunfallArcRuntime,
  type EffectInput,
} from "@sunfall/arc-core";
import {
  bindCollectionRuntimeEffect,
  makeCollectionReactivePreloadController,
} from "@sunfall/arc-db";
import { useRuntime } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { createRenderEffect, onCleanup, type Accessor } from "solid-js";

export interface SolidDbReactiveBinding<E, ER = never> {
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly preloadFailure: Accessor<E | ER | undefined>;
  /** Reads collection state from the bound runtime's Collection Store. */
  read<A>(read: () => A): A;
  bindEffect<A, E2, R>(effect: Effect.Effect<A, E2, R>): Effect.Effect<A, E2 | ER>;
}

export interface SolidDbReactiveBindingOptions<E, R = never, ER = never> {
  readonly runtime?: AnySunfallArcRuntime<ER> | undefined;
  readonly preload?: boolean | undefined;
  /** Preload work for the current sources; preloading restarts when it changes. */
  readonly preloadEffect: Accessor<Effect.Effect<void, E, R>>;
  /**
   * Observer for automatic preload failures.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; observer failures are ignored after the failure is
   * recorded.
   */
  readonly onPreloadFailure?: ((error: E | ER) => EffectInput<void, unknown>) | undefined;
}

/**
 * Shared Solid binding for collection-backed reads.
 *
 * Collection reads track their own Arc signals, which Solid tracks natively,
 * so the binding has no subscriptions or invalidation counters. It owns the
 * runtime seam, mount-time and source-change preloading, and runtime-bound
 * Effects so hooks only describe their domain-specific accessors.
 */
export const makeSolidDbReactiveBinding = <E, R = never, ER = never>(
  options: SolidDbReactiveBindingOptions<E, R, ER>,
): SolidDbReactiveBinding<E, ER> => {
  const runtime = options.runtime ?? useRuntime<ER>();
  // Adapter state lives in an Arc signal: tracked natively on the client and a
  // plain committed value during server rendering.
  const preloadFailure = Signal.make<E | ER | undefined>(undefined);
  const preloadController = makeCollectionReactivePreloadController<E, ER>({
    runtime,
    onSuccess: () => preloadFailure.set(() => undefined),
    onFailure: (error) =>
      Effect.sync(() => preloadFailure.set(() => error)).pipe(
        Effect.andThen(
          options.onPreloadFailure === undefined
            ? Effect.void
            : invokeEffectInput(
                "SolidDbReactiveBinding.onPreloadFailure",
                options.onPreloadFailure,
                error,
              ).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid,
              ),
        ),
      ),
  });

  // Preloading is a side effect, so it runs in the apply phase whenever the
  // source set (and with it the preload work) changes.
  createRenderEffect(options.preloadEffect, (preloadEffect) => {
    preloadController.start(preloadEffect, options.preload !== false);
  });

  onCleanup(() => {
    preloadController.interrupt();
  });

  return {
    runtime,
    preloadFailure: () => preloadFailure.get(),
    read: (read) => runWithRuntime(runtime, read),
    bindEffect: (effect) => bindCollectionRuntimeEffect(runtime, effect),
  };
};
