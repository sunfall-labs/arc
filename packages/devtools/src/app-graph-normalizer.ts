import type {
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphCollectionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphMissingSchema,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphRoutePreloadCollections,
  DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry,
  DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry
} from "./devtools-contract.js";

const copyStringArray = (values: readonly string[]): readonly string[] => [...values];

const missingWireSchemas = (
  wire: Pick<DevtoolsStartAppGraphActionDiagnostics["wire"], "inputSchema" | "outputSchema" | "errorSchema">
): readonly ("input" | "output" | "error")[] => [
  ...(wire.inputSchema ? [] as const : ["input"] as const),
  ...(wire.outputSchema ? [] as const : ["output"] as const),
  ...(wire.errorSchema ? [] as const : ["error"] as const)
];

const defaultRoutePreloadCollections = (): DevtoolsStartAppGraphRoutePreloadCollections => ({
  status: "unknown",
  collections: []
});

const hasRouteModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): boolean =>
  Object.prototype.hasOwnProperty.call(routeModule, "preloadCollections");

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
  modules: readonly {
    readonly wire: DevtoolsStartAppGraphActionDiagnostics["wire"];
  }[]
): DevtoolsStartAppGraphDiagnostics["schemaCoverage"]["serverFunctions"] => ({
  total: modules.length,
  input: modules.filter((module) => module.wire.inputSchema).length,
  output: modules.filter((module) => module.wire.outputSchema).length,
  error: modules.filter((module) => module.wire.errorSchema).length
});

const copyAppGraphWireDiagnostics = (
  wire: DevtoolsStartAppGraphActionDiagnostics["wire"]
): DevtoolsStartAppGraphActionDiagnostics["wire"] => {
  const missing = missingWireSchemas(wire);
  return {
    inputSchema: wire.inputSchema,
    outputSchema: wire.outputSchema,
    errorSchema: wire.errorSchema,
    complete: missing.length === 0,
    missing
  };
};

const normalizeAppGraphRouteModule = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRouteModuleDiagnostics => {
  const params = routeModule.params.map((param) => ({
    name: param.name,
    optional: param.optional
  }));

  return {
    routeId: routeModule.routeId,
    routePath: routeModule.routePath,
    moduleId: routeModule.moduleId,
    filePath: routeModule.filePath,
    pathParamCount: params.length,
    hasPathParams: params.length > 0,
    params,
    paramsSchema: routeModule.paramsSchema,
    searchSchema: routeModule.searchSchema,
    preload: routeModule.preload,
    preloadResources: {
      status: routeModule.preloadResources.status,
      families: [...routeModule.preloadResources.families]
    },
    preloadCollections: normalizeRouteModulePreloadCollections(routeModule),
    component: routeModule.component
  };
};

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
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] => {
  const supplied = (appGraph as {
    readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
  }).unknownRoutePreloadCollections ?? [];
  return supplied.length === 0
    ? []
    : appGraph.routeModules
        .filter((routeModule) =>
          hasRouteModulePreloadCollections(routeModule) &&
          routeModule.preloadCollections.status === "unknown"
        )
        .map((routeModule) => ({
          kind: "route" as const,
          routeId: routeModule.routeId,
          routePath: routeModule.routePath,
          moduleId: routeModule.moduleId,
          filePath: routeModule.filePath,
          preload: routeModule.preload,
          preloadCollections: {
            status: routeModule.preloadCollections.status,
            collections: [...routeModule.preloadCollections.collections]
          }
        }));
};

const normalizeAppGraphUnknownRoutePreloadResources = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[] =>
  appGraph.routeModules
    .filter((routeModule) => routeModule.preloadResources.status === "unknown")
    .map((routeModule) => ({
      kind: "route" as const,
      routeId: routeModule.routeId,
      routePath: routeModule.routePath,
      moduleId: routeModule.moduleId,
      filePath: routeModule.filePath,
      preload: routeModule.preload,
      preloadResources: {
        status: routeModule.preloadResources.status,
        families: [...routeModule.preloadResources.families]
      }
    }));

const missingSchemasForModules = (
  serverFunctions: readonly DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number][],
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[]
): readonly DevtoolsStartAppGraphMissingSchema[] => [
  ...serverFunctions.flatMap((serverFunction): readonly DevtoolsStartAppGraphMissingSchema[] =>
    serverFunction.wire.complete
      ? []
      : [{
          kind: "serverFunction" as const,
          name: serverFunction.name,
          input: serverFunction.wire.inputSchema,
          output: serverFunction.wire.outputSchema,
          error: serverFunction.wire.errorSchema
        }]
  ),
  ...actions.flatMap((action): readonly DevtoolsStartAppGraphMissingSchema[] =>
    action.wire.complete
      ? []
      : [{
          kind: "action" as const,
          name: action.name,
          input: action.wire.inputSchema,
          output: action.wire.outputSchema,
          error: action.wire.errorSchema
        }]
  )
];

/** Normalizes legacy Start app graph diagnostics and returns a detached structured copy. */
export const normalizeDevtoolsAppGraphDiagnostics = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): DevtoolsStartAppGraphDiagnostics => {
  const routeModules = appGraph.routeModules.map(normalizeAppGraphRouteModule);
  const serverFunctionModules = appGraph.serverFunctionModules.map(copyAppGraphServerFunction);
  const actionModules = appGraph.actionModules.map(copyAppGraphAction);
  const suppliedUnknownRoutePreloadCollections = (appGraph as {
    readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
  }).unknownRoutePreloadCollections ?? [];
  const normalizedAppGraph = {
    version: appGraph.version,
    routeCount: routeModules.length,
    serverFunctionCount: serverFunctionModules.length,
    actionCount: actionModules.length,
    routePaths: copyStringArray(appGraph.routePaths),
    routeModules,
    serverFunctionModules,
    actionModules,
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
      serverFunctions: copyAppGraphSchemaCoverage(serverFunctionModules),
      actions: copyAppGraphSchemaCoverage(actionModules)
    },
    missingSchemas: missingSchemasForModules(serverFunctionModules, actionModules),
    unknownActionBehavior: appGraph.unknownActionBehavior.map((entry) => ({ ...entry })),
    unknownRoutePreloadResources: [] as readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[],
    unknownRoutePreloadCollections: suppliedUnknownRoutePreloadCollections
  };

  return {
    ...normalizedAppGraph,
    unknownRoutePreloadResources: normalizeAppGraphUnknownRoutePreloadResources(normalizedAppGraph),
    unknownRoutePreloadCollections: normalizeAppGraphUnknownRoutePreloadCollections(normalizedAppGraph)
  };
};
