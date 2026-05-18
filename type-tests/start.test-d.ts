import {
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createStartAppGraphDiagnosticsPolicyException,
  createFileRouteCompanionModuleReferences,
  createFileRouteDefinitionsModule,
  createFileRouteModuleReferences,
  createGeneratedFileRouteDefinitionsModule,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  defaultGeneratedFileRouteDefinitionsHeader,
  defineFileRoute,
  extractStartStaticHtmlLinks,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  deserializeStartAppGraph,
  enforceStartAppGraphDiagnosticsPolicy,
  formatStartAppGraphDiagnosticsPolicyViolation,
  hydrateStartHydrationChunks,
  isFileRouteDefinitionsModuleError,
  actionManifestDefinition,
  clientReferencesForActionManifest,
  deserializeActionManifest,
  isBrowserSafeActionClientReference,
  makeActionManifest,
  makeActionManifestEntry,
  serializeActionManifest,
  stableActionId,
  ActionManifestDuplicateExport,
  ActionManifestDuplicateId,
  ActionManifestDuplicateName,
  ActionManifestInvalidEndpointPath,
  ActionManifestInvalidEntry,
  ActionManifestParseError,
  ActionManifestUnsafeClientReference,
  classifyServerFunctionModule,
  clientReferencesForServerFunctionManifest,
  deserializeServerFunctionManifest,
  isBrowserSafeServerFunctionClientReference,
  isServerFunctionContractModule,
  isServerFunctionServerOnlyModule,
  makeServerFunctionManifest,
  makeServerFunctionManifestEntry,
  preloadRequestEffect,
  serializeServerFunctionManifest,
  serverFunctionManifestDefinition,
  startEffectRpcEndpointDescriptor,
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  acceptsMediaType,
  describeStartActionInvalidationPlan,
  hasContentType,
  isServerActionRequest,
  isServerRpcRequest,
  makeStartRequestId,
  makeStartRequestIdEffect,
  mediaTypeOf,
  negotiateAcceptedMediaType,
  resolveStartTransportEndpointsEffect,
  serverActionPath,
  serverRpcPath,
  startBaggageHeader,
  startFormUrlEncodedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  startMultipartFormDataMediaType,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportDiagnosticsEffect,
  startTransportEndpointEnvelopeEffect,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
  startTransportRequestHeaders,
  startTransportResponseHeaders,
  stableServerFunctionId,
  validateStartEndpointPathEffect,
  validateStartActionRequestEffect,
  validateStartActionResponseEffect,
  validateStartRpcRequestEffect,
  validateStartRpcResponseEffect,
  validateStartTransportAcceptEffect,
  validateStartTransportContentTypeEffect,
  validateStartTransportMethodEffect,
  withStartTransportDiagnostics,
  ServerFunctionManifestDuplicateExport,
  ServerFunctionManifestDuplicateId,
  ServerFunctionManifestDuplicateName,
  ServerFunctionManifestInvalidEndpointPath,
  ServerFunctionManifestInvalidEntry,
  ServerFunctionManifestParseError,
  ServerFunctionManifestUnsafeClientReference,
  StartAppGraphDiagnosticsDtoError,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier,
  StartActionDuplicateName,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
  StartTransportRequestError,
  StartStaticPathError,
  FileRoutePreloadError,
  StartAction,
  StartAppGraphUnknownActionBehavior,
  StartActionFormEncodeError,
  decodeStartActionFormDataEffect,
  encodeStartActionFormInputEffect,
  encodeStartActionInputEffect,
  encodeStartActionPartialInputEffect,
  encodeStartActionRequestEffect,
  readStartActionRequestEffect,
  startActionForm,
  startActionFormDataDecodeOptions,
  startActionInputField,
  startActionNameField,
  submitStartActionEffect,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
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
  type StartActionDefinition,
  type ActionDefinitionErrorValue,
  type ActionDefinitionInputValue,
  type ActionDefinitionOutputValue,
  type StartActionClientOptions,
  type StartActionForm,
  type StartActionFormField,
  type StartActionFormOptions,
  type StartActionInvalidationCause,
  type StartActionInvalidationPlan,
  type StartActionInvalidationTarget,
  type StartActionRequest,
  type StartActionResponseBody,
  type StartActionResponseMeta,
  type StartActionResult,
  type StartActionResultFor,
  type StartEndpointConflictErrorInput,
  type StartEndpointPathErrorInput,
  type StartFetch,
  type ActionBehaviorMetadata,
  type ActionBehaviorPresence,
  type ActionClientReference,
  type ActionManifest,
  type ActionManifestConcurrency,
  type ActionManifestDefinition,
  type ActionManifestEntry,
  type ActionManifestError,
  type ActionManifestOptions,
  type ActionManifestSource,
  type ActionModuleKind,
  type ActionServerReference,
  type ActionWireContract,
  type FileRouteCompanionModuleReference,
  type FileRouteDefinitionsModuleError,
  type FileRouteDefinitionsModuleOptions,
  type FileRouteManifest,
  type FileRouteModuleReference,
  type DefineFileRouteBuilder,
  type FileRoutePreloadOptions,
  type FileRoutePreloadResource,
  type FileRoutePreloadRouteOptions,
  type GeneratedFileRouteDefinitionsModuleOptions,
  type StartAppGraphWireSchemaPolicy,
  type CreateStartRenderHydrationPlanOptions,
  type HydrateStartHydrationChunksFromDocumentOptions,
  type HydrateStartPayloadOptions,
  type ServerFunctionClientReference,
  type ServerFunctionManifest,
  type ServerFunctionManifestDefinition,
  type ServerFunctionManifestEntry,
  type ServerFunctionManifestError,
  type ServerFunctionManifestOptions,
  type ServerFunctionManifestSource,
  type ServerFunctionModuleKind,
  type ServerFunctionServerReference,
  type ServerFunctionWireContract,
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
  type StartRequestTrace,
  type StartStaticLinkExtractionOptions,
  type StartStaticOutputPathOptions,
  type StartTransportDiagnostics,
  type StartTransportDiagnosticsOptions,
  type StartTransportEndpointEnvelope,
  type StartTransportKind,
  type StartTransportRequestHeadersOptions,
} from "@sunfall/arc-start";
import { Schema } from "effect";
import type { ActionDefinition, SunfallArcRuntime } from "@sunfall/arc-core";

const startExports: Array<unknown> = [
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createStartAppGraphDiagnosticsPolicyException,
  createFileRouteCompanionModuleReferences,
  createFileRouteDefinitionsModule,
  createFileRouteModuleReferences,
  createGeneratedFileRouteDefinitionsModule,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  defaultGeneratedFileRouteDefinitionsHeader,
  extractStartStaticHtmlLinks,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  deserializeStartAppGraph,
  enforceStartAppGraphDiagnosticsPolicy,
  formatStartAppGraphDiagnosticsPolicyViolation,
  hydrateStartHydrationChunks,
  isFileRouteDefinitionsModuleError,
  actionManifestDefinition,
  clientReferencesForActionManifest,
  deserializeActionManifest,
  isBrowserSafeActionClientReference,
  makeActionManifest,
  makeActionManifestEntry,
  serializeActionManifest,
  stableActionId,
  ActionManifestDuplicateExport,
  ActionManifestDuplicateId,
  ActionManifestDuplicateName,
  ActionManifestInvalidEndpointPath,
  ActionManifestInvalidEntry,
  ActionManifestParseError,
  ActionManifestUnsafeClientReference,
  classifyServerFunctionModule,
  clientReferencesForServerFunctionManifest,
  deserializeServerFunctionManifest,
  isBrowserSafeServerFunctionClientReference,
  isServerFunctionContractModule,
  isServerFunctionServerOnlyModule,
  makeServerFunctionManifest,
  makeServerFunctionManifestEntry,
  preloadRequestEffect,
  serializeServerFunctionManifest,
  serverFunctionManifestDefinition,
  startEffectRpcEndpointDescriptor,
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  acceptsMediaType,
  describeStartActionInvalidationPlan,
  hasContentType,
  isServerActionRequest,
  isServerRpcRequest,
  makeStartRequestId,
  makeStartRequestIdEffect,
  mediaTypeOf,
  negotiateAcceptedMediaType,
  resolveStartTransportEndpointsEffect,
  serverActionPath,
  serverRpcPath,
  startBaggageHeader,
  startFormUrlEncodedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  startMultipartFormDataMediaType,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportDiagnosticsEffect,
  startTransportEndpointEnvelopeEffect,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
  startTransportRequestHeaders,
  startTransportResponseHeaders,
  stableServerFunctionId,
  validateStartEndpointPathEffect,
  validateStartActionRequestEffect,
  validateStartActionResponseEffect,
  validateStartRpcRequestEffect,
  validateStartRpcResponseEffect,
  validateStartTransportAcceptEffect,
  validateStartTransportContentTypeEffect,
  validateStartTransportMethodEffect,
  withStartTransportDiagnostics,
  ServerFunctionManifestDuplicateExport,
  ServerFunctionManifestDuplicateId,
  ServerFunctionManifestDuplicateName,
  ServerFunctionManifestInvalidEndpointPath,
  ServerFunctionManifestInvalidEntry,
  ServerFunctionManifestParseError,
  ServerFunctionManifestUnsafeClientReference,
  StartAppGraphDiagnosticsDtoError,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier,
  StartAction,
  FileRoutePreloadError,
  StartActionFormEncodeError,
  StartActionDuplicateName,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
  StartTransportRequestError,
  StartStaticPathError,
  StartAppGraphUnknownActionBehavior,
  decodeStartActionFormDataEffect,
  encodeStartActionFormInputEffect,
  encodeStartActionInputEffect,
  encodeStartActionPartialInputEffect,
  encodeStartActionRequestEffect,
  readStartActionRequestEffect,
  startActionForm,
  startActionFormDataDecodeOptions,
  startActionInputField,
  startActionNameField,
  submitStartActionEffect,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartAppGraphWireSchemasEffect,
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
  | StartActionDefinition
  | ActionDefinitionErrorValue<StartActionDefinition>
  | ActionDefinitionInputValue<StartActionDefinition>
  | ActionDefinitionOutputValue<StartActionDefinition>
  | StartActionClientOptions
  | StartActionForm
  | StartActionFormField
  | StartActionFormOptions<{ readonly id: string }>
  | StartActionInvalidationCause
  | StartActionInvalidationPlan
  | StartActionInvalidationTarget
  | StartActionRequest
  | StartActionResponseBody
  | StartActionResponseMeta
  | StartActionResult<string>
  | StartActionResultFor<StartActionDefinition>
  | StartEndpointConflictErrorInput
  | StartEndpointPathErrorInput
  | ActionBehaviorMetadata
  | ActionBehaviorPresence
  | ActionClientReference
  | ActionManifest
  | ActionManifestConcurrency
  | ActionManifestDefinition
  | ActionManifestEntry
  | ActionManifestError
  | ActionManifestOptions
  | ActionManifestSource
  | ActionModuleKind
  | ActionServerReference
  | ActionWireContract
  | FileRouteCompanionModuleReference
  | FileRouteDefinitionsModuleError
  | FileRouteDefinitionsModuleOptions
  | FileRouteManifest
  | FileRouteModuleReference
  | DefineFileRouteBuilder<"/typed/:id">
  | FileRoutePreloadOptions<"/typed/:id">
  | FileRoutePreloadResource<"/typed/:id">
  | FileRoutePreloadRouteOptions
  | GeneratedFileRouteDefinitionsModuleOptions
  | StartAppGraphWireSchemaPolicy
  | CreateStartRenderHydrationPlanOptions
  | HydrateStartHydrationChunksFromDocumentOptions
  | HydrateStartPayloadOptions
  | ServerFunctionClientReference
  | ServerFunctionManifest
  | ServerFunctionManifestDefinition
  | ServerFunctionManifestEntry
  | ServerFunctionManifestError
  | ServerFunctionManifestOptions
  | ServerFunctionManifestSource
  | ServerFunctionModuleKind
  | ServerFunctionServerReference
  | ServerFunctionWireContract
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
  | StartRequestTrace
  | StartStaticLinkExtractionOptions
  | StartStaticOutputPathOptions
  | StartTransportDiagnostics
  | StartTransportDiagnosticsOptions
  | StartTransportEndpointEnvelope
  | StartTransportKind
  | StartTransportRequestHeadersOptions;
void startExports;
type _StartTypes = StartTypes;

const startStaticOutputPathOptions: StartStaticOutputPathOptions = {
  autoSubfolderIndex: true,
};
const startStaticLinkExtractionOptions: StartStaticLinkExtractionOptions = {
  origin: "https://docs.example",
  fromPath: "/docs",
};
const normalizedStartStaticPath: string = normalizeStartStaticPath("/docs/");
const startStaticOutputPath: string = startStaticPageOutputPath(
  normalizedStartStaticPath,
  startStaticOutputPathOptions,
);
const startStaticLinks: readonly string[] = extractStartStaticHtmlLinks(
  '<a href="/docs/start">Start</a>',
  startStaticLinkExtractionOptions,
);
const startStaticPathError = new StartStaticPathError({
  path: "docs",
  reason: "relative-url",
  guidance: "Use a root-relative path.",
});
void startStaticOutputPath;
void startStaticLinks;
void startStaticPathError;

const fileRouteBuilder: DefineFileRouteBuilder<"/typed/:id"> = defineFileRoute("/typed/:id");
const fileRouteFromBuilder = fileRouteBuilder.preload({}).route();
declare const fileRoutePreloadResource: FileRoutePreloadResource<"/typed/:id">;
const fileRoutePreloadOptions: FileRoutePreloadOptions<"/typed/:id"> = {
  resources: [fileRoutePreloadResource],
};
const fileRoutePreloadRouteOptions: FileRoutePreloadRouteOptions = {};
const fileRoutePreloadError = new FileRoutePreloadError({
  path: "/typed/:id",
  operation: "custom-preload",
  cause: "promise-shaped preload",
  guidance: "Return an Effect from preload.",
});
const fileRoutePreloadOperation: "resource-selector" | "custom-preload" =
  fileRoutePreloadError.operation;
void fileRouteFromBuilder;
void fileRoutePreloadOptions;
void fileRoutePreloadRouteOptions;
void fileRoutePreloadOperation;

declare const startActionDefinition: ActionDefinition<
  { readonly id: string },
  unknown,
  never,
  never
>;
const startActionDefinitionPin: StartActionDefinition = startActionDefinition;
const startActionRequest: StartActionRequest = {
  name: startActionDefinition.name,
  input: { id: "atlas" },
};
const startActionFormOptions: StartActionFormOptions<{ readonly id: string }> = {
  input: { id: "atlas" },
};
const progressiveStartActionForm: StartActionForm = startActionForm(
  startActionDefinition,
  startActionFormOptions,
);
const namespaceStartActionForm: StartActionForm = StartAction.form(
  startActionDefinition,
  startActionFormOptions,
);
const startActionHiddenField: StartActionFormField = {
  name: startActionNameField,
  value: startActionDefinition.name,
};
const startActionInputHiddenField: StartActionFormField = {
  name: startActionInputField,
  value: "{}",
};
const startActionFormEncodeError = new StartActionFormEncodeError({
  actionName: startActionDefinition.name,
  operation: "json-stringify",
  input: undefined,
  cause: "not serializable",
  guidance: "use serializable defaults",
});
const encodedStartActionInputEffect = encodeStartActionInputEffect(startActionDefinition, {
  id: "atlas",
});
const encodedStartActionPartialInputEffect = encodeStartActionPartialInputEffect(
  startActionDefinition,
  { id: "atlas" },
);
const encodedStartActionRequestEffect = encodeStartActionRequestEffect(startActionDefinition, {
  id: "atlas",
});
const encodedStartActionFormInputEffect = encodeStartActionFormInputEffect(startActionDefinition, {
  id: "atlas",
});
declare const startActionBrowserFormData: FormData;
const startActionFormDecodeSchema = Schema.Struct({
  id: Schema.String,
});
const startActionFormDataDecodeOptionsPin = startActionFormDataDecodeOptions({
  omitFields: ["_intent"],
});
const decodedStartActionFormDataEffect = decodeStartActionFormDataEffect(
  startActionFormDecodeSchema,
  startActionBrowserFormData,
);
const namespaceDecodedStartActionFormDataEffect = StartAction.decodeFormDataEffect(
  startActionFormDecodeSchema,
  startActionBrowserFormData,
  startActionFormDataDecodeOptionsPin,
);
const readStartActionRequest = readStartActionRequestEffect(
  new Request("https://example.com/_actions", {
    method: "POST",
    body: JSON.stringify(startActionRequest),
    headers: { "content-type": "application/json" },
  }),
);
const startActionSubmitEffect = submitStartActionEffect(startActionDefinition, { id: "atlas" });
const startActionInstance = StartAction.use(startActionDefinition);
void progressiveStartActionForm;
void namespaceStartActionForm;
void startActionHiddenField;
void startActionInputHiddenField;
void startActionFormEncodeError;
void encodedStartActionInputEffect;
void encodedStartActionPartialInputEffect;
void encodedStartActionRequestEffect;
void encodedStartActionFormInputEffect;
void startActionFormDataDecodeOptionsPin;
void decodedStartActionFormDataEffect;
void namespaceDecodedStartActionFormDataEffect;
void readStartActionRequest;
void startActionSubmitEffect;
void startActionInstance;
void startActionDefinitionPin;

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

declare const startFileRouteManifest: FileRouteManifest;
const fileRouteDefinitionsOptions: FileRouteDefinitionsModuleOptions = {
  generatedFile: "src/routeTree.gen.ts",
  importMode: "relative",
  routeModuleExportName: "Route",
};
const fileRouteModuleReferences: readonly FileRouteModuleReference[] =
  createFileRouteModuleReferences(startFileRouteManifest, fileRouteDefinitionsOptions);
const fileRouteCompanionReferences: readonly FileRouteCompanionModuleReference[] =
  createFileRouteCompanionModuleReferences(startFileRouteManifest, fileRouteDefinitionsOptions);
const generatedFileRouteDefinitionsOptions: GeneratedFileRouteDefinitionsModuleOptions = {
  ...fileRouteDefinitionsOptions,
  header: defaultGeneratedFileRouteDefinitionsHeader,
};
const fileRouteDefinitionsModule: string = createFileRouteDefinitionsModule(
  startFileRouteManifest,
  fileRouteDefinitionsOptions,
);
const generatedFileRouteDefinitionsModule: string = createGeneratedFileRouteDefinitionsModule(
  startFileRouteManifest,
  generatedFileRouteDefinitionsOptions,
);
const invalidFileRouteIdentifier = new FileRouteDefinitionsModuleInvalidIdentifier({
  routeId: "route-projects",
  routePath: "/projects",
});
const invalidFileRouteExportName = new FileRouteDefinitionsModuleInvalidExportName({
  exportName: "1Route",
});
const fileRouteDefinitionsError: FileRouteDefinitionsModuleError = invalidFileRouteIdentifier;
if (isFileRouteDefinitionsModuleError(fileRouteDefinitionsError)) {
  const routeDefinitionErrorTag: string = fileRouteDefinitionsError._tag;
  void routeDefinitionErrorTag;
}
void fileRouteModuleReferences;
void fileRouteCompanionReferences;
void fileRouteDefinitionsModule;
void generatedFileRouteDefinitionsModule;
void invalidFileRouteExportName;

interface HydrationRuntimeService {
  readonly hydrationRuntimeService: unique symbol;
}

declare const hydrationRuntime: SunfallArcRuntime<HydrationRuntimeService>;
declare const hydrationChunks: ReadonlyArray<StartHydrationChunk>;
const sortedHydrationChunks: ReadonlyArray<StartHydrationChunk> =
  hydrateStartHydrationChunks<HydrationRuntimeService>(hydrationChunks, {
    runtime: hydrationRuntime,
  });

declare const serverFunctionManifest: ServerFunctionManifest;
const endpointDescriptor: StartEffectRpcEndpointDescriptor =
  startEffectRpcEndpointDescriptor(serverFunctionManifest);
const endpointPath: string = endpointDescriptor.path;
declare const procedureDescriptor: StartEffectRpcProcedureDescriptor;
const procedureSchemaFlags: ReadonlyArray<boolean> = [
  procedureDescriptor.schemas.payload,
  procedureDescriptor.schemas.success,
  procedureDescriptor.schemas.error,
];
void sortedHydrationChunks;
void endpointPath;
void procedureSchemaFlags;

const endpointConflictInput: StartEndpointConflictErrorInput = {
  rpcPath: "/same",
  actionPath: "/same",
  guidance: "Use distinct endpoint paths.",
};
const endpointConflict = new StartTransportEndpointConflictError(endpointConflictInput);
const endpointPathInput: StartEndpointPathErrorInput = {
  field: "rpcPath",
  value: "rpc",
  reason: "NotOriginForm",
  guidance: "Use an origin-form path.",
};
const endpointPathError = new StartTransportEndpointPathError(endpointPathInput);
void endpointConflict;
void endpointPathError;
void resolveStartTransportEndpointsEffect;
void validateStartEndpointPathEffect;

const traceHeader: StartRequestTraceHeader = { name: "x-sunfall-arc", value: "ok" };
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
  state: "Success",
};
const traceRequest: StartRequestTraceRequest = {
  id: "request-1",
  method: "GET",
  url: "https://sunfall-arc.test/projects",
  path: "/projects",
  transport: traceTransport,
  headers: [traceHeader],
  cookies: [traceCookie],
};
const traceResponse: StartRequestTraceResponse = {
  status: 200,
  headers: [traceHeader],
  setCookieCount: 0,
};
const traceCollection: StartRequestTraceCollection = { name: "projects", state: "Ready" };
const traceServerFunction: StartRequestTraceServerFunction = {
  name: "loadProjects",
  status: traceStatus,
};
const traceAction: StartRequestTraceAction = {
  name: "saveProject",
  state: "Success",
  failureKind: traceFailureKind,
  invalidationIndexes: [0],
};
const traceFiber: StartRequestTraceFiber = { name: "request-runtime", status: traceFiberStatus };
const traceStream: StartRequestTraceStream = {
  name: "ssr",
  state: traceStreamState,
  chunkCount: 1,
};
const traceTeardownSnapshot: StartRequestTraceTeardownSnapshot = {
  fiberCount: 0,
  familyCount: 0,
  moduleCount: 0,
  tagCount: 0,
};
const traceCleanupFailure: StartRequestTraceCleanupFailure = {
  _tag: "Failure",
  message: "cleanup failed",
};
const traceTeardown: StartRequestTraceTeardown = {
  runtimeDisposed: true,
  beforeDispose: traceTeardownSnapshot,
  afterDispose: traceTeardownSnapshot,
  cleanupFailure: traceCleanupFailure,
};
const traceRoutePlan: StartRequestTraceRoutePlan = {
  _tag: "Matched",
  href: "/projects",
  match: {
    path: "/projects",
    href: "/projects",
    params: {},
    search: {},
  },
  resources: [],
  hydration: {
    resourceCount: 0,
  },
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
  teardown: traceTeardown,
};
const requestMetrics: ReadonlyArray<unknown> = [
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
];
const traceHandler: StartRequestTraceHandler = (trace) => {
  void trace;
};
void requestTrace;
void requestMetrics;
void traceHandler;
