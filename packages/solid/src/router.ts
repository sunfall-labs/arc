import {
  Route,
  defaultRuntime,
  runFork,
  runWithRuntime,
  runWithScope,
  UiScope,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Cause, Data, Effect, Exit, Fiber } from "effect";
import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type Component,
  type JSX
} from "solid-js";
import { createComponent, isServer } from "solid-js/web";
import { RuntimeContext, useRuntime } from "./runtime.js";

type AnyRoute = Route.Definition<string, unknown, unknown>;

/**
 * Reactive browser router state emitted while matching and preloading routes.
 *
 * `Failure` preserves the typed preload `Cause` from `Route.preloadEffect(...)`
 * plus the first typed failure value when one is present. Defects stay in the
 * Cause for error boundaries instead of being widened to an `unknown` value.
 */
export type BrowserRouterState<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ER = never
> =
  | { readonly _tag: "Pending"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Ready"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | {
      readonly _tag: "Failure";
      readonly href: string;
      readonly match: Route.Match<Routes[number]>;
      readonly cause: Cause.Cause<Route.PreloadError | ER>;
      readonly error?: Route.PreloadError | ER;
    }
  | { readonly _tag: "NotFound"; readonly href: string };

/** Options for router navigation history behavior. */
export interface BrowserNavigateOptions {
  readonly replace?: boolean;
}

/** Options for creating a Solid browser router. */
export interface BrowserRouterOptions<ER = never> {
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<unknown, ER>;
}

/** Solid browser router backed by Effect UI route definitions and preload. */
export interface BrowserRouter<Routes extends readonly AnyRoute[] = readonly AnyRoute[], ER = never> {
  readonly routes: Routes;
  readonly state: Accessor<BrowserRouterState<Routes, ER>>;
  readonly match: Accessor<Route.Match<Routes[number]> | undefined>;
  href<R extends Routes[number]>(definition: R, options: Route.HrefOptions<R>): string;
  navigate<R extends Routes[number]>(
    definition: R,
    options: Route.HrefOptions<R>,
    navigateOptions?: BrowserNavigateOptions
  ): void;
  navigateHref(href: string, options?: BrowserNavigateOptions): void;
  preloadEffect<R extends Routes[number]>(definition: R, options: Route.HrefOptions<R>): Effect.Effect<void, Route.PreloadError>;
}

/** Props for `RouterProvider`, including route definitions and render fallbacks. */
export interface RouterProviderProps<Routes extends readonly AnyRoute[], ER = never> extends RouterOutletProps<ER> {
  readonly routes: Routes;
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<unknown, ER>;
  readonly children?: JSX.Element;
}

/**
 * Render fallbacks for route pending, failure, and not-found states.
 *
 * The `failure` renderer receives the same typed `BrowserRouterState.Failure`
 * shape as `router.state()`, including `Cause<Route.PreloadError | ER>`.
 */
export interface RouterOutletProps<ER = never> {
  readonly pending?: (state: Extract<BrowserRouterState, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<BrowserRouterState, { readonly _tag: "NotFound" }>) => JSX.Element;
}

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const currentHref = (fallback = "/"): string =>
  canUseBrowser() ? `${window.location.pathname}${window.location.search}` : fallback;

const RouterContext = createContext<BrowserRouter<readonly AnyRoute[], unknown>>();

/** Error thrown when router hooks are used outside `RouterProvider`. */
export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

const routeStateMatch = <Routes extends readonly AnyRoute[], ER>(
  state: BrowserRouterState<Routes, ER>
): Route.Match<Routes[number]> | undefined =>
  state._tag === "NotFound" ? undefined : state.match;

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

/**
 * Creates a Solid browser router from Effect UI route definitions.
 *
 * Navigation preloads matched route resources in the configured runtime and
 * interrupts stale preload work when navigation changes.
 */
export const createBrowserRouter = <const Routes extends readonly AnyRoute[], ER = never>(
  routes: Routes,
  options: BrowserRouterOptions<ER> = {}
): BrowserRouter<Routes, ER> => {
  const runtime = options.runtime ?? defaultRuntime;
  const initialHref = options.initialHref ?? currentHref();
  const initialMatch = Route.match(routes, initialHref);
  const initialMatchedState = (
    match: Route.Match<Routes[number]>
  ): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" | "Ready" }> =>
    canUseBrowser()
      ? { _tag: "Pending", href: initialHref, match }
      : { _tag: "Ready", href: initialHref, match };
  const [location, setLocation] = createSignal(initialHref);
  const [state, setState] = createSignal<BrowserRouterState<Routes, ER>>(
    initialMatch
      ? initialMatchedState(initialMatch)
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
          const cause = exit.cause as Cause.Cause<Route.PreloadError | ER>;
          const error = firstFailure(cause);
          setState({
            _tag: "Failure",
            href,
            match,
            cause,
            ...(error === undefined ? {} : { error })
          });
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

  const router: BrowserRouter<Routes, ER> = {
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

const renderRouteState = <ER>(
  state: BrowserRouterState<readonly AnyRoute[], ER>,
  props: RouterOutletProps<ER>,
  runtime: EffectUiRuntime<unknown, ER>
): { readonly node: JSX.Element; readonly disposeScope?: () => void; readonly disposeSolid?: () => void } => {
  switch (state._tag) {
    case "Pending":
      return {
        node: (props.pending ?? defaultPending)(state as Extract<BrowserRouterState, { readonly _tag: "Pending" }>)
      };
    case "Failure":
      return {
        node: (props.failure ?? defaultFailure)(state as Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>)
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
      const disposeScope = () => {
        void runFork(routeScope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
      };
      let disposeSolid: (() => void) | undefined;
      const node = createRoot((disposeRoot) => {
        disposeSolid = disposeRoot;

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

      return disposeSolid ? { node, disposeScope, disposeSolid } : { node, disposeScope };
    }
  }
};

/** Renders the matched route component and owns its route `UiScope`. */
export const RouterOutlet = <ER = never>(props: RouterOutletProps<ER>): JSX.Element => {
  const router = useRouter<readonly AnyRoute[], ER>();
  const runtime = useRuntime() as EffectUiRuntime<unknown, ER>;
  let renderedState = router.state();
  const initial = renderRouteState(renderedState, props, runtime);
  const [node, setNode] = createSignal<JSX.Element>(initial.node);
  let disposeRouteScope: (() => void) | undefined = initial.disposeScope;
  let disposeRouteSolid: (() => void) | undefined = initial.disposeSolid;

  createEffect(() => {
    const state = router.state();
    if (state === renderedState) {
      return;
    }

    const previousDisposeScope = disposeRouteScope;
    const previousDisposeSolid = disposeRouteSolid;
    disposeRouteScope = undefined;
    disposeRouteSolid = undefined;
    previousDisposeScope?.();

    const next = renderRouteState(state, props, runtime);
    renderedState = state;
    setNode(() => next.node);
    previousDisposeSolid?.();
    disposeRouteScope = next.disposeScope;
    disposeRouteSolid = next.disposeSolid;
  });

  onCleanup(() => {
    disposeRouteScope?.();
    disposeRouteSolid?.();
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
export const RouterProvider = <const Routes extends readonly AnyRoute[], ER = never>(
  props: RouterProviderProps<Routes, ER>
): JSX.Element => {
  const runtime = (props.runtime ?? useRuntime()) as EffectUiRuntime<unknown, ER>;
  const router = createBrowserRouter<Routes, ER>(
    props.routes,
    props.initialHref === undefined
      ? { runtime }
      : { initialHref: props.initialHref, runtime }
  );
  return createComponent(RuntimeContext.Provider, {
    value: runtime as EffectUiRuntime<unknown, never>,
    get children() {
      return createComponent(RouterContext.Provider, {
        value: router as unknown as BrowserRouter<readonly AnyRoute[], unknown>,
        get children() {
          return props.children ?? createComponent(RouterOutlet, props as RouterOutletProps<ER>);
        }
      });
    }
  });
};
