import type {
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphMissingSchema,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry,
} from "./devtools-contract.js";

const copyStringArray = (values: readonly string[]): readonly string[] => [...values];

const missingWireSchemas = (
  wire: Pick<
    DevtoolsStartAppGraphActionDiagnostics["wire"],
    "inputSchema" | "outputSchema" | "errorSchema"
  >,
): readonly ("input" | "output" | "error")[] => [
  ...(wire.inputSchema ? ([] as const) : (["input"] as const)),
  ...(wire.outputSchema ? ([] as const) : (["output"] as const)),
  ...(wire.errorSchema ? ([] as const) : (["error"] as const)),
];

const copyAppGraphSchemaCoverage = (
  modules: readonly {
    readonly wire: DevtoolsStartAppGraphActionDiagnostics["wire"];
  }[],
): DevtoolsStartAppGraphDiagnostics["schemaCoverage"]["serverFunctions"] => ({
  total: modules.length,
  input: modules.filter((module) => module.wire.inputSchema).length,
  output: modules.filter((module) => module.wire.outputSchema).length,
  error: modules.filter((module) => module.wire.errorSchema).length,
});

const copyAppGraphWireDiagnostics = (
  wire: DevtoolsStartAppGraphActionDiagnostics["wire"],
): DevtoolsStartAppGraphActionDiagnostics["wire"] => {
  const missing = missingWireSchemas(wire);
  return {
    inputSchema: wire.inputSchema,
    outputSchema: wire.outputSchema,
    errorSchema: wire.errorSchema,
    complete: missing.length === 0,
    missing,
  };
};

const normalizeAppGraphRouteModule = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics,
): DevtoolsStartAppGraphRouteModuleDiagnostics => {
  const params = routeModule.params.map((param) => ({
    name: param.name,
    optional: param.optional,
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
      families: [...routeModule.preloadResources.families],
    },
  };
};

const copyAppGraphServerFunction = (
  serverFunction: DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number],
): DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number] => ({
  id: serverFunction.id,
  name: serverFunction.name,
  server: { ...serverFunction.server },
  client: { ...serverFunction.client },
  wire: copyAppGraphWireDiagnostics(serverFunction.wire),
});

const copyAppGraphAction = (
  action: DevtoolsStartAppGraphActionDiagnostics,
): DevtoolsStartAppGraphActionDiagnostics => ({
  id: action.id,
  name: action.name,
  server: { ...action.server },
  client: { ...action.client },
  wire: copyAppGraphWireDiagnostics(action.wire),
  behavior: { ...action.behavior },
});

const copyAppGraphResourceFamily = (
  family: DevtoolsStartAppGraphDiagnostics["resourceFamilies"][number],
): DevtoolsStartAppGraphDiagnostics["resourceFamilies"][number] => ({
  name: family.name,
  inputSchema: family.inputSchema,
  outputSchema: family.outputSchema,
  errorSchema: family.errorSchema,
  providesTags: family.providesTags,
  policy: {
    ...(family.policy.staleFor === undefined ? {} : { staleFor: family.policy.staleFor }),
    ...(family.policy.gcFor === undefined ? {} : { gcFor: family.policy.gcFor }),
    retry: family.policy.retry,
  },
});

const normalizeAppGraphUnknownRoutePreloadResources = (
  appGraph: DevtoolsStartAppGraphDiagnostics,
): readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[] =>
  appGraph.routeModules
    .filter(
      (routeModule) =>
        routeModule.preload === "present" && routeModule.preloadResources.status === "unknown",
    )
    .map((routeModule) => ({
      kind: "route" as const,
      routeId: routeModule.routeId,
      routePath: routeModule.routePath,
      moduleId: routeModule.moduleId,
      filePath: routeModule.filePath,
      preload: routeModule.preload,
      preloadResources: {
        status: routeModule.preloadResources.status,
        families: [...routeModule.preloadResources.families],
      },
    }));

const missingSchemasForModules = (
  serverFunctions: readonly DevtoolsStartAppGraphDiagnostics["serverFunctionModules"][number][],
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[],
): readonly DevtoolsStartAppGraphMissingSchema[] => [
  ...serverFunctions.flatMap((serverFunction): readonly DevtoolsStartAppGraphMissingSchema[] =>
    serverFunction.wire.complete
      ? []
      : [
          {
            kind: "serverFunction" as const,
            name: serverFunction.name,
            input: serverFunction.wire.inputSchema,
            output: serverFunction.wire.outputSchema,
            error: serverFunction.wire.errorSchema,
          },
        ],
  ),
  ...actions.flatMap((action): readonly DevtoolsStartAppGraphMissingSchema[] =>
    action.wire.complete
      ? []
      : [
          {
            kind: "action" as const,
            name: action.name,
            input: action.wire.inputSchema,
            output: action.wire.outputSchema,
            error: action.wire.errorSchema,
          },
        ],
  ),
];

/**
 * Options for normalizing Start app-graph diagnostics into the Devtools DTO.
 *
 * The normalizer is the Adapter seam between Start's emitted facts and stored
 * Devtools snapshots. Fresh DTOs should derive route preload facts from source
 * fields; stored snapshots may opt into preserving already-derived fields.
 */
export interface NormalizeDevtoolsAppGraphDiagnosticsOptions {
  /**
   * Preserves already-normalized derived preload facts when copying a stored
   * snapshot. Fresh Start DTOs should leave this false so stale derived arrays
   * are recomputed from route module source facts.
   */
  readonly preserveDerivedPreloadFacts?: boolean;
}

/** Normalizes legacy Start app graph diagnostics and returns a detached structured copy. */
export const normalizeDevtoolsAppGraphDiagnostics = (
  appGraph: DevtoolsStartAppGraphDiagnostics,
  options: NormalizeDevtoolsAppGraphDiagnosticsOptions = {},
): DevtoolsStartAppGraphDiagnostics => {
  const routeModules = appGraph.routeModules.map(normalizeAppGraphRouteModule);
  const serverFunctionModules = appGraph.serverFunctionModules.map(copyAppGraphServerFunction);
  const actionModules = appGraph.actionModules.map(copyAppGraphAction);
  const suppliedUnknownRoutePreloadResources =
    (
      appGraph as {
        readonly unknownRoutePreloadResources?: readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[];
      }
    ).unknownRoutePreloadResources ?? [];
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
      keyed: tag.keyed,
    })),
    serverOnlyModules: copyStringArray(appGraph.serverOnlyModules),
    browserClientModules: copyStringArray(appGraph.browserClientModules),
    rpcPath: appGraph.rpcPath,
    actionPath: appGraph.actionPath,
    schemaCoverage: {
      serverFunctions: copyAppGraphSchemaCoverage(serverFunctionModules),
      actions: copyAppGraphSchemaCoverage(actionModules),
    },
    missingSchemas: missingSchemasForModules(serverFunctionModules, actionModules),
    unknownRoutePreloadResources: suppliedUnknownRoutePreloadResources,
  };

  return {
    ...normalizedAppGraph,
    unknownRoutePreloadResources: options.preserveDerivedPreloadFacts
      ? suppliedUnknownRoutePreloadResources.map((entry) => ({
          kind: "route" as const,
          routeId: entry.routeId,
          routePath: entry.routePath,
          moduleId: entry.moduleId,
          filePath: entry.filePath,
          preload: entry.preload,
          preloadResources: {
            status: entry.preloadResources.status,
            families: [...entry.preloadResources.families],
          },
        }))
      : normalizeAppGraphUnknownRoutePreloadResources(normalizedAppGraph),
  };
};
