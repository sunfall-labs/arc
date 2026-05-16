import {
  browserRouteRenderDecision,
  browserRouteRenderIdentity,
  makeRuntimeUiScopeFrame,
  type AnyEffectUiRuntime,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers,
  type RuntimeUiScopeFrame
} from "@effect-ui/core";
import {
  createElement,
  useEffect,
  useRef,
  type ReactNode
} from "react";
import { RuntimeContext } from "./runtime.js";

type AnyRoute = AnyBrowserRoute;

export type ReactRouteOutletRenderers<Routes extends readonly AnyRoute[], ER> =
  BrowserRouteOutletRenderers<Routes, ER, ReactNode>;

const defaultPending = (): ReactNode => undefined;

const defaultFailure = <ER>(
  routeState: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>
): ReactNode => {
  throw routeState.cause;
};

const defaultNotFound = (): ReactNode => undefined;

const routeRenderDefaults = {
  pending: defaultPending,
  failure: defaultFailure,
  notFound: defaultNotFound
};

interface RouteRenderFrameProps<ER> {
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly render: () => ReactNode;
}

const RouteRenderFrame = <ER,>(props: RouteRenderFrameProps<ER>): ReactNode => {
  const scopeRef = useRef<{
    readonly runtime: AnyEffectUiRuntime<ER>;
    readonly frame: RuntimeUiScopeFrame<ER>;
  } | undefined>(undefined);

  if (scopeRef.current === undefined || scopeRef.current.runtime !== props.runtime) {
    scopeRef.current = {
      runtime: props.runtime,
      frame: makeRuntimeUiScopeFrame(props.runtime)
    };
  }

  const frame = scopeRef.current.frame;

  useEffect(() => {
    return () => {
      void props.runtime.runFork(frame.disposeEffect());
    };
  }, [props.runtime, frame]);

  try {
    return frame.run(props.render);
  } catch (error) {
    scopeRef.current = undefined;
    void props.runtime.runFork(frame.disposeEffect());
    throw error;
  }
};

const renderInRouteScope = <Routes extends readonly AnyRoute[], ER>(
  runtime: AnyEffectUiRuntime<ER>,
  routeState: BrowserRouterState<Routes, ER>,
  renderers: ReactRouteOutletRenderers<Routes, ER>,
  render: () => ReactNode
): ReactNode =>
  createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: createElement(RouteRenderFrame, {
      key: browserRouteRenderIdentity({
        state: routeState,
        renderers,
        defaults: routeRenderDefaults
      }),
      runtime,
      render
    })
  });

export const renderReactRouteState = <Routes extends readonly AnyRoute[], ER>(
  routeState: BrowserRouterState<Routes, ER>,
  renderers: ReactRouteOutletRenderers<Routes, ER>,
  runtime: AnyEffectUiRuntime<ER>
): ReactNode => {
  const decision = browserRouteRenderDecision(routeState);
  switch (decision._tag) {
    case "Pending":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.pending ?? defaultPending)(decision.state)
      );
    case "Failure":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.failure ?? defaultFailure)(decision.state)
      );
    case "NotFound":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.notFound ?? defaultNotFound)(decision.state)
      );
    case "Empty":
      return undefined;
    case "Ready": {
      const component = decision.component as (props: Record<string, unknown>) => ReactNode;
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        component(decision.props as unknown as Record<string, unknown>)
      );
    }
  }
};
