import { Cause, Data, Effect, Exit, Fiber } from "effect";
import {
  Route,
  RouteNavigationError,
  type RouteNotFound,
  type RoutePreloadError,
  type RouteRedirect,
} from "./route.js";
import { matchRoutes } from "./route-match.js";
import {
  takeHydratedRouteNotFound,
  takeHydratedRoutePreloadFailure,
} from "./route-preload-failure-hydration.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { Signal, SignalWrites, type ReadableSignal } from "./signal.js";
import { makeRuntimeUiScope, type UiScope } from "./scope.js";
import type { BrowserNavigateOptions } from "./browser-router-history-adapter.js";
import {
  browserRouterFailureState,
  routeStateMatch,
  type AnyBrowserRoute,
  type BrowserRouterError,
  type BrowserRouterState,
} from "./browser-router-state.js";
import { batchSignalWrites } from "./signal-transaction.js";

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
  _ER = never,
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
  ER = never,
>(
  options: BrowserRouterInitialMatchedStateOptions<Routes, ER>,
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
 * Framework adapters pass their Sunfall Arc runtime and initial URL here before
 * projecting the kernel's signals into the host lifecycle. `initialMatchedState` lets an adapter preserve SSR hydration
 * semantics without changing the shared navigation kernel.
 */
export interface BrowserRouterKernelOptions<Routes extends readonly AnyBrowserRoute[], ER> {
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly initialHref: string;
  /** Host preparation run before route preload for a router-owned href. */
  readonly prepareHref?: (href: string) => Effect.Effect<void | HrefNotFound, unknown>;
  /**
   * Follows a route preload's `Route.redirect(...)`: the host commits `href`
   * to its history (replacing the entry when `replace`) and navigates there.
   * Without it the kernel navigates to `href` without touching history.
   */
  readonly redirect?: (href: string, options: BrowserNavigateOptions) => void;
  readonly initialMatchedState?: (
    href: string,
    match: Route.Match<Routes[number]>,
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
  ER = never,
> {
  readonly routes: Routes;
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  /** Effect-first disposal for interrupting active route preload work before teardown completes. */
  dispose(): Effect.Effect<void>;
  canHandleRoute(definition: AnyBrowserRoute): definition is Routes[number];
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  navigate<R extends Routes[number]>(
    definition: R,
    commit: (href: string, options?: BrowserNavigateOptions) => void,
    ...args: BrowserNavigateArgs<R>
  ): void;
  navigateHref(href: string): void;
  preload<R extends Routes[number]>(
    definition: R,
    ...args: Route.HrefArgs<R>
  ): Effect.Effect<void, BrowserRouterError<Routes> | ER>;
}

const prepareHrefFailure = (href: string, cause: unknown): RouteNavigationError =>
  new RouteNavigationError({
    input: href,
    cause,
  });

/** A host preparation result: the host has no page for the href. */
type HrefNotFound = { readonly _tag: "NotFound" };

/** A route preload's `Route.redirect(...)`: the navigation goes to `href` instead. */
type HrefRedirect = { readonly _tag: "Redirect"; readonly href: string; readonly replace: boolean };

const isHrefNotFound = (prepared: void | HrefNotFound): prepared is HrefNotFound =>
  prepared !== undefined && prepared._tag === "NotFound";

/** Consecutive preload redirects a navigation follows before it fails as a loop. */
const maxRouteRedirects = 20;

/**
 * Prepares the href, then preloads the route. Succeeds with `NotFound`
 * (skipping route preload) when the host preparation reports no page or the
 * preload ended with `Route.notFound()`, and with `Redirect` when it ended
 * with `Route.redirect(...)`. `onPrepared` runs once the host has the page,
 * before route preload.
 */
const provideRouterPreloadEffect = <ER, R extends AnyBrowserRoute>(
  runtime: AnySunfallArcRuntime<ER>,
  match: Route.Match<R>,
  prepareHrefEffect: (href: string) => Effect.Effect<void | HrefNotFound, RouteNavigationError>,
  onPrepared: Effect.Effect<void> = Effect.void,
): Effect.Effect<void | HrefNotFound | HrefRedirect, BrowserRouterError<readonly [R]> | ER> =>
  runtime.provide(
    Effect.scoped(
      prepareHrefEffect(match.href).pipe(
        Effect.flatMap(
          (
            prepared,
          ): Effect.Effect<
            void | HrefNotFound | HrefRedirect,
            BrowserRouterError<readonly [R]>,
            Route.PreloadRequirements<R>
          > =>
            isHrefNotFound(prepared)
              ? Effect.succeed(prepared)
              : onPrepared.pipe(
                  Effect.andThen(
                    Effect.all(
                      [
                        // Any route may end its preload with a verdict.
                        Route.preload(match) as Effect.Effect<
                          void,
                          | RoutePreloadError<Route.PreloadFailure<R>>
                          | RouteNotFound
                          | RouteRedirect,
                          Route.PreloadRequirements<R>
                        >,
                        Route.preloadComponent(match),
                      ],
                      { discard: true },
                    ),
                  ),
                  Effect.catchTags({
                    RouteNotFound: () => Effect.succeed<HrefNotFound>({ _tag: "NotFound" }),
                    RouteRedirect: (redirect) =>
                      Effect.succeed<HrefRedirect>({
                        _tag: "Redirect",
                        href: redirect.href,
                        replace: redirect.replace,
                      }),
                  }),
                ),
        ),
      ),
    ),
  );
const routeOutsideRouterError = (definition: AnyBrowserRoute): RouteNavigationError =>
  new RouteNavigationError({
    input: definition.path,
    cause: new RouterRouteNotRegistered({ path: definition.path }),
  });

/**
 * Routes compare by path, like `Route.isMatch`, so a link to a route also
 * reaches the copy `Route.withComponent(...)` registered with the router.
 */
const routerHasRoute = <Routes extends readonly AnyBrowserRoute[]>(
  routes: Routes,
  definition: AnyBrowserRoute,
): definition is Routes[number] =>
  (routes as readonly AnyBrowserRoute[]).some((route) => route.path === definition.path);

const routeMembershipFailureState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  definition: AnyBrowserRoute,
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }> =>
  browserRouterFailureState<Routes, ER>(
    href,
    Cause.fail(routeOutsideRouterError(definition)) as Cause.Cause<BrowserRouterError<Routes> | ER>,
  );

const splitNavigateArgs = <R extends AnyBrowserRoute>(
  args: BrowserNavigateArgs<R>,
): readonly [Route.HrefArgs<R>, BrowserNavigateOptions | undefined] => {
  const [options, navigateOptions] = args;
  return [(options === undefined ? [] : [options]) as Route.HrefArgs<R>, navigateOptions];
};

const defaultInitialMatchedState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  match: Route.Match<Routes[number]>,
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Ready" }> => ({
  _tag: "Ready",
  href,
  match,
});

/**
 * Create the framework-neutral Browser Router Kernel for a route list.
 *
 * The returned kernel exposes Effect-backed preload helpers and synchronous
 * route helpers while keeping host history commits supplied by the adapter.
 */
export const createBrowserRouterKernel = <
  const Routes extends readonly AnyBrowserRoute[],
  ER = never,
>(
  routes: Routes,
  options: BrowserRouterKernelOptions<Routes, ER>,
): BrowserRouterKernel<Routes, ER> => {
  const { runtime, initialHref } = options;
  const prepareHrefEffect = (
    href: string,
  ): Effect.Effect<void | HrefNotFound, RouteNavigationError> =>
    (options.prepareHref?.(href) ?? Effect.void).pipe(
      Effect.mapError((cause) => prepareHrefFailure(href, cause)),
    );
  const initialMatchedState = options.initialMatchedState ?? defaultInitialMatchedState<Routes, ER>;
  const initialRouterState = (): BrowserRouterState<Routes, ER> => {
    // The hydrated document is a not-found render, whatever this href matches.
    if (takeHydratedRouteNotFound(runtime.resourceStore)) {
      return { _tag: "NotFound", href: initialHref };
    }
    const matchExit = Effect.runSyncExit(matchRoutes(routes, initialHref));
    if (Exit.isFailure(matchExit)) {
      return browserRouterFailureState(
        initialHref,
        matchExit.cause as Cause.Cause<BrowserRouterError<Routes> | ER>,
      );
    }

    const initialMatch = matchExit.value;
    if (!initialMatch) {
      return { _tag: "NotFound", href: initialHref };
    }

    // A server render that showed this route's preload failure hands it to the
    // router rendering (server) or hydrating (client) that output.
    const hydratedFailure = takeHydratedRoutePreloadFailure(
      runtime.resourceStore,
      initialMatch.href,
    );
    return hydratedFailure === undefined
      ? initialMatchedState(initialHref, initialMatch)
      : browserRouterFailureState(
          initialHref,
          Route.preloadFailureCauseFromSnapshot(initialMatch.route, hydratedFailure),
          initialMatch,
        );
  };
  const state = SignalWrites.make<BrowserRouterState<Routes, ER>>(initialRouterState(), {
    name: "Router.state",
  });
  const match = Signal.derive(() => routeStateMatch(state.get()));
  const routeIsConfigured = (definition: AnyBrowserRoute): definition is Routes[number] =>
    routerHasRoute(routes, definition);

  let navigation = 0;
  let preloadScope: UiScope | undefined;
  // Consecutive redirects followed by the current navigation chain.
  let redirects = 0;
  let redirecting = false;

  const takePreloadScope = (): UiScope | undefined => {
    const current = preloadScope;
    preloadScope = undefined;
    return current;
  };

  const disposeTakenPreloadScopeEffect = (current: UiScope | undefined): Effect.Effect<void> =>
    current === undefined
      ? Effect.void
      : current.dispose().pipe(Effect.catchCause(() => Effect.void));

  const disposePreloadScopeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => disposeTakenPreloadScopeEffect(takePreloadScope()));

  const disposePreloadScope = (): void => {
    void runtime.runFork(disposeTakenPreloadScopeEffect(takePreloadScope()));
  };

  const disposeEffect = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      navigation++;
      yield* disposePreloadScopeEffect();
    });

  const setState = (next: BrowserRouterState<Routes, ER>): void => {
    batchSignalWrites(() => state.set(next), {
      _tag: "Router",
      href: next.href,
      status: next._tag,
    });
  };

  const followRedirect = (target: HrefRedirect): void => {
    if (redirects >= maxRouteRedirects) {
      redirects = 0;
      setState(
        browserRouterFailureState(
          target.href,
          Cause.fail(
            new RouteNavigationError({
              input: target.href,
              cause: new Error(`Route preloads redirected more than ${maxRouteRedirects} times.`),
            }),
          ) as Cause.Cause<BrowserRouterError<Routes> | ER>,
        ),
      );
      return;
    }
    redirects++;
    redirecting = true;
    try {
      if (options.redirect === undefined) {
        processNavigation(target.href);
      } else {
        options.redirect(target.href, { replace: target.replace });
      }
    } finally {
      redirecting = false;
    }
  };

  const processNavigation = (href: string): void => {
    if (!redirecting) {
      redirects = 0;
    }
    const navigationId = ++navigation;
    const currentState = state.get();
    const matchExit = Effect.runSyncExit(matchRoutes(routes, href));

    disposePreloadScope();

    if (Exit.isFailure(matchExit)) {
      setState(
        browserRouterFailureState(
          href,
          matchExit.cause as Cause.Cause<BrowserRouterError<Routes> | ER>,
        ),
      );
      return;
    }

    const nextMatch = matchExit.value;
    if (!nextMatch) {
      setState({ _tag: "NotFound", href });
      return;
    }

    const scope = makeRuntimeUiScope(runtime);
    preloadScope = scope;
    // The target match is published (`Pending`) only once the host has
    // prepared the href: until then the host may still answer that it has no
    // page, and on a static host the target's route data is not hydrated yet,
    // so UI rendered for the match would read data nothing can load. Without
    // host preparation this runs synchronously, inside `fork`.
    const enterPending = Effect.sync(() => {
      if (
        navigationId === navigation &&
        (currentState._tag !== "Ready" || currentState.href !== href)
      ) {
        setState({ _tag: "Pending", href, match: nextMatch });
      }
    });

    const fiber = scope.fork(
      provideRouterPreloadEffect(runtime, nextMatch, prepareHrefEffect, enterPending),
    );

    void runtime.runFork(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Fiber.join(fiber));
        if (navigationId !== navigation) {
          return;
        }

        if (preloadScope === scope) {
          preloadScope = undefined;
        }
        yield* scope.dispose().pipe(Effect.catchCause(() => Effect.void));

        if (Exit.isSuccess(exit)) {
          const outcome = exit.value;
          if (outcome !== undefined && outcome._tag === "Redirect") {
            followRedirect(outcome);
            return;
          }
          setState(
            outcome !== undefined && outcome._tag === "NotFound"
              ? { _tag: "NotFound", href }
              : { _tag: "Ready", href, match: nextMatch },
          );
        } else {
          setState(
            browserRouterFailureState(
              href,
              exit.cause as Cause.Cause<BrowserRouterError<Routes> | ER>,
              nextMatch,
            ),
          );
        }
      }),
    );
  };

  const cancelNavigationAndSetFailure = (
    next: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>,
  ): void => {
    navigation++;
    disposePreloadScope();
    setState(next);
  };

  const preloadRouteEffect = <R extends Routes[number]>(
    definition: R,
    args: Route.HrefArgs<R>,
  ): Effect.Effect<void, BrowserRouterError<Routes> | ER> => {
    const hrefEffect = Effect.try({
      try: () => Route.href(definition, ...args),
      catch: (cause) =>
        new RouteNavigationError({
          input: definition.path,
          cause,
        }),
    });
    return hrefEffect.pipe(
      Effect.flatMap((href) => matchRoutes(routes, href)),
      Effect.flatMap((routeMatch) =>
        routeMatch
          ? Effect.asVoid(provideRouterPreloadEffect(runtime, routeMatch, prepareHrefEffect))
          : Effect.void,
      ),
    );
  };

  return {
    routes,
    runtime,
    state,
    match,
    dispose: disposeEffect,
    canHandleRoute: routeIsConfigured,
    href: (definition, ...args) => Route.href(definition, ...args),
    navigate: (definition, commit, ...args) => {
      if (!routeIsConfigured(definition)) {
        cancelNavigationAndSetFailure(
          routeMembershipFailureState<Routes, ER>(state.get().href, definition),
        );
        return;
      }

      const [hrefArgs, navigateOptions] = splitNavigateArgs(args);
      commit(Route.href(definition, ...hrefArgs), navigateOptions);
    },
    navigateHref: processNavigation,
    preload: (definition, ...args) => {
      if (!routeIsConfigured(definition)) {
        return Effect.fail(routeOutsideRouterError(definition));
      }

      return preloadRouteEffect(definition, args);
    },
  };
};
