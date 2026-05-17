import {
  browserRouteRenderIdentity,
  browserRouteRenderDecision,
  forkRouteLazyComponentSuspense,
  isPromiseLikeValue,
  makeRuntimeUiScopeFrame,
  readRouteComponent,
  type AnyEffectUiRuntime,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers,
} from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import { batch, createRoot, type JSX, type Setter } from "solid-js";
import { createComponent } from "solid-js/web";

type AnyRoute = AnyBrowserRoute;

export type SolidRouteOutletRenderers<
  Routes extends readonly AnyRoute[],
  ER,
> = BrowserRouteOutletRenderers<Routes, ER, JSX.Element>;

export interface SolidRouteRenderInput<Routes extends readonly AnyRoute[], ER> {
  readonly state: BrowserRouterState<Routes, ER>;
  readonly renderers: SolidRouteOutletRenderers<Routes, ER>;
}

export interface SolidRouteRenderScopeController<Routes extends readonly AnyRoute[], ER> {
  update(input: SolidRouteRenderInput<Routes, ER>): void;
  disposeEffect(): Effect.Effect<void>;
  dispose(): void;
}

interface RenderedRouteScope {
  readonly node: JSX.Element;
  readonly dispose?: Effect.Effect<void, never, never>;
}

class SolidRouteRenderFailure {
  readonly _tag = "SolidRouteRenderFailure";

  constructor(
    readonly error: unknown,
    readonly dispose: Effect.Effect<void, never, never>,
  ) {}
}

class SolidRouteRenderSuspension {
  readonly _tag = "SolidRouteRenderSuspension";

  constructor(
    readonly thenable: unknown,
    readonly dispose: Effect.Effect<void, never, never>,
  ) {}
}

const defaultPending = (): JSX.Element => undefined;

const defaultFailure = <ER>(
  state: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>,
): JSX.Element => {
  throw state.cause;
};

const defaultNotFound = (): JSX.Element => undefined;

const routeRenderDefaults = {
  pending: defaultPending,
  failure: defaultFailure,
  notFound: defaultNotFound,
};

const renderInRouteScope = <ER>(
  runtime: AnyEffectUiRuntime<ER>,
  render: () => JSX.Element,
): { readonly node: JSX.Element; readonly dispose: Effect.Effect<void, never, never> } => {
  const frame = makeRuntimeUiScopeFrame(runtime);
  let disposeSolid: (() => void) | undefined;
  let renderFailure: { readonly error: unknown } | undefined;
  let renderThenable: unknown;
  const routeLazyComponentSuspenseToken = (error: unknown): unknown | undefined => {
    const fiber = forkRouteLazyComponentSuspense(error, runtime);
    return fiber === undefined ? undefined : Effect.runPromise(Fiber.join(fiber));
  };
  const dispose = Effect.andThen(
    Effect.sync(() => {
      try {
        frame.run(() => {
          disposeSolid?.();
        });
      } catch {
        // Preserve the original render error or cleanup outcome.
      }
    }),
    frame.disposeEffect(),
  ).pipe(Effect.catchCause(() => Effect.void));
  let node: JSX.Element;
  try {
    node = createRoot((disposeRoot) => {
      disposeSolid = disposeRoot;
      return frame.run(() => {
        try {
          return render();
        } catch (error) {
          if (isPromiseLikeValue(error)) {
            renderThenable = error;
            return undefined;
          }
          const pendingLazyComponent = routeLazyComponentSuspenseToken(error);
          if (pendingLazyComponent !== undefined) {
            renderThenable = pendingLazyComponent;
            return undefined;
          }
          renderFailure = { error };
          return undefined;
        }
      });
    });
  } catch (error) {
    if (isPromiseLikeValue(error)) {
      throw new SolidRouteRenderSuspension(error, dispose);
    }
    const pendingLazyComponent = routeLazyComponentSuspenseToken(error);
    if (pendingLazyComponent !== undefined) {
      throw new SolidRouteRenderSuspension(pendingLazyComponent, dispose);
    }
    throw new SolidRouteRenderFailure(error, dispose);
  }
  if (renderThenable !== undefined) {
    throw new SolidRouteRenderSuspension(renderThenable, dispose);
  }
  if (renderFailure !== undefined) {
    throw new SolidRouteRenderFailure(renderFailure.error, dispose);
  }

  return { node, dispose };
};

const renderRouteState = <Routes extends readonly AnyRoute[], ER>(
  state: BrowserRouterState<Routes, ER>,
  renderers: SolidRouteOutletRenderers<Routes, ER>,
  runtime: AnyEffectUiRuntime<ER>,
): RenderedRouteScope => {
  const decision = browserRouteRenderDecision(state);
  switch (decision._tag) {
    case "Pending":
      return renderInRouteScope(runtime, () =>
        (renderers.pending ?? defaultPending)(decision.state),
      );
    case "Failure":
      return renderInRouteScope(runtime, () =>
        (renderers.failure ?? defaultFailure)(decision.state),
      );
    case "NotFound":
      return renderInRouteScope(runtime, () =>
        (renderers.notFound ?? defaultNotFound)(decision.state),
      );
    case "Empty":
      return { node: undefined };
    case "Ready": {
      return renderInRouteScope(runtime, () => {
        const component = readRouteComponent(decision.component) as (
          props: Record<string, unknown>,
        ) => JSX.Element;
        return createComponent(component, decision.props as unknown as Record<string, unknown>);
      });
    }
  }
};

const disposeRenderedRoute = (
  dispose: Effect.Effect<void, never, never> | undefined,
): Effect.Effect<void> => dispose ?? Effect.void;

const solidRouteRenderFailure = (error: unknown): SolidRouteRenderFailure | undefined =>
  error instanceof SolidRouteRenderFailure ? error : undefined;

const solidRouteRenderSuspension = (error: unknown): SolidRouteRenderSuspension | undefined =>
  error instanceof SolidRouteRenderSuspension ? error : undefined;

const awaitRouteRenderThenableEffect = (thenable: unknown): Effect.Effect<void> =>
  Effect.callback((resume, signal) => {
    let completed = false;
    const abort = () => {
      completed = true;
      signal.removeEventListener("abort", abort);
    };
    const complete = () => {
      if (completed) {
        return;
      }
      completed = true;
      signal.removeEventListener("abort", abort);
      resume(Effect.void);
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      const then = Reflect.get(Object(thenable), "then");
      if (typeof then !== "function") {
        complete();
        return;
      }
      Reflect.apply(then, thenable, [complete, complete]);
    } catch {
      complete();
    }
  });

const scheduleRouteRenderError = (
  onCurrentTransition: () => boolean,
  setRenderError: Setter<unknown>,
  error: unknown,
): void => {
  queueMicrotask(() => {
    // Let Solid commit the cleared route node before the host ErrorBoundary renders.
    queueMicrotask(() => {
      if (onCurrentTransition()) {
        setRenderError(() => error);
      }
    });
  });
};

export const makeSolidRouteRenderScopeController = <
  Routes extends readonly AnyRoute[],
  ER,
>(options: {
  readonly initialInput: SolidRouteRenderInput<Routes, ER>;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly setNode: Setter<JSX.Element>;
  readonly setRenderError: Setter<unknown>;
  readonly setRenderSuspension?: Setter<unknown>;
}): SolidRouteRenderScopeController<Routes, ER> => {
  let renderedState = options.initialInput.state;
  let renderedIdentity = browserRouteRenderIdentity({
    state: options.initialInput.state,
    renderers: options.initialInput.renderers,
    defaults: routeRenderDefaults,
  });
  let disposeRoute: Effect.Effect<void, never, never> | undefined;
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;
  let suspensionRetryFiber: Fiber.Fiber<void, unknown> | undefined;

  const interruptSuspensionRetry = (): void => {
    const fiber = suspensionRetryFiber;
    suspensionRetryFiber = undefined;
    if (fiber !== undefined) {
      void options.runtime.runFork(
        Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void)),
      );
    }
  };

  const disposeStaleRenderedRoute = (rendered: RenderedRouteScope): void => {
    void options.runtime.runFork(
      disposeRenderedRoute(rendered.dispose).pipe(Effect.catchCause(() => Effect.void)),
    );
  };

  const joinRouteDisposal = (fiber: Fiber.Fiber<void, unknown> | undefined): Effect.Effect<void> =>
    fiber === undefined
      ? Effect.void
      : Fiber.join(fiber).pipe(Effect.catchCause(() => Effect.void));

  const startRouteDisposal = (
    routeDispose: Effect.Effect<void, never, never> | undefined,
  ): Fiber.Fiber<void, unknown> => {
    const previousDisposalFiber = disposalFiber;
    const currentDisposal = disposeRenderedRoute(routeDispose);
    const fiber = options.runtime.runFork(
      Effect.gen(function* () {
        yield* joinRouteDisposal(previousDisposalFiber);
        yield* currentDisposal;
      }).pipe(Effect.catchCause(() => Effect.void)),
    );
    disposalFiber = fiber;
    return fiber;
  };

  const startCurrentRouteDisposal = (): Fiber.Fiber<void, unknown> => {
    const currentDispose = disposeRoute;
    disposeRoute = undefined;
    return startRouteDisposal(currentDispose);
  };

  const renderTransition = (
    input: SolidRouteRenderInput<Routes, ER>,
    transition: number,
    transitionDisposalFiber: Fiber.Fiber<void, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* joinRouteDisposal(transitionDisposalFiber);
      if (transition !== transitionVersion) {
        return;
      }

      let next: RenderedRouteScope;
      try {
        next = renderRouteState(input.state, input.renderers, options.runtime);
      } catch (error) {
        const suspension = solidRouteRenderSuspension(error);
        if (suspension !== undefined) {
          if (transition !== transitionVersion) {
            startRouteDisposal(suspension.dispose);
            return;
          }
          if (options.setRenderSuspension === undefined) {
            startRouteDisposal(suspension.dispose);
            return;
          }
          disposeRoute = suspension.dispose;
          options.setRenderError(() => undefined);
          options.setNode(() => undefined);
          options.setRenderSuspension(() => suspension.thenable);
          scheduleSuspensionRetry(input, transition, suspension);
          return;
        }
        if (isPromiseLikeValue(error)) {
          return;
        }
        const failure = solidRouteRenderFailure(error);
        if (failure !== undefined) {
          startRouteDisposal(failure.dispose);
        }
        if (transition === transitionVersion) {
          options.setNode(() => undefined);
          scheduleRouteRenderError(
            () => transition === transitionVersion,
            options.setRenderError,
            failure?.error ?? error,
          );
        }
        return;
      }

      if (transition !== transitionVersion) {
        disposeStaleRenderedRoute(next);
        return;
      }

      disposeRoute = next.dispose;
      interruptSuspensionRetry();
      batch(() => {
        options.setRenderError(() => undefined);
        options.setRenderSuspension?.(() => undefined);
        options.setNode(() => next.node);
      });
    });

  function scheduleSuspensionRetry(
    input: SolidRouteRenderInput<Routes, ER>,
    transition: number,
    suspension: SolidRouteRenderSuspension,
  ): void {
    interruptSuspensionRetry();
    suspensionRetryFiber = options.runtime.runFork(
      awaitRouteRenderThenableEffect(suspension.thenable).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (transition !== transitionVersion) {
              return;
            }
            suspensionRetryFiber = undefined;
            options.setRenderSuspension?.(() => undefined);
            void options.runtime.runFork(
              renderTransition(input, transition, startCurrentRouteDisposal()),
            );
          }),
        ),
        Effect.catchCause(() => Effect.void),
      ),
    );
  }

  const disposeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      interruptSuspensionRetry();
      transitionVersion++;
      return joinRouteDisposal(startCurrentRouteDisposal());
    });

  const dispose = (): void => {
    interruptSuspensionRetry();
    transitionVersion++;
    void startCurrentRouteDisposal();
  };

  const renderInitial = (): void => {
    try {
      const initial = renderRouteState(
        renderedState,
        options.initialInput.renderers,
        options.runtime,
      );
      disposeRoute = initial.dispose;
      batch(() => {
        options.setRenderSuspension?.(() => undefined);
        options.setNode(() => initial.node);
      });
    } catch (error) {
      const suspension = solidRouteRenderSuspension(error);
      if (suspension !== undefined) {
        if (options.setRenderSuspension === undefined) {
          startRouteDisposal(suspension.dispose);
          throw suspension.thenable;
        }
        disposeRoute = suspension.dispose;
        options.setNode(() => undefined);
        options.setRenderError(() => undefined);
        options.setRenderSuspension(() => suspension.thenable);
        scheduleSuspensionRetry(options.initialInput, transitionVersion, suspension);
        return;
      }
      const failure = solidRouteRenderFailure(error);
      if (failure !== undefined) {
        startRouteDisposal(failure.dispose);
        options.setNode(() => undefined);
        scheduleRouteRenderError(
          () => transitionVersion === 0,
          options.setRenderError,
          failure.error,
        );
        return;
      }
      throw error;
    }
  };

  renderInitial();

  return {
    update: (input) => {
      const nextIdentity = browserRouteRenderIdentity({
        state: input.state,
        renderers: input.renderers,
        defaults: routeRenderDefaults,
      });
      const sameState = input.state === renderedState;
      if (sameState && nextIdentity === renderedIdentity) {
        return;
      }

      renderedState = input.state;
      renderedIdentity = nextIdentity;
      const transition = ++transitionVersion;
      interruptSuspensionRetry();
      options.setNode(() => undefined);
      options.setRenderError(() => undefined);
      options.setRenderSuspension?.(() => undefined);
      void options.runtime.runFork(
        renderTransition(input, transition, startCurrentRouteDisposal()),
      );
    },
    disposeEffect,
    dispose,
  };
};
