import { Effect } from "effect";
import type { Route } from "./route.js";
import type { AnyEffectUiRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";
import {
  makeWindowBrowserHistoryAdapter,
  type BrowserHistoryAdapter,
  type BrowserNavigateOptions,
} from "./browser-router-history-adapter.js";
import {
  createBrowserRouterKernel,
  type BrowserNavigateArgs,
  type BrowserRouterKernelOptions,
} from "./browser-router-kernel.js";
import type {
  AnyBrowserRoute,
  BrowserRouterPath,
  BrowserRouterRouteForPath,
  BrowserRouterState,
} from "./browser-router-state.js";

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
  ER,
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
  ER = never,
> {
  readonly routes: Routes;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  /** Starts history listening and returns an idempotent host-listener cleanup. */
  start(): () => void;
  /** Effect-first disposal for host listeners plus active route preload work. */
  disposeEffect(): Effect.Effect<void>;
  /** Runtime-owned synchronous convenience for framework host cleanup hooks. */
  dispose(): void;
  canHandleRoute(definition: AnyBrowserRoute): definition is Routes[number];
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  hrefByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: Route.HrefArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): string;
  navigate<R extends Routes[number]>(definition: R, ...args: BrowserNavigateArgs<R>): void;
  navigateByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
    ...args: BrowserNavigateArgs<BrowserRouterRouteForPath<Routes, Path>>
  ): void;
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  matchByPath<Path extends BrowserRouterPath<Routes>>(
    path: Path,
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
 * Creates the shared host Browser Router Controller used by framework adapters.
 *
 * React can expose this controller directly because it already consumes
 * `ReadableSignal`s. Solid wraps the same controller in `Accessor`s and owns the
 * Solid owner cleanup that calls `dispose()`.
 */
export const createBrowserRouterHostController = <
  const Routes extends readonly AnyBrowserRoute[],
  ER = never,
>(
  routes: Routes,
  options: BrowserRouterHostControllerOptions<Routes, ER>,
): BrowserRouterHostController<Routes, ER> => {
  const { runtime } = options;
  const history = options.history ?? makeWindowBrowserHistoryAdapter();
  const initialHref = options.initialHref ?? history.currentHref();
  const kernelOptions: BrowserRouterKernelOptions<Routes, ER> = {
    runtime,
    initialHref,
    ...(options.initialMatchedState === undefined
      ? {}
      : { initialMatchedState: options.initialMatchedState }),
  };
  const kernel = createBrowserRouterKernel(routes, kernelOptions);
  let started = false;
  let stopHistory = (): void => undefined;
  const stopHost = (): void => {
    stopHistory();
    stopHistory = () => undefined;
    started = false;
  };
  const disposeEffect = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      stopHost();
      yield* kernel.disposeEffect();
    });
  const dispose = (): void => {
    stopHost();
    kernel.dispose();
  };

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
      const initialState = kernel.state.get();
      if (
        options.initialMatchedState === undefined ||
        initialState._tag !== "Ready" ||
        initialState.href !== initialHref
      ) {
        kernel.navigateHref(initialHref);
      }

      return controller.dispose;
    },
    disposeEffect,
    dispose,
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
    preloadByPathEffect: kernel.preloadByPathEffect,
  };

  return controller;
};
