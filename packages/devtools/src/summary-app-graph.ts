import type {
  DevtoolsStartAppGraphActionBehaviorPresence,
  DevtoolsStartAppGraphActionConcurrency,
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphCollectionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphRoutePreloadCollections,
  DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry,
  DevtoolsSummary,
} from "./devtools-contract.js";
import {
  normalizeAppGraphCollectionDefinitions,
  normalizeAppGraphUnknownRoutePreloadCollections,
  normalizeDevtoolsAppGraphDiagnostics,
  normalizeRouteModulePreloadCollections,
} from "./app-graph-normalizer.js";
import type { NormalizeDevtoolsAppGraphDiagnosticsOptions } from "./app-graph-normalizer.js";

const valueCounts = <Value extends string>(
  values: Iterable<Value>,
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
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[],
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
  concurrency: valueCounts(actions.map((action) => action.behavior.concurrency)),
});

export const appGraphCollectionDefinitions = (
  appGraph: DevtoolsStartAppGraphDiagnostics,
): readonly DevtoolsStartAppGraphCollectionDiagnostics[] =>
  normalizeAppGraphCollectionDefinitions(appGraph);

export const appGraphUnknownRoutePreloadCollections = (
  appGraph: DevtoolsStartAppGraphDiagnostics,
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  (
    appGraph as {
      readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
    }
  ).unknownRoutePreloadCollections?.map((entry) => ({
    kind: "route" as const,
    routeId: entry.routeId,
    routePath: entry.routePath,
    moduleId: entry.moduleId,
    filePath: entry.filePath,
    preload: entry.preload,
    preloadCollections: {
      status: entry.preloadCollections.status,
      collections: [...entry.preloadCollections.collections],
    },
  })) ?? normalizeAppGraphUnknownRoutePreloadCollections(appGraph);

export const routeModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics,
): DevtoolsStartAppGraphRoutePreloadCollections =>
  normalizeRouteModulePreloadCollections(routeModule);

export const graphSummary = (
  appGraph: DevtoolsStartAppGraphDiagnostics | undefined,
  options: NormalizeDevtoolsAppGraphDiagnosticsOptions = {},
): DevtoolsSummary["graph"] => {
  if (!appGraph) {
    return {
      _tag: "Unavailable",
    };
  }

  const detached = normalizeDevtoolsAppGraphDiagnostics(appGraph, options);
  const collections = appGraphCollectionDefinitions(detached);

  return {
    _tag: "Available",
    routes: {
      count: detached.routeCount,
      paths: [...detached.routePaths],
      modules: detached.routeModules.map((routeModule) => ({ ...routeModule })),
      unknownPreloadResources: detached.unknownRoutePreloadResources.map((entry) => ({ ...entry })),
      unknownPreloadCollections: appGraphUnknownRoutePreloadCollections(detached).map((entry) => ({
        ...entry,
      })),
    },
    serverFunctions: {
      count: detached.serverFunctionCount,
      schemaCoverage: { ...detached.schemaCoverage.serverFunctions },
      modules: detached.serverFunctionModules.map((serverFunction) => ({ ...serverFunction })),
    },
    actions: {
      count: detached.actionCount,
      schemaCoverage: { ...detached.schemaCoverage.actions },
      modules: detached.actionModules.map((action) => ({ ...action })),
      behavior: actionBehaviorSummary(detached.actionModules),
      unknownBehavior: detached.unknownActionBehavior.map((entry) => ({ ...entry })),
    },
    resources: {
      familyCount: detached.resourceFamilies.length,
      tagCount: detached.resourceTags.length,
      families: detached.resourceFamilies.map((family) => ({
        ...family,
        policy: { ...family.policy },
      })),
      tags: detached.resourceTags.map((tag) => ({ ...tag })),
    },
    collections: {
      definitionCount: collections.length,
      definitions: collections.map((collection) => ({
        ...collection,
        indexes: [...(collection.indexes ?? [])],
        handlers: { ...collection.handlers },
        policy: { ...collection.policy },
        ...(collection.sync === undefined ? {} : { sync: { ...collection.sync } }),
        persistence: { ...collection.persistence },
      })),
    },
    endpoints: {
      rpc: detached.rpcPath,
      action: detached.actionPath,
    },
    modules: {
      serverOnly: [...detached.serverOnlyModules],
      browserClient: [...detached.browserClientModules],
    },
    missingSchemas: detached.missingSchemas.map((missingSchema) => ({ ...missingSchema })),
  };
};
