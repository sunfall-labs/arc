import {
  createBrowserRouterHostController,
  Route,
  type AnySunfallArcRuntime,
  type BrowserHistoryAdapter,
  type BrowserRouterHostController,
  type BrowserRouterState,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { browserRouterInitialMatchedState, SignalWrites } from "@sunfall/arc-core/internal";
import { Data, Effect } from "effect";
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
  type SolidRouteViewRenderer,
} from "./route-render-scope.js";
import { renderFailure } from "./render-failure.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

/** `undefined` means "absent" for every option, so props can pass through as-is. */
interface BrowserRouterOptionsBase {
  /** Initial URL used for tests or SSR hydration. Defaults to the browser path plus search string. */
  readonly initialHref?: string | undefined;
  /** True when the initial browser render hydrates existing server-rendered DOM. */
  readonly hydrating?: boolean | undefined;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter | undefined;
}

/** Options for `Component.router(routes, options)`. */
export interface RouterOptions extends BrowserRouterOptionsBase {}

/** Internal: options for creating a Solid browser router. */
export interface BrowserRouterOptions<ER = never> extends BrowserRouterOptionsBase {
  /** Runtime used for route preload Effects and route component scopes. */
  readonly runtime: SunfallArcRuntime<any, ER> | AnySunfallArcRuntime<ER>;
  /** Renders route components that are typed `Component` values. */
  readonly renderView?: SolidRouteViewRenderer;
}

type SolidBrowserRouterHostController<Routes extends readonly AnyRoute[], ER> = Omit<
  BrowserRouterHostController<Routes, ER>,
  "state" | "match" | "start" | "dispose"
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

/** Props for `RouterProvider`: the router from `Component.router(...)` and its subtree. */
export interface RouterProviderProps<Routes extends readonly AnyRoute[], ER = never> {
  /** Router created in setup with `Component.router(routes, options)`. */
  readonly router: BrowserRouter<Routes, ER>;
  /** Content rendered inside the router; defaults to `<RouterOutlet router={router} />`. */
  readonly children?: JSX.Element;
}

/**
 * Props for `RouterOutlet`: the router it renders plus render fallbacks for
 * route pending, failure, and not-found states.
 *
 * The fallbacks are typed from `router`, so no type arguments are needed. The
 * `failure` renderer receives the same `BrowserRouterState.Failure` as
 * `router.state()`; a route's preload failure arrives as
 * `RoutePreloadError<Route.PreloadFailure<R>>` (its `error` schema type, or
 * `RoutePreloadUntypedFailure` without one), so a `switch` on `_tag` is
 * exhaustive.
 */
export interface RouterOutletProps<Routes extends readonly AnyRoute[], ER = never> {
  /** Router created in setup with `Component.router(routes, options)`. */
  readonly router: BrowserRouter<Routes, ER>;
  readonly pending?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>,
  ) => JSX.Element;
  readonly failure?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>,
  ) => JSX.Element;
  /** Defaults to a plain "Not found". */
  readonly notFound?: (
    state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>,
  ) => JSX.Element;
}

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const isHydratingExistingDom = (): boolean => canUseBrowser() && isHydrating();

const RouterContext = createContext<BrowserRouter<readonly AnyRoute[], unknown> | null>(null);

/** Typed-`Component` route view renderer of each router, read by its outlets. */
const viewRenderers = new WeakMap<object, SolidRouteViewRenderer>();

const routerOutletRenderers = <Routes extends readonly AnyRoute[], ER>(
  props: RouterOutletProps<Routes, ER>,
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
 * `Component.router(...)` is the public entry point; it passes the runtime and
 * setup context of the Component instance that creates the router.
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
  if (canUseBrowser()) {
    controller.start();
  }

  onCleanup(() => {
    void Effect.runFork(controller.dispose());
  });

  const router: BrowserRouter<Routes, ER> = {
    routes,
    runtime,
    state,
    match,
    canHandleRoute: controller.canHandleRoute,
    href: controller.href,
    createHref: controller.createHref,
    navigate: controller.navigate,
    navigateHref: controller.navigateHref,
    preload: controller.preload,
  };
  if (options.renderView !== undefined) {
    viewRenderers.set(router, options.renderView);
  }

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

/**
 * Renders `router`'s matched route component and owns its route `UiScope`.
 * The rendered route subtree sees `router` as its current router.
 */
export const RouterOutlet = <const Routes extends readonly AnyRoute[], ER = never>(
  props: RouterOutletProps<Routes, ER>,
): JSX.Element => {
  const router = props.router;
  const runtime = router.runtime as AnySunfallArcRuntime<ER>;
  const renderView = viewRenderers.get(router);
  const renderers = createMemo(() => routerOutletRenderers(props));
  // Outlet state lives in Arc signals: Solid tracks them natively on the client,
  // and writes stay plain committed values during server rendering.
  const node = SignalWrites.make<JSX.Element>(undefined, { name: "RouterOutlet.node" });
  const renderError = SignalWrites.make<unknown>(undefined, { name: "RouterOutlet.renderError" });
  const input = () => ({ state: router.state(), renderers: renderers() });
  const routeRenderScope = makeSolidRouteRenderScopeController({
    // The first render is synchronous (server rendering runs no effects); the
    // render effect below owns every later input.
    initialInput: untrack(input),
    runtime,
    ...(renderView === undefined ? {} : { renderView }),
    owner: getOwner(),
    node,
    renderError,
  });

  createRenderEffect(input, (next) => {
    routeRenderScope.update(next);
  });

  onCleanup(() => {
    void Effect.runFork(routeRenderScope.dispose());
  });

  return createComponent(RouterContext, {
    value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
    get children() {
      return createMemo(() => {
        const error = renderError.get();
        if (error !== undefined) {
          throw renderFailure(error);
        }
        return node.get();
      }) as unknown as JSX.Element;
    },
  });
};

/**
 * Provides a router to its children (`RouterLink`, `useRouter`), rendering
 * `<RouterOutlet router={router} />` when it has no children.
 *
 * The router comes from `Component.router(routes, options)` in a Component's
 * setup, which checks the routes' preload services and route Components'
 * requirements against the Component's runtime.
 *
 * @example
 * ```tsx
 * const App = Component.define("App", function* () {
 *   const router = yield* Component.router(routes);
 *   return () => (
 *     <RouterProvider router={router}>
 *       <Nav />
 *       <RouterOutlet router={router} notFound={() => <NotFound />} />
 *     </RouterProvider>
 *   );
 * });
 * ```
 */
export const RouterProvider = <const Routes extends readonly AnyRoute[], ER = never>(
  props: RouterProviderProps<Routes, ER>,
): JSX.Element =>
  createComponent(RouterContext, {
    get value() {
      return props.router as unknown as BrowserRouter<readonly AnyRoute[], unknown>;
    },
    get children() {
      return props.children ?? createComponent(RouterOutlet<Routes, ER>, { router: props.router });
    },
  });
