import type {
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphCollectionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphRoutePreloadCollections,
  DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry
} from "./devtools-contract.js";

const copyStringArray = (values: readonly string[]): readonly string[] => [...values];

const defaultRoutePreloadCollections = (): DevtoolsStartAppGraphRoutePreloadCollections => ({
  status: "unknown",
  collections: []
});

export const normalizeRouteModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRoutePreloadCollections => {
  const preloadCollections =
    (routeModule as { readonly preloadCollections?: DevtoolsStartAppGraphRoutePreloadCollections })
      .preloadCollections ?? defaultRoutePreloadCollections();
  return {
    status: preloadCollections.status,
    collections: [...preloadCollections.collections]
  };
};

const copyAppGraphSchemaCoverage = (
  coverage: DevtoolsStartAppGraphDiagnostics["schemaCoverage"]["serverFunctions"]
): DevtoolsStartAppGraphDiagnostics["schemaCoverage"]["serverFunctions"] => ({
  total: coverage.total,
  input: coverage.input,
  output: coverage.output,
  error: coverage.error
});

const copyAppGraphWireDiagnostics = (
  wire: DevtoolsStartAppGraphActionDiagnostics["wire"]
): DevtoolsStartAppGraphActionDiagnostics["wire"] => ({
  inputSchema: wire.inputSchema,
  outputSchema: wire.outputSchema,
  errorSchema: wire.errorSchema,
  complete: wire.complete,
  missing: [...wire.missing]
});

const normalizeAppGraphRouteModule = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRouteModuleDiagnostics => ({
  routeId: routeModule.routeId,
  routePath: routeModule.routePath,
  moduleId: routeModule.moduleId,
  filePath: routeModule.filePath,
  pathParamCount: routeModule.pathParamCount,
  hasPathParams: routeModule.hasPathParams,
  params: routeModule.params.map((param) => ({
    name: param.name,
    optional: param.optional
  })),
  paramsSchema: routeModule.paramsSchema,
  searchSchema: routeModule.searchSchema,
  preload: routeModule.preload,
  preloadResources: {
    status: routeModule.preloadResources.status,
    families: [...routeModule.preloadResources.families]
  },
  preloadCollections: normalizeRouteModulePreloadCollections(routeModule),
  component: routeModule.component
});

const copyAppGraphServerFunction = (
  serverFunction: DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number]
): DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number] => ({
  id: serverFunction.id,
  name: serverFunction.name,
  server: { ...serverFunction.server },
  client: { ...serverFunction.client },
  wire: copyAppGraphWireDiagnostics(serverFunction.wire)
});

const copyAppGraphAction = (
  action: DevtoolsStartAppGraphActionDiagnostics
): DevtoolsStartAppGraphActionDiagnostics => ({
  id: action.id,
  name: action.name,
  server: { ...action.server },
  client: { ...action.client },
  wire: copyAppGraphWireDiagnostics(action.wire),
  behavior: { ...action.behavior }
});

const copyAppGraphResourceFamily = (
  family: DevtoolsStartAppGraphDiagnostics["resourceFamilies"][number]
): DevtoolsStartAppGraphDiagnostics["resourceFamilies"][number] => ({
  name: family.name,
  inputSchema: family.inputSchema,
  outputSchema: family.outputSchema,
  errorSchema: family.errorSchema,
  providesTags: family.providesTags,
  policy: {
    ...(family.policy.staleFor === undefined ? {} : { staleFor: family.policy.staleFor }),
    ...(family.policy.gcFor === undefined ? {} : { gcFor: family.policy.gcFor }),
    retry: family.policy.retry
  }
});

const normalizeAppGraphCollection = (
  collection: DevtoolsStartAppGraphCollectionDiagnostics
): DevtoolsStartAppGraphCollectionDiagnostics => ({
  name: collection.name,
  readOnly: collection.readOnly === true,
  inputSchema: collection.inputSchema,
  outputSchema: collection.outputSchema,
  initialData: collection.initialData,
  ...(collection.indexes === undefined
    ? {}
    : {
        indexes: collection.indexes.map((index) => ({
          name: index.name,
          unique: index.unique
        }))
      }),
  load: collection.load,
  handlers: { ...collection.handlers },
  policy: { ...collection.policy },
  ...(collection.sync === undefined ? {} : { sync: { ...collection.sync } }),
  persistence: { ...collection.persistence }
});

export const normalizeAppGraphCollectionDefinitions = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphCollectionDiagnostics[] =>
  ((appGraph as {
    readonly collectionDefinitions?: readonly DevtoolsStartAppGraphCollectionDiagnostics[];
  }).collectionDefinitions ?? []).map(normalizeAppGraphCollection);

export const normalizeAppGraphUnknownRoutePreloadCollections = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  ((appGraph as {
    readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
  }).unknownRoutePreloadCollections ?? []).map((entry) => ({
    kind: entry.kind,
    routeId: entry.routeId,
    routePath: entry.routePath,
    moduleId: entry.moduleId,
    filePath: entry.filePath,
    preload: entry.preload,
    preloadCollections: {
      status: entry.preloadCollections.status,
      collections: [...entry.preloadCollections.collections]
    }
  }));

/** Normalizes legacy Start app graph diagnostics and returns a detached structured copy. */
export const normalizeDevtoolsAppGraphDiagnostics = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): DevtoolsStartAppGraphDiagnostics => ({
  version: appGraph.version,
  routeCount: appGraph.routeCount,
  serverFunctionCount: appGraph.serverFunctionCount,
  actionCount: appGraph.actionCount,
  routePaths: copyStringArray(appGraph.routePaths),
  routeModules: appGraph.routeModules.map(normalizeAppGraphRouteModule),
  serverFunctionModules: appGraph.serverFunctionModules.map(copyAppGraphServerFunction),
  actionModules: appGraph.actionModules.map(copyAppGraphAction),
  resourceFamilies: appGraph.resourceFamilies.map(copyAppGraphResourceFamily),
  resourceTags: appGraph.resourceTags.map((tag) => ({
    name: tag.name,
    keyed: tag.keyed
  })),
  collectionDefinitions: normalizeAppGraphCollectionDefinitions(appGraph),
  serverOnlyModules: copyStringArray(appGraph.serverOnlyModules),
  browserClientModules: copyStringArray(appGraph.browserClientModules),
  rpcPath: appGraph.rpcPath,
  actionPath: appGraph.actionPath,
  schemaCoverage: {
    serverFunctions: copyAppGraphSchemaCoverage(appGraph.schemaCoverage.serverFunctions),
    actions: copyAppGraphSchemaCoverage(appGraph.schemaCoverage.actions)
  },
  missingSchemas: appGraph.missingSchemas.map((missingSchema) => ({ ...missingSchema })),
  unknownActionBehavior: appGraph.unknownActionBehavior.map((entry) => ({ ...entry })),
  unknownRoutePreloadResources: appGraph.unknownRoutePreloadResources.map((entry) => ({
    kind: entry.kind,
    routeId: entry.routeId,
    routePath: entry.routePath,
    moduleId: entry.moduleId,
    filePath: entry.filePath,
    preload: entry.preload,
    preloadResources: {
      status: entry.preloadResources.status,
      families: [...entry.preloadResources.families]
    }
  })),
  unknownRoutePreloadCollections: normalizeAppGraphUnknownRoutePreloadCollections(appGraph)
});
