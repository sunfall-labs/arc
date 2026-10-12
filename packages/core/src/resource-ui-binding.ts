import { Effect, Fiber } from "effect";
import type { AsyncResult } from "effect/reactivity";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { runWithRuntime } from "./runtime.js";
import type { EffectInput } from "./effect-like.js";
import { invokeEffectInput } from "./effect-like.js";
import type { ResourceRef } from "./resource.js";
import {
  prefetchResourceEffect,
  releaseResourceRefEffect,
  retainResourceRefEffect,
  refreshResourceEffect,
  resourceResult,
} from "./resource-runtime.js";
import type { ReadableSignal } from "./signal.js";

/** Resource ref input accepted by framework Resource UI adapters. */
export type ResourceUiInput<I, A, E, R = unknown> =
  | ResourceRef<I, A, E, R>
  | (() => ResourceRef<I, A, E, R>);

/** Failure from an automatic UI preload, keyed to the Resource ref that caused it. */
export interface ResourceUiPreloadFailure<I, A, E, R, ER> {
  readonly ref: ResourceRef<I, A, E, R>;
  readonly error: E | ER;
}

/** Options for automatic mount/owner-time Resource UI preloads. */
export interface ResourceUiAutoPreloadOptions<E, ER> {
  /** Start loading when the bound ref is still initial. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe automatic preload failures without failing the fire-and-forget preload fiber.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; adapt host Promise work explicitly with
   * `Effect.tryPromise(...)` before returning it.
   */
  readonly onPreloadFailure?: (error: E | ER) => EffectInput<void, unknown>;
}

/** Options for a Resource UI Binding Controller. */
export interface ResourceUiBindingControllerOptions<I, A, E, R, ER> {
  /** Runtime Spine used to provide services and Resource Store state. */
  readonly runtime: AnySunfallArcRuntime<ER>;
  /** Adapter callback used to bridge keyed preload failures into host reactivity. */
  readonly onPreloadFailureChange?: (
    failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined,
  ) => void;
}

/**
 * Adapter-neutral Resource binding policy shared by UI packages.
 *
 * The Solid adapter owns host reactivity and async rendering. This controller
 * owns the Resource-specific policy that stays host-independent and testable
 * without a renderer: ref identity, runtime-bound refresh/preload Effects, automatic
 * preload fibers, keyed preload failures, observer failure swallowing, stale
 * preload interruption, and retained-ref cleanup.
 */
export interface ResourceUiBindingController<I, A, E, R, ER> {
  /** Runtime-bound Resource `AsyncResult` signal for the supplied ref. */
  result(ref: ResourceRef<I, A, E, R>): ReadableSignal<AsyncResult.AsyncResult<A, E>>;
  /** Runtime-bound refresh Effect for the supplied ref. */
  refresh(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E | ER>;
  /** Runtime-bound preload Effect for the supplied ref. */
  preload(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E | ER>;
  /** Marks a ref as current, clearing stale keyed failures and interrupting stale preload joins. */
  bindRef(ref: ResourceRef<I, A, E, R>): void;
  /** Starts the automatic preload when the current Resource state is still initial. */
  startInitialPreload(
    ref: ResourceRef<I, A, E, R>,
    options?: ResourceUiAutoPreloadOptions<E, ER>,
  ): void;
  /** Interrupts the current automatic preload join fiber as an Effect. */
  interruptPreload(): Effect.Effect<void>;
  /** Disposes controller-owned preload and retained-ref work as an Effect. */
  dispose(): Effect.Effect<void>;
  /** Returns the current automatic preload failure only when it belongs to `ref`. */
  preloadFailureFor(ref: ResourceRef<I, A, E, R>): E | ER | undefined;
}

/** Fiber joined by UI Suspense adapters while a Resource preload is pending. */
export type ResourceUiSuspensePreloadFiber<A, E, ER> = Fiber.Fiber<A, E | ER>;

/** Options for converting a Resource preload fiber to a host Suspense token. */
export interface ResourceUiSuspensePreloadOptions<_I, A, E, R, ER, Token> {
  /** Optional adapter fork hook, used when a UI scope should own the waiting fiber. */
  readonly fork?: (effect: Effect.Effect<A, E, R>) => ResourceUiSuspensePreloadFiber<A, E, ER>;
  /** Converts the waiting fiber to the host token the UI Suspense adapter throws. */
  readonly toHostToken: (fiber: ResourceUiSuspensePreloadFiber<A, E, ER>) => Token;
}

/** Adapter-neutral controller for deduping and interrupting Suspense preload joins. */
export interface ResourceUiSuspensePreloadController<I, A, E, R, ER, Token> {
  /** Returns the current host token for `ref`, starting a new preload join when needed. */
  hostToken(
    ref: ResourceRef<I, A, E, R>,
    options: ResourceUiSuspensePreloadOptions<I, A, E, R, ER, Token>,
  ): Token;
  /** Interrupts the current preload join when it belongs to a stale ref. */
  interruptStale(ref: ResourceRef<I, A, E, R>): void;
  /** Interrupts the current preload join fiber, if any. */
  interrupt(): Effect.Effect<void>;
  /** Disposes controller-owned preload join work as an Effect. */
  dispose(): Effect.Effect<void>;
}

/** Resolves a Resource UI ref input to the current Resource ref. */
export const resourceUiRefValue = <I, A, E, R>(
  ref: ResourceUiInput<I, A, E, R>,
): ResourceRef<I, A, E, R> =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>)() : ref;

/** Converts a Resource UI ref input to a stable accessor shape. */
export const resourceUiRefAccessor = <I, A, E, R>(
  ref: ResourceUiInput<I, A, E, R>,
): (() => ResourceRef<I, A, E, R>) =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>) : () => ref;

/** Returns true when two Resource refs target the same family entry. */
export const resourceUiSameRef = <I, A, E, R>(
  left: ResourceRef<I, A, E, R>,
  right: ResourceRef<I, A, E, R>,
): boolean => left.family === right.family && left.key === right.key;

/** Returns a preload failure only when it still belongs to the supplied Resource ref. */
export const resourceUiPreloadFailureFor = <I, A, E, R, ER>(
  failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined,
  ref: ResourceRef<I, A, E, R>,
): E | ER | undefined =>
  failure !== undefined && resourceUiSameRef(failure.ref, ref) ? failure.error : undefined;

/** Binds a Resource Effect to the adapter runtime that owns Resource Store state. */
export const resourceUiBindRuntimeEffect = <A, E, R, ER>(
  runtime: AnySunfallArcRuntime<ER>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ER> => Effect.scoped(runtime.provide(effect));

interface ResourceUiBindingPreload<I, A, E, R> {
  readonly ref: ResourceRef<I, A, E, R>;
  readonly fiber: Fiber.Fiber<unknown, unknown>;
}

interface ResourceUiBindingDisposal<I, A, E, R> {
  readonly preload: ResourceUiBindingPreload<I, A, E, R> | undefined;
  readonly retainedRef: ResourceRef<I, A, E, R> | undefined;
  readonly retentionFiber: Fiber.Fiber<void, unknown> | undefined;
}

/** Creates the adapter-neutral Resource UI binding controller. */
export const makeResourceUiBindingController = <I, A, E, R = unknown, ER = never>(
  options: ResourceUiBindingControllerOptions<I, A, E, R, ER>,
): ResourceUiBindingController<I, A, E, R, ER> => {
  let currentRef: ResourceRef<I, A, E, R> | undefined;
  let preloadFailure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined;
  let preload: ResourceUiBindingPreload<I, A, E, R> | undefined;
  let retainedRef: ResourceRef<I, A, E, R> | undefined;
  let retentionFiber: Fiber.Fiber<void, unknown> | undefined;

  const setPreloadFailure = (
    failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined,
  ): void => {
    preloadFailure = failure;
    try {
      options.onPreloadFailureChange?.(failure);
    } catch {
      // Host setter/observer failures must not escape controller cleanup.
    }
  };

  const clearPreloadFailureForRef = (ref: ResourceRef<I, A, E, R>): void => {
    if (preloadFailure !== undefined && resourceUiSameRef(preloadFailure.ref, ref)) {
      setPreloadFailure(undefined);
    }
  };

  const takePreload = (): ResourceUiBindingPreload<I, A, E, R> | undefined => {
    const current = preload;
    preload = undefined;
    return current;
  };

  const interruptTakenPreloadEffect = (
    current: ResourceUiBindingPreload<I, A, E, R> | undefined,
  ): Effect.Effect<void> =>
    current === undefined
      ? Effect.void
      : Fiber.interrupt(current.fiber).pipe(Effect.catchCause(() => Effect.void));

  const interruptPreloadEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => interruptTakenPreloadEffect(takePreload()));

  const interruptPreload = (): void => {
    const current = takePreload();
    if (current !== undefined) {
      void options.runtime.runFork(interruptTakenPreloadEffect(current));
    }
  };

  const forkRetentionEffect = (effect: Effect.Effect<void, unknown, R>): void => {
    const previous = retentionFiber;
    retentionFiber = options.runtime.runFork(
      Effect.gen(function* () {
        if (previous !== undefined) {
          yield* Fiber.join(previous).pipe(Effect.catchCause(() => Effect.void));
        }
        yield* resourceUiBindRuntimeEffect(options.runtime, effect);
      }).pipe(Effect.catchCause(() => Effect.void)),
    );
  };

  const releaseRetainedRef = (): void => {
    const current = retainedRef;
    retainedRef = undefined;
    if (current !== undefined) {
      forkRetentionEffect(releaseResourceRefEffect(current));
    }
  };

  const captureDisposal = (): ResourceUiBindingDisposal<I, A, E, R> => {
    const currentPreload = takePreload();
    const currentRetainedRef = retainedRef;
    const currentRetentionFiber = retentionFiber;
    currentRef = undefined;
    retainedRef = undefined;
    retentionFiber = undefined;
    setPreloadFailure(undefined);
    return {
      preload: currentPreload,
      retainedRef: currentRetainedRef,
      retentionFiber: currentRetentionFiber,
    };
  };

  const releaseCapturedRetainedRefEffect = (ref: ResourceRef<I, A, E, R>): Effect.Effect<void> =>
    resourceUiBindRuntimeEffect(options.runtime, releaseResourceRefEffect(ref)).pipe(
      Effect.catchCause(() => Effect.void),
    );

  const disposeCapturedEffect = (
    captured: ResourceUiBindingDisposal<I, A, E, R>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* interruptTakenPreloadEffect(captured.preload);
      if (captured.retentionFiber !== undefined) {
        yield* Fiber.join(captured.retentionFiber).pipe(Effect.catchCause(() => Effect.void));
      }
      if (captured.retainedRef !== undefined) {
        yield* releaseCapturedRetainedRefEffect(captured.retainedRef);
      }
    });
  const disposeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => disposeCapturedEffect(captureDisposal()));

  const retainRef = (ref: ResourceRef<I, A, E, R>): void => {
    retainedRef = ref;
    forkRetentionEffect(retainResourceRefEffect(ref));
  };

  const bindRef = (ref: ResourceRef<I, A, E, R>): void => {
    if (currentRef !== undefined && resourceUiSameRef(currentRef, ref)) {
      return;
    }

    releaseRetainedRef();
    currentRef = ref;
    retainRef(ref);
    interruptPreload();
    setPreloadFailure(undefined);
  };

  const result = (ref: ResourceRef<I, A, E, R>): ReadableSignal<AsyncResult.AsyncResult<A, E>> =>
    runWithRuntime(options.runtime, () => resourceResult(ref));

  const prefetchEffect = (ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E | ER> =>
    resourceUiBindRuntimeEffect(options.runtime, prefetchResourceEffect(ref)).pipe(
      Effect.tap(() => Effect.sync(() => clearPreloadFailureForRef(ref))),
    );

  const refreshEffect = (ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E | ER> =>
    resourceUiBindRuntimeEffect(options.runtime, refreshResourceEffect(ref)).pipe(
      Effect.tap(() => Effect.sync(() => clearPreloadFailureForRef(ref))),
    );

  const notifyPreloadFailure = (
    observer: ResourceUiAutoPreloadOptions<E, ER>["onPreloadFailure"],
    error: E | ER,
  ): Effect.Effect<void> =>
    observer === undefined
      ? Effect.void
      : invokeEffectInput("ResourceUiBinding.onPreloadFailure", observer, error).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.asVoid,
        );

  const startInitialPreload = (
    ref: ResourceRef<I, A, E, R>,
    preloadOptions: ResourceUiAutoPreloadOptions<E, ER> = {},
  ): void => {
    bindRef(ref);
    if (preloadOptions.preload === false || result(ref).get()._tag !== "Initial") {
      return;
    }
    if (preload !== undefined && resourceUiSameRef(preload.ref, ref)) {
      return;
    }

    interruptPreload();
    const fiber = options.runtime.runFork(
      prefetchEffect(ref).pipe(
        Effect.tap(() => Effect.sync(() => setPreloadFailure(undefined))),
        Effect.catch((error) =>
          Effect.sync(() => {
            setPreloadFailure({ ref, error });
          }).pipe(Effect.andThen(notifyPreloadFailure(preloadOptions.onPreloadFailure, error))),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (preload !== undefined && resourceUiSameRef(preload.ref, ref)) {
              preload = undefined;
            }
          }),
        ),
        Effect.catchCause(() => Effect.void),
      ),
    );
    preload = { ref, fiber };
  };

  return {
    result,
    refresh: refreshEffect,
    preload: prefetchEffect,
    bindRef,
    startInitialPreload,
    interruptPreload: interruptPreloadEffect,
    dispose: disposeEffect,
    preloadFailureFor: (ref) => resourceUiPreloadFailureFor(preloadFailure, ref),
  };
};

/** Creates the adapter-neutral Resource Suspense preload controller. */
export const makeResourceUiSuspensePreloadController = <
  I,
  A,
  E,
  R = unknown,
  ER = never,
  Token = unknown,
>(
  runtime: AnySunfallArcRuntime<ER>,
): ResourceUiSuspensePreloadController<I, A, E, R, ER, Token> => {
  let preload:
    | {
        readonly ref: ResourceRef<I, A, E, R>;
        readonly fiber: ResourceUiSuspensePreloadFiber<A, E, ER>;
        readonly token: Token;
        readonly removeObserver: () => void;
      }
    | undefined;

  const takePreload = ():
    | {
        readonly ref: ResourceRef<I, A, E, R>;
        readonly fiber: ResourceUiSuspensePreloadFiber<A, E, ER>;
        readonly token: Token;
        readonly removeObserver: () => void;
      }
    | undefined => {
    const current = preload;
    preload = undefined;
    current?.removeObserver();
    return current;
  };

  const interruptTakenPreloadEffect = (
    current:
      | {
          readonly ref: ResourceRef<I, A, E, R>;
          readonly fiber: ResourceUiSuspensePreloadFiber<A, E, ER>;
          readonly token: Token;
          readonly removeObserver: () => void;
        }
      | undefined,
  ): Effect.Effect<void> =>
    current === undefined
      ? Effect.void
      : Fiber.interrupt(current.fiber).pipe(Effect.catchCause(() => Effect.void));

  const interruptEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => interruptTakenPreloadEffect(takePreload()));

  const interrupt = (): void => {
    void runtime.runFork(interruptTakenPreloadEffect(takePreload()));
  };

  const clearCompleted = (fiber: ResourceUiSuspensePreloadFiber<A, E, ER>): void => {
    const current = preload;
    if (current === undefined || current.fiber !== fiber) {
      return;
    }

    current.removeObserver();
    preload = undefined;
  };

  return {
    hostToken: (ref, options) => {
      if (preload !== undefined && resourceUiSameRef(preload.ref, ref)) {
        return preload.token;
      }

      interrupt();
      const fiber =
        options.fork === undefined
          ? runtime.runFork(Effect.scoped(runtime.provide(prefetchResourceEffect(ref))))
          : options.fork(prefetchResourceEffect(ref));
      const token = options.toHostToken(fiber);
      const removeObserver = fiber.addObserver(() => {
        clearCompleted(fiber);
      });
      preload = { ref, fiber, token, removeObserver };
      if (fiber.pollUnsafe() !== undefined) {
        clearCompleted(fiber);
      }
      return token;
    },
    interruptStale: (ref) => {
      if (preload !== undefined && !resourceUiSameRef(preload.ref, ref)) {
        interrupt();
      }
    },
    interrupt: interruptEffect,
    dispose: interruptEffect,
  };
};
