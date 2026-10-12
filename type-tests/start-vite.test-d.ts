import { Effect } from "effect";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import {
  sunfallArcStart,
  FileRouteDefinitionsFileWriteError,
  FileRouteDefinitionsOutputPathError,
  FileRouteDiscoveryError,
  StartAppGraphDiagnosticsRunnerError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  StartDevServerError,
  StartHandlerNotFound,
  StartPrerenderError,
  StartServerOnlyModuleError,
  type FileRouteDiscoveryOptions,
  type FileRouteGenerationOptions,
  type FileRouteManifestOptions,
  type StartBuildPolicy,
  type StartBuildPolicyError,
  type StartPrerenderConfig,
  type StartPrerenderFailureEvent,
  type StartPrerenderOptions,
  type StartPrerenderPage,
  type StartPrerenderPageContext,
  type StartPrerenderPageInput,
  type StartPrerenderSuccessEvent,
  type StartStaticClientPolicy,
  type StartViteDevSsrOptions,
  type SunfallArcStartOptions,
  type SunfallArcStartPlugin,
  type SunfallArcStartResolvedConfig,
} from "@sunfall/arc-start/vite";

const viteExports: Array<unknown> = [
  sunfallArcStart,
  FileRouteDefinitionsFileWriteError,
  FileRouteDefinitionsOutputPathError,
  FileRouteDiscoveryError,
  StartAppGraphDiagnosticsRunnerError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  StartDevServerError,
  StartHandlerNotFound,
  StartPrerenderError,
  StartServerOnlyModuleError,
];
type ViteTypes =
  | FileRouteDiscoveryOptions
  | FileRouteGenerationOptions
  | FileRouteManifestOptions
  | StartBuildPolicy
  | StartBuildPolicyError
  | StartPrerenderConfig
  | StartPrerenderFailureEvent
  | StartPrerenderOptions
  | StartPrerenderPage
  | StartPrerenderPageContext
  | StartPrerenderPageInput
  | StartPrerenderSuccessEvent
  | StartStaticClientPolicy
  | StartViteDevSsrOptions
  | SunfallArcStartOptions
  | SunfallArcStartPlugin
  | SunfallArcStartResolvedConfig;

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
} satisfies SunfallArcStartOptions;
type Assert<T extends true> = T;
type StaticStartBuildPolicyErrors = StartAppGraphMissingWireSchemas;
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

interface ViteDevSsrService {
  readonly value: string;
}
declare const viteDevSsrRuntime: SunfallArcRuntime<ViteDevSsrService, "dev-ssr-runtime">;
const devSsrStartOptions = {
  devSsr: {
    runtime: viteDevSsrRuntime,
  },
} satisfies SunfallArcStartOptions;
const devSsrOptions: StartViteDevSsrOptions<"dev-ssr-runtime"> = {
  runtime: viteDevSsrRuntime,
};
const prerenderStartOptions = {
  prerender: {
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
        prerender: true,
      },
    ],
    filter: ({ path }) => !path.startsWith("/private"),
  },
} satisfies SunfallArcStartOptions;
declare const promisedVoid: Promise<void>;
const effectReturningPrerenderOptions: StartPrerenderOptions = {
  pages: [],
  onSuccess: () => Effect.void,
  onError: () => Effect.void,
};
const promiseReturningSuccessPrerenderOptions: StartPrerenderOptions = {
  pages: [],
  // @ts-expect-error Start prerender callbacks must return EffectInput, not Promise work.
  onSuccess: () => promisedVoid,
};
const promiseReturningErrorPrerenderOptions: StartPrerenderOptions = {
  pages: [],
  // @ts-expect-error Start prerender callbacks must return EffectInput, not Promise work.
  onError: () => promisedVoid,
};
declare const viteRoot: string;
const discoveryOptions: FileRouteDiscoveryOptions = {
  root: viteRoot,
  routeDirectory: "src/routes",
  extensions: [".tsx"],
  fileRouteGeneration: { outputFile: "src/routes/routeTree.gen.ts" },
};
const plugin: SunfallArcStartPlugin = sunfallArcStart({
  ...diagnosticsBuildPolicyOptions,
  serverEntry: "/src/server.tsx",
  fileRouteOptions: { routeDirectory: "src/routes" },
});
// Server functions and Actions come only from the server entry's handler.
sunfallArcStart({
  serverEntry: "/src/server.tsx",
  // @ts-expect-error the plugin derives the server-function manifest; there is no option for it
  serverFunctionManifest: [],
});
sunfallArcStart({
  serverEntry: "/src/server.tsx",
  // @ts-expect-error the plugin derives the Action manifest; there is no option for it
  actionManifest: [],
});
const prerenderError = new StartPrerenderError({
  operation: "render-page",
  message: "Could not render.",
  path: "/docs",
});
const startDevServerError = new StartDevServerError({
  operation: "load-module",
  error: "missing",
});
const startHandlerNotFound = new StartHandlerNotFound({
  exportName: "default",
});
declare const routeOutputFailure: FileRouteDefinitionsOutputPathError;
declare const routeWriteFailure: FileRouteDefinitionsFileWriteError;
const routeOutputGuidance: string = routeOutputFailure.guidance;
const routeWriteOperation: "read-existing" | "create-directory" | "write-file" =
  routeWriteFailure.operation;
void viteExports;
void devSsrStartOptions;
void devSsrOptions;
void prerenderStartOptions;
void effectReturningPrerenderOptions;
void promiseReturningSuccessPrerenderOptions;
void promiseReturningErrorPrerenderOptions;
void discoveryOptions;
void plugin;
void prerenderError;
void startDevServerError;
void startHandlerNotFound;
void routeOutputGuidance;
void routeWriteOperation;
type _ViteTypes = ViteTypes;
