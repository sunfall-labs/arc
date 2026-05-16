import { Data, Effect } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve as resolvePath } from "node:path";
import type { UserConfig } from "vite";
import {
  createStartManifestWallDefineValues,
  defaultServerEntry,
  makeStartBuildAppGraphEffect,
  makeStartFileRouteManifestEffect,
  normalizeStartBuildPolicy,
  withDiscoveredFileRoutes,
  type EffectUiStartOptions
} from "./start-manifest-wall.js";
import {
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId
} from "./start-virtual-modules.js";
import {
  runStartViteDiagnosticsGateEffect,
  startDiagnosticsInlineConfig
} from "./start-vite-diagnostics-loader.js";
import {
  shouldWriteFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFile,
  type FileRouteDefinitionsFileWriteResult
} from "./generated-route-definitions.js";
import {
  handleSsrDevMiddlewareEffect,
  startDevServerFromVite,
  type StartDevMiddlewareNext,
  type StartViteDevServer
} from "./start-vite-dev-ssr.js";
import {
  forkStartHostEffect,
  runStartHostPromise
} from "./start-host-runtime-runner.js";
import { isStartManifestServerOnlyModule } from "./manifest-entry-core.js";

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
  validateStartBuildPolicyEffect
} from "./start-manifest-wall.js";
export type {
  EffectUiStartOptions,
  FileRouteDiscoveryOptions,
  FileRouteGenerationOptions,
  StartAppGraphError,
  StartBuildPolicy,
  StartBuildPolicyError,
  StartManifestDirectReferenceKind
} from "./start-manifest-wall.js";
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
  serverFunctionManifestVirtualModuleId
} from "./start-virtual-modules.js";
export {
  FileRouteDefinitionsFileWriteError,
  writeFileRouteDefinitionsFileEffect,
  writeFileRouteDefinitionsFile
} from "./generated-route-definitions.js";
export type {
  FileRouteDefinitionsFileWriteFailure,
  FileRouteDefinitionsFileWriteResult
} from "./generated-route-definitions.js";
export {
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior
} from "./app-graph.js";
export {
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect
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
  startDevServerFromVite
} from "./start-vite-dev-ssr.js";
export type {
  HandleSsrDevRequestOptions,
  StartDevMiddlewareNext,
  StartDevServer,
  StartSsrRequestHandler,
  StartViteDevServer
} from "./start-vite-dev-ssr.js";
export {
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  StartAppGraphDiagnosticsRunnerError
} from "./start-vite-diagnostics-loader.js";
export type {
  LoadedStartAppGraphDiagnostics,
  LoadStartAppGraphDiagnosticsOptions,
  StartAppGraphDiagnosticsLoadError
} from "./start-vite-diagnostics-loader.js";

/** Vite resolved config fields used by the Start plugin. */
export interface EffectUiStartResolvedConfig {
  readonly root: string;
  readonly command?: "build" | "serve";
  readonly mode?: string;
}

/** Vite plugin shape returned by `effectUiStart`. */
export interface EffectUiStartPlugin {
  readonly name: "effect-ui-start";
  readonly config: (config?: UserConfig) => UserConfig;
  readonly configResolved: (config: EffectUiStartResolvedConfig) => void;
  readonly buildStart: () => void | Promise<void>;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (
    code: string,
    id: string,
    options?: { readonly ssr?: boolean }
  ) => null;
  readonly configureServer: (
    server: StartViteDevServer & {
      readonly middlewares: {
        use: (
          handler: (
            request: IncomingMessage,
            response: ServerResponse,
            next: StartDevMiddlewareNext
          ) => void
        ) => void;
      };
    }
  ) => () => void;
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
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();
  let viteUserConfig: UserConfig = {};
  let viteCommand: "build" | "serve" | undefined;
  let viteMode: string | undefined;

  const currentOptions = (): EffectUiStartOptions =>
    withDiscoveredFileRoutes({ ...options, serverEntry }, viteRoot);

  const shouldRunDiagnosticsGate = (): boolean => {
    const policy = normalizeStartBuildPolicy(options.buildPolicy);
    return viteCommand === "build" &&
      policy?.diagnostics !== undefined &&
      policy.diagnostics !== false;
  };

  const runCurrentDiagnosticsGate = (): Promise<void> =>
    runStartHostPromise(
      runStartViteDiagnosticsGateEffect({
        root: viteRoot,
        configFile: false,
        ...(viteMode === undefined ? {} : { mode: viteMode }),
        start: currentOptions(),
        vite: startDiagnosticsInlineConfig(viteUserConfig, viteRoot, viteMode)
      })
    );

  const writeCurrentFileRouteDefinitions = (): FileRouteDefinitionsFileWriteResult | undefined => {
    const activeOptions = currentOptions();
    if (!shouldWriteFileRouteDefinitionsFile(viteRoot, activeOptions, options)) {
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
      viteUserConfig = config;
      viteRoot = resolvePath(config.root ?? process.cwd());
      const activeOptions = currentOptions();
      const graph = Effect.runSync(makeStartBuildAppGraphEffect(activeOptions));

      return {
        appType: "custom",
        define: createStartManifestWallDefineValues(graph)
      };
    },
    configResolved(config) {
      viteRoot = config.root;
      viteCommand = config.command;
      viteMode = config.mode;
      writeCurrentFileRouteDefinitions();
    },
    buildStart() {
      writeCurrentFileRouteDefinitions();
      if (shouldRunDiagnosticsGate()) {
        return runCurrentDiagnosticsGate();
      }
    },
    resolveId(id) {
      return resolveStartVirtualModuleId(id);
    },
    load(id) {
      const activeOptions = currentOptions();
      return Effect.runSync(loadStartVirtualModuleEffect(id, activeOptions));
    },
    transform(_code, id, options) {
      if (isServerOnlyModule(id) && !options?.ssr) {
        throw new StartServerOnlyModuleError({ id });
      }
      return null;
    },
    configureServer(server) {
      const startServer = startDevServerFromVite(server);
      return () => {
        server.middlewares.use((request, response, next) => {
          const activeOptions = currentOptions();
          void forkStartHostEffect(
            handleSsrDevMiddlewareEffect(
              startServer,
              request,
              response,
              next,
              {
                serverEntry,
                ...(activeOptions.rpcPath === undefined
                  ? {}
                  : { rpcPath: activeOptions.rpcPath }),
                ...(activeOptions.actionPath === undefined
                  ? {}
                  : { actionPath: activeOptions.actionPath }),
                ...(options.handlerExport === undefined
                  ? {}
                  : { handlerExport: options.handlerExport }),
                ...(options.nodeRequest === undefined
                  ? {}
                  : { nodeRequest: options.nodeRequest })
              }
            )
          );
        });
      };
    }
  };
};

/** Detects `.server.*` modules that must not be imported by browser builds. */
export const isServerOnlyModule = (id: string): boolean => {
  return isStartManifestServerOnlyModule(id);
};
