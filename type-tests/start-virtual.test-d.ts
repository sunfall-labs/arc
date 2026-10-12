import "@sunfall/arc-start/virtual";

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

const virtualModuleValues: Array<unknown> = [
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
];
type VirtualManifestEntries = FileRouteManifestEntry;
type VirtualRouteContracts =
  | RouteTree
  | RouteById
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
void virtualModuleValues;
type _VirtualManifestEntries = VirtualManifestEntries;
type _VirtualRouteContracts = VirtualRouteContracts;
