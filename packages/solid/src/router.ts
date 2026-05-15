import {
  createBrowserRouterKernel,
  makeRuntimeUiScope,
  makeWindowBrowserHistoryAdapter,
  Route,
  currentOrDefaultRuntime,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type BrowserNavigateArgs,
  type BrowserNavigateOptions,
  type BrowserHistoryAdapter,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterState,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Data, Effect, Fiber } from "effect";
import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  sharedConfig,
  useContext,
  type Accessor,
  type Component,
  type JSX
} from "solid-js";
import { createComponent, isServer } from "solid-js/web";
import { RuntimeContext, useRuntime } from "./runtime.js";

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

/** Options for creating a Solid browser router. */
export interface BrowserRouterOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
> {
  /** Initial URL used for tests or SSR hydration. Defaults to `window.location.href`. */
  readonly initialHref?: string;
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
  /** Runtime used for route preload Effects and route component scopes. */
  readonly runtime?: RouterRuntime<Routes, ER, Runtime>;
}

/** Solid browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[], ER = never> {
  /** Route definitions this router can match. */
  readonly routes: Routes;
  /** Runtime used for route preloads and route component scopes. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Reactive router state: pending, ready, failure, or not found. */
  readonly state: Accessor<BrowserRouterState<Routes, ER>>;
  /** Current ready route match, or undefined outside a ready state. */
  readonly match: Accessor<Route.Match<Routes[number]> | undefined>;
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

/** Props for `RouterProvider`, including route definitions and render fallbacks. */
type RouterOutletRoutes<RoutesOrError> =
  [RoutesOrError] extends [readonly AnyRoute[]] ? RoutesOrError : readonly AnyRoute[];
type RouterOutletError<RoutesOrError, ER> =
  [RoutesOrError] extends [readonly AnyRoute[]] ? ER : RoutesOrError;
type RouterOutletState<RoutesOrError, ER> =
  BrowserRouterState<RouterOutletRoutes<RoutesOrError>, RouterOutletError<RoutesOrError, ER>>;
type TypedRouterOutletProps<Routes extends readonly AnyRoute[], ER> = {
  readonly pending?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => JSX.Element;
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
  readonly children?: JSX.Element;
};

/**
 * Render fallbacks for route pending, failure, and not-found states.
 *
 * The `failure` renderer receives the same typed `BrowserRouterState.Failure`
 * shape as `router.state()`, including `Cause<Route.NavigationError | ER>`.
 */
export interface RouterOutletProps<RoutesOrError = readonly AnyRoute[], ER = never> {
  readonly pending?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<RouterOutletState<RoutesOrError, ER>, { readonly _tag: "NotFound" }>) => JSX.Element;
}

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const isHydratingExistingDom = (): boolean =>
  canUseBrowser() && sharedConfig.context != null;

const RouterContext = createContext<BrowserRouter<readonly AnyRoute[], unknown>>();

/** Error thrown when router hooks are used outside `RouterProvider`. */
export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

export { RouterRouteNotRegistered } from "@effect-ui/core";

/**
 * Creates a Solid browser router from Effect UI route definitions.
 *
 * Navigation preloads matched route resources in the configured runtime and
 * interrupts stale preload work when navigation changes.
 *
 * Call this under a Solid owner, either directly in `createRoot(...)` or via
 * `RouterProvider`, so effects, browser listeners, and preload scopes are
 * cleaned up with the owner.
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
      canUseBrowser() && !isHydratingExistingDom()
        ? { _tag: "Pending", href, match }
        : { _tag: "Ready", href, match }
  });
  const [state, setState] = createSignal<BrowserRouterState<Routes, ER>>(
    kernel.state.get()
  );
  const [match, setMatch] = createSignal<Route.Match<Routes[number]> | undefined>(
    kernel.match.get()
  );
  const unsubscribeState = kernel.state.subscribe(() => {
    setState(() => kernel.state.get());
  });
  const unsubscribeMatch = kernel.match.subscribe(() => {
    setMatch(() => kernel.match.get());
  });
  const stopHistory = history.listen(kernel.navigateHref);
  kernel.navigateHref(initialHref);

  onCleanup(() => {
    stopHistory();
    unsubscribeState();
    unsubscribeMatch();
    kernel.dispose();
  });

  const router: BrowserRouter<Routes, ER> = {
    routes,
    runtime,
    state,
    match,
    canHandleRoute: kernel.canHandleRoute,
    href: kernel.href,
    hrefByPath: kernel.hrefByPath,
    navigate: (definition, ...args) => {
      kernel.navigate(definition, router.navigateHref, ...args);
    },
    navigateByPath: (path, ...args) => {
      kernel.navigateByPath(path, router.navigateHref, ...args);
    },
    navigateHref: (href, options = {}) => {
      kernel.navigateHref(history.commit(href, options));
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
  props: TypedRouterOutletProps<Routes, ER>,
  runtime: AnyEffectUiRuntime<ER>
): { readonly node: JSX.Element; readonly dispose?: Effect.Effect<void, never, never> } => {
  switch (state._tag) {
    case "Pending":
      return renderInRouteScope(runtime, () => (props.pending ?? defaultPending)(state));
    case "Failure":
      return renderInRouteScope(runtime, () => (props.failure ?? defaultFailure)(state));
    case "NotFound":
      return renderInRouteScope(runtime, () => (props.notFound ?? defaultNotFound)(state));
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

/** Renders the matched route component and owns its route `UiScope`. */
export const RouterOutlet = <RoutesOrError = readonly AnyRoute[], ER = never>(
  props: RouterOutletProps<RoutesOrError, ER>
): JSX.Element => {
  type Routes = RouterOutletRoutes<RoutesOrError>;
  type Error = RouterOutletError<RoutesOrError, ER>;
  const typedProps = props as TypedRouterOutletProps<Routes, Error>;
  const router = useRouter<Routes, Error>();
  const runtime = router.runtime as AnyEffectUiRuntime<Error>;
  let renderedState = router.state();
  const initial = renderRouteState(renderedState, typedProps, runtime);
  const [node, setNode] = createSignal<JSX.Element>(initial.node);
  let disposeRoute: Effect.Effect<void, never, never> | undefined = initial.dispose;
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;

  createEffect(() => {
    const state = router.state();
    if (state === renderedState) {
      return;
    }

    renderedState = state;
    const transition = ++transitionVersion;
    const previousDispose = disposeRoute;
    disposeRoute = undefined;
    setNode(() => undefined);
    const previousDisposalFiber = disposalFiber;
    const currentDisposal = disposeRenderedRoute(previousDispose);
    disposalFiber = runtime.runFork(
      Effect.gen(function* () {
        if (previousDisposalFiber !== undefined) {
          yield* Fiber.join(previousDisposalFiber);
        }
        yield* currentDisposal;
      }).pipe(Effect.catchCause(() => Effect.void))
    );
    const transitionDisposalFiber = disposalFiber;
    void runtime.runFork(
      Effect.gen(function* () {
        yield* Fiber.join(transitionDisposalFiber);
        if (transition !== transitionVersion) {
          return;
        }

        const next = renderRouteState(state, typedProps, runtime);
        setNode(() => next.node);
        disposeRoute = next.dispose;
      })
    );
  });

  onCleanup(() => {
    transitionVersion++;
    const previousDisposalFiber = disposalFiber;
    const currentDisposal = disposeRenderedRoute(disposeRoute);
    disposeRoute = undefined;
    disposalFiber = runtime.runFork(
      Effect.gen(function* () {
        if (previousDisposalFiber !== undefined) {
          yield* Fiber.join(previousDisposalFiber);
        }
        yield* currentDisposal;
      }).pipe(Effect.catchCause(() => Effect.void))
    );
  });

  return node as unknown as JSX.Element;
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
): JSX.Element => {
  const runtime = ("runtime" in props && props.runtime !== undefined
    ? props.runtime
    : useRuntime()) as AnyEffectUiRuntime<ER>;
  const routerRuntime = runtime as unknown as EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>;
  const router = createBrowserRouter<Routes, ER>(
    props.routes,
    props.initialHref === undefined
      ? { runtime: routerRuntime }
      : { initialHref: props.initialHref, runtime: routerRuntime }
  );
  return createComponent(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    get children() {
      return createComponent(RouterContext.Provider, {
        value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
        get children() {
          return runWithRuntime(runtime, () =>
            props.children ??
            createComponent(
              RouterOutlet as (props: RouterOutletProps<Routes, ER>) => JSX.Element,
              props as RouterOutletProps<Routes, ER>
            )
          );
        }
      });
    }
  });
};
