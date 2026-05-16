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
  preloadRequestEffect,
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
  type StartRequestHandler,
  type StartRequestTrace
} from "@effect-ui/start";

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
  preloadRequestEffect,
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
  | StartFetch
  | StartRequestHandler
  | StartRequestTrace;
void startExports;
type _StartTypes = StartTypes;
