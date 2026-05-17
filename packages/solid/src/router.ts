import {
  browserRouterInitialMatchedState,
  createBrowserRouterHostController,
  Route,
  currentOrDefaultRuntime,
  runWithRuntime,
  type AnyEffectUiRuntime,
  type BrowserHistoryAdapter,
  type BrowserRouterHostController,
  type BrowserRouterState,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Data } from "effect";
import {
  createContext,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  onCleanup,
  sharedConfig,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import { createComponent, isServer } from "solid-js/web";
import {
  makeSolidRouteRenderScopeController,
  type SolidRouteOutletRenderers
} from "./route-render-scope.js";
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
        /** Runtime used for route preload Effects and route component scopes. */
        readonly runtime?: RouterRuntime<Routes, ER, Runtime>;
      }
    : {
        /** Runtime used for route preload Effects and route component scopes. */
        readonly runtime: RouterRuntime<Routes, ER, Runtime>;
      };

/** Options for creating a Solid browser router. */
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

type SolidBrowserRouterHostController<
  Routes extends readonly AnyRoute[],
  ER
> = Omit<BrowserRouterHostController<Routes, ER>, "state" | "match" | "start" | "dispose" | "disposeEffect">;

/** Solid browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[], ER = never>
  extends SolidBrowserRouterHostController<Routes, ER> {
  /** Reactive router state: pending, ready, failure, or not found. */
  readonly state: Accessor<BrowserRouterState<Routes, ER>>;
  /** Current ready route match, or undefined outside a ready state. */
  readonly match: Accessor<Route.Match<Routes[number]> | undefined>;
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
  readonly children?: JSX.Element;
};

interface RouterProviderEntry<
  Routes extends readonly AnyRoute[],
  ER
> {
  readonly routes: Routes;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly routerRuntime: EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>;
  readonly history?: BrowserHistoryAdapter;
  readonly initialHref?: string;
  readonly hydrating?: boolean;
}

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

const routerOutletRenderers = <Routes extends readonly AnyRoute[], ER>(
  props: TypedRouterOutletProps<Routes, ER>
): SolidRouteOutletRenderers<Routes, ER> => {
  const renderers = {
    ...(props.pending === undefined ? {} : { pending: props.pending }),
    ...(props.failure === undefined ? {} : { failure: props.failure }),
    ...(props.notFound === undefined ? {} : { notFound: props.notFound })
  };
  return renderers;
};

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
        hydrating: options.hydrating ?? isHydratingExistingDom()
      })
  });
  const [state, setState] = createSignal<BrowserRouterState<Routes, ER>>(
    controller.state.get()
  );
  const [match, setMatch] = createSignal<Route.Match<Routes[number]> | undefined>(
    controller.match.get()
  );
  const unsubscribeState = controller.state.subscribe(() => {
    setState(() => controller.state.get());
  });
  const unsubscribeMatch = controller.match.subscribe(() => {
    setMatch(() => controller.match.get());
  });
  const stopController = canUseBrowser()
    ? controller.start()
    : controller.dispose;

  onCleanup(() => {
    stopController();
    unsubscribeState();
    unsubscribeMatch();
  });

  const router: BrowserRouter<Routes, ER> = {
    routes,
    runtime,
    state,
    match,
    canHandleRoute: controller.canHandleRoute,
    href: controller.href,
    hrefByPath: controller.hrefByPath,
    navigate: controller.navigate,
    navigateByPath: controller.navigateByPath,
    navigateHref: controller.navigateHref,
    matchByPath: controller.matchByPath,
    preloadEffect: controller.preloadEffect,
    preloadByPathEffect: controller.preloadByPathEffect
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

/** Renders the matched route component and owns its route `UiScope`. */
export const RouterOutlet = <RoutesOrError = readonly AnyRoute[], ER = never>(
  props: RouterOutletProps<RoutesOrError, ER>
): JSX.Element => {
  type Routes = RouterOutletRoutes<RoutesOrError>;
  type Error = RouterOutletError<RoutesOrError, ER>;
  const typedProps = props as TypedRouterOutletProps<Routes, Error>;
  const router = useRouter<Routes, Error>();
  const runtime = router.runtime as AnyEffectUiRuntime<Error>;
  const renderers = createMemo(() => routerOutletRenderers(typedProps));
  const [node, setNode] = createSignal<JSX.Element>();
  const [renderError, setRenderError] = createSignal<unknown>();
  const routeRenderScope = makeSolidRouteRenderScopeController({
    initialInput: {
      state: router.state(),
      renderers: renderers()
    },
    runtime,
    setNode,
    setRenderError
  });

  createRenderEffect(() => {
    routeRenderScope.update({
      state: router.state(),
      renderers: renderers()
    });
  });

  onCleanup(() => {
    routeRenderScope.dispose();
  });

  const view = createMemo(() => {
    const error = renderError();
    if (error !== undefined) {
      throw error;
    }
    return node();
  });

  return view as unknown as JSX.Element;
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
  const contextRuntime = useRuntime<ER>();
  const entry = createMemo<RouterProviderEntry<Routes, ER>>(() => {
    const runtime = ("runtime" in props && props.runtime !== undefined
      ? props.runtime
      : contextRuntime) as AnyEffectUiRuntime<ER>;
    return {
      routes: props.routes,
      runtime,
      routerRuntime: runtime as unknown as EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>,
      ...(props.history === undefined ? {} : { history: props.history }),
      ...(props.initialHref === undefined ? {} : { initialHref: props.initialHref }),
      ...(props.hydrating === undefined ? {} : { hydrating: props.hydrating })
    };
  });
  const [view, setView] = createSignal<JSX.Element>();
  let disposeEntry: (() => void) | undefined;

  const mountEntry = (current: RouterProviderEntry<Routes, ER>): void => {
    disposeEntry?.();
    createRoot((dispose) => {
      disposeEntry = dispose;
      const next = createComponent(RouterProviderInstance, {
        entry: current,
        props
      });
      setView(() => next);
    });
  };

  let mountedEntry = entry();
  mountEntry(mountedEntry);
  createRenderEffect(() => {
    const current = entry();
    if (current === mountedEntry) {
      return;
    }
    mountedEntry = current;
    mountEntry(current);
  });
  onCleanup(() => disposeEntry?.());

  return view as unknown as JSX.Element;
};

const RouterProviderInstance = <
  const Routes extends readonly AnyRoute[],
  ER = never,
  Runtime extends EffectUiRuntime<any, ER> = EffectUiRuntime<Route.PreloadRequirements<Routes[number]>, ER>
>(
  instanceProps: {
    readonly entry: RouterProviderEntry<Routes, ER>;
    readonly props: RouterProviderProps<Routes, ER, Runtime>;
  }
): JSX.Element => {
  const { entry, props } = instanceProps;
  const router = createBrowserRouter<Routes, ER>(
    entry.routes,
    {
      runtime: entry.routerRuntime,
      ...(entry.history === undefined ? {} : { history: entry.history }),
      ...(entry.initialHref === undefined ? {} : { initialHref: entry.initialHref }),
      ...(entry.hydrating === undefined ? {} : { hydrating: entry.hydrating })
    }
  );
  return createComponent(RuntimeContext.Provider, {
    value: entry.runtime as AnyEffectUiRuntime<never>,
    get children() {
      return createComponent(RouterContext.Provider, {
        value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
        get children() {
          return runWithRuntime(entry.runtime, () =>
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
