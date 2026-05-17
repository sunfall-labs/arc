import { Effect } from "effect";
import type { EffectUiRuntime } from "@effect-ui/core";
import {
  actionManifestVirtualModuleId,
  appGraphRuntimeDiagnosticsVirtualModuleId,
  appGraphVirtualModuleId,
  defaultFileRouteDirectory,
  defaultFileRouteGeneratedFile,
  defaultServerEntry,
  defaultStartBuildPolicy,
  defaultStartBuildWireSchemaPolicy,
  effectUiStart,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  handleSsrDevRequestEffect,
  handleSsrDevMiddlewareEffect,
  handleSsrDevRequest,
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  planStartPrerenderPages,
  resolveStartPrerenderOptions,
  runStartViteDiagnosticsGateEffect,
  runStartPrerenderEffect,
  serverFunctionManifestVirtualModuleId,
  StartDevServerError,
  StartHandlerNotFound,
  StartPrerenderError,
  StartAppGraphDiagnosticsRunnerError,
  FileRouteDefinitionsFileWriteError,
  FileRouteDefinitionsOutputPathError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartBuildPolicyEffect,
  writeFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFileEffect,
  startDevServerFromVite,
  type EffectUiStartOptions,
  type EffectUiStartPlugin,
  type FileRouteDiscoveryOptions,
  type FileRouteDefinitionsFileWriteFailure,
  type FileRouteDefinitionsFileWriteResult,
  type HandleSsrDevMiddlewareOptions,
  type HandleSsrDevRequestOptions,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions,
  type ResolvedStartPrerenderOptions,
  type StartAppGraphDiagnosticsLoadError,
  type StartBuildPolicy,
  type StartBuildPolicyError,
  type StartDevMiddlewareNext,
  type StartDevServer,
  type StartPrerenderConfig,
  type StartPrerenderFailureEvent,
  type StartPrerenderOptions,
  type StartPrerenderPage,
  type StartPrerenderPageContext,
  type StartPrerenderPageInput,
  type StartPrerenderPageOptions,
  type StartPrerenderPlannedPage,
  type StartPrerenderResult,
  type StartPrerenderRunOptions,
  type StartPrerenderSuccessEvent,
  type StartSsrHandlerModule,
  type StartViteDevServer,
  type StartViteDevSsrOptions,
} from "@effect-ui/start/vite";

const viteExports: Array<unknown> = [
  actionManifestVirtualModuleId,
  appGraphRuntimeDiagnosticsVirtualModuleId,
  appGraphVirtualModuleId,
  defaultFileRouteDirectory,
  defaultFileRouteGeneratedFile,
  defaultServerEntry,
  defaultStartBuildPolicy,
  defaultStartBuildWireSchemaPolicy,
  effectUiStart,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  handleSsrDevRequestEffect,
  handleSsrDevMiddlewareEffect,
  handleSsrDevRequest,
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  planStartPrerenderPages,
  resolveStartPrerenderOptions,
  runStartViteDiagnosticsGateEffect,
  runStartPrerenderEffect,
  serverFunctionManifestVirtualModuleId,
  StartDevServerError,
  StartHandlerNotFound,
  StartPrerenderError,
  StartAppGraphDiagnosticsRunnerError,
  FileRouteDefinitionsFileWriteError,
  FileRouteDefinitionsOutputPathError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartBuildPolicyEffect,
  writeFileRouteDefinitionsFile,
  writeFileRouteDefinitionsFileEffect,
  startDevServerFromVite,
];
const diagnosticsBuildPolicyOptions = {
  buildPolicy: {
    wireSchemas: false,
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: false,
      },
      routePreloadCollections: false,
    },
  },
} satisfies EffectUiStartOptions;
type Assert<T extends true> = T;
type StaticStartBuildPolicyErrors =
  | StartAppGraphMissingWireSchemas
  | StartAppGraphUnknownActionBehavior;
type _StartBuildPolicyErrorIsStaticOnly = Assert<
  StartBuildPolicyError extends StaticStartBuildPolicyErrors ? true : false
>;
type _StartBuildPolicyErrorExcludesDiagnostics = Assert<
  Extract<
    StartBuildPolicyError,
    StartAppGraphUnknownRoutePreloadCollections | StartAppGraphUnknownRoutePreloadResources
  > extends never
    ? true
    : false
>;
type ViteTypes =
  | EffectUiStartOptions
  | EffectUiStartPlugin
  | FileRouteDiscoveryOptions
  | FileRouteDefinitionsFileWriteFailure
  | FileRouteDefinitionsFileWriteResult
  | LoadedStartAppGraphDiagnostics
  | LoadStartAppGraphDiagnosticsOptions
  | ResolvedStartPrerenderOptions
  | StartAppGraphDiagnosticsLoadError
  | StartBuildPolicy
  | StartBuildPolicyError
  | StartDevMiddlewareNext
  | StartDevServer
  | StartPrerenderConfig
  | StartPrerenderFailureEvent
  | StartPrerenderOptions
  | StartPrerenderPage
  | StartPrerenderPageContext
  | StartPrerenderPageInput
  | StartPrerenderPageOptions
  | StartPrerenderPlannedPage
  | StartPrerenderResult
  | StartPrerenderRunOptions
  | StartPrerenderSuccessEvent
  | StartViteDevServer
  | StartSsrHandlerModule
  | StartViteDevSsrOptions
  | HandleSsrDevMiddlewareOptions
  | HandleSsrDevRequestOptions;
interface ViteDevSsrService {
  readonly value: string;
}
declare const viteDevSsrRuntime: EffectUiRuntime<ViteDevSsrService, "dev-ssr-runtime">;
declare const servicefulDevSsrServer: StartDevServer<ViteDevSsrService>;
declare const servicefulDevSsrModule: StartSsrHandlerModule<"handler-error", ViteDevSsrService>;
declare const hostViteDevServer: StartViteDevServer;
declare const devSsrNodeRequest: Parameters<typeof handleSsrDevMiddlewareEffect>[1];
declare const devSsrNodeResponse: Parameters<typeof handleSsrDevMiddlewareEffect>[2];
const devMiddlewareNext: StartDevMiddlewareNext = (error?: unknown) => {
  void error;
};
const devSsrStartOptions = {
  devSsr: {
    runtime: viteDevSsrRuntime,
  },
} satisfies EffectUiStartOptions;
const prerenderStartOptions = {
  prerender: {
    enabled: true,
    autoSubfolderIndex: true,
    autoStaticPathsDiscovery: true,
    crawlLinks: true,
    retryCount: 1,
    retryDelay: 10,
    pages: [
      "/docs",
      {
        path: "/docs/static",
        outputPath: "docs/static/index.html",
        prerender: { enabled: true },
      },
    ],
    filter: ({ path }) => !path.startsWith("/private"),
  },
} satisfies EffectUiStartOptions;
const devSsrOptions: StartViteDevSsrOptions<"dev-ssr-runtime"> = {
  runtime: viteDevSsrRuntime,
};
const servicefulDevSsrEffect: Effect.Effect<Response, unknown, ViteDevSsrService> =
  handleSsrDevRequestEffect(servicefulDevSsrServer, new Request("https://example.com"));
const servicefulDevSsrRequestAlias: typeof handleSsrDevRequestEffect = handleSsrDevRequest;
const devSsrRequestOptions: HandleSsrDevRequestOptions = {
  serverEntry: defaultServerEntry,
  handlerExport: "handleRequest",
  rpcPath: "/__effect-ui/rpc",
  actionPath: "/__effect-ui/action",
};
const devSsrMiddlewareOptions: HandleSsrDevMiddlewareOptions = {
  ...devSsrRequestOptions,
  runOptions: { signal: new AbortController().signal },
};
const servicefulDevSsrMiddlewareEffect: Effect.Effect<void, never, ViteDevSsrService> =
  handleSsrDevMiddlewareEffect(
    servicefulDevSsrServer,
    devSsrNodeRequest,
    devSsrNodeResponse,
    devMiddlewareNext,
    devSsrMiddlewareOptions,
  );
const hostDevSsrServer: StartDevServer = startDevServerFromVite(hostViteDevServer);
const startDevServerError = new StartDevServerError({
  operation: "load-module",
  error: "missing",
});
const startHandlerNotFound = new StartHandlerNotFound({
  exportName: "default",
});
void devSsrStartOptions;
void devSsrOptions;
void servicefulDevSsrEffect;
void servicefulDevSsrRequestAlias;
void servicefulDevSsrMiddlewareEffect;
void servicefulDevSsrModule;
void hostDevSsrServer;
void devMiddlewareNext;
void devSsrRequestOptions;
void devSsrMiddlewareOptions;
void startDevServerError;
void startHandlerNotFound;
declare const viteRoot: string;
const discoveryOptions: FileRouteDiscoveryOptions = {
  root: viteRoot,
  routeDirectory: "src/routes",
  extensions: [".tsx"],
  fileRouteGeneration: { outputFile: "src/routes/routeTree.gen.ts" },
};
void discoveryOptions;
declare const viteManifest: Parameters<typeof writeFileRouteDefinitionsFile>[1];
const resolvedPrerenderOptions: ResolvedStartPrerenderOptions | undefined =
  resolveStartPrerenderOptions(prerenderStartOptions.prerender);
const plannedPrerenderPages: readonly StartPrerenderPlannedPage[] = planStartPrerenderPages(
  viteManifest,
  prerenderStartOptions.prerender,
);
const prerenderRunOptions: StartPrerenderRunOptions = {
  root: viteRoot,
  outDir: "dist",
  manifest: viteManifest,
  prerender: prerenderStartOptions.prerender,
  serverEntry: defaultServerEntry,
};
const prerenderEffect = runStartPrerenderEffect(prerenderRunOptions);
const prerenderError = new StartPrerenderError({
  operation: "render-page",
  message: "Could not render.",
  path: "/docs",
});
declare const routeOutputFailure: FileRouteDefinitionsOutputPathError;
declare const routeWriteFailure: FileRouteDefinitionsFileWriteError;
const routeOutputGuidance: string = routeOutputFailure.guidance;
const routeWriteOperation: "read-existing" | "create-directory" | "write-file" =
  routeWriteFailure.operation;
const routeDefinitionsWriteResult: FileRouteDefinitionsFileWriteResult | undefined =
  writeFileRouteDefinitionsFile(viteRoot, viteManifest);
const routeDefinitionsWriteEffect: Effect.Effect<
  FileRouteDefinitionsFileWriteResult | undefined,
  FileRouteDefinitionsFileWriteFailure
> = writeFileRouteDefinitionsFileEffect(viteRoot, viteManifest);
void viteExports;
void diagnosticsBuildPolicyOptions;
void prerenderStartOptions;
void routeOutputGuidance;
void routeWriteOperation;
void routeDefinitionsWriteResult;
void routeDefinitionsWriteEffect;
void resolvedPrerenderOptions;
void plannedPrerenderPages;
void prerenderRunOptions;
void prerenderEffect;
void prerenderError;
type _ViteTypes = ViteTypes;
