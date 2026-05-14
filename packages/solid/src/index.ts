import {
  Action,
  currentOrDefaultRuntime,
  read as coreRead,
  Resource,
  ResourceFailure,
  Route,
  defaultRuntime,
  forkScoped,
  makeRuntime,
  onDispose,
  runWithRuntime,
  runWithScope,
  Signal,
  UiScope,
  watch,
  type ActionInstance,
  type EffectUiRuntime,
  type ReadableSignal,
  type ResourceRef,
  type ResourceState,
  type RuntimeSource
} from "@effect-ui/core";
import { Data, Effect, Exit, Fiber, type Scope, type Stream } from "effect";
import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  useContext,
  type Accessor,
  type Component,
  type JSX
} from "solid-js";
import { createComponent, isServer } from "solid-js/web";

type ResourceInput<I, A, E, R = any> = ResourceRef<I, A, E, R> | (() => ResourceRef<I, A, E, R>);

type AnyRoute = Route.Definition<string, any, any>;

export interface ResourceSuccessMeta<A, E> {
  readonly refreshing: boolean;
  readonly state: ResourceState<A, E>;
}

export interface ResourceMatch<A, E, B> {
  readonly initial: () => B;
  readonly pending: (previous: A | undefined) => B;
  readonly success: (value: A, meta: ResourceSuccessMeta<A, E>) => B;
  readonly failure: (error: E, previous: A | undefined) => B;
}

export interface ResourceHandle<I, A, E, R = any> {
  readonly ref: Accessor<ResourceRef<I, A, E, R>>;
  readonly state: Accessor<ResourceState<A, E>>;
  readonly value: Accessor<A | undefined>;
  readonly error: Accessor<E | undefined>;
  readonly waiting: Accessor<boolean>;
  readonly refreshing: Accessor<boolean>;
  readonly hasValue: Accessor<boolean>;
  refreshEffect(): Effect.Effect<A, E, R>;
  refresh(): Promise<A>;
  prefetchEffect(): Effect.Effect<A, E, R>;
  prefetch(): Promise<A>;
  match<B>(cases: ResourceMatch<A, E, B>): B;
}

export type BrowserRouterState<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[]
> =
  | { readonly _tag: "Pending"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Ready"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Failure"; readonly href: string; readonly match: Route.Match<Routes[number]>; readonly error: unknown }
  | { readonly _tag: "NotFound"; readonly href: string };

export interface BrowserNavigateOptions {
  readonly replace?: boolean;
}

export interface BrowserRouterOptions {
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<any, any>;
}

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
  preload<R extends Routes[number]>(definition: R, options: Route.HrefOptions<R>): Promise<void>;
}

export interface RouterProviderProps<Routes extends readonly AnyRoute[]> extends RouterOutletProps {
  readonly routes: Routes;
  readonly initialHref?: string;
  readonly runtime?: EffectUiRuntime<any, any>;
  readonly children?: JSX.Element;
}

export interface RouterOutletProps {
  readonly pending?: (state: Extract<BrowserRouterState, { readonly _tag: "Pending" }>) => JSX.Element;
  readonly failure?: (state: Extract<BrowserRouterState, { readonly _tag: "Failure" }>) => JSX.Element;
  readonly notFound?: (state: Extract<BrowserRouterState, { readonly _tag: "NotFound" }>) => JSX.Element;
}

const resourceAccessor = <I, A, E, R>(
  ref: ResourceInput<I, A, E, R>
): (() => ResourceRef<I, A, E, R>) =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>) : () => ref;

const canUseBrowser = (): boolean => !isServer && typeof window !== "undefined";

const currentHref = (fallback = "/"): string =>
  canUseBrowser() ? `${window.location.pathname}${window.location.search}` : fallback;

const RouterContext = createContext<BrowserRouter>();
const RuntimeContext = createContext<EffectUiRuntime<any, any>>();

export class RouterContextMissing extends Data.TaggedError("RouterContextMissing")<{
  readonly hook: string;
}> {}

export interface RuntimeProviderProps {
  readonly runtime?: EffectUiRuntime<any, any>;
  readonly source?: RuntimeSource<any, any>;
  readonly children?: JSX.Element;
}

export const createEffectRuntime = makeRuntime;

export const useRuntime = (): EffectUiRuntime<any, any> =>
  useContext(RuntimeContext) ?? currentOrDefaultRuntime();

export const RuntimeProvider = (props: RuntimeProviderProps): JSX.Element => {
  const runtime = props.runtime ?? (props.source ? makeRuntime(props.source) : defaultRuntime);
  if (!props.runtime && props.source) {
    onCleanup(() => {
      void runtime.dispose();
    });
  }

  return createComponent(RuntimeContext.Provider, {
    value: runtime,
    get children() {
      return runWithRuntime(runtime, () => props.children);
    }
  });
};

const routeStateMatch = <Routes extends readonly AnyRoute[]>(
  state: BrowserRouterState<Routes>
): Route.Match<Routes[number]> | undefined =>
  state._tag === "NotFound" ? undefined : state.match;

const stateHasValue = <A, E>(state: ResourceState<A, E>): boolean => {
  switch (state._tag) {
    case "Success":
      return true;
    case "Pending":
    case "Failure":
      return "previous" in state;
    case "Initial":
      return false;
  }
};

export const createComponentScope = <A>(f: (scope: UiScope) => A): A => {
  const scope = new UiScope();
  onCleanup(() => {
    void scope.dispose();
  });
  return runWithScope(scope, () => f(scope));
};

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
      void preloadScope.dispose();
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
    const currentState = state();

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

    const fiber = scope.fork(
      runtime.provide(Route.preloadEffect(match)) as Effect.Effect<void, unknown, Scope.Scope>
    );

    void runtime.runPromise(
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
      }) as Effect.Effect<void, never, any>
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
    preload: (definition, options) => {
      const match = definition.match(Route.href(definition, options));
      return match
        ? runtime.runPromise(Route.preloadEffect(match) as Effect.Effect<void, unknown, any>)
        : runtime.runPromise(Effect.void);
    }
  };

  return router;
};

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
  runtime: EffectUiRuntime<any, any>
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
      const component = state.match.route.options.component as Component<any> | undefined;
      if (!component) {
        return { node: undefined };
      }

      const routeScope = new UiScope();
      let disposeRoute: (() => void) | undefined;
      const node = createRoot((disposeSolid) => {
        disposeRoute = () => {
          disposeSolid();
          void routeScope.dispose();
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
    children: (value: any) => value as JSX.Element
  });
};

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

export const useSignal = <A>(signal: ReadableSignal<A>): Accessor<A> => {
  const [value, setValue] = createSignal(coreRead(signal));
  const unsubscribe = signal.subscribe(() => {
    setValue(() => coreRead(signal));
  });
  onCleanup(unsubscribe);
  return value;
};

export const useStream = <A>(
  stream: Stream.Stream<A, never, never>,
  initial: A
): Accessor<A> =>
  createComponentScope(() => {
    if (isServer) {
      return () => initial;
    }

    const signal = Signal.fromStream(stream, initial);
    return useSignal(signal);
  });

export const useResourceResult = <I, A, E, R = any>(
  ref: ResourceInput<I, A, E, R>
): Accessor<ResourceState<A, E>> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const resourceResult = (currentRef: ResourceRef<I, A, E, R>) =>
    runWithRuntime(runtime, () => Resource.result(currentRef));
  const [state, setState] = createSignal<ResourceState<A, E>>(resourceResult(getRef()).get());
  let unsubscribe: (() => void) | undefined;

  createEffect(() => {
    unsubscribe?.();

    const currentRef = getRef();
    const result = resourceResult(currentRef);
    setState(() => result.get());
    unsubscribe = result.subscribe(() => setState(() => result.get()));

    if (result.get()._tag === "Initial") {
      void runtime.runPromise(
        (Resource.prefetchEffect(currentRef) as Effect.Effect<A, E, any>).pipe(
          Effect.catch(() => Effect.void)
        )
      );
    }
  });

  onCleanup(() => {
    unsubscribe?.();
  });

  return state;
};

export const useResourceValue = <I, A, E, R = any>(
  ref: ResourceInput<I, A, E, R>
): Accessor<A | undefined> => {
  const state = useResourceResult(ref);
  return createMemo(() => Resource.value(state()));
};

export const useResourceError = <I, A, E, R = any>(
  ref: ResourceInput<I, A, E, R>
): Accessor<E | undefined> => {
  const state = useResourceResult(ref);
  return createMemo(() => Resource.error(state()));
};

export const useResource = <I, A, E, R = any>(ref: ResourceInput<I, A, E, R>): ResourceHandle<I, A, E, R> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const state = useResourceResult(getRef);
  const value = createMemo(() => Resource.value(state()));
  const error = createMemo(() => Resource.error(state()));
  const waiting = createMemo(() => state().waiting);
  const hasValue = createMemo(() => stateHasValue(state()));
  const refreshing = createMemo(() => {
    const current = state();
    return current._tag === "Pending" && "previous" in current;
  });

  return {
    ref: getRef,
    state,
    value,
    error,
    waiting,
    refreshing,
    hasValue,
    refreshEffect: () => Resource.refreshEffect(getRef()),
    refresh: () => runtime.runPromise(Resource.refreshEffect(getRef()) as Effect.Effect<A, E, any>),
    prefetchEffect: () => Resource.prefetchEffect(getRef()),
    prefetch: () => runtime.runPromise(Resource.prefetchEffect(getRef()) as Effect.Effect<A, E, any>),
    match: (cases) => {
      const current = state();
      switch (current._tag) {
        case "Initial":
          return cases.initial();
        case "Pending":
          return cases.pending(current.previous);
        case "Success":
          return cases.success(current.value, { refreshing: false, state: current });
        case "Failure":
          return cases.failure(current.error, current.previous);
      }
    }
  };
};

export const useResourceSuspense = <I, A, E, R = any>(ref: ResourceInput<I, A, E, R>): Accessor<A> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const state = useResourceResult(getRef);
  return createMemo(() => {
    const current = state();
    const value = Resource.value(current);
    if (value !== undefined) {
      return value;
    }

    if (current._tag === "Failure") {
      throw new ResourceFailure({
        ref: getRef() as ResourceRef<unknown, A, E, unknown>,
        error: current.error,
        previous: current.previous
      });
    }

    throw runtime.runPromise(Resource.prefetchEffect(getRef()) as Effect.Effect<A, E, any>);
  });
};

export const useAction = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>
): ActionInstance<I, A, E, R> => Action.use(definition, { runtime: useRuntime() as EffectUiRuntime<R, unknown> });

export { Action, coreRead as read, forkScoped, onDispose, Resource, Route, Signal, UiScope, watch };
