import {
  browserRouterInitialMatchedState,
  createBrowserRouterHostController,
  Route,
  currentOrDefaultRuntime,
  type AnyEffectUiRuntime,
  type BrowserHistoryAdapter,
  type BrowserRouterHostController,
  type BrowserRouterState,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Data } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from "react";
import { renderReactRouteState } from "./route-render-scope.js";
import { RuntimeContext, useRuntime } from "./runtime.js";
import { useSignal } from "./hooks.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;
type RouterRuntimeServices<Runtime> =
  Runtime extends EffectUiRuntime<infer Services, any> ? Services : never;
type RouterRuntime<
  Routes extends readonly AnyRoute[],
  ER,
  Runtime extends EffectUiRuntime<any, ER>
> =
  [Exclude<Route.PreloadRequirements<Routes[number]>, RouterRuntimeServices<Runtime>>] extends [never]
    ? Runtime
    : never;

export type {
  BrowserNavigateArgs,
  BrowserNavigateOptions,
  BrowserRouterPath,
  BrowserRouterRouteForPath,
  BrowserRouterState
} from "@effect-ui/core";

interface BrowserRouterOptionsBase {
  /** Initial URL used for tests or SSR hydration. Defaults to `window.location.href`. */
  readonly initialHref?: string;
  /** True when the initial browser render hydrates existing server-rendered DOM. */
  readonly hydrating?: boolean;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
}

type BrowserRouterRuntimeOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
> =
  [Route.PreloadRequirements<Routes[number]>] extends [never]
    ? {
        /** Runtime used for route preload Effects and route components. */
        readonly runtime?: RouterRuntime<Routes, ER, Runtime>;
      }
    : {
        /** Runtime used for route preload Effects and route components. */
        readonly runtime: RouterRuntime<Routes, ER, Runtime>;
      };

/** Options for creating a React browser router. */
export type BrowserRouterOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
> = BrowserRouterOptionsBase & BrowserRouterRuntimeOptions<Routes, ER, Runtime>;

type BrowserRouterOptionsArgs<
  Routes extends readonly AnyRoute[],
  ER,
  Runtime extends EffectUiRuntime<any, ER>
> =
  [Route.PreloadRequirements<Routes[number]>] extends [never]
    ? [options?: BrowserRouterOptions<Routes, ER, Runtime>]
    : [options: BrowserRouterOptions<Routes, ER, Runtime>];

/** React browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[], ER = never>
  extends BrowserRouterHostController<Routes, ER> {}

type RouterOutletRoutes<RoutesOrError> =
  [RoutesOrError] extends [readonly AnyRoute[]] ? RoutesOrError : readonly AnyRoute[];
type RouterOutletError<RoutesOrError, ER> =
  [RoutesOrError] extends [readonly AnyRoute[]] ? ER : RoutesOrError;
type RouterOutletState<RoutesOrError, ER> =
  BrowserRouterState<RouterOutletRoutes<RoutesOrError>, RouterOutletError<RoutesOrError, ER>>;
type TypedRouterOutletProps<Routes extends readonly AnyRoute[], ER> = {
  readonly pending?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => ReactNode;
  readonly failure?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => ReactNode;
  readonly notFound?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => ReactNode;
};

type RouterProviderRuntimeProps<
  Routes extends readonly AnyRoute[],
  ER,
  Runtime extends EffectUiRuntime<any, ER>
> =
  [Route.PreloadRequirements<Routes[number]>] extends [never]
    ? { readonly runtime?: RouterRuntime<Routes, ER, Runtime> }
    : { readonly runtime: RouterRuntime<Routes, ER, Runtime> };

/** Props for `RouterProvider`, including route definitions, history, and render fallbacks. */
export type RouterProviderProps<
  Routes extends readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
> = RouterOutletProps<Routes, ER> &
  RouterProviderRuntimeProps<Routes, ER, Runtime> & {
  /** Route definitions available to the provider. */
  readonly routes: Routes;
  /** Initial URL used for tests or SSR hydration. */
  readonly initialHref?: string;
  /** True when the initial browser render hydrates existing server-rendered DOM. */
  readonly hydrating?: boolean;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
  readonly children?: ReactNode;
};

/**
 * Render fallbacks for route pending, failure, and not-found states.
 *
 * The `failure` renderer receives the same typed `BrowserRouterState.Failure`
 * shape as `router.state`, including `Cause<Route.NavigationError | ER>`.
 */
export interface RouterOutletProps<RoutesOrError = readonly AnyRoute[], ER = never> {
  readonly pending?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Pending" }>) => ReactNode;
  readonly failure?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Failure" }>) => ReactNode;
  readonly notFound?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "NotFound" }>) => ReactNode;
}

const canUseBrowser = (): boolean => typeof window !== "undefined";

const RouterContext = createContext<BrowserRouter<readonly AnyRoute[], unknown> | undefined>(undefined);

/** Error thrown when router hooks are used outside `RouterProvider`. */
export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

export { RouterRouteNotRegistered } from "@effect-ui/core";

/**
 * Creates a React browser router from Effect UI route definitions.
 *
 * Navigation preloads matched route resources in the configured runtime and
 * interrupts stale preload work when navigation changes.
 */
export const createBrowserRouter = <
  const Routes extends readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
>(
  routes: Routes,
  ...args: BrowserRouterOptionsArgs<Routes, ER, Runtime>
): BrowserRouter<Routes, ER> => {
  const options = (args[0] ?? {}) as BrowserRouterOptionsBase & {
    readonly runtime?: RouterRuntime<Routes, ER, Runtime>;
  };
  const runtime = (options.runtime ?? currentOrDefaultRuntime()) as AnyEffectUiRuntime<ER>;
  const controller = createBrowserRouterHostController(routes, {
    runtime,
    ...(options.history === undefined ? {} : { history: options.history }),
    ...(options.initialHref === undefined ? {} : { initialHref: options.initialHref }),
    initialMatchedState: (href, match) =>
      browserRouterInitialMatchedState({
        href,
        match,
        host: canUseBrowser() ? "browser" : "server",
        ...(options.hydrating === undefined ? {} : { hydrating: options.hydrating })
      })
  });

  return controller;
};

/** Reads the current router from `RouterProvider`. */
export const useRouter = <
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never
>(): BrowserRouter<Routes, ER> => {
  const router = useContext(RouterContext);
  if (!router) {
    throw new RouterContextMissing({ hook: "useRouter" });
  }

  return router as unknown as BrowserRouter<Routes, ER>;
};

/** Renders the matched route component. */
export const RouterOutlet = <RoutesOrError = readonly AnyRoute[], ER = never>(
  props: RouterOutletProps<RoutesOrError, ER>
): ReactNode => {
  type Routes = RouterOutletRoutes<RoutesOrError>;
  type Error = RouterOutletError<RoutesOrError, ER>;
  const typedProps = props as TypedRouterOutletProps<Routes, Error>;
  const router = useRouter<Routes, Error>();
  const routeState = useSignal(router.state);

  return renderReactRouteState(routeState, typedProps, router.runtime as AnyEffectUiRuntime<Error>);
};

/**
 * Provides router and runtime context, then renders either children or outlet.
 *
 * @example
 * ```tsx
 * <RouterProvider routes={routes} />
 * ```
 */
export const RouterProvider = <
  const Routes extends readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
>(
  props: RouterProviderProps<Routes, ER, Runtime>
): ReactNode => {
  const runtime = ("runtime" in props && props.runtime !== undefined
    ? props.runtime
    : useRuntime()) as AnyEffectUiRuntime<ER>;
  const routerRuntime = runtime as unknown as EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>;
  const router = useMemo(
    () =>
      createBrowserRouter<Routes, ER>(
        props.routes,
        {
          runtime: routerRuntime,
          ...(props.history === undefined ? {} : { history: props.history }),
          ...(props.initialHref === undefined ? {} : { initialHref: props.initialHref }),
          ...(props.hydrating === undefined ? {} : { hydrating: props.hydrating })
        }
      ),
    [props.routes, props.history, props.initialHref, props.hydrating, routerRuntime]
  );

  useEffect(() => router.start(), [router]);

  return createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: createElement(RouterContext.Provider, {
      value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
      children: props.children ?? createElement(
        RouterOutlet as (outletProps: RouterOutletProps<Routes, ER>) => ReactNode,
        props as RouterOutletProps<Routes, ER>
      )
    })
  });
};
