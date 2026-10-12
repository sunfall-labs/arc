import {
  Route,
  makeResponseContext,
  type SunfallArcRuntime,
  type ResponseContext,
  type Resource,
} from "@sunfall/arc-core";
import { matchRoutes } from "@sunfall/arc-core/internal";
import { Data, Effect } from "effect";
import type { StartServerApp } from "./start-server-app.js";
import { createStartHydrationPayload, type StartHydrationPayload } from "./hydration.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";

/**
 * Data Start prepares before rendering a request: the matched route, route
 * preload plan, resource payloads, and final hydration payload for the client.
 */
export interface StartPreloadResult<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[] =
    readonly Route.Definition<string, unknown, unknown, any>[],
> {
  readonly match: Route.Match<Routes[number]> | undefined;
  readonly resources: Resource.HydrationPayload;
  readonly hydration: StartHydrationPayload;
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
  /**
   * Set when the request handler renders a failed route preload. The request still renders:
   * routers on the request runtime start in this `Failure` state (the outlet's
   * failure view), and the hydration payload hands it to the client.
   */
  readonly routeFailure?: Route.PreloadFailureSnapshot;
}

/** Error raised while planning a Start request preload or hydration payload. */
export class StartPreloadError extends Data.TaggedError("StartPreloadError")<{
  readonly operation: "route-navigation" | "preload-request";
  readonly request?: {
    readonly method: string;
    readonly url: string;
  };
  readonly cause: unknown;
}> {}

const requestPreloadContext = (request: Request): NonNullable<StartPreloadError["request"]> => ({
  method: request.method,
  url: request.url,
});

const preloadError = (
  operation: StartPreloadError["operation"],
  cause: unknown,
  options: {
    readonly request?: Request;
  } = {},
): StartPreloadError =>
  cause instanceof StartPreloadError
    ? cause
    : new StartPreloadError({
        operation,
        ...(options.request === undefined
          ? {}
          : { request: requestPreloadContext(options.request) }),
        cause,
      });

type StartPreloadRequirements<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
> = RequestRuntimeRemainingRequirements<Route.PreloadRequirements<Routes[number]>, ServerServices>;

interface StartRoutePlanOutcome<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
> {
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
  readonly routeFailure?: Route.PreloadFailureSnapshot;
}

/**
 * How a failed route preload affects the request: `fail` fails the preload
 * (`preloadRequest`), `render` renders it (the request handler).
 */
type StartRoutePreloadFailurePolicy = "fail" | "render";

/**
 * Plans the request's route. Under the `render` policy a failed route preload
 * is a render outcome, not a request failure: the route still matched, so the
 * plan is `Matched` with no preloaded resources, and the failure is recorded
 * for the routers the request renders.
 */
const startRoutePlanEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
>(
  routes: Routes,
  url: URL,
  routePreloadFailure: StartRoutePreloadFailurePolicy,
): Effect.Effect<
  StartRoutePlanOutcome<Routes>,
  Route.NavigationPlanError<Routes[number]>,
  Route.PreloadRequirements<Routes[number]>
> => {
  const planned = Route.planNavigation(routes, url).pipe(
    Effect.map((routePlan): StartRoutePlanOutcome<Routes> => ({ routePlan })),
  );
  return routePreloadFailure === "fail"
    ? planned
    : planned.pipe(
        Effect.catchTag("RoutePreloadError", (error) =>
          Effect.gen(function* () {
            const match = yield* matchRoutes(routes, url);
            if (match === undefined) {
              return yield* Effect.fail(error);
            }
            // Encoded with the route's `error` schema (or tag-only without one);
            // the server render decodes this snapshot exactly like the client.
            const routeFailure = yield* Route.preloadFailureSnapshot(match.route, error);
            yield* Route.hydratePreloadFailure(routeFailure);
            return {
              routePlan: {
                _tag: "Matched",
                href: match.href,
                match,
                refs: [],
                resources: { resources: [] },
              },
              routeFailure,
            } satisfies StartRoutePlanOutcome<Routes>;
          }),
        ),
      );
};

export const preloadRequestEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
>(
  app: StartServerApp<Routes, ServerServices, ServerError>,
  request: Request,
  runtime: SunfallArcRuntime<ServerServices, ServerError>,
  responseContext: ResponseContext = makeResponseContext(),
  routePreloadFailure: StartRoutePreloadFailurePolicy = "fail",
): Effect.Effect<
  StartPreloadResult<Routes>,
  StartPreloadError,
  StartPreloadRequirements<Routes, ServerServices>
> =>
  Effect.scoped(
    provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const { routePlan, routeFailure } = yield* startRoutePlanEffect(
          app.routes,
          new URL(request.url),
          routePreloadFailure,
        ).pipe(Effect.mapError((cause) => preloadError("route-navigation", cause, { request })));
        // A lazy route component loads before render, so the server renders it
        // in the first pass; a failed load surfaces where the router renders it.
        if (routePlan.match !== undefined) {
          yield* Effect.ignore(Route.preloadComponent(routePlan.match));
        }
        const hydration = createStartHydrationPayload(routePlan.resources, {
          routeFailure,
          notFound: routePlan._tag === "NotFound",
        });
        return {
          match: routePlan.match,
          resources: routePlan.resources,
          hydration,
          routePlan,
          ...(routeFailure === undefined ? {} : { routeFailure }),
        };
      }),
      responseContext,
      app.registry,
    ),
  ).pipe(Effect.mapError((cause) => preloadError("preload-request", cause, { request })));

/**
 * Matches a request URL and preloads route resources.
 *
 * Creates a request-scoped runtime, runs route preload, builds hydration
 * payloads, then disposes the runtime when the Effect completes.
 */
export const preloadRequest = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
>(
  app: StartServerApp<Routes, ServerServices, ServerError>,
  request: Request,
): Effect.Effect<
  StartPreloadResult<Routes>,
  StartPreloadError,
  StartPreloadRequirements<Routes, ServerServices>
> => {
  const runtime = makeRequestRuntime(app);
  return Effect.ensuring(
    preloadRequestEffectWithRuntime(app, request, runtime),
    runtime.dispose.pipe(Effect.catchCause(() => Effect.void)),
  );
};
