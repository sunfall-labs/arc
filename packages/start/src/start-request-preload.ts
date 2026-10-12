import {
  Route,
  makeResponseContext,
  runWithRuntime,
  type AnySunfallArcRuntime,
  type RoutePreloadFailureSnapshot,
  type SunfallArcRuntime,
  type ResourceHydrationPayload,
  type ResponseContext,
} from "@sunfall/arc-core";
import { eraseRuntime, matchRoutesEffect } from "@sunfall/arc-core/internal";
import type { Collection } from "@sunfall/arc-db";
import {
  collectCollectionsEffect,
  dehydrateCollectionsEffect,
  isCollection,
} from "@sunfall/arc-db/internal";
import { Data, Effect } from "effect";
import type { StartServerApp } from "./start-server-app.js";
import { AsyncResult } from "effect/reactivity";
import {
  createStartHydrationPayload,
  type PreloadRequestOptions,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload,
} from "./hydration.js";
import {
  makeStartCollectionResolution,
  startCollectionArray,
  uniqueStartCollectionsEffect,
  validateStartCollectionResolutionOptionsEffect,
  type StartCollectionDuplicateName,
} from "./start-collection-resolution.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";

/**
 * Data Start prepares before rendering a request: the matched route, route
 * preload plan, resource payloads, collection payloads, and final hydration
 * payload for the client.
 */
export interface StartPreloadResult<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[] =
    readonly Route.Definition<string, unknown, unknown, any>[],
> {
  readonly match: Route.Match<Routes[number]> | undefined;
  readonly resources: ResourceHydrationPayload;
  readonly collections: Collection.HydrationPayload;
  readonly collectionPreload: StartCollectionPreload;
  readonly hydration: StartHydrationPayload;
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
  /**
   * Set when the request handler renders a failed route preload. The request still renders:
   * routers on the request runtime start in this `Failure` state (the outlet's
   * failure view), and the hydration payload hands it to the client.
   */
  readonly routeFailure?: RoutePreloadFailureSnapshot;
}

/**
 * Collection preload details collected while planning a request.
 *
 * Use this when diagnostics or render code needs to distinguish collections
 * touched by route preload from collections explicitly registered for hydration.
 */
export interface StartCollectionPreload {
  readonly routeTouchedCollections: ReadonlyArray<Collection.Any>;
  readonly routeDeclaredCollections: ReadonlyArray<Collection.Any>;
  readonly registeredCollections: ReadonlyArray<Collection.Any>;
  readonly dehydratedCollections: ReadonlyArray<Collection.Any>;
  readonly hydration: Collection.HydrationPayload;
}

/** Error raised while planning a Start request preload or hydration payload. */
export class StartPreloadError extends Data.TaggedError("StartPreloadError")<{
  readonly operation:
    | "route-navigation"
    | "declared-collection-resolution"
    | "declared-collection-preload"
    | "collection-hydration"
    | "preload-request";
  readonly request?: {
    readonly method: string;
    readonly url: string;
  };
  readonly collectionName?: string;
  readonly cause: unknown;
}> {}

interface DeclaredCollectionResolutionCause {
  readonly _tag: "DeclaredCollectionResolutionCause";
  readonly message: string;
  readonly collectionName: string;
}

const requestPreloadContext = (request: Request): NonNullable<StartPreloadError["request"]> => ({
  method: request.method,
  url: request.url,
});

const preloadError = (
  operation: StartPreloadError["operation"],
  cause: unknown,
  options: {
    readonly request?: Request;
    readonly collectionName?: string;
  } = {},
): StartPreloadError =>
  cause instanceof StartPreloadError
    ? cause
    : new StartPreloadError({
        operation,
        ...(options.request === undefined
          ? {}
          : { request: requestPreloadContext(options.request) }),
        ...(options.collectionName === undefined ? {} : { collectionName: options.collectionName }),
        cause,
      });

const emptyCollectionHydrationPayload: Collection.HydrationPayload = { collections: [] };

const unresolvedRouteDeclaredCollection = (name: string): StartPreloadError =>
  preloadError(
    "declared-collection-resolution",
    {
      _tag: "DeclaredCollectionResolutionCause",
      message: `Route declared collection "${name}" by name, but no matching collection was supplied in request collections, collectionRegistry, or resolveCollection.`,
      collectionName: name,
    } satisfies DeclaredCollectionResolutionCause,
    { collectionName: name },
  );

const duplicateRouteCollection = (cause: StartCollectionDuplicateName): StartPreloadError =>
  preloadError(
    cause.source === "hydration" ? "collection-hydration" : "declared-collection-resolution",
    cause,
    { collectionName: cause.name },
  );

const routeDeclaredCollectionsEffect = (
  routePlan: Route.NavigationPlan,
  options: PreloadRequestOptions = {},
): Effect.Effect<ReadonlyArray<Collection.Any>, StartPreloadError> => {
  if (routePlan._tag !== "Matched") {
    return Effect.succeed([]);
  }

  const { resolve: resolveCollection } = makeStartCollectionResolution(options);
  const declaredCollections = routePlan.match.route.options.preloadCollections ?? [];

  return Effect.gen(function* () {
    yield* validateStartCollectionResolutionOptionsEffect(options).pipe(
      Effect.mapError(duplicateRouteCollection),
    );
    const resolved: Array<Collection.Any> = [];
    for (const input of declaredCollections) {
      if (isCollection(input)) {
        resolved.push(input);
        continue;
      }

      const name = typeof input === "string" ? input : input.name;
      if (typeof name !== "string") {
        continue;
      }

      const collection = resolveCollection(name);
      if (collection === undefined) {
        return yield* Effect.fail(unresolvedRouteDeclaredCollection(name));
      }

      resolved.push(collection);
    }

    return yield* uniqueStartCollectionsEffect(resolved, "route-preload").pipe(
      Effect.mapError(duplicateRouteCollection),
    );
  });
};

type StartPreloadRequirements<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
> = RequestRuntimeRemainingRequirements<Route.PreloadRequirements<Routes[number]>, ServerServices>;

const preloadRouteDeclaredCollectionsEffect = (
  routeDeclaredCollections: ReadonlyArray<Collection.Any>,
  routeTouchedCollections: ReadonlyArray<Collection.Any>,
): Effect.Effect<void, StartPreloadError> =>
  Effect.gen(function* () {
    const touchedNames = new Set(routeTouchedCollections.map((collection) => collection.name));
    for (const collection of routeDeclaredCollections) {
      if (!touchedNames.has(collection.name)) {
        yield* collection.preload().pipe(
          Effect.mapError((cause) =>
            preloadError("declared-collection-preload", cause, {
              collectionName: collection.name,
            }),
          ),
        );
      }
    }
  }) as Effect.Effect<void, StartPreloadError>;

/**
 * The client restores a hydrated collection snapshot as a completed load, so
 * the payload carries only writable collections whose state this request
 * knows: loaded, or holding rows it wrote. A collection the request
 * never loaded (or failed to load) stays out of the payload: the server
 * rendered it as not-yet-loaded, and so does the client, which loads it itself.
 */
const startCollectionCanHydrate = (
  runtime: AnySunfallArcRuntime<unknown>,
  collection: Collection.Any,
): boolean =>
  collection.readOnly !== true &&
  runWithRuntime(
    runtime,
    () => AsyncResult.isSuccess(collection.result().get()) || collection.rows().length > 0,
  );

const startCollectionPreloadEffect = (
  runtime: AnySunfallArcRuntime<unknown>,
  routeTouchedCollections: ReadonlyArray<Collection.Any>,
  routeDeclaredCollections: ReadonlyArray<Collection.Any>,
  options: StartCollectionHydrationOptions = {},
): Effect.Effect<StartCollectionPreload, StartPreloadError> =>
  Effect.gen(function* () {
    const registeredCollections = yield* uniqueStartCollectionsEffect(
      startCollectionArray(options.collections),
      "collections",
    ).pipe(Effect.mapError(duplicateRouteCollection));
    const dehydratedCollections = yield* uniqueStartCollectionsEffect(
      [...registeredCollections, ...routeDeclaredCollections, ...routeTouchedCollections].filter(
        (collection) => startCollectionCanHydrate(runtime, collection),
      ),
      "hydration",
    ).pipe(Effect.mapError(duplicateRouteCollection));
    const hydration =
      dehydratedCollections.length > 0
        ? yield* dehydrateCollectionsEffect(dehydratedCollections).pipe(
            Effect.mapError((cause) => preloadError("collection-hydration", cause)),
          )
        : emptyCollectionHydrationPayload;

    return {
      routeTouchedCollections,
      routeDeclaredCollections,
      registeredCollections,
      dehydratedCollections,
      hydration,
    };
  }) as Effect.Effect<StartCollectionPreload, StartPreloadError>;

interface StartRoutePlanOutcome<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
> {
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
  readonly routeFailure?: RoutePreloadFailureSnapshot;
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
  Route.NavigationError<Routes[number]>,
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
            const match = yield* matchRoutesEffect(routes, url);
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
  options: PreloadRequestOptions = {},
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
        const collectedRoutePlan = yield* collectCollectionsEffect(
          startRoutePlanEffect(app.routes, new URL(request.url), routePreloadFailure),
        ).pipe(Effect.mapError((cause) => preloadError("route-navigation", cause, { request })));
        const { routePlan, routeFailure } = collectedRoutePlan.value;
        const declaredCollections = yield* routeDeclaredCollectionsEffect(routePlan, options);
        yield* preloadRouteDeclaredCollectionsEffect(
          declaredCollections,
          collectedRoutePlan.definitions,
        );
        const collectionPreload = yield* startCollectionPreloadEffect(
          eraseRuntime(runtime),
          collectedRoutePlan.definitions,
          declaredCollections,
          options,
        );
        const collections = collectionPreload.hydration;
        const hydration = createStartHydrationPayload(
          routePlan.resources,
          collections,
          routeFailure,
        );
        return {
          match: routePlan.match,
          resources: routePlan.resources,
          collections,
          collectionPreload,
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
 * Matches a request URL and preloads route resources and collections.
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
  options: PreloadRequestOptions = {},
): Effect.Effect<
  StartPreloadResult<Routes>,
  StartPreloadError,
  StartPreloadRequirements<Routes, ServerServices>
> => {
  const runtime = makeRequestRuntime(app);
  return Effect.ensuring(
    preloadRequestEffectWithRuntime(app, request, runtime, options),
    runtime.dispose.pipe(Effect.catchCause(() => Effect.void)),
  );
};
