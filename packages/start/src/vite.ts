import { Data, Effect } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve as resolvePath } from "node:path";
import type { InlineConfig, UserConfig } from "vite";
import {
  defaultServerEntry,
  fileRouteDiscoveryPlan,
  isFileRouteDiscoveryFile,
  makeStartFileRouteManifest,
  normalizeStartManifestIterableOptions,
  withDiscoveredFileRoutesSync,
  type SunfallArcStartOptions,
} from "./start-manifest-wall.js";
import {
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  loadStartVirtualModule,
  resolveStartVirtualModuleId,
} from "./start-virtual-modules.js";
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
export { StartDevServerError, StartHandlerNotFound } from "./start-vite-dev-ssr.js";

/** Vite resolved config fields used by the Start plugin. */
export interface SunfallArcStartResolvedConfig {
  readonly root: string;
  readonly command?: "build" | "serve";
  readonly mode?: string;
  readonly configFile?: string | false;
  readonly base?: string;
  readonly build?: {
    readonly outDir?: string;
    readonly manifest?: boolean | string;
  };
}

/** Vite plugin shape returned by `sunfallArcStart`. */
export interface SunfallArcStartPlugin {
  readonly name: typeof sunfallArcStartPluginName;
  readonly config: (
    config?: UserConfig,
    env?: { readonly command?: "build" | "serve"; readonly mode?: string },
  ) => UserConfig;
  readonly configResolved: (config: SunfallArcStartResolvedConfig) => void;
  readonly buildStart: () => void;
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

const serverOnlyModulePattern = /\.server\.(?:[cm]?[jt]sx?|tsrx)$/;

const isServerOnlyModule = (id: string): boolean =>
  serverOnlyModulePattern.test((id.split(/[?#]/, 1)[0] ?? id).replace(/\\/g, "/"));

// The temporary Vite server that prerenders the build runs the app's plugins
// without Start's own.
const isStartPlugin = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  ((value as { readonly name?: unknown }).name === sunfallArcStartPluginName ||
    (value as { readonly name?: unknown }).name === "sunfall-arc-tsrx-deps");

const withoutStartPlugins = (pluginOption: unknown): unknown => {
  if (Array.isArray(pluginOption)) {
    return pluginOption
      .map(withoutStartPlugins)
      .filter((plugin) => plugin !== undefined && !isStartPlugin(plugin));
  }
  return isStartPlugin(pluginOption) ? undefined : pluginOption;
};

const prerenderInlineConfig = (
  config: UserConfig,
  root: string,
  mode: string | undefined,
): InlineConfig => {
  const plugins = withoutStartPlugins(config.plugins) as InlineConfig["plugins"] | undefined;
  return {
    ...config,
    root,
    configFile: false,
    ...(mode === undefined ? {} : { mode }),
    logLevel: config.logLevel ?? "silent",
    ...(plugins === undefined ? {} : { plugins }),
  };
};

const isStaticClientBuild = (
  command: "build" | "serve" | undefined,
  options: SunfallArcStartOptions,
): boolean => {
  const policy = options.buildPolicy?.staticClient;
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
 * The plugin serves the file-route virtual modules, discovers file routes,
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
  let viteBase = "/";
  let viteBuildManifest: boolean | string | undefined;

  const currentOptions = (): SunfallArcStartOptions =>
    withDiscoveredFileRoutesSync({ ...normalizedOptions, serverEntry }, viteRoot);

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
      const manifest = config.build?.manifest;
      return {
        appType: "custom",
        // Prerendering swaps the dev entry for the built assets listed in Vite's build manifest.
        ...(env?.command === "build" && normalizedOptions.prerender && !config.build?.ssr
          ? { build: { manifest: typeof manifest === "string" ? manifest : true } }
          : {}),
        define: {
          // Static-client builds compile the RPC client out of `App.launch`.
          __SUNFALL_ARC_BROWSER_RPC__: JSON.stringify(
            !isStaticClientBuild(env?.command, normalizedOptions),
          ),
        },
      };
    },
    configResolved(config) {
      viteRoot = config.root;
      viteCommand = config.command;
      viteMode = config.mode;
      viteOutDir = config.build?.outDir ?? "dist";
      viteBase = config.base ?? "/";
      viteBuildManifest = config.build?.manifest;
      refreshFileRouteArtifacts();
    },
    buildStart() {
      refreshFileRouteArtifacts();
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
          vite: prerenderInlineConfig(viteUserConfig, viteRoot, viteMode),
          base: viteBase,
          ...(typeof viteBuildManifest === "string" ? { buildManifest: viteBuildManifest } : {}),
          serverEntry,
          ...(normalizedOptions.handlerExport === undefined
            ? {}
            : { handlerExport: normalizedOptions.handlerExport }),
          ...(viteMode === undefined ? {} : { mode: viteMode }),
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
      if (isServerOnlyModule(id) && !options?.ssr) {
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
