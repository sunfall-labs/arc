import {
  Route,
  defaultRuntime,
  runFork,
  runWithRuntime,
  runWithScope,
  UiScope,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Data, Effect, Exit, Fiber } from "effect";
import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  untrack,
  useContext,
  type Accessor,
  type Component,
  type JSX
} from "solid-js";
import { createComponent, isServer } from "solid-js/web";
import { RuntimeContext, useRuntime } from "./runtime.js";

type AnyRoute = Route.Definition<string, unknown, unknown>;

/** Reactive browser router state emitted while matching and preloading routes. */
export type BrowserRouterState<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[]
> =
  | { readonly _tag: "Pending"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Ready"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Failure"; readonly href: string; readonly match: Route.Match<Routes[number]>; readonly error: unknown }
  | { readonly _tag: "NotFound"; readonly href: string };

/** Options for router navigation history behavior. */
export interface BrowserNavigateOptions {
  readonly replace?: boolean;
}

/** Options for creating a Solid browser router. */
export interface BrowserRouterOptions {
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<unknown, unknown>;
}

/** Solid browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[]> {
  readonly routes: Routes;
  readonly state: Accessor<BrowserRouterState<Routes>>;
  readonly match: Accessor<Route.Match<Routes[number]> | undefined>;
  href<R extends Routes[number]>(definition: R, options: Route.HrefOptions<R>): string;
  navigate<R extends Routes[number]>(
    definition: R,
    options: Route.HrefOptions<R>,
    navigateOptions?: BrowserNavigateOptions
  ): void;
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  preloadEffect<R extends Routes[number]>(definition: R, options: Route.HrefOptions<R>): Effect.Effect<void, unknown>;
}

/** Props for `RouterProvider`, including route definitions and render fallbacks. */
export interface RouterProviderProps<Routes extends readonly AnyRoute[]> extends RouterOutletProps {
  readonly routes: Routes;
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<unknown, unknown>;
  readonly children?: JSX.Element;
}

/** Render fallbacks for route pending, failure, and not-found states. */
export interface RouterOutletProps {
  readonly pending?: (state: Extract<BrowserRouterState, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<BrowserRouterState, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<BrowserRouterState, { readonly _tag: "NotFound" }>) => JSX.Element;
}

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const currentHref = (fallback = "/"): string =>
  canUseBrowser() ? `${window.location.pathname}${window.location.search}` : fallback;

const RouterContext = createContext<BrowserRouter>();

/** Error thrown when router hooks are used outside `RouterProvider`. */
export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

const routeStateMatch = <Routes extends readonly AnyRoute[]>(
  state: BrowserRouterState<Routes>
): Route.Match<Routes[number]> | undefined =>
  state._tag === "NotFound" ? undefined : state.match;

/**
 * Creates a Solid browser router from Effect UI route definitions.
 *
 * Navigation preloads matched route resources in the configured runtime and
 * interrupts stale preload work when navigation changes.
 */
export const createBrowserRouter = <const Routes extends readonly AnyRoute[]>(
  routes: Routes,
  options: BrowserRouterOptions = {}
): BrowserRouter<Routes> => {
  const runtime = options.runtime ?? defaultRuntime;
  const initialHref = options.initialHref ?? currentHref();
  const initialMatch = Route.match(routes, initialHref);
  const [location, setLocation] = createSignal(initialHref);
  const [state, setState] = createSignal<BrowserRouterState<Routes>>(
    initialMatch
      ? { _tag: "Ready", href: initialHref, match: initialMatch }
      : { _tag: "NotFound", href: initialHref }
  );

  let navigation = 0;
  let preloadScope: UiScope | undefined;

  const disposePreloadScope = (): void => {
    if (preloadScope) {
      void runFork(preloadScope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
      preloadScope = undefined;
    }
  };

  const syncLocation = (): void => {
    setLocation(currentHref());
  };
  if (canUseBrowser()) {
    window.addEventListener("popstate", syncLocation);
  }

  createEffect(() => {
    const href = location();
    const match = Route.match(routes, href);
    const navigationId = ++navigation;
    const currentState = untrack(state);

    disposePreloadScope();

    if (!match) {
      setState({ _tag: "NotFound", href });
      return;
    }

    const scope = new UiScope();
    preloadScope = scope;
    if (currentState._tag !== "Ready" || currentState.href !== href) {
      setState({ _tag: "Pending", href, match });
    }

    const fiber = scope.fork(runtime.provide(Route.preloadEffect(match)));

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
          setState({ _tag: "Ready", href, match });
        } else {
          setState({ _tag: "Failure", href, match, error: exit.cause });
        }
      })
    );
  });

  onCleanup(() => {
    if (canUseBrowser()) {
      window.removeEventListener("popstate", syncLocation);
    }
    navigation++;
    disposePreloadScope();
  });

  const router: BrowserRouter<Routes> = {
    routes,
    state,
    match: createMemo(() => routeStateMatch(state())),
    href: (definition, options) => Route.href(definition, options),
    navigate: (definition, options, navigateOptions) => {
      router.navigateHref(Route.href(definition, options), navigateOptions);
    },
    navigateHref: (href, options = {}) => {
      if (!canUseBrowser()) {
        setLocation(href);
        return;
      }

      if (href === currentHref()) {
        setLocation(href);
        return;
      }

      if (options.replace) {
        window.history.replaceState(null, "", href);
      } else {
        window.history.pushState(null, "", href);
      }

      setLocation(currentHref());
    },
    preloadEffect: (definition, options) => {
      const match = definition.match(Route.href(definition, options));
      return match ? Route.preloadEffect(match) : Effect.void;
    }
  };

  return router;
};

/** Reads the current router from `RouterProvider`. */
export const useRouter = <
  Routes extends readonly AnyRoute[] = readonly AnyRoute[]
>(): BrowserRouter<Routes> => {
  const router = useContext(RouterContext);
  if (!router) {
    throw new RouterContextMissing({ hook: "useRouter" });
  }

  return router as BrowserRouter<Routes>;
};

const defaultPending = (): JSX.Element => undefined;

const defaultFailure = (state: Extract<BrowserRouterState, { readonly _tag: "Failure" }>): JSX.Element => {
  throw state.error;
};

const defaultNotFound = (): JSX.Element => undefined;

const renderRouteState = (
  state: BrowserRouterState,
  props: RouterOutletProps,
  runtime: EffectUiRuntime<unknown, unknown>
): { readonly node: JSX.Element; readonly dispose?: () => void } => {
  switch (state._tag) {
    case "Pending":
      return {
        node: (props.pending ?? defaultPending)(state as Extract<BrowserRouterState, { readonly _tag: "Pending" }>)
      };
    case "Failure":
      return {
        node: (props.failure ?? defaultFailure)(state as Extract<BrowserRouterState, { readonly _tag: "Failure" }>)
      };
    case "NotFound":
      return {
        node: (props.notFound ?? defaultNotFound)(state)
      };
    case "Ready": {
      const component = state.match.route.options.component as Component<Record<string, unknown>> | undefined;
      if (!component) {
        return { node: undefined };
      }

      const routeScope = new UiScope();
      let disposeRoute: (() => void) | undefined;
      const node = createRoot((disposeSolid) => {
        disposeRoute = () => {
          disposeSolid();
          void runFork(routeScope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
        };

        return runWithRuntime(runtime, () =>
          runWithScope(routeScope, () =>
            createComponent(component, {
              params: state.match.params,
              search: state.match.search,
              match: state.match
            })
          )
        );
      });

      return disposeRoute ? { node, dispose: disposeRoute } : { node };
    }
  }
};

/** Renders the matched route component and owns its route `UiScope`. */
export const RouterOutlet = (props: RouterOutletProps): JSX.Element => {
  const router = useRouter();
  const runtime = useRuntime();
  const initial = renderRouteState(router.state(), props, runtime);
  const [node, setNode] = createSignal<JSX.Element>(initial.node);
  let disposeRoute: (() => void) | undefined = initial.dispose;
  let initialized = false;

  createEffect(() => {
    const state = router.state();
    if (!initialized) {
      initialized = true;
      return;
    }

    const previousDispose = disposeRoute;
    const next = renderRouteState(state, props, runtime);

    setNode(() => next.node);
    previousDispose?.();
    disposeRoute = next.dispose;
  });

  onCleanup(() => {
    disposeRoute?.();
  });

  return createComponent(Show, {
    get when() {
      return node();
    },
    keyed: true,
    children: (value: unknown) => value as JSX.Element
  });
};

/**
 * Provides router and runtime context, then renders either children or outlet.
 *
 * @example
 * ```tsx
 * <RouterProvider routes={routes} />
 * ```
 */
export const RouterProvider = <const Routes extends readonly AnyRoute[]>(
  props: RouterProviderProps<Routes>
): JSX.Element => {
  const runtime = props.runtime ?? useRuntime();
  const router = createBrowserRouter(
    props.routes,
    props.initialHref === undefined
      ? { runtime }
      : { initialHref: props.initialHref, runtime }
  );
  return createComponent(RuntimeContext.Provider, {
    value: runtime,
    get children() {
      return createComponent(RouterContext.Provider, {
        value: router,
        get children() {
          return props.children ?? createComponent(RouterOutlet, props);
        }
      });
    }
  });
};
