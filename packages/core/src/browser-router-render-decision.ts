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
