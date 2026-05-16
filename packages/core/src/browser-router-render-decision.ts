import type { Route } from "./route.js";
import type { AnyBrowserRoute, BrowserRouterState } from "./browser-router-state.js";

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

/** Adapter defaults used when computing route-render identity. */
export interface BrowserRouteOutletDefaultRenderers<
  Routes extends readonly AnyBrowserRoute[],
  ER,
  Out
> {
  /** Default pending renderer supplied by the framework adapter. */
  readonly pending: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Pending" }>) => Out;
  /** Default failure renderer supplied by the framework adapter. */
  readonly failure: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }>) => Out;
  /** Default not-found renderer supplied by the framework adapter. */
  readonly notFound: (state: Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "NotFound" }>) => Out;
}

/** Facts used to compute route-render identity across router state and renderers. */
export interface BrowserRouteRenderIdentityInput<
  Routes extends readonly AnyBrowserRoute[],
  ER,
  Out
> {
  /** Current browser router state. */
  readonly state: BrowserRouterState<Routes, ER>;
  /** Adapter/user renderers participating in route scope identity. */
  readonly renderers: BrowserRouteOutletRenderers<Routes, ER, Out>;
  /** Adapter defaults used when a renderer override is absent. */
  readonly defaults: BrowserRouteOutletDefaultRenderers<Routes, ER, Out>;
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

const routeRendererIdentityIds = new WeakMap<object, number>();
let routeRendererIdentitySequence = 0;

const routeRendererIdentityToken = (renderer: unknown): string => {
  if (renderer === undefined || renderer === null) {
    return "none";
  }
  if (typeof renderer !== "object" && typeof renderer !== "function") {
    return `value:${String(renderer)}`;
  }

  const key = renderer as object;
  const existing = routeRendererIdentityIds.get(key);
  if (existing !== undefined) {
    return `ref:${existing}`;
  }

  const next = ++routeRendererIdentitySequence;
  routeRendererIdentityIds.set(key, next);
  return `ref:${next}`;
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

/** Active renderer participating in the route `UiScope` lifetime identity. */
export const browserRouteActiveRenderer = <Routes extends readonly AnyBrowserRoute[], ER, Out>(
  input: BrowserRouteRenderIdentityInput<Routes, ER, Out>
): unknown => {
  const decision = browserRouteRenderDecision(input.state);
  switch (decision._tag) {
    case "Pending":
      return input.renderers.pending ?? input.defaults.pending;
    case "Failure":
      return input.renderers.failure ?? input.defaults.failure;
    case "NotFound":
      return input.renderers.notFound ?? input.defaults.notFound;
    case "Ready":
      return decision.component;
    case "Empty":
      return undefined;
  }
};

/**
 * Stable identity for route-render scopes.
 *
 * The state key owns navigation identity. The renderer token owns same-state
 * fallback/component swaps so adapters dispose stale `UiScope` lifetimes
 * consistently.
 */
export const browserRouteRenderIdentity = <Routes extends readonly AnyBrowserRoute[], ER, Out>(
  input: BrowserRouteRenderIdentityInput<Routes, ER, Out>
): string =>
  `${browserRouteRenderKey(input.state)}:renderer:${routeRendererIdentityToken(browserRouteActiveRenderer(input))}`;
