import { Cause, Data, Effect, Exit, Fiber } from "effect";
import { Route, RouteNavigationError } from "./route.js";
import { Signal, type ReadableSignal } from "./signal.js";
import { makeRuntimeUiScope, type UiScope } from "./scope.js";
import type { AnyEffectUiRuntime } from "./runtime.js";

export type AnyBrowserRoute = Route.Definition<string, unknown, unknown, any>;
export type BrowserRouterPath<Routes extends readonly AnyBrowserRoute[]> = Routes[number]["path"];
export type BrowserRouterRouteForPath<
  Routes extends readonly AnyBrowserRoute[],
  Path extends BrowserRouterPath<Routes>
> = Extract<Routes[number], { readonly path: Path }>;

/**
 * Reactive browser router state emitted while matching and preloading routes.
 *
 * `Failure` preserves the typed navigation/preload `Cause` plus the first typed
 * failure value when one is present. Defects stay in the Cause for error
 * boundaries instead of being widened to an `unknown` value.
 */
export type BrowserRouterState<
  Routes extends readonly AnyBrowserRoute[] = readonly AnyBrowserRoute[],
  ER = never
> =
  | { readonly _tag: "Pending"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Ready"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | {
      readonly _tag: "Failure";
      readonly href: string;
      readonly match?: Route.Match<Routes[number]>;
      readonly cause: Cause.Cause<Route.NavigationError | ER>;
      readonly error?: Route.NavigationError | ER;
    }
  | { readonly _tag: "NotFound"; readonly href: string };

/** Adapter-neutral renderers for router outlet states. */
export interface BrowserRouteOutletRenderers<
  Routes extends readonly AnyBrowserRoute[],
  ER,
  Out
> {
  /** Render while a matched route preload is still pending. */
  readonly pending?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => Out;
  /** Render a failed navigation or preload. Defaults are owned by UI adapters. */
  readonly failure?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => Out;
  /** Render when no route matches the current href. */
  readonly notFound?: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => Out;
}

/** Props passed to a route component when a router state is ready to render. */
export interface BrowserRouteReadyRenderProps<R extends AnyBrowserRoute = AnyBrowserRoute> {
  /** Decoded path params for the matched route. */
  readonly params: Route.Match<R>["params"];
  /** Decoded URL search values for the matched route. */
  readonly search: Route.Match<R>["search"];
  /** Full route match, including the route definition. */
  readonly match: Route.Match<R>;
}

/**
 * Adapter-neutral route render decision consumed by React and Solid outlets.
 *
 * Core owns the route-state decision and ready props; framework adapters keep
 * component invocation, fallback elements, and UI-scope lifecycle local.
 */
export type BrowserRouteRenderDecision<
  Routes extends readonly AnyBrowserRoute[],
  ER
> =
  | {
      readonly _tag: "Pending";
      readonly state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>;
    }
  | {
      readonly _tag: "Failure";
      readonly state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>;
    }
  | {
      readonly _tag: "NotFound";
      readonly state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>;
    }
  | {
      readonly _tag: "Ready";
      readonly state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Ready" }>;
      readonly component: unknown;
      readonly props: BrowserRouteReadyRenderProps<Routes[number]>;
    }
  | {
      readonly _tag: "Empty";
      readonly state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Ready" }>;
    };

/** Stable key for route-render scopes that should reset when route identity changes. */
export const browserRouteRenderKey = <Routes extends readonly AnyBrowserRoute[], ER>(
  state: BrowserRouterState<Routes, ER>
): string => {
  switch (state._tag) {
    case "Pending":
    case "Ready":
      return `${state._tag}:${state.href}:${state.match.route.path}`;
    case "Failure":
      return state.match
        ? `${state._tag}:${state.href}:${state.match.route.path}`
        : `${state._tag}:${state.href}`;
    case "NotFound":
      return `${state._tag}:${state.href}`;
  }
};

/** Builds the adapter-neutral render decision for one router state. */
export const browserRouteRenderDecision = <Routes extends readonly AnyBrowserRoute[], ER>(
  state: BrowserRouterState<Routes, ER>
): BrowserRouteRenderDecision<Routes, ER> => {
  switch (state._tag) {
    case "Pending":
      return { _tag: "Pending", state };
    case "Failure":
      return { _tag: "Failure", state };
    case "NotFound":
      return { _tag: "NotFound", state };
    case "Ready": {
      const component = state.match.route.options.component;
      return component
        ? {
            _tag: "Ready",
            state,
            component,
            props: {
              params: state.match.params,
              search: state.match.search,
              match: state.match
            }
          }
        : { _tag: "Empty", state };
    }
  }
};

/** Options for router navigation history behavior. */
export interface BrowserNavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  readonly replace?: boolean;
}

/** Minimal browser history host used by the Browser History Adapter. */
export interface BrowserHistoryWindow {
  readonly location: {
    readonly pathname: string;
    readonly search: string;
  };
  readonly history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

/**
 * Host history seam used by framework browser routers.
 *
 * Programmatic `commit(...)` returns the href the router should process. It
 * should not notify listeners; browser `pushState(...)` also does not emit a
 * `popstate` event.
 */
export interface BrowserHistoryAdapter {
  /** Reads the current path plus search string, or `fallback` when unavailable. */
  currentHref(fallback?: string): string;
  /** Subscribes to external history changes such as `popstate`. */
  listen(onChange: (href: string) => void): () => void;
  /** Applies a programmatic navigation and returns the href to process. */
  commit(href: string, options?: BrowserNavigateOptions): string;
}

/** In-memory Browser History Adapter useful for tests and non-DOM hosts. */
export interface MemoryBrowserHistoryAdapter extends BrowserHistoryAdapter {
  /** Simulates an external browser navigation and notifies listeners. */
  externalNavigate(href: string): void;
  /** Snapshot of committed entries, including the initial entry. */
  entries(): ReadonlyArray<string>;
}

const browserHistoryWindowHref = (
  windowLike: BrowserHistoryWindow,
  fallback = "/"
): string => {
  const href = `${windowLike.location.pathname}${windowLike.location.search}`;
  return href.length === 0 ? fallback : href;
};

const defaultBrowserHistoryWindow = (): BrowserHistoryWindow | undefined =>
  typeof window === "undefined"
    ? undefined
    : window as unknown as BrowserHistoryWindow;

/** Creates a Browser History Adapter backed by `window.history`. */
export const makeWindowBrowserHistoryAdapter = (
  getWindow: () => BrowserHistoryWindow | undefined = defaultBrowserHistoryWindow
): BrowserHistoryAdapter => ({
  currentHref: (fallback = "/") => {
    const windowLike = getWindow();
    return windowLike === undefined
      ? fallback
      : browserHistoryWindowHref(windowLike, fallback);
  },
  listen: (onChange) => {
    const windowLike = getWindow();
    if (windowLike === undefined) {
      return () => undefined;
    }

    const listener = (): void => {
      onChange(browserHistoryWindowHref(windowLike));
    };
    windowLike.addEventListener("popstate", listener);
    return () => {
      windowLike.removeEventListener("popstate", listener);
    };
  },
  commit: (href, options = {}) => {
    const windowLike = getWindow();
    if (windowLike === undefined) {
      return href;
    }

    const currentHref = browserHistoryWindowHref(windowLike, href);
    if (href === currentHref) {
      return currentHref;
    }

    if (options.replace) {
      windowLike.history.replaceState(null, "", href);
    } else {
      windowLike.history.pushState(null, "", href);
    }

    return browserHistoryWindowHref(windowLike, href);
  }
});

/** Creates an in-memory Browser History Adapter. */
export const makeMemoryBrowserHistoryAdapter = (
  options: { readonly initialHref?: string } = {}
): MemoryBrowserHistoryAdapter => {
  let href = options.initialHref ?? "/";
  const entries = [href];
  const listeners = new Set<(href: string) => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(href);
    }
  };

  return {
    currentHref: () => href,
    listen: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    commit: (nextHref, navigateOptions = {}) => {
      href = nextHref;
      if (navigateOptions.replace) {
        entries[entries.length - 1] = href;
      } else {
        entries.push(href);
      }
      return href;
    },
    externalNavigate: (nextHref) => {
      href = nextHref;
      entries.push(href);
      notify();
    },
    entries: () => entries.slice()
  };
};

export type BrowserNavigateArgs<R extends AnyBrowserRoute> =
  {} extends Route.Params<R>
    ? [options?: Route.HrefOptions<R>, navigateOptions?: BrowserNavigateOptions]
    : [options: Route.HrefOptions<R>, navigateOptions?: BrowserNavigateOptions];

/** Mouse event shape used to decide whether a router link should intercept a click. */
export interface BrowserRouterClickEvent {
  readonly defaultPrevented?: boolean;
  readonly button: number;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/** Returns true for plain primary-button clicks that should stay inside the router. */
export const isPlainLeftClick = (event: BrowserRouterClickEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey;

/** Returns true when anchor attributes intentionally hand navigation to the browser. */
export const opensOutsideRouter = (
  target: string | undefined,
  download: unknown
): boolean =>
  download !== undefined ||
  (target !== undefined && target.length > 0 && target !== "_self");

/** Reason a router-owned link left navigation or preloading to the adapter/browser. */
export type BrowserRouterLinkIgnoreReason =
  | "default-prevented"
  | "preload-disabled"
  | "non-plain-click"
  | "browser-handled"
  | "outside-router";

/** Anchor attributes that affect whether a router link should stay inside the router. */
export interface BrowserRouterLinkTarget {
  /** Anchor target attribute. Non-empty targets other than `_self` are browser-handled. */
  readonly target?: string | undefined;
  /** Anchor download attribute. Any defined value is browser-handled. */
  readonly download?: unknown;
}

/** Facts used by Core to decide whether a link hover should preload. */
export interface BrowserRouterLinkPreloadDecisionOptions extends BrowserRouterLinkTarget {
  /** Whether a framework/user handler already prevented the hover's default behavior. */
  readonly defaultPrevented: boolean;
  /** Resolved RouterLink preload setting. Defaults are adapter-owned before this call. */
  readonly preload: boolean;
  /** Whether the route belongs to the active router provider. */
  readonly canHandleRoute: boolean;
}

/** Adapter-neutral hover preload decision for router-owned links. */
export type BrowserRouterLinkPreloadDecision =
  | { readonly _tag: "Preload" }
  | {
      readonly _tag: "Ignore";
      readonly reason: Exclude<BrowserRouterLinkIgnoreReason, "non-plain-click">;
    };

/** Builds the shared hover preload decision used by framework RouterLink adapters. */
export const browserRouterLinkPreloadDecision = (
  options: BrowserRouterLinkPreloadDecisionOptions
): BrowserRouterLinkPreloadDecision => {
  if (options.defaultPrevented) {
    return { _tag: "Ignore", reason: "default-prevented" };
  }
  if (!options.preload) {
    return { _tag: "Ignore", reason: "preload-disabled" };
  }
  if (opensOutsideRouter(options.target, options.download)) {
    return { _tag: "Ignore", reason: "browser-handled" };
  }
  if (!options.canHandleRoute) {
    return { _tag: "Ignore", reason: "outside-router" };
  }
  return { _tag: "Preload" };
};

/** Facts used by Core to decide whether a link click should navigate in-router. */
export interface BrowserRouterLinkClickDecisionOptions extends BrowserRouterLinkTarget {
  /** Click event facts supplied by the framework adapter after user handlers run. */
  readonly event: BrowserRouterClickEvent;
  /** Href already built from the route definition and current href options. */
  readonly href: string;
  /** Whether in-router navigation should replace the current history entry. */
  readonly replace?: boolean | undefined;
  /** Whether the route belongs to the active router provider. */
  readonly canHandleRoute: boolean;
}

/** Adapter-neutral click decision for router-owned links. */
export type BrowserRouterLinkClickDecision =
  | {
      readonly _tag: "Navigate";
      readonly href: string;
      readonly options?: BrowserNavigateOptions;
    }
  | {
      readonly _tag: "Ignore";
      readonly reason: Exclude<BrowserRouterLinkIgnoreReason, "preload-disabled">;
    };

/** Builds the shared click decision used by framework RouterLink adapters. */
export const browserRouterLinkClickDecision = (
  options: BrowserRouterLinkClickDecisionOptions
): BrowserRouterLinkClickDecision => {
  if (options.event.defaultPrevented === true) {
    return { _tag: "Ignore", reason: "default-prevented" };
  }
  if (!isPlainLeftClick(options.event)) {
    return { _tag: "Ignore", reason: "non-plain-click" };
  }
  if (opensOutsideRouter(options.target, options.download)) {
    return { _tag: "Ignore", reason: "browser-handled" };
  }
  if (!options.canHandleRoute) {
    return { _tag: "Ignore", reason: "outside-router" };
  }
  return {
    _tag: "Navigate",
    href: options.href,
    ...(options.replace === true ? { options: { replace: true } } : {})
  };
};

/** Controls hover preloads for router-owned links. */
export interface BrowserRouterLinkPreloader {
  /** Starts a fresh preload, interrupting any previous hover preload first. */
  preload(): void;
  /** Interrupts the active hover preload, when one is running. */
  interrupt(): void;
}

/** Options for the framework-neutral router link preload policy. */
export interface BrowserRouterLinkPreloaderOptions<ER = unknown> {
  /** Runtime that owns route preload execution and interruption. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Dynamic gate for disabled preloads or links outside this router. */
  readonly enabled: () => boolean;
  /** Builds the current route preload Effect when hover starts. */
  readonly preloadEffect: () => Effect.Effect<void, unknown, unknown>;
}

/**
 * Creates the shared hover-preload policy used by framework link adapters.
 *
 * The policy interrupts stale hover work, swallows fire-and-forget failures, and
 * clears only the latest fiber when preloads race.
 */
export const makeBrowserRouterLinkPreloader = <ER>(
  options: BrowserRouterLinkPreloaderOptions<ER>
): BrowserRouterLinkPreloader => {
  let revision = 0;
  let preloadFiber: Fiber.Fiber<void, unknown> | undefined;

  const interrupt = (): void => {
    const fiber = preloadFiber;
    if (!fiber) {
      return;
    }
    preloadFiber = undefined;
    void options.runtime.runFork(
      Fiber.interrupt(fiber).pipe(Effect.catch(() => Effect.void))
    );
  };

  const preload = (): void => {
    if (!options.enabled()) {
      return;
    }
    interrupt();
    const currentRevision = ++revision;
    preloadFiber = options.runtime.runFork(
      options.preloadEffect().pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => {
          if (revision === currentRevision) {
            preloadFiber = undefined;
          }
        }))
      )
    );
  };

  return { interrupt, preload };
};

/** Cause attached when a router helper receives a route outside its route list. */
export class RouterRouteNotRegistered extends Data.TaggedError("RouterRouteNotRegistered")<{
  readonly path: string;
}> {}

export interface BrowserRouterKernelOptions<
  Routes extends readonly AnyBrowserRoute[],
  ER
> {
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly initialHref: string;
  readonly initialMatchedState?: (
    href: string,
    match: Route.Match<Routes[number]>
  ) => Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" | "Ready" }>;
}

export interface BrowserRouterKernel<
  Routes extends readonly AnyBrowserRoute[] = readonly AnyBrowserRoute[],
  ER = never
> {
  readonly routes: Routes;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  dispose(): void;
  canHandleRoute(definition: AnyBrowserRoute): definition is Routes[number];
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  hrefByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): string;
  navigate<R extends Routes[number]>(
    definition: R,
    commit: (href: string, options?: BrowserNavigateOptions) => void,
    ...args: BrowserNavigateArgs<R>
  ): void;
  navigateByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    commit: (href: string, options?: BrowserNavigateOptions) => void,
    ...args: BrowserNavigateArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): void;
  navigateHref(href: string): void;
  matchByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path
  ): Route.Match<BrowserRouterRouteForPath<Routes, Path>> | undefined;
  preloadEffect<R extends Routes[number]>(
    definition: R,
    ...args: Route.HrefArgs<R>
  ): Effect.Effect<void, Route.NavigationError | ER>;
  preloadByPathEffect<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): Effect.Effect<void, Route.NavigationError | ER>;
}

/**
 * Options for the host-facing Browser Router Controller used by framework adapters.
 *
 * Framework adapters own host reactivity and component lifecycle. This
 * controller owns history adapter wiring, initial navigation, programmatic
 * commits, and kernel disposal so React and Solid cannot drift on browser
 * routing mechanics.
 */
export interface BrowserRouterHostControllerOptions<
  Routes extends readonly AnyBrowserRoute[],
  ER
> extends Omit<BrowserRouterKernelOptions<Routes, ER>, "initialHref"> {
  /** Host history Adapter. Defaults to `window.history` when a browser is available. */
  readonly history?: BrowserHistoryAdapter;
  /** Initial URL used for tests or SSR hydration. Defaults to the history adapter's current href. */
  readonly initialHref?: string;
}

/**
 * Host-facing Browser Router Controller shared by React and Solid adapters.
 *
 * The controller exposes the framework-neutral kernel signals plus start,
 * dispose, navigation, href, match, and preload helpers. Framework adapters can
 * project `state` and `match` into their own reactive primitives without
 * reimplementing history listener or commit policy.
 */
export interface BrowserRouterHostController<
  Routes extends readonly AnyBrowserRoute[] = readonly AnyBrowserRoute[],
  ER = never
> {
  readonly routes: Routes;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  start(): () => void;
  dispose(): void;
  canHandleRoute(definition: AnyBrowserRoute): definition is Routes[number];
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  hrefByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): string;
  navigate<R extends Routes[number]>(
    definition: R,
    ...args: BrowserNavigateArgs<R>
  ): void;
  navigateByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: BrowserNavigateArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): void;
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  matchByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path
  ): Route.Match<BrowserRouterRouteForPath<Routes, Path>> | undefined;
  preloadEffect<R extends Routes[number]>(
    definition: R,
    ...args: Route.HrefArgs<R>
  ): Effect.Effect<void, Route.NavigationError | ER>;
  preloadByPathEffect<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): Effect.Effect<void, Route.NavigationError | ER>;
}

export const routeStateMatch = <Routes extends readonly AnyBrowserRoute[], ER>(
  state: BrowserRouterState<Routes, ER>
): Route.Match<Routes[number]> | undefined =>
  state._tag === "Ready" || state._tag === "Pending" || state._tag === "Failure"
    ? state.match
    : undefined;

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

export const browserRouterFailureState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  cause: Cause.Cause<Route.NavigationError | ER>,
  match?: Route.Match<Routes[number]>
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }> => {
  const error = firstFailure(cause);
  return {
    _tag: "Failure",
    href,
    ...(match === undefined ? {} : { match }),
    cause,
    ...(error === undefined ? {} : { error })
  };
};

const provideRouterPreloadEffect = <ER, R extends AnyBrowserRoute>(
  runtime: AnyEffectUiRuntime<ER>,
  match: Route.Match<R>
): Effect.Effect<void, Route.PreloadError | ER> =>
  runtime.provide(Effect.scoped(Route.preloadEffect(match)));

const routeOutsideRouterError = (definition: AnyBrowserRoute): RouteNavigationError =>
  new RouteNavigationError({
    input: definition.path,
    cause: new RouterRouteNotRegistered({ path: definition.path })
  });

const routePathOutsideRouterError = (path: string): RouteNavigationError =>
  new RouteNavigationError({
    input: path,
    cause: new RouterRouteNotRegistered({ path })
  });

const routerHasRoute = <Routes extends readonly AnyBrowserRoute[]>(
  routes: Routes,
  definition: AnyBrowserRoute
): definition is Routes[number] =>
  (routes as readonly AnyBrowserRoute[]).includes(definition);

const routeMembershipFailureState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  definition: AnyBrowserRoute
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }> =>
  browserRouterFailureState<Routes, ER>(
    href,
    Cause.fail(routeOutsideRouterError(definition)) as Cause.Cause<Route.NavigationError | ER>
  );

const routePathMembershipFailureState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  path: string
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }> =>
  browserRouterFailureState<Routes, ER>(
    href,
    Cause.fail(routePathOutsideRouterError(path)) as Cause.Cause<Route.NavigationError | ER>
  );

const splitNavigateArgs = <R extends AnyBrowserRoute>(
  args: BrowserNavigateArgs<R>
): readonly [Route.HrefArgs<R>, BrowserNavigateOptions | undefined] => {
  const [options, navigateOptions] = args;
  return [
    (options === undefined ? [] : [options]) as Route.HrefArgs<R>,
    navigateOptions
  ];
};

const defaultInitialMatchedState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  match: Route.Match<Routes[number]>
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Ready" }> => ({
  _tag: "Ready",
  href,
  match
});

export const createBrowserRouterKernel = <
  const Routes extends readonly AnyBrowserRoute[],
  ER = never
>(
  routes: Routes,
  options: BrowserRouterKernelOptions<Routes, ER>
): BrowserRouterKernel<Routes, ER> => {
  const { runtime, initialHref } = options;
  const initialMatchedState = options.initialMatchedState ?? defaultInitialMatchedState<Routes, ER>;
  const initialRouterState = (): BrowserRouterState<Routes, ER> => {
    const matchExit = Effect.runSyncExit(Route.matchEffect(routes, initialHref));
    if (Exit.isFailure(matchExit)) {
      return browserRouterFailureState(
        initialHref,
        matchExit.cause as Cause.Cause<Route.NavigationError | ER>
      );
    }

    return matchExit.value
      ? initialMatchedState(initialHref, matchExit.value)
      : { _tag: "NotFound", href: initialHref };
  };
  const state = Signal.make<BrowserRouterState<Routes, ER>>(initialRouterState());
  const match = Signal.derive(() => routeStateMatch(state.get()));
  const routeIsConfigured = (definition: AnyBrowserRoute): definition is Routes[number] =>
    routerHasRoute(routes, definition);
  const routeByPath = new Map<string, Routes[number]>();
  for (const definition of routes) {
    if (!routeByPath.has(definition.path)) {
      routeByPath.set(definition.path, definition);
    }
  }
  const routeForPath = <Path extends BrowserRouterPath<Routes>>(
    path: Path
  ): BrowserRouterRouteForPath<Routes, Path> | undefined =>
    routeByPath.get(path) as BrowserRouterRouteForPath<Routes, Path> | undefined;

  let navigation = 0;
  let preloadScope: UiScope | undefined;

  const disposePreloadScope = (): void => {
    if (preloadScope) {
      void runtime.runFork(preloadScope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
      preloadScope = undefined;
    }
  };

  const setState = (next: BrowserRouterState<Routes, ER>): void => {
    state.set(next);
  };

  const processNavigation = (href: string): void => {
    const navigationId = ++navigation;
    const currentState = state.get();
    const matchExit = Effect.runSyncExit(Route.matchEffect(routes, href));

    disposePreloadScope();

    if (Exit.isFailure(matchExit)) {
      setState(browserRouterFailureState(
        href,
        matchExit.cause as Cause.Cause<Route.NavigationError | ER>
      ));
      return;
    }

    const nextMatch = matchExit.value;
    if (!nextMatch) {
      setState({ _tag: "NotFound", href });
      return;
    }

    const scope = makeRuntimeUiScope(runtime);
    preloadScope = scope;
    if (currentState._tag !== "Ready" || currentState.href !== href) {
      setState({ _tag: "Pending", href, match: nextMatch });
    }

    const fiber = scope.fork(provideRouterPreloadEffect(runtime, nextMatch));

    void runtime.runFork(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Fiber.join(fiber));
        if (navigationId !== navigation) {
          return;
        }

        if (preloadScope === scope) {
          preloadScope = undefined;
        }
        yield* scope.disposeEffect().pipe(Effect.catch(() => Effect.void));

        if (Exit.isSuccess(exit)) {
          setState({ _tag: "Ready", href, match: nextMatch });
        } else {
          setState(browserRouterFailureState(
            href,
            exit.cause as Cause.Cause<Route.NavigationError | ER>,
            nextMatch
          ));
        }
      })
    );
  };

  const preloadRouteEffect = <R extends Routes[number]>(
    definition: R,
    args: Route.HrefArgs<R>
  ): Effect.Effect<void, Route.NavigationError | ER> => {
    const hrefEffect = Effect.try({
      try: () => Route.href(definition, ...args),
      catch: (cause) => new RouteNavigationError({
        input: definition.path,
        cause
      })
    });
    return hrefEffect.pipe(
      Effect.flatMap((href) => Route.matchEffect(routes, href)),
      Effect.flatMap((routeMatch) =>
        routeMatch ? provideRouterPreloadEffect(runtime, routeMatch) : Effect.void
      )
    );
  };

  return {
    routes,
    runtime,
    state,
    match,
    dispose: () => {
      navigation++;
      disposePreloadScope();
    },
    canHandleRoute: routeIsConfigured,
    href: (definition, ...args) => Route.href(definition, ...args),
    hrefByPath: (path, ...args) => {
      const definition = routeForPath(path);
      if (!definition) {
        throw routePathOutsideRouterError(path);
      }

      return Route.href(definition, ...args);
    },
    navigate: (definition, commit, ...args) => {
      if (!routeIsConfigured(definition)) {
        setState(routeMembershipFailureState<Routes, ER>(state.get().href, definition));
        return;
      }

      const [hrefArgs, navigateOptions] = splitNavigateArgs(args);
      commit(Route.href(definition, ...hrefArgs), navigateOptions);
    },
    navigateByPath: (path, commit, ...args) => {
      const definition = routeForPath(path);
      if (!definition) {
        setState(routePathMembershipFailureState<Routes, ER>(state.get().href, path));
        return;
      }

      const [hrefArgs, navigateOptions] = splitNavigateArgs(args);
      commit(Route.href(definition, ...hrefArgs), navigateOptions);
    },
    navigateHref: processNavigation,
    matchByPath: (path) => {
      const currentMatch = routeStateMatch(state.get());
      return currentMatch?.route.path === path
        ? currentMatch as Route.Match<BrowserRouterRouteForPath<Routes, typeof path>>
        : undefined;
    },
    preloadEffect: (definition, ...args) => {
      if (!routeIsConfigured(definition)) {
        return Effect.fail(routeOutsideRouterError(definition));
      }

      return preloadRouteEffect(definition, args);
    },
    preloadByPathEffect: (path, ...args) => {
      const definition = routeForPath(path);
      return definition
        ? preloadRouteEffect(definition, args)
        : Effect.fail(routePathOutsideRouterError(path));
    }
  };
};

/**
 * Creates the shared host Browser Router Controller used by framework adapters.
 *
 * React can expose this controller directly because it already consumes
 * `ReadableSignal`s. Solid wraps the same controller in `Accessor`s and owns the
 * Solid owner cleanup that calls `dispose()`.
 */
export const createBrowserRouterHostController = <
  const Routes extends readonly AnyBrowserRoute[],
  ER = never
>(
  routes: Routes,
  options: BrowserRouterHostControllerOptions<Routes, ER>
): BrowserRouterHostController<Routes, ER> => {
  const { runtime } = options;
  const history = options.history ?? makeWindowBrowserHistoryAdapter();
  const initialHref = options.initialHref ?? history.currentHref();
  const kernelOptions: BrowserRouterKernelOptions<Routes, ER> = {
    runtime,
    initialHref,
    ...(options.initialMatchedState === undefined ? {} : { initialMatchedState: options.initialMatchedState })
  };
  const kernel = createBrowserRouterKernel(routes, kernelOptions);
  let started = false;
  let stopHistory = (): void => undefined;

  const controller: BrowserRouterHostController<Routes, ER> = {
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

      return controller.dispose;
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
      kernel.navigate(definition, controller.navigateHref, ...args);
    },
    navigateByPath: (path, ...args) => {
      kernel.navigateByPath(path, controller.navigateHref, ...args);
    },
    navigateHref: (href, navigateOptions = {}) => {
      kernel.navigateHref(history.commit(href, navigateOptions));
    },
    matchByPath: kernel.matchByPath,
    preloadEffect: kernel.preloadEffect,
    preloadByPathEffect: kernel.preloadByPathEffect
  };

  return controller;
};
