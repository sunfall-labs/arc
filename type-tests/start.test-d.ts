import {
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  preloadRequestEffect,
  submitStartActionEffect,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphWireSchemasEffect,
  type StartAppGraph,
  type StartAppGraphActionBehaviorPolicy,
  type StartAppGraphDiagnostics,
  type StartAppGraphDiagnosticsPolicy,
  type StartAppGraphDiagnosticsPolicyViolation,
  type StartFetch,
  type StartAppGraphWireSchemaPolicy,
  type StartRequestHandler,
  type StartRequestTrace
} from "@effect-ui/start";

const startExports: Array<unknown> = [
  collectStartAppGraphDiagnosticsPolicyViolations,
  createStartAppGraph,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  describeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  preloadRequestEffect,
  submitStartActionEffect,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphWireSchemasEffect
];
type StartTypes =
  | StartAppGraph
  | StartAppGraphActionBehaviorPolicy
  | StartAppGraphDiagnostics
  | StartAppGraphDiagnosticsPolicy
  | StartAppGraphDiagnosticsPolicyViolation
  | StartAppGraphWireSchemaPolicy
  | StartFetch
  | StartRequestHandler
  | StartRequestTrace;
void startExports;
type _StartTypes = StartTypes;
