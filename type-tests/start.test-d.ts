import {
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createStartAppGraphDiagnosticsPolicyException,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  deserializeStartAppGraph,
  enforceStartAppGraphDiagnosticsPolicy,
  formatStartAppGraphDiagnosticsPolicyViolation,
  hydrateStartHydrationChunks,
  preloadRequestEffect,
  startEffectRpcEndpointDescriptor,
  StartAppGraphDiagnosticsDtoError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartAppGraphUnknownActionBehavior,
  submitStartActionEffect,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartAppGraphWireSchemasEffect,
  type StartAppGraph,
  type StartAppGraphActionBehaviorPolicy,
  type StartAppGraphDeserializeError,
  type StartAppGraphDiagnostics,
  type StartAppGraphDiagnosticsDto,
  type StartAppGraphDiagnosticsDtoInput,
  type StartAppGraphDiagnosticsPolicy,
  type StartAppGraphDiagnosticsPolicyError,
  type StartAppGraphDiagnosticsPolicyViolation,
  type StartAppGraphRoutePreloadCollectionsPolicy,
  type StartAppGraphRoutePreloadResourcesPolicy,
  type StartFetch,
  type StartAppGraphWireSchemaPolicy,
  type HydrateStartPayloadOptions,
  type ServerFunctionManifest,
  type StartEffectRpcCompatibilityArtifact,
  type StartEffectRpcEndpointDescriptor,
  type StartEffectRpcProcedureDescriptor,
  type StartHydrationChunk,
  type StartRenderContext,
  type StartRenderHydrationPlan,
  type StartRequestHandler,
  type StartRequestTrace
} from "@effect-ui/start";
import type { EffectUiRuntime } from "@effect-ui/core";

const startExports: Array<unknown> = [
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createStartAppGraphDiagnosticsPolicyException,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  deserializeStartAppGraph,
  enforceStartAppGraphDiagnosticsPolicy,
  formatStartAppGraphDiagnosticsPolicyViolation,
  hydrateStartHydrationChunks,
  preloadRequestEffect,
  startEffectRpcEndpointDescriptor,
  StartAppGraphDiagnosticsDtoError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartAppGraphUnknownActionBehavior,
  submitStartActionEffect,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartAppGraphWireSchemasEffect
];
type StartTypes =
  | StartAppGraph
  | StartAppGraphActionBehaviorPolicy
  | StartAppGraphDeserializeError
  | StartAppGraphDiagnostics
  | StartAppGraphDiagnosticsDto
  | StartAppGraphDiagnosticsDtoInput
  | StartAppGraphDiagnosticsPolicy
  | StartAppGraphDiagnosticsPolicyError
  | StartAppGraphDiagnosticsPolicyViolation
  | StartAppGraphRoutePreloadCollectionsPolicy
  | StartAppGraphRoutePreloadResourcesPolicy
  | StartAppGraphWireSchemaPolicy
  | HydrateStartPayloadOptions
  | ServerFunctionManifest
  | StartEffectRpcCompatibilityArtifact
  | StartEffectRpcEndpointDescriptor
  | StartEffectRpcProcedureDescriptor
  | StartHydrationChunk
  | StartFetch
  | StartRenderContext
  | StartRenderHydrationPlan
  | StartRequestHandler
  | StartRequestTrace;
void startExports;
type _StartTypes = StartTypes;

declare const startRenderContext: StartRenderContext;
const legacyHydrationScript: string = startRenderContext.legacyHydrationScript;
/** @deprecated pinned so the LSP keeps showing the migration target. */
const deprecatedHydrationScript: string = startRenderContext.hydrationScript;
const hydrationRootScript: string = startRenderContext.hydrationRootScript;
const hydrationPlan: StartRenderHydrationPlan = startRenderContext.hydrationPlan;
void legacyHydrationScript;
void deprecatedHydrationScript;
void hydrationRootScript;
void hydrationPlan;

interface HydrationRuntimeService {
  readonly hydrationRuntimeService: unique symbol;
}

declare const hydrationRuntime: EffectUiRuntime<HydrationRuntimeService>;
declare const hydrationChunks: ReadonlyArray<StartHydrationChunk>;
const sortedHydrationChunks: ReadonlyArray<StartHydrationChunk> =
  hydrateStartHydrationChunks<HydrationRuntimeService>(hydrationChunks, {
    runtime: hydrationRuntime
  });

declare const serverFunctionManifest: ServerFunctionManifest;
const endpointDescriptor: StartEffectRpcEndpointDescriptor =
  startEffectRpcEndpointDescriptor(serverFunctionManifest);
const endpointPath: string = endpointDescriptor.path;
declare const procedureDescriptor: StartEffectRpcProcedureDescriptor;
const procedureSchemaFlags: ReadonlyArray<boolean> = [
  procedureDescriptor.schemas.payload,
  procedureDescriptor.schemas.success,
  procedureDescriptor.schemas.error
];
void sortedHydrationChunks;
void endpointPath;
void procedureSchemaFlags;
