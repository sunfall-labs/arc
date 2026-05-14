import { Data, Effect } from "effect";
import { isPromiseLike, runPromise, type ActionDefinition, type ServerFunction } from "@effect-ui/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { createServer, type InlineConfig, type PluginOption, type UserConfig } from "vite";
import { nodeRequestToWebRequest, writeNodeResponse } from "./adapters.js";
import { serverActionPath, serverRpcPath } from "./rpc.js";
import {
  makeServerFunctionManifest,
  serializeServerFunctionManifest,
  serverFunctionManifestDefinition,
  type ServerFunctionManifestDefinition,
  type ServerFunctionManifestError,
  type ServerFunctionManifest,
  type ServerFunctionManifestSource
} from "./server-function-manifest.js";
import {
  actionManifestDefinition,
  makeActionManifest,
  serializeActionManifest,
  type ActionManifest,
  type ActionManifestDefinition,
  type ActionManifestError,
  type ActionManifestSource
} from "./action-manifest.js";
import {
  createStartAppGraph,
  describeStartAppGraph,
  serializeStartAppGraph as serializeStartAppGraphArtifact,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphWireSchemasEffect,
  type StartAppGraphActionBehaviorPolicy,
  type StartAppGraphDiagnostics,
  type StartAppGraphDiagnosticsPolicy,
  type StartAppGraphDiagnosticsPolicyError,
  type StartAppGraphMissingWireSchemas as StartAppGraphMissingWireSchemasError,
  type StartAppGraphUnknownActionBehavior as StartAppGraphUnknownActionBehaviorError,
  type StartAppGraphWireSchemaPolicy,
  type StartAppGraph
} from "./app-graph.js";
import {
  createFileRouteManifest,
  defaultFileRouteExtensions,
  generateValidatedFileRouteManifestArtifactEffect,
  serializeFileRouteManifest,
  validateFileRouteManifestEffect,
  type FileRouteManifest,
  type FileRouteManifestEntry,
  type FileRouteManifestError,
  type FileRouteManifestOptions
} from "./file-routes.js";
import {
  createFileRouteModuleReferences,
  createFileRouteDefinitionsModule,
  createGeneratedFileRouteDefinitionsModule,
  type GeneratedFileRouteDefinitionsModuleOptions
} from "./file-route-modules.js";

export interface FileRouteGenerationOptions
  extends GeneratedFileRouteDefinitionsModuleOptions {
  readonly outputFile?: string | false;
}

export interface EffectUiStartOptions {
  readonly serverFunctions?: ReadonlyArray<ServerFunction<unknown, unknown>>;
  readonly serverFunctionManifest?: Iterable<ServerFunctionManifestDefinition>;
  readonly serverFunctionSources?: Iterable<ServerFunctionManifestSource>;
  readonly actions?: ReadonlyArray<ActionDefinition<any, any, any, any>>;
  readonly actionManifest?: Iterable<ActionManifestDefinition>;
  readonly actionSources?: Iterable<ActionManifestSource>;
  readonly fileRoutes?: Iterable<string>;
  readonly fileRouteManifest?: FileRouteManifest | Iterable<FileRouteManifestEntry>;
  readonly fileRouteOptions?: FileRouteManifestOptions;
  readonly fileRouteGeneration?: FileRouteGenerationOptions;
  readonly serverEntry?: string;
  readonly handlerExport?: string;
  readonly buildPolicy?: StartBuildPolicy | boolean;
}

export interface StartBuildPolicy {
  readonly wireSchemas?: StartAppGraphWireSchemaPolicy | false;
  readonly actionBehavior?: StartAppGraphActionBehaviorPolicy | false;
  readonly diagnostics?: StartAppGraphDiagnosticsPolicy | false;
}

export type StartBuildPolicyError =
  | StartAppGraphMissingWireSchemasError
  | StartAppGraphUnknownActionBehaviorError
  | StartAppGraphDiagnosticsPolicyError;

export interface FileRouteDiscoveryOptions {
  readonly root?: string;
  readonly routeDirectory?: string;
  readonly extensions?: readonly string[];
}

export type StartSsrRequestHandler = (request: Request) => Response | Promise<Response>;

export interface StartDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  transformIndexHtml(url: string, html: string): Promise<string>;
  ssrFixStacktrace?(error: Error): void;
}

export interface LoadStartAppGraphDiagnosticsOptions {
  readonly root?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
  readonly start?: EffectUiStartOptions;
  readonly vite?: InlineConfig;
}

export interface LoadedStartAppGraphDiagnostics {
  readonly graph: StartAppGraph;
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations: readonly unknown[];
}

export class StartAppGraphDiagnosticsRunnerError extends Data.TaggedError(
  "StartAppGraphDiagnosticsRunnerError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface HandleSsrDevRequestOptions {
  readonly serverEntry?: string;
  readonly handlerExport?: string;
}

export const defaultServerEntry = "/src/server.tsx";
export const defaultFileRouteDirectory = "src/routes";
export const defaultFileRouteGeneratedFile = "src/routeTree.gen.ts";
export const defaultStartBuildWireSchemaPolicy: Required<StartAppGraphWireSchemaPolicy> = {
  requireInput: true,
  requireOutput: true,
  requireError: false
};
export const defaultStartBuildPolicy: StartBuildPolicy = {
  wireSchemas: defaultStartBuildWireSchemaPolicy
};
export {
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect
} from "./app-graph.js";
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

const normalizeDiscoveredFileRoutePath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

const isRouteFileName = (
  fileName: string,
  extensions: readonly string[]
): boolean =>
  !fileName.endsWith(".d.ts") &&
  extensions.some((extension) => fileName.endsWith(extension));

const absoluteFileRouteDirectory = (
  root: string,
  routeDirectory: string = defaultFileRouteDirectory
): string =>
  isAbsolute(routeDirectory)
    ? routeDirectory
    : resolvePath(root, routeDirectory);

export const discoverFileRoutes = (
  options: FileRouteDiscoveryOptions = {}
): readonly string[] => {
  const root = resolvePath(options.root ?? process.cwd());
  const routeDirectory = options.routeDirectory ?? defaultFileRouteDirectory;
  const directory = absoluteFileRouteDirectory(root, routeDirectory);
  const extensions = options.extensions ?? defaultFileRouteExtensions;

  if (!existsSync(directory)) {
    return [];
  }

  const discovered: string[] = [];
  const visit = (currentDirectory: string): void => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = resolvePath(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && isRouteFileName(entry.name, extensions)) {
        const routeFilePath = isAbsolute(routeDirectory)
          ? fullPath
          : relativePath(root, fullPath);
        discovered.push(normalizeDiscoveredFileRoutePath(routeFilePath));
      }
    }
  };

  visit(directory);
  return discovered.sort();
};

const serverFunctionDefinitionsFromOptions = (
  options: EffectUiStartOptions,
  serverEntry: string
): Iterable<ServerFunctionManifestDefinition> => {
  if (options.serverFunctionManifest) {
    return options.serverFunctionManifest;
  }

  if (options.serverFunctionSources) {
    return Array.from(options.serverFunctionSources, (source) =>
      serverFunctionManifestDefinition(source.fn, source)
    );
  }

  return Array.from(options.serverFunctions ?? [], (fn) =>
    serverFunctionManifestDefinition(fn, {
      module: serverEntry,
      exportName: fn.name
    })
  );
};

const actionDefinitionsFromOptions = (
  options: EffectUiStartOptions,
  serverEntry: string
): Iterable<ActionManifestDefinition> => {
  if (options.actionManifest) {
    return options.actionManifest;
  }

  if (options.actionSources) {
    return Array.from(options.actionSources, (source) =>
      actionManifestDefinition(source.action, source)
    );
  }

  return Array.from(options.actions ?? [], (action) =>
    actionManifestDefinition(action, {
      module: serverEntry,
      exportName: action.name
    })
  );
};

export const makeStartServerFunctionManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestError> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return makeServerFunctionManifest(
    serverFunctionDefinitionsFromOptions(options, serverEntry)
  );
};

export const serializeStartServerFunctionManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartServerFunctionManifestEffect(options), serializeServerFunctionManifest)
  );

export const makeStartActionManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<ActionManifest, ActionManifestError> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return makeActionManifest(actionDefinitionsFromOptions(options, serverEntry));
};

export const serializeStartActionManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartActionManifestEffect(options), serializeActionManifest)
  );

const isFileRouteManifest = (value: unknown): value is FileRouteManifest =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly version?: unknown }).version === 1 &&
  Array.isArray((value as { readonly entries?: unknown }).entries);

const withDefaultFileRouteDirectory = (
  options: EffectUiStartOptions
): EffectUiStartOptions => {
  if (
    options.fileRouteOptions?.routeDirectory !== undefined ||
    (options.fileRouteManifest !== undefined && isFileRouteManifest(options.fileRouteManifest))
  ) {
    return options;
  }

  return {
    ...options,
    fileRouteOptions: {
      ...options.fileRouteOptions,
      routeDirectory: defaultFileRouteDirectory
    }
  };
};

const withDiscoveredFileRoutes = (
  options: EffectUiStartOptions,
  root: string
): EffectUiStartOptions => {
  const next = withDefaultFileRouteDirectory(options);
  if (next.fileRouteManifest !== undefined || next.fileRoutes !== undefined) {
    return next;
  }

  const fileRouteOptions = next.fileRouteOptions;
  return {
    ...next,
    fileRoutes: discoverFileRoutes({
      root,
      ...(fileRouteOptions?.routeDirectory === undefined
        ? {}
        : { routeDirectory: fileRouteOptions.routeDirectory }),
      ...(fileRouteOptions?.extensions === undefined
        ? {}
        : { extensions: fileRouteOptions.extensions })
    })
  };
};

export const makeStartFileRouteManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<FileRouteManifest, FileRouteManifestError> => {
  const manifest = options.fileRouteManifest;
  if (manifest) {
    const routeDirectory = isFileRouteManifest(manifest)
      ? manifest.routeDirectory
      : options.fileRouteOptions?.routeDirectory;
    const fileRouteOptions = {
      ...options.fileRouteOptions,
      ...(routeDirectory === undefined ? {} : { routeDirectory })
    };
    const entries = isFileRouteManifest(manifest) ? manifest.entries : manifest;
    const modules = isFileRouteManifest(manifest) && Array.isArray(manifest.modules)
      ? manifest.modules
      : [];

    return Effect.map(validateFileRouteManifestEffect(entries, modules), (entries) =>
      createFileRouteManifest(entries, fileRouteOptions, modules)
    );
  }

  if (options.fileRoutes) {
    return generateValidatedFileRouteManifestArtifactEffect(
      options.fileRoutes,
      options.fileRouteOptions
    );
  }

  return Effect.succeed(createFileRouteManifest([], options.fileRouteOptions));
};

export const serializeStartFileRouteManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartFileRouteManifestEffect(options), serializeFileRouteManifest)
  );

export type StartAppGraphError =
  | ServerFunctionManifestError
  | ActionManifestError
  | FileRouteManifestError;

export const makeStartAppGraphEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<StartAppGraph, StartAppGraphError> =>
  Effect.gen(function* () {
    const serverFunctions = yield* makeStartServerFunctionManifestEffect(options);
    const actions = yield* makeStartActionManifestEffect(options);
    const routes = yield* makeStartFileRouteManifestEffect(options);

    return createStartAppGraph({
      routes,
      serverFunctions,
      actions
    });
  });

const normalizeStartBuildPolicy = (
  policy: EffectUiStartOptions["buildPolicy"]
): StartBuildPolicy | undefined => {
  if (policy === undefined || policy === false) {
    return undefined;
  }

  return policy === true ? defaultStartBuildPolicy : policy;
};

export const validateStartBuildPolicyEffect = (
  graph: StartAppGraph,
  policy: StartBuildPolicy = defaultStartBuildPolicy
): Effect.Effect<void, StartBuildPolicyError> =>
  Effect.gen(function* () {
    const wireSchemas = policy.wireSchemas;
    if (wireSchemas !== false) {
      yield* validateStartAppGraphWireSchemasEffect(
        graph,
        wireSchemas ?? defaultStartBuildWireSchemaPolicy
      );
    }

    const actionBehavior = policy.actionBehavior;
    if (actionBehavior !== undefined && actionBehavior !== false) {
      yield* validateStartAppGraphActionBehaviorEffect(graph, actionBehavior);
    }
  });

export const makeStartBuildAppGraphEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<StartAppGraph, StartAppGraphError | StartBuildPolicyError> =>
  Effect.gen(function* () {
    const graph = yield* makeStartAppGraphEffect(options);
    const policy = normalizeStartBuildPolicy(options.buildPolicy);
    if (policy !== undefined) {
      yield* validateStartBuildPolicyEffect(graph, policy);
    }

    return graph;
  });

export const serializeStartAppGraph = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartBuildAppGraphEffect(options), serializeStartAppGraphArtifact)
  );

const diagnosticsPolicyLiteral = (
  policy: StartBuildPolicy | undefined
): string =>
  JSON.stringify(policy?.diagnostics === undefined || policy.diagnostics === false ? null : policy.diagnostics);

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
    "const unknownRoutePreloadResources = routeModules",
    "  .filter((routeModule) => routeModule.preload === \"present\" && routeModule.preloadResources.status === \"unknown\")",
    "  .map((routeModule) => ({",
    "    kind: \"route\",",
    "    routeId: routeModule.routeId,",
    "    routePath: routeModule.routePath,",
    "    moduleId: routeModule.moduleId,",
    "    filePath: routeModule.filePath,",
    "    preload: routeModule.preload,",
    "    preloadResources: routeModule.preloadResources",
    "  }));",
    "const unknownRoutePreloadCollections = routeModules",
    "  .filter((routeModule) => routeModule.preload === \"present\" && routeModule.preloadCollections.status === \"unknown\")",
    "  .map((routeModule) => ({",
    "    kind: \"route\",",
    "    routeId: routeModule.routeId,",
    "    routePath: routeModule.routePath,",
    "    moduleId: routeModule.moduleId,",
    "    filePath: routeModule.filePath,",
    "    preload: routeModule.preload,",
    "    preloadCollections: routeModule.preloadCollections",
    "  }));",
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
    "const isEnabledDiagnosticsPolicy = (value) => value !== undefined && value !== null && value !== false;",
    "const collectDiagnosticsPolicyViolations = (diagnostics, policy) => {",
    "  if (!isEnabledDiagnosticsPolicy(policy)) return [];",
    "  const violations = [];",
    "  const routePreloadResources = policy.routePreloadResources;",
    "  if (isEnabledDiagnosticsPolicy(routePreloadResources) && (routePreloadResources.requireDeclaredForPreload ?? true)) {",
    "    if (diagnostics.unknownRoutePreloadResources.length > 0) {",
    "      violations.push({",
    "        _tag: \"UnknownRoutePreloadResources\",",
    "        message: \"Routes with preload must declare preloadResources.\",",
    "        routes: diagnostics.unknownRoutePreloadResources",
    "      });",
    "    }",
    "  }",
    "  const routePreloadCollections = policy.routePreloadCollections;",
    "  if (isEnabledDiagnosticsPolicy(routePreloadCollections) && (routePreloadCollections.requireDeclaredForPreload ?? true)) {",
    "    if (diagnostics.unknownRoutePreloadCollections.length > 0) {",
    "      violations.push({",
    "        _tag: \"UnknownRoutePreloadCollections\",",
    "        message: \"Routes with preload must declare preloadCollections.\",",
    "        routes: diagnostics.unknownRoutePreloadCollections",
    "      });",
    "    }",
    "  }",
    "  return violations;",
    "};",
    "const formatDiagnosticsPolicyViolation = (violation) => {",
    "  const routes = violation.routes.map((route) => `${route.routePath} (${route.filePath})`).join(\", \");",
    "  return `${violation.message} ${routes}`;",
    "};",
    "export const diagnosticsPolicyViolations = collectDiagnosticsPolicyViolations(diagnostics, diagnosticsPolicy);",
    "if (diagnosticsPolicyViolations.length > 0) {",
    "  const error = new Error(`Effect UI app graph diagnostics policy failed: ${diagnosticsPolicyViolations.map(formatDiagnosticsPolicyViolation).join(\"; \")}`);",
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

export const createFileRouteDefinitionsVirtualModule = (
  manifest: FileRouteManifest
): string => createFileRouteDefinitionsModule(manifest, { importMode: "rootAbsolute" });

const startAppGraphDiagnosticsFromModule = (
  module: Record<string, unknown>
): LoadedStartAppGraphDiagnostics => ({
  graph: module.graph as StartAppGraph,
  diagnostics: module.diagnostics as StartAppGraphDiagnostics,
  diagnosticsPolicyViolations: Array.isArray(module.diagnosticsPolicyViolations)
    ? module.diagnosticsPolicyViolations
    : []
});

export const loadStartAppGraphDiagnostics = async (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Promise<LoadedStartAppGraphDiagnostics> => {
  const inlineConfig = options.vite ?? {};
  const plugins = [
    ...(inlineConfig.plugins ?? []),
    ...(options.start === undefined ? [] : [effectUiStart(options.start)])
  ];
  const root = options.root ?? inlineConfig.root;
  const configFile = options.configFile ?? inlineConfig.configFile;
  const mode = options.mode ?? inlineConfig.mode;
  const server = await createServer({
    ...inlineConfig,
    ...(root === undefined ? {} : { root }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(mode === undefined ? {} : { mode }),
    logLevel: inlineConfig.logLevel ?? "silent",
    plugins,
    server: {
      ...inlineConfig.server,
      middlewareMode: true,
      hmr: false
    }
  });

  try {
    const module = await server.ssrLoadModule(appGraphVirtualModuleId);
    return startAppGraphDiagnosticsFromModule(module);
  } finally {
    await server.close();
  }
};

export const loadStartAppGraphDiagnosticsEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsRunnerError> =>
  Effect.tryPromise({
    try: () => loadStartAppGraphDiagnostics(options),
    catch: (cause) =>
      new StartAppGraphDiagnosticsRunnerError({
        message: "Could not load resolved Effect UI app graph diagnostics through Vite.",
        cause
      })
  });

export interface FileRouteDefinitionsFileWriteResult {
  readonly outputFile: string;
  readonly absolutePath: string;
  readonly written: boolean;
  readonly source: string;
}

export const writeFileRouteDefinitionsFile = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): FileRouteDefinitionsFileWriteResult | undefined => {
  if (options.outputFile === false) {
    return undefined;
  }

  const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
  const absolutePath = isAbsolute(outputFile)
    ? outputFile
    : resolvePath(root, outputFile);
  const generatedFile = isAbsolute(outputFile)
    ? normalizeDiscoveredFileRoutePath(relativePath(root, absolutePath))
    : outputFile;
  const source = createGeneratedFileRouteDefinitionsModule(manifest, {
    ...options,
    generatedFile
  });

  if (existsSync(absolutePath) && readFileSync(absolutePath, "utf8") === source) {
    return {
      outputFile,
      absolutePath,
      written: false,
      source
    };
  }

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);

  return {
    outputFile,
    absolutePath,
    written: true,
    source
  };
};

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

export class StartHandlerNotFound extends Data.TaggedError("StartHandlerNotFound")<{
  readonly exportName: string;
}> {}

export class StartDevServerError extends Data.TaggedError("StartDevServerError")<{
  readonly operation: "load-module" | "run-handler" | "read-html" | "transform-html";
  readonly error: unknown;
}> {}

export class StartServerOnlyModuleError extends Data.TaggedError("StartServerOnlyModuleError")<{
  readonly id: string;
}> {}

export const effectUiStart = (options: EffectUiStartOptions = {}): PluginOption => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();

  const currentOptions = (): EffectUiStartOptions =>
    withDiscoveredFileRoutes({ ...options, serverEntry }, viteRoot);

  const shouldWriteFileRouteDefinitions = (activeOptions: EffectUiStartOptions): boolean => {
    if (activeOptions.fileRouteGeneration?.outputFile === false) {
      return false;
    }

    if (options.fileRoutes !== undefined || options.fileRouteManifest !== undefined) {
      return true;
    }

    const routeDirectory = activeOptions.fileRouteOptions?.routeDirectory ?? defaultFileRouteDirectory;
    return existsSync(absoluteFileRouteDirectory(viteRoot, routeDirectory));
  };

  const writeCurrentFileRouteDefinitions = (): FileRouteDefinitionsFileWriteResult | undefined => {
    const activeOptions = currentOptions();
    if (!shouldWriteFileRouteDefinitions(activeOptions)) {
      return undefined;
    }

    return writeFileRouteDefinitionsFile(
      viteRoot,
      Effect.runSync(makeStartFileRouteManifestEffect(activeOptions)),
      activeOptions.fileRouteGeneration
    );
  };

  return {
    name: "effect-ui-start",
    config(config: UserConfig = {}) {
      viteRoot = resolvePath(config.root ?? process.cwd());
      const activeOptions = currentOptions();
      const graph = Effect.runSync(makeStartBuildAppGraphEffect(activeOptions));

      return {
        appType: "custom",
        define: {
          __EFFECT_UI_SERVER_FUNCTIONS__: serializeServerFunctionManifest(graph.serverFunctions),
          __EFFECT_UI_ACTIONS__: serializeActionManifest(graph.actions),
          __EFFECT_UI_FILE_ROUTES__: serializeFileRouteManifest(graph.routes),
          __EFFECT_UI_APP_GRAPH__: serializeStartAppGraphArtifact(graph)
        }
      };
    },
    configResolved(config) {
      viteRoot = config.root;
      writeCurrentFileRouteDefinitions();
    },
    buildStart() {
      writeCurrentFileRouteDefinitions();
    },
    resolveId(id) {
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
    },
    load(id) {
      const activeOptions = currentOptions();

      switch (id) {
        case resolvedServerFunctionManifestVirtualModuleId:
          return createServerFunctionManifestVirtualModule(
            Effect.runSync(makeStartServerFunctionManifestEffect(activeOptions))
          );
        case resolvedActionManifestVirtualModuleId:
          return createActionManifestVirtualModule(
            Effect.runSync(makeStartActionManifestEffect(activeOptions))
          );
        case resolvedFileRouteManifestVirtualModuleId:
          return createFileRouteManifestVirtualModule(
            Effect.runSync(makeStartFileRouteManifestEffect(activeOptions))
          );
        case resolvedFileRouteDefinitionsVirtualModuleId:
          return createFileRouteDefinitionsVirtualModule(
            Effect.runSync(makeStartFileRouteManifestEffect(activeOptions))
          );
        case resolvedAppGraphVirtualModuleId:
          return createStartAppGraphVirtualModule(
            Effect.runSync(makeStartBuildAppGraphEffect(activeOptions)),
            normalizeStartBuildPolicy(activeOptions.buildPolicy)
          );
        default:
          return null;
      }
    },
    transform(_code, id, options) {
      if (isServerOnlyModule(id) && !options?.ssr) {
        throw new StartServerOnlyModuleError({ id });
      }
      return null;
    },
    configureServer(server) {
      return () => {
        server.middlewares.use(async (request, response, next) => {
          try {
            if (!shouldHandleSsrRequest(request)) {
              next();
              return;
            }

            const webRequest = nodeRequestToWebRequest(request);
            const webResponse = await handleSsrDevRequest(
              server,
              webRequest,
              options.handlerExport === undefined
                ? { serverEntry }
                : { serverEntry, handlerExport: options.handlerExport }
            );
            await writeNodeResponse(response, webResponse, { headOnly: request.method === "HEAD" });
          } catch (error) {
            if (error instanceof Error) {
              server.ssrFixStacktrace(error);
            }
            next(error);
          }
        });
      };
    }
  };
};

export const isHtmlResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.includes("text/html") ?? false;

export const isServerOnlyModule = (id: string): boolean => {
  const clean = id.split("?", 1)[0] ?? id;
  return /\.(server)\.[cm]?[jt]sx?$/.test(clean);
};

export const shouldHandleSsrRequest = (
  request: Pick<IncomingMessage, "method" | "url" | "headers">
): boolean => {
  const url = request.url ?? "/";
  const pathname = new URL(url, "http://effect-ui.local").pathname;
  if (pathname === serverRpcPath || pathname === serverActionPath) {
    return true;
  }

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (
    url.startsWith("/@") ||
    url.startsWith("/src/") ||
    url.startsWith("/node_modules/") ||
    url.startsWith("/favicon.") ||
    /\.[A-Za-z0-9]+(?:\?|$)/.test(url)
  ) {
    return false;
  }

  const accept = request.headers.accept;
  return Array.isArray(accept)
    ? accept.some((value) => value.includes("text/html") || value.includes("*/*"))
    : accept === undefined || accept.includes("text/html") || accept.includes("*/*");
};

export const resolveStartHandler = (
  module: Record<string, unknown>,
  options: { readonly handlerExport?: string } = {}
): StartSsrRequestHandler => {
  const candidate = options.handlerExport
    ? module[options.handlerExport]
    : module.default ?? module.handleRequest;

  if (typeof candidate !== "function") {
    const exportName = options.handlerExport ?? "default or handleRequest";
    throw new StartHandlerNotFound({ exportName });
  }

  return candidate as StartSsrRequestHandler;
};

export const resolveStartHandlerEffect = (
  module: Record<string, unknown>,
  options: { readonly handlerExport?: string } = {}
): Effect.Effect<StartSsrRequestHandler, StartHandlerNotFound> =>
  Effect.try({
    try: () => resolveStartHandler(module, options),
    catch: (error) =>
      error instanceof StartHandlerNotFound
        ? error
        : new StartHandlerNotFound({
            exportName: options.handlerExport ?? "default or handleRequest"
          })
  });

const tryDevPromise = <A>(
  operation: StartDevServerError["operation"],
  f: () => Promise<A>
): Effect.Effect<A, StartDevServerError> =>
  Effect.tryPromise({
    try: f,
    catch: (error) => new StartDevServerError({ operation, error })
  });

const handlerResultEffect = (
  handler: StartSsrRequestHandler,
  request: Request
): Effect.Effect<Response, StartDevServerError> =>
  Effect.try({
    try: () => handler(request),
    catch: (error) => new StartDevServerError({ operation: "run-handler", error })
  }).pipe(
    Effect.flatMap((response) =>
      isPromiseLike(response)
        ? tryDevPromise("run-handler", () => response)
        : Effect.succeed(response)
    )
  );

export const handleSsrDevRequestEffect = (
  server: StartDevServer,
  request: Request,
  options: HandleSsrDevRequestOptions = {}
): Effect.Effect<Response, StartHandlerNotFound | StartDevServerError> =>
  Effect.gen(function* () {
    const module = yield* tryDevPromise("load-module", () =>
      server.ssrLoadModule(options.serverEntry ?? defaultServerEntry)
    );
    const handler = yield* resolveStartHandlerEffect(module, options);
    const response = yield* handlerResultEffect(handler, request);

    if (!isHtmlResponse(response)) {
      return response;
    }

    const url = new URL(request.url);
    const html = yield* tryDevPromise("read-html", () => response.text());
    const transformed = yield* tryDevPromise("transform-html", () =>
      server.transformIndexHtml(`${url.pathname}${url.search}`, html)
    );
    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });

export const handleSsrDevRequest = (
  server: StartDevServer,
  request: Request,
  options: HandleSsrDevRequestOptions = {}
): Promise<Response> =>
  runPromise(handleSsrDevRequestEffect(server, request, options));
