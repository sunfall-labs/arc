import {
  createBrowserRouterKernel,
  makeWindowBrowserHistoryAdapter,
  Route,
  currentOrDefaultRuntime,
  type AnyEffectUiRuntime,
  type BrowserNavigateArgs,
  type BrowserNavigateOptions,
  type BrowserHistoryAdapter,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterState,
  type EffectUiRuntime,
  type ReadableSignal
} from "@effect-ui/core";
import { Data, Effect } from "effect";
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

/** Options for creating a React browser router. */
export interface BrowserRouterOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
> {
  /** Initial URL used for tests or SSR hydration. Defaults to `window.location.href`. */
  readonly initialHref?: string;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
  /** Runtime used for route preload Effects and route components. */
  readonly runtime?: RouterRuntime<Routes, ER, Runtime>;
}

/** React browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[], ER = never> {
  /** Route definitions this router can match. */
  readonly routes: Routes;
  /** Runtime used for route preloads and route components. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Reactive router state: pending, ready, failure, or not found. */
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  /** Reactive current ready route match, or undefined outside a ready state. */
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  /** Starts browser listeners and the initial preload. Returns a cleanup. */
  start(): () => void;
  /** Disposes browser listeners and any in-flight route preload. */
  dispose(): void;
  /** Returns true when a route definition belongs to this router. */
  canHandleRoute(definition: AnyRoute): definition is Routes[number];
  /** Builds a typed href for a route definition. */
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  /** Builds a typed href for a route path owned by this router. */
  hrefByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): string;
  /** Navigates to a typed route and runs its preload in the router runtime. */
  navigate<R extends Routes[number]>(
    definition: R,
    ...args: BrowserNavigateArgs<R>
  ): void;
  /** Navigates to a typed route path and runs its preload in the router runtime. */
  navigateByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: BrowserNavigateArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): void;
  /** Navigates to a raw href and matches it against the router's route list. */
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  /** Returns the current match narrowed to a route path, when that path is active. */
  matchByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path
  ): Route.Match<BrowserRouterRouteForPath<Routes, Path>> | undefined;
  /** Preloads a route without changing browser history. */
  preloadEffect<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): Effect.Effect<void, Route.NavigationError | ER>;
  /** Preloads a route path without changing browser history. */
  preloadByPathEffect<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): Effect.Effect<void, Route.NavigationError | ER>;
}

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
  options: BrowserRouterOptions<Routes, ER, Runtime> = {}
): BrowserRouter<Routes, ER> => {
  const runtime = (options.runtime ?? currentOrDefaultRuntime()) as AnyEffectUiRuntime<ER>;
  const history = options.history ?? makeWindowBrowserHistoryAdapter();
  const initialHref = options.initialHref ?? history.currentHref();
  const kernel = createBrowserRouterKernel(routes, {
    runtime,
    initialHref,
    initialMatchedState: (href, match) =>
      canUseBrowser()
        ? { _tag: "Pending", href, match }
        : { _tag: "Ready", href, match }
  });
  let started = false;
  let stopHistory = (): void => undefined;

  const router: BrowserRouter<Routes, ER> = {
    routes,
    runtime,
    state: kernel.state,
    match: kernel.match,
    start: () => {
      if (started) {
        return () => undefined;
      }

      started = true;
      stopHistory = history.listen(kernel.navigateHref);
      kernel.navigateHref(initialHref);

      return router.dispose;
    },
    dispose: () => {
      stopHistory();
      stopHistory = () => undefined;
      started = false;
      kernel.dispose();
    },
    canHandleRoute: kernel.canHandleRoute,
    href: kernel.href,
    hrefByPath: kernel.hrefByPath,
    navigate: (definition, ...args) => {
      kernel.navigate(definition, router.navigateHref, ...args);
    },
    navigateByPath: (path, ...args) => {
      kernel.navigateByPath(path, router.navigateHref, ...args);
    },
    navigateHref: (href, navigateOptions = {}) => {
      kernel.navigateHref(history.commit(href, navigateOptions));
    },
    matchByPath: kernel.matchByPath,
    preloadEffect: kernel.preloadEffect,
    preloadByPathEffect: kernel.preloadByPathEffect
  };

  return router;
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
        props.initialHref === undefined
          ? { runtime: routerRuntime }
          : { initialHref: props.initialHref, runtime: routerRuntime }
      ),
    [props.routes, props.initialHref, routerRuntime]
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
