import { Data, Effect } from "effect";
import { createServer, type InlineConfig, type UserConfig } from "vite";
import type {
  StartAppGraph,
  StartAppGraphDiagnostics
} from "./app-graph.js";
import {
  decodeStartAppGraphDiagnosticsDtoEffect,
  deserializeStartAppGraph
} from "./app-graph.js";
import type {
  StartAppGraphDiagnosticsPolicyException,
  StartAppGraphDiagnosticsPolicyViolation
} from "./start-app-graph-diagnostics-policy.js";
import {
  defaultServerEntry,
  withDiscoveredFileRoutes,
  type EffectUiStartOptions
} from "./start-manifest-wall.js";
import {
  appGraphRuntimeDiagnosticsVirtualModuleId,
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId
} from "./start-virtual-modules.js";

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
  | StartAppGraphDiagnosticsPolicyException;

type StartDiagnosticsViteServer = Pick<
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
  readonly name: "effect-ui-start-virtual-modules";
  readonly configResolved: (config: { readonly root: string }) => void;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
}

const effectUiStartVirtualModules = (
  options: EffectUiStartOptions = {}
): EffectUiStartVirtualModulesPlugin => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();
  const currentOptions = (): EffectUiStartOptions =>
    withDiscoveredFileRoutes({ ...options, serverEntry }, viteRoot);

  return {
    name: "effect-ui-start-virtual-modules",
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
  (value.name === "effect-ui-start" || value.name === "effect-ui-start-virtual-modules");

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
  const inlinePlugins = removeStartPlugins(inlineConfig.plugins) as InlineConfig["plugins"] | undefined;
  const plugins = [
    ...pluginOptionArray(inlinePlugins),
    ...(options.start === undefined ? [] : [effectUiStartVirtualModules(options.start)])
  ];
  const root = options.root ?? inlineConfig.root;
  const configFile = options.configFile ?? inlineConfig.configFile;
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
): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => server.close(),
    catch: (cause) => cause
  }).pipe(
    Effect.catch((cause) => Effect.die(cause)),
    Effect.asVoid
  );

const acquireStartDiagnosticsViteServerEffect = (
  options: LoadStartAppGraphDiagnosticsOptions
) =>
  Effect.acquireRelease(
    startDiagnosticsViteServerEffect(options),
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

    return {
      graph,
      diagnostics: dto.diagnostics,
      diagnosticsPolicyViolations: dto.diagnosticsPolicyViolations
    };
  });

const loadStartAppGraphDiagnosticsRawEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* acquireStartDiagnosticsViteServerEffect(options);
      const module = yield* Effect.tryPromise({
        try: () => server.ssrLoadModule(appGraphRuntimeDiagnosticsVirtualModuleId),
        catch: (cause) =>
          diagnosticsRunnerError(
            "Could not load resolved Effect UI app graph diagnostics through Vite.",
            cause
          )
      });

      return yield* startAppGraphDiagnosticsFromModuleEffect(module);
    })
  );

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
