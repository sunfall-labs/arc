import {
  makeRuntimeUiScope,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type BrowserRouterState,
  type Route,
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

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export type ReactRouteOutletRenderers<Routes extends readonly AnyRoute[], ER> = {
  readonly pending?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => ReactNode;
  readonly failure?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => ReactNode;
  readonly notFound?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => ReactNode;
};

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

const routeRenderKey = <Routes extends readonly AnyRoute[], ER>(
  routeState: BrowserRouterState<Routes, ER>
): string => {
  switch (routeState._tag) {
    case "Pending":
    case "Ready":
      return `${routeState._tag}:${routeState.href}:${routeState.match.route.path}`;
    case "Failure":
      return routeState.match
        ? `${routeState._tag}:${routeState.href}:${routeState.match.route.path}`
        : `${routeState._tag}:${routeState.href}`;
    case "NotFound":
      return `${routeState._tag}:${routeState.href}`;
  }
};

const renderInRouteScope = <Routes extends readonly AnyRoute[], ER>(
  runtime: AnyEffectUiRuntime<ER>,
  routeState: BrowserRouterState<Routes, ER>,
  render: () => ReactNode
): ReactNode =>
  createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: createElement(RouteRenderFrame, {
      key: routeRenderKey(routeState),
      runtime,
      render
    })
  });

export const renderReactRouteState = <Routes extends readonly AnyRoute[], ER>(
  routeState: BrowserRouterState<Routes, ER>,
  renderers: ReactRouteOutletRenderers<Routes, ER>,
  runtime: AnyEffectUiRuntime<ER>
): ReactNode => {
  switch (routeState._tag) {
    case "Pending":
      return renderInRouteScope(runtime, routeState, () =>
        (renderers.pending ?? defaultPending)(routeState)
      );
    case "Failure":
      return renderInRouteScope(runtime, routeState, () =>
        (renderers.failure ?? defaultFailure)(routeState)
      );
    case "NotFound":
      return renderInRouteScope(runtime, routeState, () =>
        (renderers.notFound ?? defaultNotFound)(routeState)
      );
    case "Ready": {
      const component = routeState.match.route.options.component as
        | ((props: Record<string, unknown>) => ReactNode)
        | undefined;
      if (!component) {
        return undefined;
      }

      return renderInRouteScope(runtime, routeState, () =>
        component({
          params: routeState.match.params,
          search: routeState.match.search,
          match: routeState.match
        })
      );
    }
  }
};
