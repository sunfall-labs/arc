import {
  browserRouteRenderDecision,
  browserRouteRenderKey,
  makeRuntimeUiScope,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers,
  type UiScope
} from "@effect-ui/core";
import { Effect } from "effect";
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

interface RouteRenderFrameProps<ER> {
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly render: () => ReactNode;
}

const RouteRenderFrame = <ER,>(props: RouteRenderFrameProps<ER>): ReactNode => {
  const scopeRef = useRef<{
    readonly runtime: AnyEffectUiRuntime<ER>;
    readonly scope: UiScope;
  } | undefined>(undefined);

  if (scopeRef.current === undefined || scopeRef.current.runtime !== props.runtime) {
    scopeRef.current = {
      runtime: props.runtime,
      scope: makeRuntimeUiScope(props.runtime)
    };
  }

  const scope = scopeRef.current.scope;

  useEffect(() => {
    return () => {
      void props.runtime.runFork(
        props.runtime.provide(scope.disposeEffect()).pipe(
          Effect.catch(() => Effect.void)
        )
      );
    };
  }, [props.runtime, scope]);

  return runWithRuntime(props.runtime, () =>
    runWithScope(scope, props.render)
  );
};

const renderInRouteScope = <Routes extends readonly AnyRoute[], ER>(
  runtime: AnyEffectUiRuntime<ER>,
  routeState: BrowserRouterState<Routes, ER>,
  render: () => ReactNode
): ReactNode =>
  createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: createElement(RouteRenderFrame, {
      key: browserRouteRenderKey(routeState),
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
      return renderInRouteScope(runtime, decision.state, () =>
        (renderers.pending ?? defaultPending)(decision.state)
      );
    case "Failure":
      return renderInRouteScope(runtime, decision.state, () =>
        (renderers.failure ?? defaultFailure)(decision.state)
      );
    case "NotFound":
      return renderInRouteScope(runtime, decision.state, () =>
        (renderers.notFound ?? defaultNotFound)(decision.state)
      );
    case "Empty":
      return undefined;
    case "Ready": {
      const component = decision.component as (props: Record<string, unknown>) => ReactNode;
      return renderInRouteScope(runtime, decision.state, () =>
        component(decision.props as unknown as Record<string, unknown>)
      );
    }
  }
};
