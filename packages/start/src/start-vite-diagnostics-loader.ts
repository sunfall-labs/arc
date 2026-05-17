import { Data, Effect } from "effect";
import { createServer, type InlineConfig, type UserConfig } from "vite";
import type {
  StartAppGraph,
  StartAppGraphDiagnostics
} from "./app-graph.js";
import {
  decodeStartAppGraphDiagnosticsDtoEffect,
  describeStartAppGraph,
  deserializeStartAppGraph
} from "./app-graph.js";
import {
  unknownRoutePreloadCollectionsForDiagnostics,
  unknownRoutePreloadResourcesForDiagnostics
} from "./app-graph.js";
import type {
  StartAppGraphDiagnosticsPolicyException,
  StartAppGraphDiagnosticsPolicyViolation
} from "./start-app-graph-diagnostics-policy.js";
import {
  defaultServerEntry,
  normalizeStartManifestIterableOptions,
  withDiscoveredFileRoutes,
  type EffectUiStartOptions
} from "./start-manifest-wall.js";
import {
  appGraphRuntimeDiagnosticsVirtualModuleId,
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId
} from "./start-virtual-modules.js";
import {
  resolveStartTransportEndpointsEffect,
  type StartTransportEndpointConflictError,
  type StartTransportEndpointPathError
} from "./start-transport-endpoints.js";
import {
  effectUiStartPluginName,
  effectUiStartVirtualModulesPluginName
} from "./start-vite-plugin-names.js";

/** Options for loading resolved app graph diagnostics through Vite. */
export interface LoadStartAppGraphDiagnosticsOptions {
  readonly root?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
  readonly start?: EffectUiStartOptions;
  readonly vite?: InlineConfig;
}

/** App graph diagnostics loaded from the generated Vite virtual module. */
export interface LoadedStartAppGraphDiagnostics {
  readonly graph: StartAppGraph;
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations: readonly StartAppGraphDiagnosticsPolicyViolation[];
}

/** Error reported when diagnostics cannot be loaded through a Vite server. */
export class StartAppGraphDiagnosticsRunnerError extends Data.TaggedError(
  "StartAppGraphDiagnosticsRunnerError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Failure channel for loading resolved Start app graph diagnostics through Vite. */
export type StartAppGraphDiagnosticsLoadError =
  | StartAppGraphDiagnosticsRunnerError
  | StartAppGraphDiagnosticsPolicyException
  | StartTransportEndpointPathError
  | StartTransportEndpointConflictError;

export type StartDiagnosticsViteServer = Pick<
  Awaited<ReturnType<typeof createServer>>,
  "close" | "ssrLoadModule"
>;

const isStartAppGraphDiagnosticsPolicyException = (
  cause: unknown
): cause is StartAppGraphDiagnosticsPolicyException =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { readonly name?: unknown }).name === "StartAppGraphDiagnosticsPolicyError";

const diagnosticsRunnerError = (
  message: string,
  cause: unknown
): StartAppGraphDiagnosticsLoadError =>
  isStartAppGraphDiagnosticsPolicyException(cause)
    ? cause
    : new StartAppGraphDiagnosticsRunnerError({ message, cause });

interface EffectUiStartVirtualModulesPlugin {
  readonly name: typeof effectUiStartVirtualModulesPluginName;
  readonly configResolved: (config: { readonly root: string }) => void;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
}

export const effectUiStartVirtualModules = (
  options: EffectUiStartOptions = {}
): EffectUiStartVirtualModulesPlugin => {
  const normalizedOptions = normalizeStartManifestIterableOptions(options);
  const serverEntry = normalizedOptions.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();
  const currentOptions = (): EffectUiStartOptions =>
    withDiscoveredFileRoutes({ ...normalizedOptions, serverEntry }, viteRoot);

  return {
    name: effectUiStartVirtualModulesPluginName,
    configResolved(config) {
      viteRoot = config.root;
    },
    resolveId(id) {
      return resolveStartVirtualModuleId(id);
    },
    load(id) {
      return Effect.runSync(loadStartVirtualModuleEffect(id, currentOptions()));
    }
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStartPluginRecord = (value: unknown): value is { readonly name: string } =>
  isRecord(value) &&
  (value.name === effectUiStartPluginName || value.name === effectUiStartVirtualModulesPluginName);

const removeStartPlugins = (pluginOption: unknown): unknown => {
  if (Array.isArray(pluginOption)) {
    return pluginOption
      .map(removeStartPlugins)
      .filter((plugin) => plugin !== undefined && !isStartPluginRecord(plugin));
  }
  return isStartPluginRecord(pluginOption) ? undefined : pluginOption;
};

const pluginOptionArray = (
  plugins: InlineConfig["plugins"] | undefined
): NonNullable<InlineConfig["plugins"]> extends readonly (infer Plugin)[] ? readonly Plugin[] : readonly unknown[] =>
  plugins === undefined ? [] : Array.isArray(plugins) ? plugins : [plugins];

export const startDiagnosticsInlineConfig = (
  config: UserConfig,
  root: string,
  mode: string | undefined
): InlineConfig => {
  const plugins = removeStartPlugins(config.plugins) as InlineConfig["plugins"] | undefined;
  return {
    ...config,
    root,
    configFile: false,
    ...(mode === undefined ? {} : { mode }),
    logLevel: config.logLevel ?? "silent",
    ...(plugins === undefined ? {} : { plugins })
  };
};

const startDiagnosticsViteServerEffect = (
  options: LoadStartAppGraphDiagnosticsOptions
): Effect.Effect<StartDiagnosticsViteServer, StartAppGraphDiagnosticsLoadError> => {
  const inlineConfig = options.vite ?? {};
  const inlinePlugins = (
    options.start === undefined
      ? inlineConfig.plugins
      : removeStartPlugins(inlineConfig.plugins)
  ) as InlineConfig["plugins"] | undefined;
  const plugins = [
    ...pluginOptionArray(inlinePlugins),
    ...(options.start === undefined ? [] : [effectUiStartVirtualModules(options.start)])
  ];
  const root = options.root ?? inlineConfig.root;
  const configFile = options.configFile ?? inlineConfig.configFile ?? (options.start === undefined ? undefined : false);
  const mode = options.mode ?? inlineConfig.mode;

  return Effect.tryPromise({
    try: () =>
      createServer({
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
      }),
    catch: (cause) =>
      diagnosticsRunnerError(
        "Could not create the temporary Vite server for Effect UI app graph diagnostics.",
        cause
      )
  });
};

const closeStartDiagnosticsViteServerEffect = (
  server: StartDiagnosticsViteServer
): Effect.Effect<void, StartAppGraphDiagnosticsLoadError> =>
  Effect.tryPromise({
    try: () => server.close(),
    catch: (cause) =>
      diagnosticsRunnerError(
        "Could not close the temporary Vite server for Effect UI app graph diagnostics.",
        cause
      )
  }).pipe(
    Effect.asVoid
  );

const loadStartAppGraphDiagnosticsFromServerEffect = (
  server: StartDiagnosticsViteServer
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: () => server.ssrLoadModule(appGraphRuntimeDiagnosticsVirtualModuleId),
      catch: (cause) =>
        diagnosticsRunnerError(
          "Could not load resolved Effect UI app graph diagnostics through Vite.",
          cause
        )
    });

    return yield* startAppGraphDiagnosticsFromModuleEffect(module);
  });

export const loadStartAppGraphDiagnosticsWithServerEffect = (
  server: StartDiagnosticsViteServer
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.acquireUseRelease(
    Effect.succeed(server),
    loadStartAppGraphDiagnosticsFromServerEffect,
    closeStartDiagnosticsViteServerEffect
  );

const decodeStartAppGraphFromModuleEffect = (
  value: unknown
): Effect.Effect<StartAppGraph, StartAppGraphDiagnosticsLoadError> =>
  Effect.try({
    try: () => JSON.stringify(value),
    catch: (cause) =>
      diagnosticsRunnerError(
        "The loaded Effect UI app graph virtual module exported a graph that could not be serialized for validation.",
        cause
      )
  }).pipe(
    Effect.flatMap((serialized) =>
      deserializeStartAppGraph(serialized).pipe(
        Effect.mapError((cause) =>
          diagnosticsRunnerError(
            "The loaded Effect UI app graph virtual module did not match the Start app graph contract.",
            cause
          )
        )
      )
    )
  );

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const sameStringArray = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const validateLoadedStartAppGraphDiagnosticsCoherence = (
  graph: StartAppGraph,
  diagnostics: StartAppGraphDiagnostics
): string | undefined => {
  const expected = describeStartAppGraph(graph);

  if (diagnostics.routeCount !== graph.routes.entries.length) {
    return "routeCount must match graph.routes.entries.";
  }
  if (diagnostics.serverFunctionCount !== graph.serverFunctions.entries.length) {
    return "serverFunctionCount must match graph.serverFunctions.entries.";
  }
  if (diagnostics.actionCount !== graph.actions.entries.length) {
    return "actionCount must match graph.actions.entries.";
  }
  if (!sameStringArray(diagnostics.routePaths, expected.routePaths)) {
    return "routePaths must match graph.routes.entries.";
  }
  if (diagnostics.rpcPath !== expected.rpcPath || diagnostics.actionPath !== expected.actionPath) {
    return "transport paths must match the graph manifests.";
  }

  for (const [index, routeModule] of diagnostics.routeModules.entries()) {
    const expectedRouteModule = expected.routeModules[index];
    if (expectedRouteModule === undefined) {
      return "routeModules must match graph.routes.entries.";
    }
    for (const key of [
      "routeId",
      "routePath",
      "moduleId",
      "filePath",
      "pathParamCount",
      "hasPathParams"
    ] as const) {
      if (routeModule[key] !== expectedRouteModule[key]) {
        return `routeModules[${index}].${key} must match graph.routes.entries.`;
      }
    }
    if (!sameJson(routeModule.params, expectedRouteModule.params)) {
      return `routeModules[${index}].params must match graph.routes.entries.`;
    }
  }

  if (!sameJson(diagnostics.serverFunctionModules, expected.serverFunctionModules)) {
    return "serverFunctionModules must match graph.serverFunctions.entries.";
  }
  if (!sameJson(diagnostics.actionModules, expected.actionModules)) {
    return "actionModules must match graph.actions.entries.";
  }
  if (!sameJson(diagnostics.schemaCoverage, expected.schemaCoverage)) {
    return "schemaCoverage must match the graph manifests.";
  }
  if (!sameJson(diagnostics.missingSchemas, expected.missingSchemas)) {
    return "missingSchemas must match the graph manifests.";
  }
  if (!sameJson(diagnostics.unknownActionBehavior, expected.unknownActionBehavior)) {
    return "unknownActionBehavior must match graph.actions.entries.";
  }
  if (!sameStringArray(diagnostics.serverOnlyModules, expected.serverOnlyModules)) {
    return "serverOnlyModules must match the graph manifests.";
  }
  if (!sameStringArray(diagnostics.browserClientModules, expected.browserClientModules)) {
    return "browserClientModules must match the graph manifests.";
  }
  if (!sameJson(
    diagnostics.unknownRoutePreloadResources,
    unknownRoutePreloadResourcesForDiagnostics(diagnostics)
  )) {
    return "unknownRoutePreloadResources must match routeModules.";
  }
  if (!sameJson(
    diagnostics.unknownRoutePreloadCollections,
    unknownRoutePreloadCollectionsForDiagnostics(diagnostics)
  )) {
    return "unknownRoutePreloadCollections must match routeModules.";
  }

  return undefined;
};

const validateLoadedStartAppGraphDiagnosticsCoherenceEffect = (
  graph: StartAppGraph,
  diagnostics: StartAppGraphDiagnostics
): Effect.Effect<void, StartAppGraphDiagnosticsLoadError> => {
  const reason = validateLoadedStartAppGraphDiagnosticsCoherence(graph, diagnostics);
  return reason === undefined
    ? Effect.void
    : Effect.fail(
        new StartAppGraphDiagnosticsRunnerError({
          message: `The loaded Effect UI app graph diagnostics are not coherent with the loaded graph: ${reason}`,
          cause: { reason }
        })
      );
};

const startAppGraphDiagnosticsFromModuleEffect = (
  module: Record<string, unknown>
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.gen(function* () {
    const graph = yield* decodeStartAppGraphFromModuleEffect(module.graph);
    const dto = yield* decodeStartAppGraphDiagnosticsDtoEffect({
      diagnostics: module.diagnostics,
      diagnosticsPolicyViolations: module.diagnosticsPolicyViolations
    }).pipe(
      Effect.mapError((cause) =>
        diagnosticsRunnerError(
          cause.message,
          cause
        )
      )
    );
    yield* validateLoadedStartAppGraphDiagnosticsCoherenceEffect(graph, dto.diagnostics);

    return {
      graph,
      diagnostics: dto.diagnostics,
      diagnosticsPolicyViolations: dto.diagnosticsPolicyViolations
    };
  });

const loadStartAppGraphDiagnosticsRawEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.gen(function* () {
    if (options.start !== undefined) {
      yield* resolveStartTransportEndpointsEffect({
        ...(options.start.rpcPath === undefined ? {} : { rpcPath: options.start.rpcPath }),
        ...(options.start.actionPath === undefined ? {} : { actionPath: options.start.actionPath })
      });
    }
    return yield* Effect.acquireUseRelease(
      startDiagnosticsViteServerEffect(options),
      loadStartAppGraphDiagnosticsFromServerEffect,
      closeStartDiagnosticsViteServerEffect
    );
  });

/**
 * Loads resolved Start app graph diagnostics through a temporary Vite server.
 *
 * Returns an Effect so callers can compose diagnostics loading with their own
 * runtime and error handling.
 */
export const loadStartAppGraphDiagnostics = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  loadStartAppGraphDiagnosticsRawEffect(options);

/** Same as `loadStartAppGraphDiagnostics`, with a concrete load-error channel. */
export const loadStartAppGraphDiagnosticsEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  loadStartAppGraphDiagnosticsRawEffect(options);

/**
 * Runs the resolved Start diagnostics policy through Vite without requiring
 * application code to import `virtual:effect-ui/app-graph`.
 */
export const runStartViteDiagnosticsGateEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<void, StartAppGraphDiagnosticsLoadError> =>
  Effect.asVoid(loadStartAppGraphDiagnosticsRawEffect(options));
