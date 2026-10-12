import "@sunfall/arc-start/virtual";

import serverFunctionManifest, {
  entries as serverFunctionEntries,
  type ServerFunctionManifestEntry,
} from "virtual:sunfall-arc/server-functions";
import actionManifest, {
  entries as actionEntries,
  type ActionManifestEntry,
} from "virtual:sunfall-arc/actions";
import fileRouteManifest, {
  entries as fileRouteEntries,
  modules as fileRouteModules,
  type FileRouteManifestEntry,
} from "virtual:sunfall-arc/file-routes";
import {
  errorBoundaryById,
  fileRouteErrorBoundaryById,
  fileRouteLayoutsById,
  fileRouteMetadata as routeFileRouteMetadata,
  fileRouteMetadataById,
  fileRouteModules as routeFileRouteModules,
  layoutsById,
  metadataById,
  routeById,
  routes as virtualRoutes,
  type FileRoute,
  type FileRouteErrorBoundary,
  type FileRouteErrorBoundaryById,
  type FileRouteHrefArgs,
  type FileRouteHrefArgsById,
  type FileRouteHrefOptions,
  type FileRouteHrefOptionsById,
  type FileRouteId,
  type FileRouteLayouts,
  type FileRouteLayoutsById,
  type FileRouteMetadata,
  type FileRouteMetadataById,
  type FileRouteMetadataModules,
  type FileRouteModules,
  type FileRouteParamsById,
  type FileRouteSearchById,
  type RouteById,
  type RouteTree,
} from "virtual:sunfall-arc/routes";
import appGraph, {
  diagnostics as appGraphDiagnostics,
  diagnosticsPolicyViolations as appGraphDiagnosticsPolicyViolations,
  type StartAppGraphDiagnostics,
} from "virtual:sunfall-arc/app-graph";
import runtimeDiagnosticsGraph, {
  diagnostics as runtimeDiagnostics,
  diagnosticsPolicyViolations as runtimeDiagnosticsPolicyViolations,
} from "virtual:sunfall-arc/app-graph/runtime-diagnostics";

const virtualModuleValues: Array<unknown> = [
  serverFunctionManifest,
  serverFunctionEntries,
  actionManifest,
  actionEntries,
  fileRouteManifest,
  fileRouteEntries,
  fileRouteModules,
  virtualRoutes,
  routeById,
  fileRouteLayoutsById,
  fileRouteErrorBoundaryById,
  fileRouteMetadataById,
  layoutsById,
  errorBoundaryById,
  metadataById,
  routeFileRouteModules,
  routeFileRouteMetadata,
  appGraph,
  appGraphDiagnostics,
  appGraphDiagnosticsPolicyViolations,
  runtimeDiagnosticsGraph,
  runtimeDiagnostics,
  runtimeDiagnosticsPolicyViolations,
];
type VirtualManifestEntries =
  | ServerFunctionManifestEntry
  | ActionManifestEntry
  | FileRouteManifestEntry;
type VirtualRouteContracts =
  | RouteTree
  | RouteById
  | FileRoute
  | FileRouteId
  | FileRouteParamsById
  | FileRouteSearchById
  | FileRouteHrefOptionsById
  | FileRouteHrefOptions<FileRouteId>
  | FileRouteHrefArgsById
  | FileRouteHrefArgs<FileRouteId>
  | FileRouteLayoutsById
  | FileRouteErrorBoundaryById
  | FileRouteMetadataById
  | FileRouteLayouts<FileRouteId>
  | FileRouteErrorBoundary<FileRouteId>
  | FileRouteMetadataModules<FileRouteId>
  | FileRouteModules
  | FileRouteMetadata;
type VirtualGraphContracts = StartAppGraphDiagnostics;
void virtualModuleValues;
type _VirtualManifestEntries = VirtualManifestEntries;
type _VirtualRouteContracts = VirtualRouteContracts;
type _VirtualGraphContracts = VirtualGraphContracts;
