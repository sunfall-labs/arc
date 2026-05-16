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
  createFileRouteModuleReferences,
  isFileRouteDefinitionsModuleError,
  type FileRouteDefinitionsModuleError
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

/** Vite virtual module id for the generated server function manifest. */
export const serverFunctionManifestVirtualModuleId = "virtual:effect-ui/server-functions";
/** Vite virtual module id for the generated action manifest. */
export const actionManifestVirtualModuleId = "virtual:effect-ui/actions";
/** Vite virtual module id for the generated file route manifest. */
export const fileRouteManifestVirtualModuleId = "virtual:effect-ui/file-routes";
/** Vite virtual module id for generated file route definitions. */
export const fileRouteDefinitionsVirtualModuleId = "virtual:effect-ui/routes";
/** Vite virtual module id for the generated Start app graph. */
export const appGraphVirtualModuleId = "virtual:effect-ui/app-graph";
/** Vite virtual module id for generated Start app graph runtime diagnostics. */
export const appGraphRuntimeDiagnosticsVirtualModuleId = "virtual:effect-ui/app-graph/runtime-diagnostics";

const resolvedServerFunctionManifestVirtualModuleId = `\0${serverFunctionManifestVirtualModuleId}`;
const resolvedActionManifestVirtualModuleId = `\0${actionManifestVirtualModuleId}`;
const resolvedFileRouteManifestVirtualModuleId = `\0${fileRouteManifestVirtualModuleId}`;
const resolvedFileRouteDefinitionsVirtualModuleId = `\0${fileRouteDefinitionsVirtualModuleId}`;
const resolvedAppGraphVirtualModuleId = `\0${appGraphVirtualModuleId}`;
const resolvedAppGraphRuntimeDiagnosticsVirtualModuleId = `\0${appGraphRuntimeDiagnosticsVirtualModuleId}`;

export type StartVirtualModuleLoadError =
  | StartAppGraphError
  | StartBuildPolicyError
  | FileRouteDefinitionsModuleError;

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
    case appGraphRuntimeDiagnosticsVirtualModuleId:
      return resolvedAppGraphRuntimeDiagnosticsVirtualModuleId;
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

const createFileRouteDefinitionsVirtualModuleEffect = (
  manifest: FileRouteManifest
): Effect.Effect<string, FileRouteDefinitionsModuleError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(createFileRouteDefinitionsVirtualModule(manifest));
    } catch (cause) {
      if (isFileRouteDefinitionsModuleError(cause)) {
        return Effect.fail(cause);
      }
      throw cause;
    }
  });

const diagnosticsPolicyLiteral = (
  policy: StartBuildPolicy | undefined
): string =>
  JSON.stringify(policy?.diagnostics === undefined || policy.diagnostics === false ? null : policy.diagnostics);

/** Creates the Vite virtual module source for the resolved Start app graph. */
export const createStartAppGraphVirtualModule = (
  graph: StartAppGraph,
  _policy?: StartBuildPolicy
): string => {
  const serialized = serializeStartAppGraphArtifact(graph);
  const diagnostics = JSON.stringify(describeStartAppGraph(graph));
  return [
    `export const graph = ${serialized};`,
    `export const diagnostics = ${diagnostics};`,
    "export const diagnosticsPolicyViolations = [];",
    "export const routes = graph.routes;",
    "export const serverFunctions = graph.serverFunctions;",
    "export const actions = graph.actions;",
    "export default graph;"
  ].join("\n");
};

/** Creates the runtime diagnostics virtual module that explicitly loads route implementations. */
export const createStartAppGraphRuntimeDiagnosticsVirtualModule = (
  graph: StartAppGraph,
  policy?: StartBuildPolicy
): string => {
  const serialized = serializeStartAppGraphArtifact(graph);
  const diagnosticsPolicy = diagnosticsPolicyLiteral(policy);
  const routeModuleReferences = createFileRouteModuleReferences(graph.routes, {
    importMode: "rootAbsolute"
  });
  const routeModuleImports = routeModuleReferences.map((reference) =>
    `import { ${reference.importName} as ${reference.identifier} } from ${JSON.stringify(reference.importSpecifier)};`
  );
  const routeModuleCandidates = routeModuleReferences.map(({ identifier }, index) =>
    [
      "{",
      `    entry: graph.routes.entries[${index}],`,
      `    route: ${identifier},`,
      `    preloadResources: Route.describePreloadResources(${identifier}),`,
      `    preloadCollections: Route.describePreloadCollections(${identifier})`,
      "  }"
    ].join("\n")
  );
  return [
    "import { Effect } from \"effect\";",
    "import { Resource, Route } from \"@effect-ui/core\";",
    "import { describeStartAppGraphRuntimeDiagnostics, startAppGraphCollectionDefinitions, validateStartAppGraphDiagnosticsPolicyExceptionEffect } from \"@effect-ui/start\";",
    ...(routeModuleImports.length > 0 ? [""] : []),
    ...routeModuleImports,
    ...(routeModuleImports.length > 0 ? [""] : []),
    `export const graph = ${serialized};`,
    "const resourceDiagnostics = Resource.diagnostics();",
    "const collectionDefinitions = startAppGraphCollectionDefinitions();",
    "const routeModuleCandidates = [",
    routeModuleCandidates.join(",\n"),
    "];",
    "export const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {",
    "  routeModules: routeModuleCandidates,",
    "  resourceFamilies: resourceDiagnostics.families,",
    "  resourceTags: resourceDiagnostics.tags,",
    "  collectionDefinitions",
    "});",
    `const diagnosticsPolicy = ${diagnosticsPolicy};`,
    "export const diagnosticsPolicyViolations = Effect.runSync(validateStartAppGraphDiagnosticsPolicyExceptionEffect(diagnostics, diagnosticsPolicy));",
    "export const routes = graph.routes;",
    "export const serverFunctions = graph.serverFunctions;",
    "export const actions = graph.actions;",
    "export default graph;"
  ].join("\n");
};

const createStartAppGraphRuntimeDiagnosticsVirtualModuleEffect = (
  graph: StartAppGraph,
  policy?: StartBuildPolicy
): Effect.Effect<string, FileRouteDefinitionsModuleError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(createStartAppGraphRuntimeDiagnosticsVirtualModule(graph, policy));
    } catch (cause) {
      if (isFileRouteDefinitionsModuleError(cause)) {
        return Effect.fail(cause);
      }
      throw cause;
    }
  });

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
      return Effect.flatMap(
        makeStartFileRouteManifestEffect(options),
        createFileRouteDefinitionsVirtualModuleEffect
      );
    case resolvedAppGraphVirtualModuleId:
      return Effect.map(
        makeStartBuildAppGraphEffect(options),
        (graph) => createStartAppGraphVirtualModule(
          graph,
          normalizeStartBuildPolicy(options.buildPolicy)
        )
      );
    case resolvedAppGraphRuntimeDiagnosticsVirtualModuleId:
      return Effect.flatMap(
        makeStartBuildAppGraphEffect(options),
        (graph) => createStartAppGraphRuntimeDiagnosticsVirtualModuleEffect(
          graph,
          normalizeStartBuildPolicy(options.buildPolicy)
        )
      );
    default:
      return Effect.succeed(null);
  }
};
