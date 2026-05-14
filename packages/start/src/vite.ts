import { Cause, Data, Effect } from "effect";
import { runFork, toEffect, type EffectInput } from "@effect-ui/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve as resolvePath } from "node:path";
import { createServer, type InlineConfig, type UserConfig } from "vite";
import { nodeRequestToWebRequestEffect, writeNodeResponseEffect } from "./adapters.js";
import type {
  StartAppGraph,
  StartAppGraphDiagnostics,
  StartAppGraphDiagnosticsPolicyException,
  StartAppGraphDiagnosticsPolicyViolation
} from "./app-graph.js";
import { deserializeStartAppGraph } from "./app-graph.js";
import type { StartRequestHandlerError } from "./start-request-handler.js";
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
  appGraphVirtualModuleId,
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId
} from "./start-virtual-modules.js";
import {
  shouldWriteFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFile,
  type FileRouteDefinitionsFileWriteResult
} from "./generated-route-definitions.js";
import { serverActionPath, serverRpcPath } from "./rpc.js";

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
  validateStartBuildPolicyEffect
} from "./start-manifest-wall.js";
export type {
  EffectUiStartOptions,
  FileRouteDiscoveryOptions,
  FileRouteGenerationOptions,
  StartAppGraphError,
  StartBuildPolicy,
  StartBuildPolicyError
} from "./start-manifest-wall.js";
export {
  actionManifestVirtualModuleId,
  appGraphVirtualModuleId,
  createActionManifestVirtualModule,
  createFileRouteDefinitionsVirtualModule,
  createFileRouteManifestVirtualModule,
  createServerFunctionManifestVirtualModule,
  createStartAppGraphVirtualModule,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  serverFunctionManifestVirtualModuleId
} from "./start-virtual-modules.js";
export {
  writeFileRouteDefinitionsFile
} from "./generated-route-definitions.js";
export type {
  FileRouteDefinitionsFileWriteResult
} from "./generated-route-definitions.js";
export {
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect
} from "./app-graph.js";

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
    server: StartDevServer & {
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

/**
 * Handler export shape used by the Vite dev SSR middleware.
 *
 * Dev SSR accepts a plain `Response` or an Effect so server entries can stay
 * Effect-first without adding a Promise wrapper inside application code.
 */
export type StartSsrRequestHandler<HandlerError = StartRequestHandlerError> = (
  request: Request
) => Response | Effect.Effect<Response, HandlerError, unknown>;

/** Minimal Vite dev server surface used by Start SSR middleware. */
export interface StartDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  transformIndexHtml(url: string, html: string): Promise<string>;
  ssrFixStacktrace?(error: Error): void;
}

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

export type StartAppGraphDiagnosticsLoadError =
  | StartAppGraphDiagnosticsRunnerError
  | StartAppGraphDiagnosticsPolicyException;

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

/** Options for resolving the SSR handler export in Vite dev. */
export interface HandleSsrDevRequestOptions {
  readonly serverEntry?: string;
  readonly handlerExport?: string;
}

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

const startDiagnosticsInlineConfig = (
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

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isStartAppGraphDiagnostics = (
  value: unknown
): value is StartAppGraphDiagnostics =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.routeCount === "number" &&
  typeof value.serverFunctionCount === "number" &&
  typeof value.actionCount === "number" &&
  isStringArray(value.routePaths) &&
  Array.isArray(value.routeModules) &&
  Array.isArray(value.serverFunctionModules) &&
  Array.isArray(value.actionModules) &&
  Array.isArray(value.resourceFamilies) &&
  Array.isArray(value.resourceTags) &&
  Array.isArray(value.collectionDefinitions) &&
  isStringArray(value.serverOnlyModules) &&
  isStringArray(value.browserClientModules) &&
  typeof value.rpcPath === "string" &&
  typeof value.actionPath === "string" &&
  isRecord(value.schemaCoverage) &&
  Array.isArray(value.missingSchemas) &&
  Array.isArray(value.unknownActionBehavior) &&
  Array.isArray(value.unknownRoutePreloadResources) &&
  Array.isArray(value.unknownRoutePreloadCollections);

const isStartAppGraphDiagnosticsPolicyViolation = (
  value: unknown
): value is StartAppGraphDiagnosticsPolicyViolation =>
  isRecord(value) &&
  (value._tag === "UnknownRoutePreloadResources" ||
    value._tag === "UnknownRoutePreloadCollections") &&
  typeof value.message === "string" &&
  Array.isArray(value.routes);

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

    if (!isStartAppGraphDiagnostics(module.diagnostics)) {
      return yield* Effect.fail(
        diagnosticsRunnerError(
          "The loaded Effect UI app graph virtual module did not export valid diagnostics.",
          module.diagnostics
        )
      );
    }

    if (
      !Array.isArray(module.diagnosticsPolicyViolations) ||
      !module.diagnosticsPolicyViolations.every(isStartAppGraphDiagnosticsPolicyViolation)
    ) {
      return yield* Effect.fail(
        diagnosticsRunnerError(
          "The loaded Effect UI app graph virtual module did not export valid diagnostics policy violations.",
          module.diagnosticsPolicyViolations
        )
      );
    }

    return {
      graph,
      diagnostics: module.diagnostics,
      diagnosticsPolicyViolations: module.diagnosticsPolicyViolations
    };
  });

const loadStartAppGraphDiagnosticsRawEffect = (
  options: LoadStartAppGraphDiagnosticsOptions = {}
): Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError> =>
  Effect.gen(function* () {
    const inlineConfig = options.vite ?? {};
    const inlinePlugins = removeStartPlugins(inlineConfig.plugins) as InlineConfig["plugins"] | undefined;
    const plugins = [
      ...pluginOptionArray(inlinePlugins),
      ...(options.start === undefined ? [] : [effectUiStartVirtualModules(options.start)])
    ];
    const root = options.root ?? inlineConfig.root;
    const configFile = options.configFile ?? inlineConfig.configFile;
    const mode = options.mode ?? inlineConfig.mode;
    const server = yield* Effect.tryPromise({
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

    return yield* Effect.tryPromise({
      try: () => server.ssrLoadModule(appGraphVirtualModuleId),
      catch: (cause) =>
        diagnosticsRunnerError(
          "Could not load resolved Effect UI app graph diagnostics through Vite.",
          cause
        )
    }).pipe(
      Effect.flatMap(startAppGraphDiagnosticsFromModuleEffect),
      Effect.ensuring(
        Effect.tryPromise({
          try: () => server.close(),
          catch: (cause) => cause
        }).pipe(Effect.catch((cause) => Effect.die(cause)))
      )
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

/** Error raised when a dev SSR module does not export the configured handler. */
export class StartHandlerNotFound extends Data.TaggedError("StartHandlerNotFound")<{
  readonly exportName: string;
}> {}

/** Error raised while loading or running a Vite dev SSR request. */
export class StartDevServerError extends Data.TaggedError("StartDevServerError")<{
  readonly operation: "load-module" | "run-handler" | "read-html" | "transform-html";
  readonly error: unknown;
}> {}

/** Error thrown when a browser build imports a `.server.*` module. */
export class StartServerOnlyModuleError extends Data.TaggedError("StartServerOnlyModuleError")<{
  readonly id: string;
}> {}

/** Vite middleware continuation callback. */
export type StartDevMiddlewareNext = (error?: unknown) => void;

const reportSsrDevMiddlewareError = (
  server: StartDevServer,
  next: StartDevMiddlewareNext,
  error: unknown
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (error instanceof Error) {
      server.ssrFixStacktrace?.(error);
    }
    next(error);
  });

/**
 * Handles one Vite dev-server middleware request.
 *
 * Non-SSR asset requests call `next`; SSR, RPC, and action requests are
 * converted to web requests, handled, and written back to Node.
 */
export const handleSsrDevMiddlewareEffect = (
  server: StartDevServer,
  request: IncomingMessage,
  response: ServerResponse,
  next: StartDevMiddlewareNext,
  options: HandleSsrDevRequestOptions = {}
): Effect.Effect<void, never, unknown> =>
  Effect.gen(function* () {
    if (!shouldHandleSsrRequest(request)) {
      yield* Effect.sync(() => {
        next();
      });
      return;
    }

    const webRequest = yield* nodeRequestToWebRequestEffect(request);
    const webResponse = yield* handleSsrDevRequestEffect(server, webRequest, options);
    yield* writeNodeResponseEffect(response, webResponse, {
      headOnly: request.method === "HEAD"
    });
  }).pipe(
    Effect.catch((error) => reportSsrDevMiddlewareError(server, next, error)),
    Effect.catchCause((cause) =>
      reportSsrDevMiddlewareError(server, next, Cause.squash(cause))
    )
  );

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
    Effect.runPromise(
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
      return () => {
        server.middlewares.use((request, response, next) => {
          void runFork(
            handleSsrDevMiddlewareEffect(
              server,
              request,
              response,
              next,
              options.handlerExport === undefined
                ? { serverEntry }
                : { serverEntry, handlerExport: options.handlerExport }
            )
          );
        });
      };
    }
  };
};

/** Returns true when a response should pass through Vite HTML transforms. */
export const isHtmlResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.includes("text/html") ?? false;

/** Detects `.server.*` modules that must not be imported by browser builds. */
export const isServerOnlyModule = (id: string): boolean => {
  const clean = id.split("?", 1)[0] ?? id;
  return /\.(server)\.[cm]?[jt]sx?$/.test(clean);
};

/** Returns true for requests the dev SSR middleware should handle. */
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

/** Resolves the SSR request handler export from a loaded server module. */
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

/** Effect wrapper for `resolveStartHandler` with a typed not-found error. */
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

const handlerResultEffect = <HandlerError = StartRequestHandlerError>(
  handler: StartSsrRequestHandler<HandlerError>,
  request: Request
): Effect.Effect<Response, StartDevServerError, unknown> =>
  Effect.suspend(() =>
    Effect.try({
      try: () => handler(request),
      catch: (error) => new StartDevServerError({ operation: "run-handler", error })
    }).pipe(
      Effect.flatMap((result) =>
        toEffect(result as EffectInput<Response, HandlerError, never>)
      ),
      Effect.mapError((error) =>
        error instanceof StartDevServerError
          ? error
          : new StartDevServerError({ operation: "run-handler", error })
      )
    )
  ).pipe(
    Effect.catchCause((cause) => {
      const failure = cause.reasons.find(Cause.isFailReason)?.error;
      return Effect.fail(
        failure instanceof StartDevServerError
          ? failure
          : new StartDevServerError({ operation: "run-handler", error: Cause.squash(cause) })
      );
    })
  );

/**
 * Handles one Vite dev SSR web request.
 *
 * Loads the configured server entry, runs its handler, and applies Vite HTML
 * transforms to HTML responses.
 */
export const handleSsrDevRequestEffect = (
  server: StartDevServer,
  request: Request,
  options: HandleSsrDevRequestOptions = {}
): Effect.Effect<Response, StartHandlerNotFound | StartDevServerError, unknown> =>
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

/** Alias for `handleSsrDevRequestEffect` on the current dev SSR surface. */
export const handleSsrDevRequest = (
  server: StartDevServer,
  request: Request,
  options: HandleSsrDevRequestOptions = {}
): Effect.Effect<Response, StartHandlerNotFound | StartDevServerError, unknown> =>
  handleSsrDevRequestEffect(server, request, options);
