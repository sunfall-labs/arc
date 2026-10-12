import { Cause } from "effect";
import type { Route, RouteLazyComponentFailed } from "./route.js";

export type AnyBrowserRoute = Route.Definition<string, unknown, unknown, any>;

/**
 * Typed failures a Browser Router reports for its routes: navigation and
 * preload failures, with each route's typed preload failure
 * (`RoutePreloadError<Route.PreloadFailure<Routes[number]>>`), plus lazy
 * route component load failures.
 */
export type BrowserRouterError<Routes extends readonly AnyBrowserRoute[]> =
  | Route.NavigationPlanError<Routes[number]>
  | RouteLazyComponentFailed<unknown>;

/**
 * Reactive browser router state emitted while matching and preloading routes.
 *
 * `Failure` preserves the typed navigation/preload `Cause` plus the first typed
 * failure value when one is present. Defects stay in the Cause for error
 * boundaries instead of being widened to an `unknown` value.
 */
export type BrowserRouterState<
  Routes extends readonly AnyBrowserRoute[] = readonly AnyBrowserRoute[],
  ER = never,
> =
  | { readonly _tag: "Pending"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | { readonly _tag: "Ready"; readonly href: string; readonly match: Route.Match<Routes[number]> }
  | {
      readonly _tag: "Failure";
      readonly href: string;
      readonly match?: Route.Match<Routes[number]>;
      readonly cause: Cause.Cause<BrowserRouterError<Routes> | ER>;
      readonly error?: BrowserRouterError<Routes> | ER;
    }
  | { readonly _tag: "NotFound"; readonly href: string };

export const routeStateMatch = <Routes extends readonly AnyBrowserRoute[], ER>(
  state: BrowserRouterState<Routes, ER>,
): Route.Match<Routes[number]> | undefined =>
  state._tag === "Ready" || state._tag === "Pending" || state._tag === "Failure"
    ? state.match
    : undefined;

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

export const browserRouterFailureState = <Routes extends readonly AnyBrowserRoute[], ER>(
  href: string,
  cause: Cause.Cause<BrowserRouterError<Routes> | ER>,
  match?: Route.Match<Routes[number]>,
): Extract<BrowserRouterState<Routes, ER>, { readonly _tag: "Failure" }> => {
  const error = firstFailure(cause);
  return {
    _tag: "Failure",
    href,
    ...(match === undefined ? {} : { match }),
    cause,
    ...(error === undefined ? {} : { error }),
  };
};
