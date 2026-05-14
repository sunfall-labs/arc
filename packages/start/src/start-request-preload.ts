import {
  Route,
  makeResponseContext,
  type AppDefinition,
  type EffectUiRuntime,
  type ResourceHydrationPayload,
  type ResponseContext
} from "@effect-ui/core";
import { Collection, type AnyCollection, type CollectionHydrationPayload } from "@effect-ui/db";
import { Effect } from "effect";
import {
  createStartHydrationPayload,
  type PreloadRequestOptions,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";
import {
  makeRequestRuntime,
  provideRequestRuntime
} from "./request-runtime.js";

/**
 * Data Start prepares before rendering a request: the matched route, route
 * preload plan, resource payloads, collection payloads, and final hydration
 * payload for the client.
 */
export interface StartPreloadResult<
  Routes extends readonly Route.Definition<string, unknown, unknown>[] = readonly Route.Definition<string, unknown, unknown>[]
> {
  readonly match: Route.Match<Routes[number]> | undefined;
  readonly resources: ResourceHydrationPayload;
  readonly collections: CollectionHydrationPayload;
  readonly collectionPreload: StartCollectionPreload;
  readonly hydration: StartHydrationPayload;
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
}

/**
 * Collection preload details collected while planning a request.
 *
 * Use this when diagnostics or render code needs to distinguish collections
 * touched by route preload from collections explicitly registered for hydration.
 */
export interface StartCollectionPreload {
  readonly routeTouchedCollections: ReadonlyArray<AnyCollection>;
  readonly routeDeclaredCollections: ReadonlyArray<AnyCollection>;
  readonly registeredCollections: ReadonlyArray<AnyCollection>;
  readonly dehydratedCollections: ReadonlyArray<AnyCollection>;
  readonly hydration: CollectionHydrationPayload;
}

const emptyCollectionHydrationPayload: CollectionHydrationPayload = { collections: [] };

const collectionArray = (
  collections: Iterable<AnyCollection> | undefined
): ReadonlyArray<AnyCollection> =>
  collections ? Array.from(collections) : [];

const uniqueCollections = (
  collections: Iterable<AnyCollection>
): ReadonlyArray<AnyCollection> => {
  const names = new Set<string>();
  const out: Array<AnyCollection> = [];
  for (const collection of collections) {
    if (!names.has(collection.name)) {
      names.add(collection.name);
      out.push(collection);
    }
  }
  return out;
};

const routeDeclaredCollections = (
  routePlan: Route.NavigationPlan
): ReadonlyArray<AnyCollection> => {
  if (routePlan._tag !== "Matched") {
    return [];
  }

  const definitions = Collection.definitions();
  return Route.preloadCollectionNames(routePlan.match.route)
    .flatMap((name) => {
      const collection = definitions.get(name);
      return collection ? [collection] : [];
    });
};

const preloadRouteDeclaredCollectionsEffect = (
  routeDeclaredCollections: ReadonlyArray<AnyCollection>,
  routeTouchedCollections: ReadonlyArray<AnyCollection>
): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function* () {
    const touchedNames = new Set(routeTouchedCollections.map((collection) => collection.name));
    for (const collection of routeDeclaredCollections) {
      if (!touchedNames.has(collection.name)) {
        yield* collection.preloadEffect();
      }
    }
  });

const startCollectionPreloadEffect = (
  routeTouchedCollections: ReadonlyArray<AnyCollection>,
  routeDeclaredCollections: ReadonlyArray<AnyCollection>,
  options: StartCollectionHydrationOptions = {}
): Effect.Effect<StartCollectionPreload> =>
  Effect.gen(function* () {
    const registeredCollections = collectionArray(options.collections);
    const dehydratedCollections = uniqueCollections([
      ...registeredCollections,
      ...routeDeclaredCollections,
      ...routeTouchedCollections
    ]);
    const hydration = dehydratedCollections.length > 0
      ? yield* Collection.dehydrateEffect(dehydratedCollections)
      : emptyCollectionHydrationPayload;

    return {
      routeTouchedCollections,
      routeDeclaredCollections,
      registeredCollections,
      dehydratedCollections,
      hydration
    };
  });

export const preloadRequestEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  options: PreloadRequestOptions = {},
  responseContext: ResponseContext = makeResponseContext()
): Effect.Effect<StartPreloadResult<Routes>, unknown> =>
  Effect.scoped(
    provideRequestRuntime(runtime, request, Effect.gen(function* () {
      const collectedRoutePlan = yield* Collection.collectEffect(
        Route.planNavigationEffect(app.routes, new URL(request.url))
      );
      const routePlan = collectedRoutePlan.value;
      const declaredCollections = routeDeclaredCollections(routePlan);
      yield* preloadRouteDeclaredCollectionsEffect(declaredCollections, collectedRoutePlan.definitions);
      const collectionPreload = yield* startCollectionPreloadEffect(
        collectedRoutePlan.definitions,
        declaredCollections,
        options
      );
      const collections = collectionPreload.hydration;
      const hydration = createStartHydrationPayload(routePlan.resources, collections);
      return {
        match: routePlan.match,
        resources: routePlan.resources,
        collections,
        collectionPreload,
        hydration,
        routePlan
      };
    }), responseContext)
  );

/**
 * Matches a request URL and preloads route resources and collections.
 *
 * Creates a request-scoped runtime, runs route preload, builds hydration
 * payloads, then disposes the runtime when the Effect completes.
 */
export const preloadRequestEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  options: PreloadRequestOptions = {}
): Effect.Effect<StartPreloadResult<Routes>, unknown> => {
  const runtime = makeRequestRuntime(app);
  return Effect.ensuring(
    preloadRequestEffectWithRuntime(app, request, runtime, options),
    runtime.disposeEffect
  );
};

/** Alias for `preloadRequestEffect` on the current Effect-first surface. */
export const preloadRequest = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  options: PreloadRequestOptions = {}
): Effect.Effect<StartPreloadResult<Routes>, unknown> =>
  preloadRequestEffect(app, request, options);
