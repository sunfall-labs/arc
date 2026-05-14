import type {
  DevtoolsStartAppGraphActionBehaviorPresence,
  DevtoolsStartAppGraphActionConcurrency,
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphCollectionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphRoutePreloadCollections,
  DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry,
  DevtoolsSummary
} from "./index.js";

const valueCounts = <Value extends string>(
  values: Iterable<Value>
): ReadonlyArray<{ readonly state: Value; readonly count: number }> => {
  const counts = new Map<Value, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

const actionBehaviorSummary = (
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[]
): {
  readonly invalidates: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly optimistic: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly retry: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly concurrency: readonly {
    readonly state: DevtoolsStartAppGraphActionConcurrency;
    readonly count: number;
  }[];
} => ({
    invalidates: valueCounts(actions.map((action) => action.behavior.invalidates)),
    optimistic: valueCounts(actions.map((action) => action.behavior.optimistic)),
    retry: valueCounts(actions.map((action) => action.behavior.retry)),
    concurrency: valueCounts(actions.map((action) => action.behavior.concurrency))
  });

export const appGraphCollectionDefinitions = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphCollectionDiagnostics[] =>
  (appGraph as { readonly collectionDefinitions?: readonly DevtoolsStartAppGraphCollectionDiagnostics[] })
    .collectionDefinitions ?? [];

export const appGraphUnknownRoutePreloadCollections = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  (appGraph as { readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] })
    .unknownRoutePreloadCollections ?? [];

export const routeModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRoutePreloadCollections =>
  (routeModule as { readonly preloadCollections?: DevtoolsStartAppGraphRoutePreloadCollections })
    .preloadCollections ?? {
      status: "unknown",
      collections: []
    };

export const graphSummary = (
  appGraph: DevtoolsStartAppGraphDiagnostics | undefined
): DevtoolsSummary["graph"] => {
  if (!appGraph) {
    return {
      _tag: "Unavailable"
    };
  }

  const collections = appGraphCollectionDefinitions(appGraph);

  return {
    _tag: "Available",
    routes: {
      count: appGraph.routeCount,
      paths: [...appGraph.routePaths],
      modules: appGraph.routeModules.map((routeModule) => ({ ...routeModule })),
      unknownPreloadResources: appGraph.unknownRoutePreloadResources.map((entry) => ({ ...entry })),
      unknownPreloadCollections: appGraphUnknownRoutePreloadCollections(appGraph).map((entry) => ({ ...entry }))
    },
    serverFunctions: {
      count: appGraph.serverFunctionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.serverFunctions },
      modules: appGraph.serverFunctionModules.map((serverFunction) => ({ ...serverFunction }))
    },
    actions: {
      count: appGraph.actionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.actions },
      modules: appGraph.actionModules.map((action) => ({ ...action })),
      behavior: actionBehaviorSummary(appGraph.actionModules),
      unknownBehavior: appGraph.unknownActionBehavior.map((entry) => ({ ...entry }))
    },
    resources: {
      familyCount: appGraph.resourceFamilies.length,
      tagCount: appGraph.resourceTags.length,
      families: appGraph.resourceFamilies.map((family) => ({ ...family, policy: { ...family.policy } })),
      tags: appGraph.resourceTags.map((tag) => ({ ...tag }))
    },
    collections: {
      definitionCount: collections.length,
      definitions: collections.map((collection) => ({
        ...collection,
        indexes: [...(collection.indexes ?? [])],
        handlers: { ...collection.handlers },
        policy: { ...collection.policy },
        ...(collection.sync === undefined ? {} : { sync: { ...collection.sync } }),
        persistence: { ...collection.persistence }
      }))
    },
    endpoints: {
      rpc: appGraph.rpcPath,
      action: appGraph.actionPath
    },
    modules: {
      serverOnly: [...appGraph.serverOnlyModules],
      browserClient: [...appGraph.browserClientModules]
    },
    missingSchemas: appGraph.missingSchemas.map((missingSchema) => ({ ...missingSchema }))
  };
};
