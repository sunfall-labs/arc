import { Data, Effect } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve as resolvePath } from "node:path";
import type { UserConfig } from "vite";
import {
  createStartManifestWallDefineValues,
  defaultServerEntry,
  fileRouteDiscoveryPlan,
  isFileRouteDiscoveryFile,
  makeStartBuildAppGraphEffect,
  makeStartFileRouteManifestEffect,
  normalizeStartManifestIterableOptions,
  normalizeStartBuildPolicy,
  withDiscoveredFileRoutes,
  type EffectUiStartOptions,
} from "./start-manifest-wall.js";
import {
  appGraphRuntimeDiagnosticsVirtualModuleId,
  appGraphVirtualModuleId,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId,
} from "./start-virtual-modules.js";
import {
  runStartViteDiagnosticsGateEffect,
  startDiagnosticsInlineConfig,
} from "./start-vite-diagnostics-loader.js";
import {
  shouldWriteFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFile,
  type FileRouteDefinitionsFileWriteResult,
} from "./generated-route-definitions.js";
import {
  handleSsrDevMiddlewareEffect,
  startDevServerFromVite,
  type StartDevMiddlewareNext,
  type StartViteDevServer,
} from "./start-vite-dev-ssr.js";
import { forkStartHostEffect, runStartHostPromise } from "./start-host-runtime-runner.js";
import { isStartManifestServerOnlyModule } from "./manifest-entry-core.js";
import { effectUiStartPluginName } from "./start-vite-plugin-names.js";
import {
  loadStartRouteComponentSplitModule,
  resolveStartRouteComponentSplitModuleId,
  transformStartRouteAutoCodeSplitting,
} from "./route-code-splitting.js";
import { runStartPrerenderEffect } from "./start-prerender.js";

export {
  defaultFileRouteDirectory,
  defaultFileRouteGeneratedFile,
  defaultServerEntry,
  defaultStartBuildPolicy,
  defaultStartBuildWireSchemaPolicy,
  discoverFileRoutes,
  discoverFileRoutesEffect,
  FileRouteDiscoveryError,
  makeStartActionManifestEffect,
  makeStartAppGraphEffect,
  makeStartBuildAppGraphEffect,
  makeStartFileRouteManifestEffect,
  makeStartServerFunctionManifestEffect,
  serializeStartActionManifest,
  serializeStartAppGraph,
  serializeStartFileRouteManifest,
  serializeStartServerFunctionManifest,
  StartManifestDirectReferenceError,
  validateStartBuildPolicyEffect,
} from "./start-manifest-wall.js";
export type {
  EffectUiStartOptions,
  FileRouteDiscoveryOptions,
  FileRouteGenerationOptions,
  StartAppGraphError,
  StartBuildPolicy,
  StartBuildPolicyError,
  StartViteDevSsrOptions,
  StartManifestDirectReferenceKind,
} from "./start-manifest-wall.js";
export type {
  ResolvedStartPrerenderOptions,
  StartPrerenderConfig,
  StartPrerenderFailureEvent,
  StartPrerenderOptions,
  StartPrerenderPage,
  StartPrerenderPageContext,
  StartPrerenderPageInput,
  StartPrerenderPageOptions,
  StartPrerenderPlannedPage,
  StartPrerenderResult,
  StartPrerenderRunOptions,
  StartPrerenderSuccessEvent,
} from "./start-prerender.js";
export {
  planStartPrerenderPages,
  resolveStartPrerenderOptions,
  runStartPrerenderEffect,
  StartPrerenderError,
} from "./start-prerender.js";
export {
  actionManifestVirtualModuleId,
  appGraphVirtualModuleId,
  createActionManifestVirtualModule,
  createFileRouteDefinitionsVirtualModule,
  createFileRouteManifestVirtualModule,
  createServerFunctionManifestVirtualModule,
  createStartAppGraphRuntimeDiagnosticsVirtualModule,
  createStartAppGraphVirtualModule,
  appGraphRuntimeDiagnosticsVirtualModuleId,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  serverFunctionManifestVirtualModuleId,
} from "./start-virtual-modules.js";
export {
  FileRouteDefinitionsOutputPathError,
  FileRouteDefinitionsFileWriteError,
  writeFileRouteDefinitionsFileEffect,
  writeFileRouteDefinitionsFile,
} from "./generated-route-definitions.js";
export type {
  FileRouteDefinitionsFileWriteFailure,
  FileRouteDefinitionsFileWriteResult,
} from "./generated-route-definitions.js";
export {
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
} from "./app-graph.js";
export {
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
} from "./start-app-graph-diagnostics-policy.js";
export {
  StartDevServerError,
  StartHandlerNotFound,
  handleSsrDevMiddlewareEffect,
  handleSsrDevRequest,
  handleSsrDevRequestEffect,
  isHtmlResponse,
  resolveStartHandler,
  resolveStartHandlerEffect,
  shouldHandleSsrRequest,
  startDevServerFromVite,
} from "./start-vite-dev-ssr.js";
export type {
  HandleSsrDevMiddlewareOptions,
  HandleSsrDevRequestOptions,
  StartDevMiddlewareNext,
  StartDevServer,
  StartSsrHandlerModule,
  StartSsrRequestHandler,
  StartViteDevServer,
} from "./start-vite-dev-ssr.js";
export {
  loadStartRouteComponentSplitModule,
  resolveStartRouteComponentSplitModuleId,
  startRouteComponentSplitVirtualModuleId,
  transformStartRouteAutoCodeSplitting,
} from "./route-code-splitting.js";
export type { StartRouteAutoCodeSplittingOptions } from "./route-code-splitting.js";
export {
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  StartAppGraphDiagnosticsRunnerError,
} from "./start-vite-diagnostics-loader.js";
export type {
  LoadedStartAppGraphDiagnostics,
  LoadStartAppGraphDiagnosticsOptions,
  StartAppGraphDiagnosticsLoadError,
} from "./start-vite-diagnostics-loader.js";

/** Vite resolved config fields used by the Start plugin. */
export interface EffectUiStartResolvedConfig {
  readonly root: string;
  readonly command?: "build" | "serve";
  readonly mode?: string;
  readonly configFile?: string | false;
  readonly build?: {
    readonly outDir?: string;
  };
}

/** Vite plugin shape returned by `effectUiStart`. */
export interface EffectUiStartPlugin {
  readonly name: typeof effectUiStartPluginName;
  readonly config: (config?: UserConfig) => UserConfig;
  readonly configResolved: (config: EffectUiStartResolvedConfig) => void;
  readonly buildStart: () => void | Promise<void>;
  readonly closeBundle: () => void | Promise<void>;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (
    code: string,
    id: string,
    options?: { readonly ssr?: boolean },
  ) => string | null;
  readonly configureServer: (
    server: StartViteDevServer & {
      readonly middlewares: {
        use: (
          handler: (
            request: IncomingMessage,
            response: ServerResponse,
            next: StartDevMiddlewareNext,
          ) => void,
        ) => void;
      };
    },
  ) => () => void;
  readonly handleHotUpdate?: (context: {
    readonly file: string;
    readonly server: {
      readonly moduleGraph: {
        getModuleById(id: string): unknown;
        invalidateModule(module: unknown): void;
      };
    };
  }) => void;
  readonly hotUpdate?: (context: {
    readonly type: "create" | "update" | "delete";
    readonly file: string;
    readonly server: {
      readonly moduleGraph: {
        getModuleById(id: string): unknown;
        invalidateModule(module: unknown): void;
      };
    };
  }) => void;
}

/** Error thrown when a browser build imports a `.server.*` module. */
export class StartServerOnlyModuleError extends Data.TaggedError("StartServerOnlyModuleError")<{
  readonly id: string;
}> {}

/**
 * Creates the Effect UI Start Vite plugin.
 *
 * The plugin wires manifests into virtual modules, discovers file routes,
 * enforces build policies, blocks server-only imports from browser builds, and
 * installs the dev SSR middleware.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   plugins: [effectUiStart({ serverEntry: "/src/server.tsx" })]
 * });
 * ```
 */
export const effectUiStart = (options: EffectUiStartOptions = {}): EffectUiStartPlugin => {
  const normalizedOptions = normalizeStartManifestIterableOptions(options);
  const serverEntry = normalizedOptions.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();
  let viteUserConfig: UserConfig = {};
  let viteCommand: "build" | "serve" | undefined;
  let viteMode: string | undefined;
  let viteOutDir = "dist";

  const currentOptions = (): EffectUiStartOptions =>
    withDiscoveredFileRoutes({ ...normalizedOptions, serverEntry }, viteRoot);

  const shouldRunDiagnosticsGate = (): boolean => {
    const policy = normalizeStartBuildPolicy(normalizedOptions.buildPolicy);
    return (
      viteCommand === "build" && policy?.diagnostics !== undefined && policy.diagnostics !== false
    );
  };

  const runCurrentDiagnosticsGate = (): Promise<void> =>
    runStartHostPromise(
      runStartViteDiagnosticsGateEffect({
        root: viteRoot,
        configFile: false,
        ...(viteMode === undefined ? {} : { mode: viteMode }),
        start: currentOptions(),
        vite: startDiagnosticsInlineConfig(viteUserConfig, viteRoot, viteMode),
      }),
    );

  const writeCurrentFileRouteDefinitions = (): FileRouteDefinitionsFileWriteResult | undefined => {
    const activeOptions = currentOptions();
    if (!shouldWriteFileRouteDefinitionsFile(viteRoot, activeOptions, normalizedOptions)) {
      return undefined;
    }

    return writeFileRouteDefinitionsFile(
      viteRoot,
      Effect.runSync(makeStartFileRouteManifestEffect(activeOptions)),
      activeOptions.fileRouteGeneration,
    );
  };
  const fileRouteVirtualModuleIds = [
    fileRouteManifestVirtualModuleId,
    fileRouteDefinitionsVirtualModuleId,
    appGraphVirtualModuleId,
    appGraphRuntimeDiagnosticsVirtualModuleId,
  ] as const;
  const invalidateFileRouteVirtualModules = (server: {
    readonly moduleGraph: {
      getModuleById(id: string): unknown;
      invalidateModule(module: unknown): void;
    };
  }): void => {
    for (const id of fileRouteVirtualModuleIds) {
      const resolved = resolveStartVirtualModuleId(id);
      if (resolved === null) {
        continue;
      }
      const module = server.moduleGraph.getModuleById(resolved);
      if (module !== undefined) {
        server.moduleGraph.invalidateModule(module);
      }
    }
  };
  const isFileRouteUpdate = (file: string): boolean => {
    const activeOptions = currentOptions();
    return isFileRouteDiscoveryFile(
      fileRouteDiscoveryPlan({
        root: viteRoot,
        ...(activeOptions.fileRouteOptions?.routeDirectory === undefined
          ? {}
          : { routeDirectory: activeOptions.fileRouteOptions.routeDirectory }),
        ...(activeOptions.fileRouteOptions?.extensions === undefined
          ? {}
          : { extensions: activeOptions.fileRouteOptions.extensions }),
        ...(activeOptions.fileRouteGeneration === undefined
          ? {}
          : { fileRouteGeneration: activeOptions.fileRouteGeneration }),
      }),
      file,
    );
  };
  const refreshFileRouteArtifacts = (server?: {
    readonly moduleGraph: {
      getModuleById(id: string): unknown;
      invalidateModule(module: unknown): void;
    };
  }): void => {
    writeCurrentFileRouteDefinitions();
    if (server !== undefined) {
      invalidateFileRouteVirtualModules(server);
    }
  };

  return {
    name: effectUiStartPluginName,
    config(config: UserConfig = {}) {
      viteUserConfig = config;
      viteRoot = resolvePath(config.root ?? process.cwd());
      const activeOptions = currentOptions();
      const graph = Effect.runSync(makeStartBuildAppGraphEffect(activeOptions));

      return {
        appType: "custom",
        define: createStartManifestWallDefineValues(graph),
      };
    },
    configResolved(config) {
      viteRoot = config.root;
      viteCommand = config.command;
      viteMode = config.mode;
      viteOutDir = config.build?.outDir ?? "dist";
      refreshFileRouteArtifacts();
    },
    buildStart() {
      refreshFileRouteArtifacts();
      if (shouldRunDiagnosticsGate()) {
        return runCurrentDiagnosticsGate();
      }
    },
    closeBundle() {
      if (viteCommand !== "build" || normalizedOptions.prerender === undefined) {
        return undefined;
      }
      const activeOptions = currentOptions();
      const prerenderRunnerOptions =
        normalizedOptions.devSsr?.runOptions === undefined
          ? {}
          : { runOptions: normalizedOptions.devSsr.runOptions };
      return runStartHostPromise(
        runStartPrerenderEffect({
          root: viteRoot,
          outDir: viteOutDir,
          manifest: Effect.runSync(makeStartFileRouteManifestEffect(activeOptions)),
          prerender: activeOptions.prerender ?? normalizedOptions.prerender,
          vite: startDiagnosticsInlineConfig(viteUserConfig, viteRoot, viteMode),
          serverEntry,
          ...(normalizedOptions.handlerExport === undefined
            ? {}
            : { handlerExport: normalizedOptions.handlerExport }),
          ...(viteMode === undefined ? {} : { mode: viteMode }),
          ...(normalizedOptions.nodeRequest === undefined
            ? {}
            : { nodeRequest: normalizedOptions.nodeRequest }),
        }).pipe(Effect.asVoid),
        prerenderRunnerOptions,
      );
    },
    resolveId(id) {
      return resolveStartRouteComponentSplitModuleId(id) ?? resolveStartVirtualModuleId(id);
    },
    load(id) {
      const splitModule = loadStartRouteComponentSplitModule(id);
      if (splitModule !== null) {
        return splitModule;
      }
      const activeOptions = currentOptions();
      return Effect.runSync(loadStartVirtualModuleEffect(id, activeOptions));
    },
    transform(code, id, options) {
      if (isServerOnlyModule(id) && !options?.ssr) {
        throw new StartServerOnlyModuleError({ id });
      }
      const activeOptions = currentOptions();
      if (!options?.ssr && activeOptions.autoCodeSplitting !== false && isFileRouteUpdate(id)) {
        return transformStartRouteAutoCodeSplitting(code, id, { root: viteRoot });
      }
      return null;
    },
    configureServer(server) {
      const startServer = startDevServerFromVite(server);
      return () => {
        server.middlewares.use((request, response, next) => {
          const activeOptions = currentOptions();
          const devSsr = activeOptions.devSsr;

          try {
            forkStartHostEffect(
              handleSsrDevMiddlewareEffect(startServer, request, response, next, {
                serverEntry,
                ...(activeOptions.rpcPath === undefined ? {} : { rpcPath: activeOptions.rpcPath }),
                ...(activeOptions.actionPath === undefined
                  ? {}
                  : { actionPath: activeOptions.actionPath }),
                ...(normalizedOptions.handlerExport === undefined
                  ? {}
                  : { handlerExport: normalizedOptions.handlerExport }),
                ...(devSsr?.runOptions === undefined ? {} : { runOptions: devSsr.runOptions }),
                nodeRequest: {
                  ...normalizedOptions.nodeRequest,
                },
              }),
              devSsr,
            );
          } catch (error) {
            try {
              next(error);
            } catch {
              // Vite owns middleware error reporting; setup failures should not escape.
            }
          }
        });
      };
    },
    hotUpdate(context) {
      if (isFileRouteUpdate(context.file)) {
        refreshFileRouteArtifacts(context.server);
      }
    },
    handleHotUpdate(context) {
      if (isFileRouteUpdate(context.file)) {
        refreshFileRouteArtifacts(context.server);
      }
    },
  };
};

/** Detects `.server.*` modules that must not be imported by browser builds. */
export const isServerOnlyModule = (id: string): boolean => {
  return isStartManifestServerOnlyModule(id);
};
