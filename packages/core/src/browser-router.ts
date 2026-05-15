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
