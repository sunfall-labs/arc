import { Data, Effect } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { UserConfig } from "vite";
import {
  createStartManifestWallDefineValues,
  defaultServerEntry,
  fileRouteDiscoveryPlan,
  isFileRouteDiscoveryFile,
  makeStartBuildAppGraph,
  makeStartFileRouteManifest,
  normalizeStartManifestIterableOptions,
  normalizeStartBuildPolicy,
  withDiscoveredFileRoutesSync,
  type StartManifestOptions,
  type SunfallArcStartOptions,
} from "./start-manifest-wall.js";
import {
  deriveStartDefinitionSources,
  type StartDefinitionSourcesError,
  type StartDerivedDefinitionSources,
} from "./start-definition-sources.js";
import {
  appGraphRuntimeDiagnosticsVirtualModuleId,
  appGraphVirtualModuleId,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  loadStartVirtualModule,
  resolveStartVirtualModuleId,
} from "./start-virtual-modules.js";
import {
  runStartViteDiagnosticsGate,
  startDiagnosticsInlineConfig,
} from "./start-vite-diagnostics-loader.js";
import {
  shouldWriteFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFile,
  type FileRouteDefinitionsFileWriteResult,
} from "./generated-route-definitions.js";
import {
  handleSsrDevMiddleware,
  startDevServerFromVite,
  type StartDevMiddlewareNext,
  type StartViteDevServer,
} from "./start-vite-dev-ssr.js";
import { forkStartHost, runStartHostPromise } from "./start-host-runtime-runner.js";
import { isStartManifestServerOnlyModule } from "./manifest-entry-core.js";
import { sunfallArcStartPluginName } from "./start-vite-plugin-names.js";
import {
  isStartRouteCodeSplitModule,
  loadStartRouteComponentSplitModule,
  resolveStartRouteComponentSplitModuleId,
  transformStartRouteAutoCodeSplitting,
} from "./route-code-splitting.js";
import { runStartPrerender } from "./start-prerender.js";

export type {
  SunfallArcStartOptions,
  FileRouteDiscoveryOptions,
  FileRouteGenerationOptions,
  StartBuildPolicy,
  StartBuildPolicyError,
  StartStaticClientPolicy,
  StartViteDevSsrOptions,
} from "./start-manifest-wall.js";
export { FileRouteDiscoveryError } from "./start-manifest-wall.js";
export type { FileRouteManifestOptions } from "./file-routes.js";
export type {
  StartPrerenderConfig,
  StartPrerenderFailureEvent,
  StartPrerenderOptions,
  StartPrerenderPage,
  StartPrerenderPageContext,
  StartPrerenderPageInput,
  StartPrerenderSuccessEvent,
} from "./start-prerender.js";
export { StartPrerenderError } from "./start-prerender.js";
export {
  FileRouteDefinitionsOutputPathError,
  FileRouteDefinitionsFileWriteError,
} from "./generated-route-definitions.js";
export { StartAppGraphMissingWireSchemas } from "./app-graph.js";
export {
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
} from "./start-app-graph-diagnostics-policy.js";
export { StartDevServerError, StartHandlerNotFound } from "./start-vite-dev-ssr.js";
export { StartAppGraphDiagnosticsRunnerError } from "./start-vite-diagnostics-loader.js";

/** Vite resolved config fields used by the Start plugin. */
export interface SunfallArcStartResolvedConfig {
  readonly root: string;
  readonly command?: "build" | "serve";
  readonly mode?: string;
  readonly configFile?: string | false;
  readonly build?: {
    readonly outDir?: string;
  };
}

/** Vite plugin shape returned by `sunfallArcStart`. */
export interface SunfallArcStartPlugin {
  readonly name: typeof sunfallArcStartPluginName;
  readonly config: (
    config?: UserConfig,
    env?: { readonly command?: "build" | "serve"; readonly mode?: string },
  ) => Promise<UserConfig>;
  readonly configResolved: (config: SunfallArcStartResolvedConfig) => void;
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

const isStaticClientBuild = (
  command: "build" | "serve" | undefined,
  options: SunfallArcStartOptions,
): boolean => {
  const policy = normalizeStartBuildPolicy(options.buildPolicy)?.staticClient;
  return (
    command === "build" &&
    policy !== undefined &&
    policy !== false &&
    policy.target === "static" &&
    policy.forbidBrowserRpc !== false
  );
};

/**
 * Creates the Sunfall Arc Start Vite plugin.
 *
 * The plugin wires manifests into virtual modules, discovers file routes,
 * enforces build policies, blocks server-only imports from browser builds, and
 * installs the dev SSR middleware.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   plugins: [sunfallArcStart({ serverEntry: "/src/server.tsx" })]
 * });
 * ```
 */
export const sunfallArcStart = (options: SunfallArcStartOptions = {}): SunfallArcStartPlugin => {
  const normalizedOptions = normalizeStartManifestIterableOptions(options);
  const serverEntry = normalizedOptions.serverEntry ?? defaultServerEntry;
  let viteRoot = process.cwd();
  let viteUserConfig: UserConfig = {};
  let viteCommand: "build" | "serve" | undefined;
  let viteMode: string | undefined;
  let viteOutDir = "dist";
  let derivedSources: StartDerivedDefinitionSources | undefined;

  const currentOptions = (): StartManifestOptions =>
    withDiscoveredFileRoutesSync(
      { ...normalizedOptions, ...derivedSources, serverEntry },
      viteRoot,
    );

  // Server functions and Actions come only from what the server entry's
  // handler serves.
  const deriveSourcesEffect = (
    command: "build" | "serve" | undefined,
    mode: string | undefined,
  ): Effect.Effect<StartDerivedDefinitionSources | undefined, StartDefinitionSourcesError> =>
    deriveStartDefinitionSources({
      root: viteRoot,
      serverEntry,
      ...(normalizedOptions.handlerExport === undefined
        ? {}
        : { handlerExport: normalizedOptions.handlerExport }),
      vite: startDiagnosticsInlineConfig(viteUserConfig, viteRoot, mode),
    }).pipe(
      Effect.catchTag("StartDefinitionSourcesLoadError", (error) =>
        // A dev server still starts on a broken server module; its SSR
        // middleware reports the error per request. Builds fail.
        command === "build"
          ? Effect.fail(error)
          : Effect.logWarning(
              `[sunfall-arc-start] ${error.message} The app graph lists no server functions or Actions until the server entry loads.`,
            ).pipe(Effect.as(undefined)),
      ),
    );

  const shouldRunDiagnosticsGate = (): boolean => {
    const policy = normalizeStartBuildPolicy(normalizedOptions.buildPolicy);
    return (
      viteCommand === "build" && policy?.diagnostics !== undefined && policy.diagnostics !== false
    );
  };

  const runCurrentDiagnosticsGate = (): Promise<void> =>
    runStartHostPromise(
      runStartViteDiagnosticsGate({
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

    return Effect.runSync(
      Effect.flatMap(makeStartFileRouteManifest(activeOptions), (manifest) =>
        writeFileRouteDefinitionsFile(viteRoot, manifest, activeOptions.fileRouteGeneration),
      ),
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
    name: sunfallArcStartPluginName,
    config(config: UserConfig = {}, env) {
      viteUserConfig = config;
      viteRoot = resolvePath(config.root ?? process.cwd());
      return runStartHostPromise(
        Effect.gen(function* () {
          if (existsSync(resolvePath(viteRoot, `.${serverEntry}`))) {
            // Deriving loads the server entry, which imports the generated routes.
            writeCurrentFileRouteDefinitions();
          }
          derivedSources = yield* deriveSourcesEffect(env?.command, env?.mode);
          const activeOptions = currentOptions();
          const graph = yield* makeStartBuildAppGraph(activeOptions);
          const userConfig: UserConfig = {
            appType: "custom",
            define: {
              ...createStartManifestWallDefineValues(graph),
              // Static-client builds compile the RPC client out of `App.launch`.
              __SUNFALL_ARC_BROWSER_RPC__: JSON.stringify(
                !isStaticClientBuild(env?.command, activeOptions),
              ),
            },
          };
          return userConfig;
        }),
      );
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
        runStartPrerender({
          root: viteRoot,
          outDir: viteOutDir,
          manifest: Effect.runSync(makeStartFileRouteManifest(activeOptions)),
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
      return Effect.runSync(loadStartVirtualModule(id, activeOptions));
    },
    transform(code, id, options) {
      if (isStartManifestServerOnlyModule(id) && !options?.ssr) {
        throw new StartServerOnlyModuleError({ id });
      }
      const activeOptions = currentOptions();
      if (
        !options?.ssr &&
        activeOptions.autoCodeSplitting !== false &&
        isStartRouteCodeSplitModule(id, viteRoot)
      ) {
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
            forkStartHost(
              handleSsrDevMiddleware(startServer, request, response, next, {
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
