import {
  effectUiStart,
  handleSsrDevRequestEffect,
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  StartAppGraphDiagnosticsRunnerError,
  FileRouteDefinitionsOutputPathError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartBuildPolicyEffect,
  writeFileRouteDefinitionsFileEffect,
  type EffectUiStartOptions,
  type EffectUiStartPlugin,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions,
  type StartAppGraphDiagnosticsLoadError,
  type StartBuildPolicy,
  type StartBuildPolicyError,
  type StartDevServer
} from "@effect-ui/start/vite";

const viteExports: Array<unknown> = [
  effectUiStart,
  handleSsrDevRequestEffect,
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  runStartViteDiagnosticsGateEffect,
  StartAppGraphDiagnosticsRunnerError,
  FileRouteDefinitionsOutputPathError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartBuildPolicyEffect,
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
  | LoadedStartAppGraphDiagnostics
  | LoadStartAppGraphDiagnosticsOptions
  | StartAppGraphDiagnosticsLoadError
  | StartBuildPolicy
  | StartBuildPolicyError
  | StartDevServer;
declare const routeOutputFailure: FileRouteDefinitionsOutputPathError;
const routeOutputGuidance: string = routeOutputFailure.guidance;
void viteExports;
void diagnosticsBuildPolicyOptions;
void routeOutputGuidance;
type _ViteTypes = ViteTypes;
