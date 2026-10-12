import { Route } from "@sunfall/arc-core";
import { Effect } from "effect";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

/** Property key carrying the app routes on a Start request handler. */
const startHandlerRoutesKey: unique symbol = Symbol.for("@sunfall/arc-start/handler-routes");

/** Attaches the routes a handler renders, without changing how it is called. */
export const attachStartHandlerRoutes = <Handler extends object>(
  handler: Handler,
  routes: ReadonlyArray<AnyRoute>,
): Handler => {
  Object.defineProperty(handler, startHandlerRoutesKey, { value: routes });
  return handler;
};

const startHandlerRoutesOf = (handler: unknown): ReadonlyArray<AnyRoute> =>
  typeof handler === "function" || (typeof handler === "object" && handler !== null)
    ? ((handler as { readonly [startHandlerRoutesKey]?: ReadonlyArray<AnyRoute> })[
        startHandlerRoutesKey
      ] ?? [])
    : [];

const warnedHandlers = new WeakSet<object>();

/**
 * Dev-only: logs a warning, once per loaded handler, for each route that runs
 * a `preload` without declaring `preloadResources`. Devtools reads the
 * declared families to show what a route preloads.
 */
export const warnUndeclaredRoutePreloadResources = (handler: unknown): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (typeof handler !== "function" || warnedHandlers.has(handler)) {
      return Effect.void;
    }
    warnedHandlers.add(handler);
    const undeclared = startHandlerRoutesOf(handler).filter(
      (route) => Route.describePreloadResources(route).status === "unknown",
    );
    return Effect.forEach(
      undeclared,
      (route) =>
        Effect.logWarning(
          `[sunfall-arc-start] Route "${route.path}" has a preload but no preloadResources. Declare the Resource families it preloads.`,
        ),
      { discard: true },
    );
  });
