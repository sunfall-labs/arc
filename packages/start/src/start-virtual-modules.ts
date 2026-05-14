import { Effect } from "effect";
import {
  describeStartAppGraph,
  serializeStartAppGraph as serializeStartAppGraphArtifact,
  type StartAppGraph
} from "./app-graph.js";
import {
  serializeActionManifest,
  type ActionManifest
} from "./action-manifest.js";
import {
  serializeFileRouteManifest,
  type FileRouteManifest
} from "./file-routes.js";
import {
  createFileRouteDefinitionsModule,
  createFileRouteModuleReferences
} from "./file-route-modules.js";
import {
  makeStartActionManifestEffect,
  makeStartBuildAppGraphEffect,
  makeStartFileRouteManifestEffect,
  makeStartServerFunctionManifestEffect,
  normalizeStartBuildPolicy,
  type EffectUiStartOptions,
  type StartAppGraphError,
  type StartBuildPolicy,
  type StartBuildPolicyError
} from "./start-manifest-wall.js";
import {
  serializeServerFunctionManifest,
  type ServerFunctionManifest
} from "./server-function-manifest.js";

export const serverFunctionManifestVirtualModuleId = "virtual:effect-ui/server-functions";
export const actionManifestVirtualModuleId = "virtual:effect-ui/actions";
export const fileRouteManifestVirtualModuleId = "virtual:effect-ui/file-routes";
export const fileRouteDefinitionsVirtualModuleId = "virtual:effect-ui/routes";
export const appGraphVirtualModuleId = "virtual:effect-ui/app-graph";

const resolvedServerFunctionManifestVirtualModuleId = `\0${serverFunctionManifestVirtualModuleId}`;
const resolvedActionManifestVirtualModuleId = `\0${actionManifestVirtualModuleId}`;
const resolvedFileRouteManifestVirtualModuleId = `\0${fileRouteManifestVirtualModuleId}`;
const resolvedFileRouteDefinitionsVirtualModuleId = `\0${fileRouteDefinitionsVirtualModuleId}`;
const resolvedAppGraphVirtualModuleId = `\0${appGraphVirtualModuleId}`;

export type StartVirtualModuleLoadError =
  | StartAppGraphError
  | StartBuildPolicyError;

export const resolveStartVirtualModuleId = (id: string): string | null => {
  switch (id) {
    case serverFunctionManifestVirtualModuleId:
      return resolvedServerFunctionManifestVirtualModuleId;
    case actionManifestVirtualModuleId:
      return resolvedActionManifestVirtualModuleId;
    case fileRouteManifestVirtualModuleId:
      return resolvedFileRouteManifestVirtualModuleId;
    case fileRouteDefinitionsVirtualModuleId:
      return resolvedFileRouteDefinitionsVirtualModuleId;
    case appGraphVirtualModuleId:
      return resolvedAppGraphVirtualModuleId;
    default:
      return null;
  }
};

/** Creates the Vite virtual module source for the file-route manifest. */
export const createFileRouteManifestVirtualModule = (
  manifest: FileRouteManifest
): string => {
  const serialized = serializeFileRouteManifest(manifest);
  return [
    `export const manifest = ${serialized};`,
    "export const entries = manifest.entries;",
    "export const modules = manifest.modules;",
    "export default manifest;"
  ].join("\n");
};

/** Creates the Vite virtual module source for server-function manifests. */
export const createServerFunctionManifestVirtualModule = (
  manifest: ServerFunctionManifest
): string => {
  const serialized = serializeServerFunctionManifest(manifest);
  return [
    `export const manifest = ${serialized};`,
    "export const entries = manifest.entries;",
    "export default manifest;"
  ].join("\n");
};

/** Creates the Vite virtual module source for Start action manifests. */
export const createActionManifestVirtualModule = (
  manifest: ActionManifest
): string => {
  const serialized = serializeActionManifest(manifest);
  return [
    `export const manifest = ${serialized};`,
    "export const entries = manifest.entries;",
    "export default manifest;"
  ].join("\n");
};

export const createFileRouteDefinitionsVirtualModule = (
  manifest: FileRouteManifest
): string => createFileRouteDefinitionsModule(manifest, { importMode: "rootAbsolute" });

const diagnosticsPolicyLiteral = (
  policy: StartBuildPolicy | undefined
): string =>
  JSON.stringify(policy?.diagnostics === undefined || policy.diagnostics === false ? null : policy.diagnostics);

/** Creates the Vite virtual module source for the resolved Start app graph. */
export const createStartAppGraphVirtualModule = (
  graph: StartAppGraph,
  policy?: StartBuildPolicy
): string => {
  const serialized = serializeStartAppGraphArtifact(graph);
  const staticDiagnostics = JSON.stringify(describeStartAppGraph(graph));
  const diagnosticsPolicy = diagnosticsPolicyLiteral(policy);
  const routeModuleReferences = createFileRouteModuleReferences(graph.routes, {
    importMode: "rootAbsolute"
  });
  const routeModuleImports = routeModuleReferences.map((reference) =>
    `import { ${reference.importName} as ${reference.identifier} } from ${JSON.stringify(reference.importSpecifier)};`
  );
  const routeModuleDiagnostics = routeModuleReferences.map(({ entry, identifier }) =>
    [
      "{",
      `    routeId: ${JSON.stringify(String(entry.routeId))},`,
      `    routePath: ${JSON.stringify(entry.routePath)},`,
      `    moduleId: ${JSON.stringify(entry.moduleId)},`,
      `    filePath: ${JSON.stringify(entry.filePath)},`,
      `    pathParamCount: ${entry.params.length},`,
      `    hasPathParams: ${entry.params.length > 0},`,
      `    params: ${JSON.stringify(entry.params)},`,
      `    paramsSchema: routeModulePresence(${identifier}.options?.params),`,
      `    searchSchema: routeModulePresence(${identifier}.options?.search),`,
      `    preload: routeModulePresence(${identifier}.options?.preload),`,
      `    preloadResources: Route.describePreloadResources(${identifier}),`,
      `    preloadCollections: Route.describePreloadCollections(${identifier}),`,
      `    component: routeModulePresence(${identifier}.options?.component)`,
      "  }"
    ].join("\n")
  );
  return [
    "import { Resource, Route } from \"@effect-ui/core\";",
    "import { Collection } from \"@effect-ui/db\";",
    "import { collectStartAppGraphDiagnosticsPolicyViolations, formatStartAppGraphDiagnosticsPolicyViolation, unknownRoutePreloadCollectionsForDiagnostics, unknownRoutePreloadResourcesForDiagnostics } from \"@effect-ui/start\";",
    ...(routeModuleImports.length > 0 ? [""] : []),
    ...routeModuleImports,
    ...(routeModuleImports.length > 0 ? [""] : []),
    "const routeModulePresence = (value) => value === undefined ? \"absent\" : \"present\";",
    `export const graph = ${serialized};`,
    `const staticDiagnostics = ${staticDiagnostics};`,
    "const resourceDiagnostics = Resource.diagnostics();",
    "const collectionDiagnostics = Collection.diagnostics();",
    "const routeModules = [",
    routeModuleDiagnostics.join(",\n"),
    "];",
    "const unknownRoutePreloadResources = unknownRoutePreloadResourcesForDiagnostics({ routeModules });",
    "const unknownRoutePreloadCollections = unknownRoutePreloadCollectionsForDiagnostics({ routeModules });",
    "export const diagnostics = {",
    "  ...staticDiagnostics,",
    "  routeModules,",
    "  unknownRoutePreloadResources,",
    "  unknownRoutePreloadCollections,",
    "  resourceFamilies: resourceDiagnostics.families,",
    "  resourceTags: resourceDiagnostics.tags,",
    "  collectionDefinitions: collectionDiagnostics.collections",
    "};",
    `const diagnosticsPolicy = ${diagnosticsPolicy};`,
    "export const diagnosticsPolicyViolations = collectStartAppGraphDiagnosticsPolicyViolations(diagnostics, diagnosticsPolicy);",
    "if (diagnosticsPolicyViolations.length > 0) {",
    "  const error = new Error(`Effect UI app graph diagnostics policy failed: ${diagnosticsPolicyViolations.map(formatStartAppGraphDiagnosticsPolicyViolation).join(\"; \")}`);",
    "  error.name = \"StartAppGraphDiagnosticsPolicyError\";",
    "  error.violations = diagnosticsPolicyViolations;",
    "  error.diagnostics = diagnostics;",
    "  throw error;",
    "}",
    "export const routes = graph.routes;",
    "export const serverFunctions = graph.serverFunctions;",
    "export const actions = graph.actions;",
    "export default graph;"
  ].join("\n");
};

export const loadStartVirtualModuleEffect = (
  id: string,
  options: EffectUiStartOptions = {}
): Effect.Effect<string | null, StartVirtualModuleLoadError> => {
  switch (id) {
    case resolvedServerFunctionManifestVirtualModuleId:
      return Effect.map(
        makeStartServerFunctionManifestEffect(options),
        createServerFunctionManifestVirtualModule
      );
    case resolvedActionManifestVirtualModuleId:
      return Effect.map(
        makeStartActionManifestEffect(options),
        createActionManifestVirtualModule
      );
    case resolvedFileRouteManifestVirtualModuleId:
      return Effect.map(
        makeStartFileRouteManifestEffect(options),
        createFileRouteManifestVirtualModule
      );
    case resolvedFileRouteDefinitionsVirtualModuleId:
      return Effect.map(
        makeStartFileRouteManifestEffect(options),
        createFileRouteDefinitionsVirtualModule
      );
    case resolvedAppGraphVirtualModuleId:
      return Effect.map(
        makeStartBuildAppGraphEffect(options),
        (graph) => createStartAppGraphVirtualModule(
          graph,
          normalizeStartBuildPolicy(options.buildPolicy)
        )
      );
    default:
      return Effect.succeed(null);
  }
};
