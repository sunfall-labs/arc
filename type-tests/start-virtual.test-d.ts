import "@effect-ui/start/virtual";

import serverFunctionManifest, {
  entries as serverFunctionEntries,
  type ServerFunctionManifestEntry
} from "virtual:effect-ui/server-functions";
import actionManifest, {
  entries as actionEntries,
  type ActionManifestEntry
} from "virtual:effect-ui/actions";
import fileRouteManifest, {
  entries as fileRouteEntries,
  modules as fileRouteModules,
  type FileRouteManifestEntry
} from "virtual:effect-ui/file-routes";
import routeTree, {
  errorBoundaryByPath,
  hrefByPath,
  isRoutePathMatch,
  layoutsByPath,
  metadataByPath,
  routeByPath,
  type Match,
  type RoutePath
} from "virtual:effect-ui/routes";
import appGraph, {
  diagnostics as appGraphDiagnostics,
  diagnosticsPolicyViolations as appGraphDiagnosticsPolicyViolations,
  type StartAppGraphDiagnostics
} from "virtual:effect-ui/app-graph";
import runtimeDiagnosticsGraph, {
  diagnostics as runtimeDiagnostics,
  diagnosticsPolicyViolations as runtimeDiagnosticsPolicyViolations
} from "virtual:effect-ui/app-graph/runtime-diagnostics";

const virtualModuleValues: Array<unknown> = [
  serverFunctionManifest,
  serverFunctionEntries,
  actionManifest,
  actionEntries,
  fileRouteManifest,
  fileRouteEntries,
  fileRouteModules,
  routeTree,
  routeByPath,
  hrefByPath,
  layoutsByPath,
  errorBoundaryByPath,
  metadataByPath,
  isRoutePathMatch,
  appGraph,
  appGraphDiagnostics,
  appGraphDiagnosticsPolicyViolations,
  runtimeDiagnosticsGraph,
  runtimeDiagnostics,
  runtimeDiagnosticsPolicyViolations
];
type VirtualManifestEntries =
  | ServerFunctionManifestEntry
  | ActionManifestEntry
  | FileRouteManifestEntry;
type VirtualRouteContracts =
  | RoutePath
  | Match<RoutePath>;
type VirtualGraphContracts = StartAppGraphDiagnostics;
void virtualModuleValues;
type _VirtualManifestEntries = VirtualManifestEntries;
type _VirtualRouteContracts = VirtualRouteContracts;
type _VirtualGraphContracts = VirtualGraphContracts;
