import {
  makeRuntimeUiScope,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type BrowserRouterState,
  type Route
} from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import {
  createRoot,
  type Component,
  type JSX,
  type Setter
} from "solid-js";
import { createComponent } from "solid-js/web";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export type SolidRouteOutletRenderers<Routes extends readonly AnyRoute[], ER> = {
  readonly pending?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => JSX.Element;
};

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
  const node = createRoot((disposeRoot) => {
    disposeSolid = disposeRoot;
    return runWithRuntime(runtime, () =>
      runWithScope(routeScope, render)
    );
  });
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
  switch (state._tag) {
    case "Pending":
      return renderInRouteScope(runtime, () => (renderers.pending ?? defaultPending)(state));
    case "Failure":
      return renderInRouteScope(runtime, () => (renderers.failure ?? defaultFailure)(state));
    case "NotFound":
      return renderInRouteScope(runtime, () => (renderers.notFound ?? defaultNotFound)(state));
    case "Ready": {
      const component = state.match.route.options.component as Component<Record<string, unknown>> | undefined;
      if (!component) {
        return { node: undefined };
      }

      return renderInRouteScope(runtime, () =>
        createComponent(component, {
          params: state.match.params,
          search: state.match.search,
          match: state.match
        })
      );
    }
  }
};

const disposeRenderedRoute = (
  dispose: Effect.Effect<void, never, never> | undefined
): Effect.Effect<void> =>
  dispose ?? Effect.void;

export const makeSolidRouteRenderScopeController = <Routes extends readonly AnyRoute[], ER>(options: {
  readonly initialState: BrowserRouterState<Routes, ER>;
  readonly renderers: SolidRouteOutletRenderers<Routes, ER>;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly setNode: Setter<JSX.Element>;
}): SolidRouteRenderScopeController<Routes, ER> => {
  let renderedState = options.initialState;
  const initial = renderRouteState(renderedState, options.renderers, options.runtime);
  options.setNode(() => initial.node);
  let disposeRoute: Effect.Effect<void, never, never> | undefined = initial.dispose;
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;

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

          const next = renderRouteState(state, options.renderers, options.runtime);
          options.setNode(() => next.node);
          disposeRoute = next.dispose;
        })
      );
    },
    dispose: () => {
      transitionVersion++;
      disposeCurrentRoute();
    }
  };
};
