import { Effect } from "effect";
import { Route, RouteNavigationError } from "./route.js";

/**
 * Internal: runs `Route.match(...)` and reports schema decode throws as typed
 * `RouteNavigationError` failures for router kernels and server preloads.
 */
export const matchRoutes = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
>(
  routes: Routes,
  input: string | URL,
): Effect.Effect<Route.Match<Routes[number]> | undefined, RouteNavigationError> =>
  Effect.try({
    try: () => Route.match(routes, input),
    catch: (cause) =>
      new RouteNavigationError({
        input: typeof input === "string" ? input : input.href,
        cause,
      }),
  });
