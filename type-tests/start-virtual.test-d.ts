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
import routeTree, {
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
  type FileRouteByPath,
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
  type Href,
  type HrefArgs,
  type HrefArgsById,
  type HrefArgsByPath,
  type HrefById,
  type HrefByPath,
  type Match,
  type ParamsById,
  type ParamsByPath,
  type RouteById,
  type RouteByPath,
  type RouteId,
  type RouteIdByPath,
  type RoutePath,
  type RouteTree,
  type SearchById,
  type SearchByPath,
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
  routeTree,
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
  | RoutePath
  | RouteId
  | RouteTree
  | RouteById
  | RouteByPath
  | RouteIdByPath
  | FileRoute
  | FileRouteId
  | FileRoutePath
  | FileRouteByPath
  | FileRouteParamsById
  | FileRouteSearchById
  | FileRouteHrefOptionsById
  | FileRouteHrefOptions<RouteId>
  | FileRouteHrefArgsById
  | FileRouteHrefArgs<RouteId>
  | FileRouteParamsByPath
  | FileRouteSearchByPath
  | FileRouteHrefOptionsByPath
  | FileRouteHrefArgsByPath
  | FileRouteMatch<RoutePath>
  | FileRouteLayoutsById
  | FileRouteErrorBoundaryById
  | FileRouteMetadataById
  | FileRouteLayouts<RouteId>
  | FileRouteErrorBoundary<RouteId>
  | FileRouteMetadataModules<RouteId>
  | ParamsById
  | SearchById
  | HrefById
  | Href<RouteId>
  | HrefArgsById
  | HrefArgs<RouteId>
  | ParamsByPath
  | SearchByPath
  | HrefByPath
  | HrefArgsByPath
  | Match<RoutePath>
  | FileRouteModules
  | FileRouteMetadata;
type VirtualGraphContracts = StartAppGraphDiagnostics;
void virtualModuleValues;
type _VirtualManifestEntries = VirtualManifestEntries;
type _VirtualRouteContracts = VirtualRouteContracts;
type _VirtualGraphContracts = VirtualGraphContracts;
