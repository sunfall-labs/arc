import type { AnySunfallArcRuntime, EffectInput } from "@sunfall/arc-core";
import { invokeEffectInput } from "@sunfall/arc-core/internal";
import { Effect, Fiber } from "effect";

/** Provides the runtime and scopes a collection/live-query Effect. */
export const bindCollectionRuntimeEffect = <A, E, R, ER = never>(
  runtime: AnySunfallArcRuntime<ER>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ER> => Effect.scoped(runtime.provide(effect));

/** Controls mount-time preload fibers for framework collection adapters. */
export interface CollectionReactivePreloadController<E, _ER = never> {
  /** Starts a new preload when enabled, interrupting any previous one first. */
  start(preloadEffect: Effect.Effect<void, E, unknown> | undefined, enabled: boolean): void;
  /** Interrupts the current preload fiber and retires its generation as an Effect. */
  interruptEffect(): Effect.Effect<void>;
  /** Runtime-owned synchronous convenience for framework cleanup hooks. */
  interrupt(): void;
}

/** Options for the shared collection/live-query preload controller. */
export interface CollectionReactivePreloadControllerOptions<E, ER = never> {
  /** Runtime that owns preload execution and interruption. */
  readonly runtime: AnySunfallArcRuntime<ER>;
  /**
   * Called when the latest preload succeeds.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; adapt host Promise work explicitly with
   * `Effect.tryPromise(...)` before returning it.
   */
  readonly onSuccess: () => EffectInput<void, unknown>;
  /**
   * Called when the latest preload fails.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; adapt host Promise work explicitly with
   * `Effect.tryPromise(...)` before returning it.
   */
  readonly onFailure: (error: E | ER) => EffectInput<void, unknown>;
}

/**
 * Creates the mount-time preload lifecycle used by the Solid DB hooks.
 *
 * The controller keeps generation checks in one place so stale preload failures
 * cannot overwrite newer UI state after a source refresh or unmount.
 */
export const makeCollectionReactivePreloadController = <E, ER = never>(
  options: CollectionReactivePreloadControllerOptions<E, ER>,
): CollectionReactivePreloadController<E, ER> => {
  let preloadFiber: Fiber.Fiber<void, unknown> | undefined;
  let preloadGeneration = 0;

  const retireCurrentPreload = (): Fiber.Fiber<void, unknown> | undefined => {
    preloadGeneration++;
    const fiber = preloadFiber;
    preloadFiber = undefined;
    return fiber;
  };

  const interruptEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const fiber = retireCurrentPreload();
      return fiber === undefined
        ? Effect.void
        : Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void));
    });

  const interrupt = (): void => {
    const fiber = retireCurrentPreload();
    if (fiber !== undefined) {
      void options.runtime.runFork(
        Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void)),
      );
    }
  };

  const start = (
    preloadEffect: Effect.Effect<void, E, unknown> | undefined,
    enabled: boolean,
  ): void => {
    interrupt();
    if (!enabled || preloadEffect === undefined) {
      return;
    }

    const generation = ++preloadGeneration;
    const isCurrentGeneration = (): boolean => preloadGeneration === generation;
    preloadFiber = options.runtime.runFork(
      bindCollectionRuntimeEffect(options.runtime, preloadEffect).pipe(
        Effect.tap(() =>
          isCurrentGeneration()
            ? invokeEffectInput("CollectionReactivePreload.onSuccess", options.onSuccess).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid,
              )
            : Effect.void,
        ),
        Effect.catch((error) =>
          isCurrentGeneration()
            ? invokeEffectInput(
                "CollectionReactivePreload.onFailure",
                options.onFailure,
                error,
              ).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid,
              )
            : Effect.void,
        ),
        Effect.catchCause(() => Effect.void),
      ),
    );
  };

  return { interruptEffect, interrupt, start };
};
