import { Cause, Data, Effect, Exit, Fiber } from "effect";
import { Route, RouteNavigationError } from "./route.js";
import type { AnyEffectUiRuntime } from "./runtime.js";
import { Signal, type ReadableSignal } from "./signal.js";
import { makeRuntimeUiScope, type UiScope } from "./scope.js";
import type { BrowserNavigateOptions } from "./browser-router-history-adapter.js";
import {
  browserRouterFailureState,
  routeStateMatch,
  type AnyBrowserRoute,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterState
} from "./browser-router-state.js";

/** Positional arguments accepted by router navigation helpers for one route. */
export type BrowserNavigateArgs<R extends AnyBrowserRoute> =
  {} extends Route.Params<R>
    ? [options?: Route.HrefOptions<R>, navigateOptions?: BrowserNavigateOptions]
    : [options: Route.HrefOptions<R>, navigateOptions?: BrowserNavigateOptions];

/** Host environment used to choose the first matched router state. */
export type BrowserRouterInitialMatchedHost = "browser" | "server";

/** Input for the shared browser-router initial matched state policy. */
export interface BrowserRouterInitialMatchedStateOptions<
  Routes extends readonly AnyBrowserRoute[],
  ER = never
> {
  /** Initial URL being matched. */
  readonly href: string;
  /** Route match for the initial URL. */
  readonly match: Route.Match<Routes[number]>;
  /** Host environment constructing the router. */
  readonly host: BrowserRouterInitialMatchedHost;
  /** True while the host is hydrating existing server-rendered DOM. */
  readonly hydrating?: boolean;
}

/**
 * Chooses the first matched browser-router state for framework adapters.
 *
 * Server rendering and hydration start `Ready` so the first client render
 * preserves existing server output. Client-only browser mounts start `Pending`
 * so route preload can show pending UI before the matched component renders.
 */
export const browserRouterInitialMatchedState = <
  const Routes extends readonly AnyBrowserRoute[],
  ER = never
>(
  options: BrowserRouterInitialMatchedStateOptions<Routes, ER>
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" | "Ready" }> =>
  options.host === "browser" && options.hydrating !== true
    ? { _tag: "Pending", href: options.href, match: options.match }
    : { _tag: "Ready", href: options.href, match: options.match };

/** Cause attached when a router helper receives a route outside its route list. */
export class RouterRouteNotRegistered extends Data.TaggedError("RouterRouteNotRegistered")<{
  readonly path: string;
}> {}

/**
 * Framework-neutral Browser Router Kernel construction options.
 *
 * Framework adapters pass their Effect UI runtime and initial URL here before
 * projecting the kernel's signals into React, Solid, or another host
 * lifecycle. `initialMatchedState` lets an adapter preserve SSR hydration
 * semantics without changing the shared navigation kernel.
 */
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

/**
 * Framework-neutral Browser Router Kernel shared by host adapters.
 *
 * The kernel owns route matching, href construction, navigation state,
 * membership validation, preload execution, and disposal. Host integrations
 * should wrap this contract instead of duplicating router mechanics.
 */
export interface BrowserRouterKernel<
  Routes extends readonly AnyBrowserRoute[] = readonly AnyBrowserRoute[],
  ER = never
> {
  readonly routes: Routes;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  /** Effect-first disposal for interrupting active route preload work before teardown completes. */
  disposeEffect(): Effect.Effect<void>;
  /** Runtime-owned synchronous convenience for framework host cleanup hooks. */
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

/**
 * Create the framework-neutral Browser Router Kernel for a route list.
 *
 * The returned kernel exposes Effect-backed preload helpers and synchronous
 * route helpers while keeping host history commits supplied by the adapter.
 */
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

  const takePreloadScope = (): UiScope | undefined => {
    const current = preloadScope;
    preloadScope = undefined;
    return current;
  };

  const disposePreloadScopeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const current = takePreloadScope();
      return current === undefined
        ? Effect.void
        : current.disposeEffect().pipe(Effect.catchCause(() => Effect.void));
    });

  const disposePreloadScope = (): void => {
    void runtime.runFork(disposePreloadScopeEffect());
  };

  const disposeEffect = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      navigation++;
      yield* disposePreloadScopeEffect();
    });

  const dispose = (): void => {
    navigation++;
    disposePreloadScope();
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
        yield* scope.disposeEffect().pipe(Effect.catchCause(() => Effect.void));

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
    disposeEffect,
    dispose,
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
