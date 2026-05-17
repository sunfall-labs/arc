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
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  serverFunctionManifestVirtualModuleId,
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
  type EffectUiStartOptions,
  type EffectUiStartPlugin,
  type FileRouteDiscoveryOptions,
  type FileRouteDefinitionsFileWriteFailure,
  type FileRouteDefinitionsFileWriteResult,
  type HandleSsrDevRequestOptions,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions,
  type StartAppGraphDiagnosticsLoadError,
  type StartBuildPolicy,
  type StartBuildPolicyError,
  type StartDevMiddlewareNext,
  type StartDevServer,
  type StartSsrHandlerModule,
  type StartViteDevServer,
  type StartViteDevSsrOptions
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
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  serverFunctionManifestVirtualModuleId,
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
  writeFileRouteDefinitionsFileEffect
];
const diagnosticsBuildPolicyOptions = {
  buildPolicy: {
    wireSchemas: false,
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: false
      },
      routePreloadCollections: false
    }
  }
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
  > extends never ? true : false
>;
type ViteTypes =
  | EffectUiStartOptions
  | EffectUiStartPlugin
  | FileRouteDiscoveryOptions
  | FileRouteDefinitionsFileWriteFailure
  | FileRouteDefinitionsFileWriteResult
  | LoadedStartAppGraphDiagnostics
  | LoadStartAppGraphDiagnosticsOptions
  | StartAppGraphDiagnosticsLoadError
  | StartBuildPolicy
  | StartBuildPolicyError
  | StartDevMiddlewareNext
  | StartDevServer
  | StartViteDevServer
  | StartSsrHandlerModule
  | StartViteDevSsrOptions
  | HandleSsrDevRequestOptions;
interface ViteDevSsrService {
  readonly value: string;
}
declare const viteDevSsrRuntime: EffectUiRuntime<ViteDevSsrService, "dev-ssr-runtime">;
declare const servicefulDevSsrServer: StartDevServer<ViteDevSsrService>;
declare const servicefulDevSsrModule: StartSsrHandlerModule<"handler-error", ViteDevSsrService>;
declare const hostViteDevServer: StartViteDevServer;
const devMiddlewareNext: StartDevMiddlewareNext = (error?: unknown) => {
  void error;
};
const devSsrStartOptions = {
  devSsr: {
    runtime: viteDevSsrRuntime
  }
} satisfies EffectUiStartOptions;
const devSsrOptions: StartViteDevSsrOptions<"dev-ssr-runtime"> = {
  runtime: viteDevSsrRuntime
};
const servicefulDevSsrEffect: Effect.Effect<Response, unknown, ViteDevSsrService> =
  handleSsrDevRequestEffect(servicefulDevSsrServer, new Request("https://example.com"));
const devSsrRequestOptions: HandleSsrDevRequestOptions = {
  serverEntry: defaultServerEntry,
  handlerExport: "handleRequest",
  rpcPath: "/__effect-ui/rpc",
  actionPath: "/__effect-ui/action"
};
void devSsrStartOptions;
void devSsrOptions;
void servicefulDevSsrEffect;
void servicefulDevSsrModule;
void hostViteDevServer;
void devMiddlewareNext;
void devSsrRequestOptions;
declare const viteRoot: string;
const discoveryOptions: FileRouteDiscoveryOptions = {
  root: viteRoot,
  routeDirectory: "src/routes",
  extensions: [".tsx"],
  fileRouteGeneration: { outputFile: "src/routes/routeTree.gen.ts" }
};
void discoveryOptions;
declare const viteManifest: Parameters<typeof writeFileRouteDefinitionsFile>[1];
declare const routeOutputFailure: FileRouteDefinitionsOutputPathError;
declare const routeWriteFailure: FileRouteDefinitionsFileWriteError;
const routeOutputGuidance: string = routeOutputFailure.guidance;
const routeWriteOperation:
  | "read-existing"
  | "create-directory"
  | "write-file" = routeWriteFailure.operation;
const routeDefinitionsWriteResult: FileRouteDefinitionsFileWriteResult | undefined =
  writeFileRouteDefinitionsFile(viteRoot, viteManifest);
const routeDefinitionsWriteEffect: Effect.Effect<
  FileRouteDefinitionsFileWriteResult | undefined,
  FileRouteDefinitionsFileWriteFailure
> = writeFileRouteDefinitionsFileEffect(viteRoot, viteManifest);
void viteExports;
void diagnosticsBuildPolicyOptions;
void routeOutputGuidance;
void routeWriteOperation;
void routeDefinitionsWriteResult;
void routeDefinitionsWriteEffect;
type _ViteTypes = ViteTypes;
