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
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  resolveStartTransportEndpointsEffect,
  validateStartEndpointPathEffect,
  StartAppGraphDiagnosticsDtoError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
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
  type StartEndpointConflictErrorInput,
  type StartEndpointPathErrorInput,
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
  type StartRequestTraceAction,
  type StartRequestTraceCollection,
  type StartRequestTraceCookie,
  type StartRequestTraceCleanupFailure,
  type StartRequestTraceFailureKind,
  type StartRequestTraceFiber,
  type StartRequestTraceFiberStatus,
  type StartRequestTraceHeader,
  type StartRequestTraceHandler,
  type StartRequestTraceRequest,
  type StartRequestTraceResource,
  type StartRequestTraceResponse,
  type StartRequestTraceRoutePlan,
  type StartRequestTraceServerFunction,
  type StartRequestTraceStatus,
  type StartRequestTraceStream,
  type StartRequestTraceStreamState,
  type StartRequestTraceTeardown,
  type StartRequestTraceTeardownSnapshot,
  type StartRequestTraceTransport,
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
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  resolveStartTransportEndpointsEffect,
  validateStartEndpointPathEffect,
  StartAppGraphDiagnosticsDtoError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
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
  | StartEndpointConflictErrorInput
  | StartEndpointPathErrorInput
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
  | StartRequestTraceAction
  | StartRequestTraceCollection
  | StartRequestTraceCookie
  | StartRequestTraceCleanupFailure
  | StartRequestTraceFailureKind
  | StartRequestTraceFiber
  | StartRequestTraceFiberStatus
  | StartRequestTraceHeader
  | StartRequestTraceHandler
  | StartRequestTraceRequest
  | StartRequestTraceResource
  | StartRequestTraceResponse
  | StartRequestTraceRoutePlan
  | StartRequestTraceServerFunction
  | StartRequestTraceStatus
  | StartRequestTraceStream
  | StartRequestTraceStreamState
  | StartRequestTraceTeardown
  | StartRequestTraceTeardownSnapshot
  | StartRequestTraceTransport
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

const endpointConflictInput: StartEndpointConflictErrorInput = {
  rpcPath: "/same",
  actionPath: "/same",
  guidance: "Use distinct endpoint paths."
};
const endpointConflict = new StartTransportEndpointConflictError(endpointConflictInput);
const endpointPathInput: StartEndpointPathErrorInput = {
  field: "rpcPath",
  value: "rpc",
  reason: "NotOriginForm",
  guidance: "Use an origin-form path."
};
const endpointPathError = new StartTransportEndpointPathError(endpointPathInput);
void endpointConflict;
void endpointPathError;
void resolveStartTransportEndpointsEffect;
void validateStartEndpointPathEffect;

const traceHeader: StartRequestTraceHeader = { name: "x-effect-ui", value: "ok" };
const traceCookie: StartRequestTraceCookie = { name: "session", value: "[redacted]" };
const traceTransport: StartRequestTraceTransport = "ssr";
const traceStatus: StartRequestTraceStatus = "success";
const traceFailureKind: StartRequestTraceFailureKind = "transport";
const traceFiberStatus: StartRequestTraceFiberStatus = "done";
const traceStreamState: StartRequestTraceStreamState = "closed";
const traceResource: StartRequestTraceResource = {
  key: "project:atlas",
  family: "Project",
  input: { id: "atlas" },
  state: "Success"
};
const traceRequest: StartRequestTraceRequest = {
  id: "request-1",
  method: "GET",
  url: "https://effect-ui.test/projects",
  path: "/projects",
  transport: traceTransport,
  headers: [traceHeader],
  cookies: [traceCookie]
};
const traceResponse: StartRequestTraceResponse = {
  status: 200,
  headers: [traceHeader],
  setCookieCount: 0
};
const traceCollection: StartRequestTraceCollection = { name: "projects", state: "Ready" };
const traceServerFunction: StartRequestTraceServerFunction = {
  name: "loadProjects",
  status: traceStatus
};
const traceAction: StartRequestTraceAction = {
  name: "saveProject",
  state: "Success",
  failureKind: traceFailureKind,
  invalidationIndexes: [0]
};
const traceFiber: StartRequestTraceFiber = { name: "request-runtime", status: traceFiberStatus };
const traceStream: StartRequestTraceStream = {
  name: "ssr",
  state: traceStreamState,
  chunkCount: 1
};
const traceTeardownSnapshot: StartRequestTraceTeardownSnapshot = {
  fiberCount: 0,
  familyCount: 0,
  moduleCount: 0,
  tagCount: 0
};
const traceCleanupFailure: StartRequestTraceCleanupFailure = {
  _tag: "Failure",
  message: "cleanup failed"
};
const traceTeardown: StartRequestTraceTeardown = {
  runtimeDisposed: true,
  beforeDispose: traceTeardownSnapshot,
  afterDispose: traceTeardownSnapshot,
  cleanupFailure: traceCleanupFailure
};
const traceRoutePlan: StartRequestTraceRoutePlan = {
  _tag: "Matched",
  href: "/projects",
  match: {
    path: "/projects",
    href: "/projects",
    params: {},
    search: {}
  },
  resources: [],
  hydration: {
    resourceCount: 0
  }
};
const requestTrace: StartRequestTrace = {
  request: traceRequest,
  response: traceResponse,
  services: ["RequestContext", "ResponseContext"],
  routePlan: traceRoutePlan,
  resources: [traceResource],
  collections: [traceCollection],
  serverFunctions: [traceServerFunction],
  actions: [traceAction],
  fibers: [traceFiber],
  streams: [traceStream],
  status: traceStatus,
  teardown: traceTeardown
};
const requestMetrics: ReadonlyArray<unknown> = [
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric
];
const traceHandler: StartRequestTraceHandler = (trace) => {
  void trace;
};
void requestTrace;
void requestMetrics;
void traceHandler;
