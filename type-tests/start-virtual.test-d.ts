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
  errorBoundaryByPath,
  fileRouteErrorBoundaryById,
  fileRouteLayoutsById,
  fileRouteMetadata as routeFileRouteMetadata,
  fileRouteMetadataById,
  fileRouteModules as routeFileRouteModules,
  hrefById,
  hrefByPath,
  isRoutePathMatch,
  layoutsById,
  layoutsByPath,
  metadataById,
  metadataByPath,
  routeById,
  routeByPath,
  routeIdByPath,
  routes as virtualRoutes,
  type FileRoute,
  type FileRouteErrorBoundary,
  type FileRouteErrorBoundaryById,
  type FileRouteHrefArgs,
  type FileRouteHrefArgsById,
  type FileRouteHrefArgsByPath,
  type FileRouteHrefOptions,
  type FileRouteHrefOptionsById,
  type FileRouteHrefOptionsByPath,
  type FileRouteId,
  type FileRouteLayouts,
  type FileRouteLayoutsById,
  type FileRouteMatch,
  type FileRouteMetadata,
  type FileRouteMetadataById,
  type FileRouteMetadataModules,
  type FileRouteModules,
  type FileRouteParamsById,
  type FileRouteParamsByPath,
  type FileRoutePath,
  type FileRouteSearchById,
  type FileRouteSearchByPath,
  type RouteById,
  type RouteByPath,
  type RouteIdByPath,
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
  routeByPath,
  routeIdByPath,
  hrefById,
  hrefByPath,
  fileRouteLayoutsById,
  fileRouteErrorBoundaryById,
  fileRouteMetadataById,
  layoutsById,
  layoutsByPath,
  errorBoundaryById,
  errorBoundaryByPath,
  metadataById,
  metadataByPath,
  routeFileRouteModules,
  routeFileRouteMetadata,
  isRoutePathMatch,
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
  | RouteByPath
  | RouteIdByPath
  | FileRoute
  | FileRouteId
  | FileRoutePath
  | FileRouteParamsById
  | FileRouteSearchById
  | FileRouteHrefOptionsById
  | FileRouteHrefOptions<FileRouteId>
  | FileRouteHrefArgsById
  | FileRouteHrefArgs<FileRouteId>
  | FileRouteParamsByPath
  | FileRouteSearchByPath
  | FileRouteHrefOptionsByPath
  | FileRouteHrefArgsByPath
  | FileRouteMatch<FileRoutePath>
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
