import {
  createBrowserRouterHostController,
  Route,
  runWithRuntime,
  Signal,
  type AnySunfallArcRuntime,
  type BrowserHistoryAdapter,
  type BrowserRouterHostController,
  type BrowserRouterState,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { browserRouterInitialMatchedState } from "@sunfall/arc-core/internal";
import { Data } from "effect";
import {
  createComponent,
  createContext,
  createMemo,
  createRenderEffect,
  getOwner,
  isHydrating,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
} from "solid-js";
import { isServer, type JSX } from "@solidjs/web";
import {
  makeSolidRouteRenderScopeController,
  type SolidRouteOutletRenderers,
} from "./route-render-scope.js";
import { useRuntime } from "./runtime.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

interface BrowserRouterOptionsBase {
  /** Initial URL used for tests or SSR hydration. Defaults to the browser path plus search string. */
  readonly initialHref?: string;
  /** True when the initial browser render hydrates existing server-rendered DOM. */
  readonly hydrating?: boolean;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
}

/** Options for creating a Solid browser router. */
export interface BrowserRouterOptions<ER = never> extends BrowserRouterOptionsBase {
  /** Runtime used for route preload Effects and route component scopes. */
  readonly runtime: SunfallArcRuntime<any, ER> | AnySunfallArcRuntime<ER>;
}

type SolidBrowserRouterHostController<Routes extends readonly AnyRoute[], ER> = Omit<
  BrowserRouterHostController<Routes, ER>,
  "state" | "match" | "start" | "dispose" | "disposeEffect"
>;

/** Solid browser router backed by Sunfall Arc route definitions and preload. */
export interface BrowserRouter<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
> extends SolidBrowserRouterHostController<Routes, ER> {
  /** Reactive router state: pending, ready, failure, or not found. */
  readonly state: Accessor<BrowserRouterState<Routes, ER>>;
  /** Current matched route for pending, ready, or failure states; undefined when unmatched. */
  readonly match: Accessor<Route.Match<Routes[number]> | undefined>;
}

/** Props for `RouterProvider`, including route definitions and render fallbacks. */
type RouterOutletRoutes<RoutesOrError> = [RoutesOrError] extends [readonly AnyRoute[]]
  ? RoutesOrError
  : readonly AnyRoute[];
type RouterOutletError<RoutesOrError, ER> = [RoutesOrError] extends [readonly AnyRoute[]]
  ? ER
  : RoutesOrError;
type RouterOutletState<RoutesOrError, ER> = BrowserRouterState<
  RouterOutletRoutes<RoutesOrError>,
  RouterOutletError<RoutesOrError, ER>
>;
type TypedRouterOutletProps<Routes extends readonly AnyRoute[], ER> = {
  readonly pending?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>,
  ) => JSX.Element;
  readonly failure?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>,
  ) => JSX.Element;
  readonly notFound?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>,
  ) => JSX.Element;
};

/** Props for `RouterProvider`, including route definitions, history, and render fallbacks. */
export type RouterProviderProps<Routes extends readonly AnyRoute[], ER = never> = RouterOutletProps<
  Routes,
  ER
> & {
  /** Route definitions available to the provider. */
  readonly routes: Routes;
  /** Initial URL used for tests or SSR hydration. */
  readonly initialHref?: string;
  /** True when the initial browser render hydrates existing server-rendered DOM. */
  readonly hydrating?: boolean;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
  readonly children?: JSX.Element;
};

/**
 * Render fallbacks for route pending, failure, and not-found states.
 *
 * The `failure` renderer receives the same typed `BrowserRouterState.Failure`
 * shape as `router.state()`, including `Cause<BrowserRouterError<Routes> | ER>`; a
 * route's typed preload failure arrives as `RoutePreloadError<Route.PreloadFailure<R>>`.
 */
export interface RouterOutletProps<RoutesOrError = readonly AnyRoute[], ER = never> {
  readonly pending?: (
    state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Pending" }>,
  ) => JSX.Element;
  readonly failure?: (
    state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Failure" }>,
  ) => JSX.Element;
  readonly notFound?: (
    state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "NotFound" }>,
  ) => JSX.Element;
}

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const isHydratingExistingDom = (): boolean => canUseBrowser() && isHydrating();

const RouterContext = createContext<BrowserRouter<readonly AnyRoute[], unknown> | null>(null);

interface RouterProviderEntry<Routes extends readonly AnyRoute[], ER> {
  readonly routes: Routes;
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly history?: BrowserHistoryAdapter;
  readonly initialHref?: string;
  readonly hydrating?: boolean;
}

const routerOutletRenderers = <Routes extends readonly AnyRoute[], ER>(
  props: TypedRouterOutletProps<Routes, ER>,
): SolidRouteOutletRenderers<Routes, ER> => {
  const renderers = {
    ...(props.pending === undefined ? {} : { pending: props.pending }),
    ...(props.failure === undefined ? {} : { failure: props.failure }),
    ...(props.notFound === undefined ? {} : { notFound: props.notFound }),
  };
  return renderers;
};

/** Error thrown when router hooks are used outside `RouterProvider`. */
export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

/**
 * Internal: creates a Solid browser router from Sunfall Arc route definitions.
 * `RouterProvider` is the public entry point; it passes the runtime from
 * `RuntimeProvider` context.
 *
 * Navigation preloads matched route resources in the configured runtime and
 * interrupts stale preload work when navigation changes. Call this under a
 * Solid owner so effects, browser listeners, and preload scopes are cleaned up
 * with the owner.
 */
export const createBrowserRouter = <const Routes extends readonly AnyRoute[], ER = never>(
  routes: Routes,
  options: BrowserRouterOptions<ER>,
): BrowserRouter<Routes, ER> => {
  const runtime = options.runtime as AnySunfallArcRuntime<ER>;
  const controller = createBrowserRouterHostController(routes, {
    runtime,
    ...(options.history === undefined ? {} : { history: options.history }),
    ...(options.initialHref === undefined ? {} : { initialHref: options.initialHref }),
    initialMatchedState: (href, match) =>
      browserRouterInitialMatchedState({
        href,
        match,
        host: canUseBrowser() ? "browser" : "server",
        hydrating: options.hydrating ?? isHydratingExistingDom(),
      }),
  });
  // Controller signals are Arc signals, which Solid tracks natively.
  const state: Accessor<BrowserRouterState<Routes, ER>> = () => controller.state.get();
  const match: Accessor<Route.Match<Routes[number]> | undefined> = () => controller.match.get();
  const stopController = canUseBrowser() ? controller.start() : controller.dispose;

  onCleanup(() => {
    stopController();
  });

  const router: BrowserRouter<Routes, ER> = {
    routes,
    runtime,
    state,
    match,
    canHandleRoute: controller.canHandleRoute,
    href: controller.href,
    createHref: controller.createHref,
    hrefByPath: controller.hrefByPath,
    navigate: controller.navigate,
    navigateByPath: controller.navigateByPath,
    navigateHref: controller.navigateHref,
    matchByPath: controller.matchByPath,
    preloadEffect: controller.preloadEffect,
    preloadByPathEffect: controller.preloadByPathEffect,
  };

  return router;
};

/** Reads the current router from `RouterProvider`. */
export const useRouter = <
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
>(): BrowserRouter<Routes, ER> => {
  const router = useContext(RouterContext);
  if (!router) {
    throw new RouterContextMissing({ hook: "useRouter" });
  }

  return router as unknown as BrowserRouter<Routes, ER>;
};

/** Renders the matched route component and owns its route `UiScope`. */
export const RouterOutlet = <RoutesOrError = readonly AnyRoute[], ER = never>(
  props: RouterOutletProps<RoutesOrError, ER>,
): JSX.Element => {
  type Routes = RouterOutletRoutes<RoutesOrError>;
  type Error = RouterOutletError<RoutesOrError, ER>;
  const typedProps = props as TypedRouterOutletProps<Routes, Error>;
  const router = useRouter<Routes, Error>();
  const runtime = router.runtime as AnySunfallArcRuntime<Error>;
  const renderers = createMemo(() => routerOutletRenderers(typedProps));
  // Outlet state lives in Arc signals: Solid tracks them natively on the client,
  // and writes stay plain committed values during server rendering.
  const node = Signal.make<JSX.Element>(undefined);
  const renderError = Signal.make<unknown>(undefined);
  const input = () => ({ state: router.state(), renderers: renderers() });
  const routeRenderScope = makeSolidRouteRenderScopeController({
    // The first render is synchronous (server rendering runs no effects); the
    // render effect below owns every later input.
    initialInput: untrack(input),
    runtime,
    owner: getOwner(),
    node,
    renderError,
  });

  createRenderEffect(input, (next) => {
    routeRenderScope.update(next);
  });

  onCleanup(() => {
    routeRenderScope.dispose();
  });

  return createMemo(() => {
    const error = renderError.get();
    if (error !== undefined) {
      throw error;
    }
    return node.get();
  }) as unknown as JSX.Element;
};

/**
 * Provides router context, then renders either children or outlet.
 *
 * Route preloads and route component scopes run on the runtime from the
 * nearest `RuntimeProvider`; a missing provider throws `RuntimeContextMissing`.
 *
 * @example
 * ```tsx
 * <RuntimeProvider runtime={runtime}>
 *   <RouterProvider routes={routes} />
 * </RuntimeProvider>
 * ```
 */
export const RouterProvider = <const Routes extends readonly AnyRoute[], ER = never>(
  props: RouterProviderProps<Routes, ER>,
): JSX.Element => {
  const runtime = useRuntime<ER>();
  const entry = createMemo<RouterProviderEntry<Routes, ER>>(() => {
    return {
      routes: props.routes,
      runtime,
      ...(props.history === undefined ? {} : { history: props.history }),
      ...(props.initialHref === undefined ? {} : { initialHref: props.initialHref }),
      ...(props.hydrating === undefined ? {} : { hydrating: props.hydrating }),
    };
  });

  // Each entry gets its own router instance. The memo owns it, so a new entry
  // disposes the previous router first, and rendering stays in tree order for
  // hydration.
  return createMemo(() =>
    createComponent(RouterProviderInstance<Routes, ER>, {
      entry: entry(),
      props,
    }),
  ) as unknown as JSX.Element;
};

const RouterProviderInstance = <
  const Routes extends readonly AnyRoute[],
  ER = never,
>(instanceProps: {
  readonly entry: RouterProviderEntry<Routes, ER>;
  readonly props: RouterProviderProps<Routes, ER>;
}): JSX.Element => {
  const { entry, props } = instanceProps;
  const router = createBrowserRouter<Routes, ER>(entry.routes, {
    runtime: entry.runtime,
    ...(entry.history === undefined ? {} : { history: entry.history }),
    ...(entry.initialHref === undefined ? {} : { initialHref: entry.initialHref }),
    ...(entry.hydrating === undefined ? {} : { hydrating: entry.hydrating }),
  });

  return createComponent(RouterContext, {
    value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
    get children() {
      return runWithRuntime(
        entry.runtime,
        () =>
          props.children ??
          createComponent(
            RouterOutlet as (props: RouterOutletProps<Routes, ER>) => JSX.Element,
            props as RouterOutletProps<Routes, ER>,
          ),
      );
    },
  });
};
