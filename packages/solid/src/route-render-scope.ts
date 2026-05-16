import {
  browserRouteRenderDecision,
  makeRuntimeUiScope,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers
} from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import {
  createRoot,
  type Component,
  type JSX,
  type Setter
} from "solid-js";
import { createComponent } from "solid-js/web";

type AnyRoute = AnyBrowserRoute;

export type SolidRouteOutletRenderers<Routes extends readonly AnyRoute[], ER> =
  BrowserRouteOutletRenderers<Routes, ER, JSX.Element>;

export interface SolidRouteRenderScopeController<Routes extends readonly AnyRoute[], ER> {
  update(state: BrowserRouterState<Routes, ER>): void;
  dispose(): void;
}

interface RenderedRouteScope {
  readonly node: JSX.Element;
  readonly dispose?: Effect.Effect<void, never, never>;
}

const defaultPending = (): JSX.Element => undefined;

const defaultFailure = <ER>(
  state: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>
): JSX.Element => {
  throw state.cause;
};

const defaultNotFound = (): JSX.Element => undefined;

const renderInRouteScope = <ER>(
  runtime: AnyEffectUiRuntime<ER>,
  render: () => JSX.Element
): { readonly node: JSX.Element; readonly dispose: Effect.Effect<void, never, never> } => {
  const routeScope = makeRuntimeUiScope(runtime);
  let disposeSolid: (() => void) | undefined;
  let renderFailure: { readonly error: unknown } | undefined;
  const cleanupFailedRender = (): void => {
    try {
      runWithRuntime(runtime, () =>
        runWithScope(routeScope, () => {
          disposeSolid?.();
        })
      );
    } catch {
      // Preserve the original render error for the host ErrorBoundary.
    }
    void runtime.runFork(routeScope.disposeEffect().pipe(Effect.catchCause(() => Effect.void)));
  };
  let node: JSX.Element;
  try {
    node = createRoot((disposeRoot) => {
      disposeSolid = disposeRoot;
      return runWithRuntime(runtime, () =>
        runWithScope(routeScope, () => {
          try {
            return render();
          } catch (error) {
            renderFailure = { error };
            return undefined;
          }
        })
      );
    });
  } catch (error) {
    cleanupFailedRender();
    throw error;
  }
  if (renderFailure !== undefined) {
    cleanupFailedRender();
    throw renderFailure.error;
  }
  const dispose = Effect.andThen(
    Effect.sync(() => {
      runWithRuntime(runtime, () =>
        runWithScope(routeScope, () => {
          disposeSolid?.();
        })
      );
    }),
    runtime.provide(routeScope.disposeEffect()).pipe(Effect.catchCause(() => Effect.void))
  ).pipe(Effect.catchCause(() => Effect.void));

  return { node, dispose };
};

const renderRouteState = <Routes extends readonly AnyRoute[], ER>(
  state: BrowserRouterState<Routes, ER>,
  renderers: SolidRouteOutletRenderers<Routes, ER>,
  runtime: AnyEffectUiRuntime<ER>
): RenderedRouteScope => {
  const decision = browserRouteRenderDecision(state);
  switch (decision._tag) {
    case "Pending":
      return renderInRouteScope(runtime, () => (renderers.pending ?? defaultPending)(decision.state));
    case "Failure":
      return renderInRouteScope(runtime, () => (renderers.failure ?? defaultFailure)(decision.state));
    case "NotFound":
      return renderInRouteScope(runtime, () => (renderers.notFound ?? defaultNotFound)(decision.state));
    case "Empty":
      return { node: undefined };
    case "Ready": {
      const component = decision.component as Component<Record<string, unknown>>;
      return renderInRouteScope(runtime, () =>
        createComponent(component, decision.props as unknown as Record<string, unknown>)
      );
    }
  }
};

const disposeRenderedRoute = (
  dispose: Effect.Effect<void, never, never> | undefined
): Effect.Effect<void> =>
  dispose ?? Effect.void;

const scheduleRouteRenderError = (
  onCurrentTransition: () => boolean,
  setRenderError: Setter<unknown>,
  error: unknown
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

export const makeSolidRouteRenderScopeController = <Routes extends readonly AnyRoute[], ER>(options: {
  readonly initialState: BrowserRouterState<Routes, ER>;
  readonly renderers: SolidRouteOutletRenderers<Routes, ER>;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly setNode: Setter<JSX.Element>;
  readonly setRenderError: Setter<unknown>;
}): SolidRouteRenderScopeController<Routes, ER> => {
  let renderedState = options.initialState;
  const initial = renderRouteState(renderedState, options.renderers, options.runtime);
  options.setNode(() => initial.node);
  let disposeRoute: Effect.Effect<void, never, never> | undefined = initial.dispose;
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;

  const disposeStaleRenderedRoute = (rendered: RenderedRouteScope): void => {
    void options.runtime.runFork(
      disposeRenderedRoute(rendered.dispose).pipe(Effect.catchCause(() => Effect.void))
    );
  };

  const disposeCurrentRoute = (): void => {
    const previousDisposalFiber = disposalFiber;
    const currentDisposal = disposeRenderedRoute(disposeRoute);
    disposeRoute = undefined;
    disposalFiber = options.runtime.runFork(
      Effect.gen(function* () {
        if (previousDisposalFiber !== undefined) {
          yield* Fiber.join(previousDisposalFiber);
        }
        yield* currentDisposal;
      }).pipe(Effect.catchCause(() => Effect.void))
    );
  };

  return {
    update: (state) => {
      if (state === renderedState) {
        return;
      }

      renderedState = state;
      const transition = ++transitionVersion;
      options.setNode(() => undefined);
      options.setRenderError(() => undefined);
      disposeCurrentRoute();
      const transitionDisposalFiber = disposalFiber;
      void options.runtime.runFork(
        Effect.gen(function* () {
          if (transitionDisposalFiber !== undefined) {
            yield* Fiber.join(transitionDisposalFiber);
          }
          if (transition !== transitionVersion) {
            return;
          }

          let next: RenderedRouteScope;
          try {
            next = renderRouteState(state, options.renderers, options.runtime);
          } catch (error) {
            if (transition === transitionVersion) {
              options.setNode(() => undefined);
              scheduleRouteRenderError(
                () => transition === transitionVersion,
                options.setRenderError,
                error
              );
            }
            return;
          }

          if (transition !== transitionVersion) {
            disposeStaleRenderedRoute(next);
            return;
          }

          disposeRoute = next.dispose;
          options.setRenderError(() => undefined);
          options.setNode(() => next.node);
        })
      );
    },
    dispose: () => {
      transitionVersion++;
      disposeCurrentRoute();
    }
  };
};
