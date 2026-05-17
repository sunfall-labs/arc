import {
  browserRouteRenderDecision,
  browserRouteRenderIdentity,
  forkRouteLazyComponentSuspense,
  isPromiseLikeValue,
  readRouteComponent,
  type AnySunfallArcRuntime,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers,
} from "@sunfall/arc-core";
import { Effect, Fiber } from "effect";
import { createElement, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  makeReactRuntimeUiScopeFrame,
  RuntimeContext,
  type ReactRuntimeUiScopeFrame,
} from "./runtime.js";

type AnyRoute = AnyBrowserRoute;

export type ReactRouteOutletRenderers<
  Routes extends readonly AnyRoute[],
  ER,
> = BrowserRouteOutletRenderers<Routes, ER, ReactNode>;

const defaultPending = (): ReactNode => undefined;

const defaultFailure = <ER>(
  routeState: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>,
): ReactNode => {
  throw routeState.cause;
};

const defaultNotFound = (): ReactNode => undefined;

const routeRenderDefaults = {
  pending: defaultPending,
  failure: defaultFailure,
  notFound: defaultNotFound,
};

interface RouteRenderFrameProps<ER> {
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly render: () => ReactNode;
}

const RouteRenderFrame = <ER>(props: RouteRenderFrameProps<ER>): ReactNode => {
  const scopeRef = useRef<
    | {
        readonly runtime: AnySunfallArcRuntime<ER>;
        readonly frame: ReactRuntimeUiScopeFrame<ER>;
      }
    | undefined
  >(undefined);

  if (scopeRef.current === undefined || scopeRef.current.runtime !== props.runtime) {
    scopeRef.current = {
      runtime: props.runtime,
      frame: makeReactRuntimeUiScopeFrame(props.runtime, {
        preCommitFinalizers: "buffer",
      }),
    };
  }

  const frame = scopeRef.current.frame;
  const activeFrameRef = useRef(frame);
  const frameLifecycleVersionRef = useRef(0);

  useLayoutEffect(() => {
    frame.commit();
  });

  useEffect(() => {
    activeFrameRef.current = frame;
    frameLifecycleVersionRef.current++;
    return () => {
      const cleanupFrame = frame;
      const cleanupVersion = ++frameLifecycleVersionRef.current;
      queueMicrotask(() => {
        if (
          activeFrameRef.current === cleanupFrame &&
          frameLifecycleVersionRef.current !== cleanupVersion
        ) {
          return;
        }

        cleanupFrame.dispose();
      });
    };
  }, [props.runtime, frame]);

  try {
    return frame.run(props.render);
  } catch (error) {
    if (isPromiseLikeValue(error)) {
      throw error;
    }
    const pendingLazyComponent = forkRouteLazyComponentSuspense(error, props.runtime);
    if (pendingLazyComponent !== undefined) {
      const fiber = pendingLazyComponent;
      throw Effect.runPromise(Fiber.join(fiber));
    }
    scopeRef.current = undefined;
    frame.dispose();
    throw error;
  }
};

const renderInRouteScope = <Routes extends readonly AnyRoute[], ER>(
  runtime: AnySunfallArcRuntime<ER>,
  routeState: BrowserRouterState<Routes, ER>,
  renderers: ReactRouteOutletRenderers<Routes, ER>,
  render: () => ReactNode,
): ReactNode =>
  createElement(RuntimeContext.Provider, {
    value: runtime as AnySunfallArcRuntime<never>,
    children: createElement(RouteRenderFrame, {
      key: browserRouteRenderIdentity({
        state: routeState,
        renderers,
        defaults: routeRenderDefaults,
      }),
      runtime,
      render,
    }),
  });

export const renderReactRouteState = <Routes extends readonly AnyRoute[], ER>(
  routeState: BrowserRouterState<Routes, ER>,
  renderers: ReactRouteOutletRenderers<Routes, ER>,
  runtime: AnySunfallArcRuntime<ER>,
): ReactNode => {
  const decision = browserRouteRenderDecision(routeState);
  switch (decision._tag) {
    case "Pending":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.pending ?? defaultPending)(decision.state),
      );
    case "Failure":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.failure ?? defaultFailure)(decision.state),
      );
    case "NotFound":
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (renderers.notFound ?? defaultNotFound)(decision.state),
      );
    case "Empty":
      return undefined;
    case "Ready": {
      return renderInRouteScope(runtime, decision.state, renderers, () =>
        (readRouteComponent(decision.component) as (props: Record<string, unknown>) => ReactNode)(
          decision.props as unknown as Record<string, unknown>,
        ),
      );
    }
  }
};
