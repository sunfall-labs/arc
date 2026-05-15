import { Effect, Fiber } from "effect";
import type { AnyEffectUiRuntime } from "./runtime.js";
import { runWithRuntime } from "./runtime.js";
import { Resource, type ResourceLoadError, type ResourceRef, type ResourceState } from "./resource.js";
import type { ReadableSignal } from "./signal.js";

export type ResourceUiInput<I, A, E, R = unknown> =
  | ResourceRef<I, A, E, R>
  | (() => ResourceRef<I, A, E, R>);

/** Metadata passed to Resource UI success render branches. */
export interface ResourceUiSuccessMeta<A, E> {
  readonly refreshing: boolean;
  readonly state: ResourceState<A, E>;
}

/** Exhaustive render cases for Resource UI handles. */
export interface ResourceUiMatch<A, E, B> {
  readonly initial: () => B;
  readonly pending: (previous: A | undefined) => B;
  readonly success: (value: A, meta: ResourceUiSuccessMeta<A, E>) => B;
  readonly failure: (error: E, previous: A | undefined) => B;
}

/** Failure from an automatic UI preload, keyed to the Resource ref that caused it. */
export interface ResourceUiPreloadFailure<I, A, E, R, ER> {
  readonly ref: ResourceRef<I, A, E, R>;
  readonly error: ResourceLoadError<E> | ER;
}

/** Options for automatic mount/owner-time Resource UI preloads. */
export interface ResourceUiAutoPreloadOptions<E, ER> {
  /** Start loading when the bound ref is still initial. Defaults to true. */
  readonly preload?: boolean;
  /** Observe automatic preload failures without failing the fire-and-forget preload fiber. */
  readonly onPreloadFailure?: (error: ResourceLoadError<E> | ER) => void;
}

/** Options for a Resource UI Binding Controller. */
export interface ResourceUiBindingControllerOptions<I, A, E, R, ER> {
  /** Runtime Spine used to provide services and Resource Store state. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Adapter callback used to bridge keyed preload failures into host reactivity. */
  readonly onPreloadFailureChange?: (failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined) => void;
}

/**
 * Adapter-neutral Resource binding policy shared by UI packages.
 *
 * React and Solid own their host reactivity and Suspense integration. This
 * controller owns the Resource-specific policy that should not drift between
 * adapters: ref identity, runtime-bound refresh/prefetch Effects, automatic
 * preload fibers, keyed preload failures, observer failure swallowing, and
 * stale preload interruption.
 */
export interface ResourceUiBindingController<I, A, E, R, ER> {
  /** Runtime-bound Resource result signal for the supplied ref. */
  result(ref: ResourceRef<I, A, E, R>): ReadableSignal<ResourceState<A, ResourceLoadError<E>>>;
  /** Runtime-bound refresh Effect for the supplied ref. */
  refreshEffect(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E> | ER>;
  /** Runtime-bound prefetch Effect for the supplied ref. */
  prefetchEffect(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E> | ER>;
  /** Marks a ref as current, clearing stale keyed failures and interrupting stale preload joins. */
  bindRef(ref: ResourceRef<I, A, E, R>): void;
  /** Starts the automatic preload when the current Resource state is still initial. */
  startInitialPreload(ref: ResourceRef<I, A, E, R>, options?: ResourceUiAutoPreloadOptions<E, ER>): void;
  /** Interrupts the current automatic preload join fiber, if any. */
  interruptPreload(): void;
  /** Disposes controller-owned preload work. */
  dispose(): void;
  /** Returns the current automatic preload failure only when it belongs to `ref`. */
  preloadFailureFor(ref: ResourceRef<I, A, E, R>): ResourceLoadError<E> | ER | undefined;
}

export type ResourceUiSuspensePreloadFiber<A, E, ER> = Fiber.Fiber<A, ResourceLoadError<E> | ER>;

export interface ResourceUiSuspensePreloadOptions<I, A, E, R, ER, Token> {
  /** Optional adapter fork hook, used when a UI scope should own the waiting fiber. */
  readonly fork?: (effect: Effect.Effect<A, ResourceLoadError<E>, R>) => ResourceUiSuspensePreloadFiber<A, E, ER>;
  /** Converts the waiting fiber to the host token the UI Suspense adapter throws. */
  readonly toHostToken: (fiber: ResourceUiSuspensePreloadFiber<A, E, ER>) => Token;
}

/** Adapter-neutral controller for deduping and interrupting Suspense preload joins. */
export interface ResourceUiSuspensePreloadController<I, A, E, R, ER, Token> {
  /** Returns the current host token for `ref`, starting a new preload join when needed. */
  hostToken(ref: ResourceRef<I, A, E, R>, options: ResourceUiSuspensePreloadOptions<I, A, E, R, ER, Token>): Token;
  /** Interrupts the current preload join when it belongs to a stale ref. */
  interruptStale(ref: ResourceRef<I, A, E, R>): void;
  /** Interrupts the current preload join fiber, if any. */
  interrupt(): void;
  /** Disposes controller-owned preload join work. */
  dispose(): void;
}

export const resourceUiRefValue = <I, A, E, R>(
  ref: ResourceUiInput<I, A, E, R>
): ResourceRef<I, A, E, R> =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>)() : ref;

export const resourceUiRefAccessor = <I, A, E, R>(
  ref: ResourceUiInput<I, A, E, R>
): (() => ResourceRef<I, A, E, R>) =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>) : () => ref;

export const resourceUiSameRef = <I, A, E, R>(
  left: ResourceRef<I, A, E, R>,
  right: ResourceRef<I, A, E, R>
): boolean =>
  left.family === right.family && left.key === right.key;

export const resourceUiStateHasValue = <A, E>(state: ResourceState<A, E>): boolean => {
  switch (state._tag) {
    case "Success":
      return true;
    case "Pending":
    case "Failure":
      return "previous" in state;
    case "Initial":
      return false;
  }
};

export const resourceUiPreloadFailureFor = <I, A, E, R, ER>(
  failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined,
  ref: ResourceRef<I, A, E, R>
): ResourceLoadError<E> | ER | undefined =>
  failure !== undefined && resourceUiSameRef(failure.ref, ref)
    ? failure.error
    : undefined;

export const resourceUiMatchState = <A, E, B>(
  state: ResourceState<A, E>,
  cases: ResourceUiMatch<A, E, B>
): B => {
  switch (state._tag) {
    case "Initial":
      return cases.initial();
    case "Pending":
      return cases.pending(state.previous);
    case "Success":
      return cases.success(state.value, { refreshing: false, state });
    case "Failure":
      return cases.failure(state.error, state.previous);
  }
};

export const resourceUiBindRuntimeEffect = <A, E, R, ER>(
  runtime: AnyEffectUiRuntime<ER>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | ER> =>
  Effect.scoped(runtime.provide(effect));

export const makeResourceUiBindingController = <I, A, E, R = unknown, ER = never>(
  options: ResourceUiBindingControllerOptions<I, A, E, R, ER>
): ResourceUiBindingController<I, A, E, R, ER> => {
  let currentRef: ResourceRef<I, A, E, R> | undefined;
  let preloadFailure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined;
  let preload:
    | {
        readonly ref: ResourceRef<I, A, E, R>;
        readonly fiber: Fiber.Fiber<unknown, unknown>;
      }
    | undefined;

  const setPreloadFailure = (failure: ResourceUiPreloadFailure<I, A, E, R, ER> | undefined): void => {
    preloadFailure = failure;
    options.onPreloadFailureChange?.(failure);
  };

  const interruptPreload = (): void => {
    const current = preload;
    preload = undefined;
    if (current !== undefined) {
      void options.runtime.runFork(
        Fiber.interrupt(current.fiber).pipe(Effect.catch(() => Effect.void))
      );
    }
  };

  const bindRef = (ref: ResourceRef<I, A, E, R>): void => {
    if (currentRef !== undefined && resourceUiSameRef(currentRef, ref)) {
      return;
    }

    currentRef = ref;
    interruptPreload();
    setPreloadFailure(undefined);
  };

  const result = (ref: ResourceRef<I, A, E, R>): ReadableSignal<ResourceState<A, ResourceLoadError<E>>> =>
    runWithRuntime(options.runtime, () => Resource.result(ref));

  const prefetchEffect = (ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E> | ER> =>
    resourceUiBindRuntimeEffect(options.runtime, Resource.prefetchEffect(ref));

  const refreshEffect = (ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E> | ER> =>
    resourceUiBindRuntimeEffect(options.runtime, Resource.refreshEffect(ref));

  const startInitialPreload = (
    ref: ResourceRef<I, A, E, R>,
    preloadOptions: ResourceUiAutoPreloadOptions<E, ER> = {}
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
            if (preloadOptions.onPreloadFailure !== undefined) {
              try {
                preloadOptions.onPreloadFailure(error);
              } catch {
                // Observer callbacks must not fail the fire-and-forget preload fiber.
              }
            }
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (preload !== undefined && resourceUiSameRef(preload.ref, ref)) {
              preload = undefined;
            }
          })
        )
      )
    );
    preload = { ref, fiber };
  };

  return {
    result,
    refreshEffect,
    prefetchEffect,
    bindRef,
    startInitialPreload,
    interruptPreload,
    dispose: interruptPreload,
    preloadFailureFor: (ref) => resourceUiPreloadFailureFor(preloadFailure, ref)
  };
};

export const makeResourceUiSuspensePreloadController = <I, A, E, R = unknown, ER = never, Token = unknown>(
  runtime: AnyEffectUiRuntime<ER>
): ResourceUiSuspensePreloadController<I, A, E, R, ER, Token> => {
  let preload:
    | {
        readonly ref: ResourceRef<I, A, E, R>;
        readonly fiber: ResourceUiSuspensePreloadFiber<A, E, ER>;
        readonly token: Token;
      }
    | undefined;

  const interrupt = (): void => {
    const current = preload;
    preload = undefined;
    if (current !== undefined) {
      void runtime.runFork(
        Fiber.interrupt(current.fiber).pipe(Effect.catch(() => Effect.void))
      );
    }
  };

  return {
    hostToken: (ref, options) => {
      if (preload !== undefined && resourceUiSameRef(preload.ref, ref)) {
        return preload.token;
      }

      interrupt();
      const fiber = options.fork === undefined
        ? runtime.runFork(runtime.provide(Resource.prefetchEffect(ref)))
        : options.fork(Resource.prefetchEffect(ref));
      const token = options.toHostToken(fiber);
      preload = { ref, fiber, token };
      return token;
    },
    interruptStale: (ref) => {
      if (preload !== undefined && !resourceUiSameRef(preload.ref, ref)) {
        interrupt();
      }
    },
    interrupt,
    dispose: interrupt
  };
};
