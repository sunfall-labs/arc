import { Effect } from "effect";
import type { Route } from "./route.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
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
  BrowserRouterError,
  AnyBrowserRoute,
  BrowserRouterState,
} from "./browser-router-state.js";

/**
 * Options for the host-facing Browser Router Controller used by framework adapters.
 *
 * Framework adapters own host reactivity and component lifecycle. This
 * controller owns history adapter wiring, initial navigation, programmatic
 * commits, and kernel disposal so browser routing mechanics stay testable
 * without a renderer.
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
 * Host-facing Browser Router Controller used by the Solid adapter.
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
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly state: ReadableSignal<BrowserRouterState<Routes, ER>>;
  readonly match: ReadableSignal<Route.Match<Routes[number]> | undefined>;
  /**
   * Starts history listening and returns the host-owner cleanup, which forks
   * `dispose()` on the router runtime.
   */
  start(): () => void;
  /** Effect-first disposal for host listeners plus active route preload work. */
  dispose(): Effect.Effect<void>;
  canHandleRoute(definition: AnyBrowserRoute): definition is Routes[number];
  href<R extends Routes[number]>(definition: R, ...args: Route.HrefArgs<R>): string;
  /** Maps a router-owned href to the browser-visible href used by anchors. */
  createHref(href: string): string;
  navigate<R extends Routes[number]>(definition: R, ...args: BrowserNavigateArgs<R>): void;
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  preload<R extends Routes[number]>(
    definition: R,
    ...args: Route.HrefArgs<R>
  ): Effect.Effect<void, BrowserRouterError<Routes> | ER>;
}

/**
 * Creates the shared host Browser Router Controller used by framework adapters.
 *
 * Its signals are Arc signals, which Solid tracks natively; the Solid adapter
 * exposes them as accessors and owns the owner cleanup that calls `dispose()`.
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
    ...(history.prepareHref === undefined ? {} : { prepareHref: history.prepareHref }),
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
      yield* kernel.dispose();
    });
  const forkDispose = (): void => {
    void Effect.runFork(disposeEffect());
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
      // Skip the initial preload when the first state is already settled for
      // this href: a host-chosen `Ready` (server output being hydrated) or a
      // `Failure` (unmatchable href, or a hydrated server preload failure).
      const initialState = kernel.state.get();
      const settled =
        initialState.href === initialHref &&
        (initialState._tag === "Failure" ||
          (initialState._tag === "Ready" && options.initialMatchedState !== undefined));
      if (!settled) {
        kernel.navigateHref(initialHref);
      }

      return forkDispose;
    },
    dispose: disposeEffect,
    canHandleRoute: kernel.canHandleRoute,
    href: kernel.href,
    createHref: (href) => history.createHref?.(href) ?? href,
    navigate: (definition, ...args) => {
      kernel.navigate(definition, controller.navigateHref, ...args);
    },
    navigateHref: (href, navigateOptions = {}) => {
      kernel.navigateHref(history.commit(href, navigateOptions));
    },
    preload: kernel.preload,
  };

  return controller;
};
