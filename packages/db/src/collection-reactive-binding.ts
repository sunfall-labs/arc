import type { AnySunfallArcRuntime } from "@sunfall/arc-core";
import { Effect, Fiber } from "effect";

/** Provides the runtime and scopes a collection/live-query Effect. */
export const bindCollectionRuntimeEffect = <A, E, R, ER = never>(
  runtime: AnySunfallArcRuntime<ER>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ER> => Effect.scoped(runtime.provide(effect));

/** Controls mount-time preload fibers for framework collection adapters. */
export interface CollectionReactivePreloadController {
  /** Starts a new preload when enabled, interrupting any previous one first. */
  start(preloadEffect: Effect.Effect<void, unknown, unknown> | undefined, enabled: boolean): void;
  /** Interrupts the current preload fiber and retires its generation as an Effect. */
  interrupt(): Effect.Effect<void>;
}

/** Options for the shared collection/live-query preload controller. */
export interface CollectionReactivePreloadControllerOptions<ER = never> {
  /** Runtime that owns preload execution and interruption. */
  readonly runtime: AnySunfallArcRuntime<ER>;
}

/**
 * Creates the mount-time preload lifecycle used by the Solid DB hooks.
 *
 * Preload outcomes land in the sources' own load results (which the bindings
 * read); the controller only owns the fiber, so a source change or unmount
 * interrupts the stale preload.
 */
export const makeCollectionReactivePreloadController = <ER = never>(
  options: CollectionReactivePreloadControllerOptions<ER>,
): CollectionReactivePreloadController => {
  let preloadFiber: Fiber.Fiber<void, unknown> | undefined;

  const retireCurrentPreload = (): Fiber.Fiber<void, unknown> | undefined => {
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
    preloadEffect: Effect.Effect<void, unknown, unknown> | undefined,
    enabled: boolean,
  ): void => {
    interrupt();
    if (!enabled || preloadEffect === undefined) {
      return;
    }

    preloadFiber = options.runtime.runFork(
      bindCollectionRuntimeEffect(options.runtime, preloadEffect).pipe(
        Effect.catchCause(() => Effect.void),
      ),
    );
  };

  return { interrupt: interruptEffect, start };
};
