declare module "virtual:effect-ui/server-functions" {
  /** Generated server-function manifest discovered by the Start Vite plugin. */
  export type ServerFunctionManifest = import("./server-function-manifest.js").ServerFunctionManifest;
  /** One server-function manifest entry, including server and client module facts. */
  export type ServerFunctionManifestEntry =
    import("./server-function-manifest.js").ServerFunctionManifestEntry;

  /** Complete generated server-function manifest. */
  export const manifest: ServerFunctionManifest;
  /** Server-function manifest entries. */
  export const entries: ServerFunctionManifest["entries"];
  export default manifest;
}

declare module "virtual:effect-ui/actions" {
  /** Generated action manifest discovered by the Start Vite plugin. */
  export type ActionManifest = import("./action-manifest.js").ActionManifest;
  /** One action manifest entry, including server/client modules and behavior facts. */
  export type ActionManifestEntry = import("./action-manifest.js").ActionManifestEntry;

  /** Complete generated action manifest. */
  export const manifest: ActionManifest;
  /** Action manifest entries. */
  export const entries: ActionManifest["entries"];
  export default manifest;
}

declare module "virtual:effect-ui/file-routes" {
  /** Generated file-route manifest discovered by the Start Vite plugin. */
  export type FileRouteManifest = import("./file-routes.js").FileRouteManifest;
  /** One route entry in the generated file-route manifest. */
  export type FileRouteManifestEntry = import("./file-routes.js").FileRouteManifestEntry;

  /** Complete generated file-route manifest. */
  export const manifest: FileRouteManifest;
  /** Route entries that produce runtime route definitions. */
  export const entries: FileRouteManifest["entries"];
  /** Route, layout, error-boundary, and metadata modules discovered from files. */
  export const modules: FileRouteManifest["modules"];
  export default manifest;
}

declare module "virtual:effect-ui/routes" {
  /**
   * Generated route definitions discovered by the Vite plugin.
   *
   * Virtual modules are intentionally app-agnostic in this declaration file, so
   * route maps are broad `Route.Definition<string, unknown, unknown, any>` records.
   * Use the written `routeTree.gen.ts` artifact when an app needs precise
   * route-id, path, params, search, and href-option unions in editor hovers.
   */
  export const routes: readonly import("@effect-ui/core").Route.Definition<string, unknown, unknown, any>[];
  /** Alias for `routes`, matching the written route definitions artifact. */
  export const routeTree: typeof routes;
  /** Broad virtual map keyed by generated route id. */
  export const routeById: Readonly<Record<string, import("@effect-ui/core").Route.Definition<string, unknown, unknown, any>>>;
	  /** Broad virtual map keyed by route path. */
	  export const routeByPath: Readonly<Record<string, import("@effect-ui/core").Route.Definition<string, unknown, unknown, any>>>;
	  /** Broad virtual map from route path to generated route id. */
	  export const routeIdByPath: Readonly<Record<string, string>>;
	  /** Builds a typed href for a virtual route id. Written generated files narrow this per app. */
	  export const hrefById: <Id extends RouteId>(
	    id: Id,
    ...args: import("@effect-ui/core").Route.HrefArgs<RouteById[Id]>
  ) => string;
  /** Builds a typed href for a virtual route path. Written generated files narrow this per app. */
  export const hrefByPath: <Path extends RoutePath>(
    path: Path,
    ...args: import("@effect-ui/core").Route.HrefArgs<RouteByPath[Path]>
  ) => string;
  /** Narrows a broad route match to one virtual route path pattern. */
	  export const isRoutePathMatch: <Path extends RoutePath>(
	    path: Path,
	    match: import("@effect-ui/core").Route.Match<FileRoute> | undefined
	  ) => match is FileRouteMatch<Path>;
	  /** Layout modules scoped to each generated route id. */
	  export const fileRouteLayoutsById: Readonly<Record<string, readonly import("./file-route.js").FileRouteLayoutDefinition[]>>;
	  /** Nearest error boundary modules keyed by generated route id. */
	  export const fileRouteErrorBoundaryById: Readonly<Partial<Record<string, import("./file-route.js").FileRouteErrorBoundaryDefinition>>>;
	  /** Metadata modules scoped to each generated route id. */
	  export const fileRouteMetadataById: Readonly<Record<string, readonly import("./file-route.js").FileRouteMetadataDefinition[]>>;
	  /** Returns layout modules for a virtual route id. Written generated files narrow this per app. */
	  export const layoutsById: <Id extends RouteId>(id: Id) => FileRouteLayouts<Id>;
	  /** Returns layout modules for a virtual route path. Written generated files narrow this per app. */
	  export const layoutsByPath: <Path extends RoutePath>(path: Path) => FileRouteLayouts<RouteIdByPath[Path]>;
	  /** Returns the nearest error boundary for a virtual route id, when one exists. */
	  export const errorBoundaryById: <Id extends RouteId>(id: Id) => FileRouteErrorBoundary<Id>;
	  /** Returns the nearest error boundary for a virtual route path, when one exists. */
	  export const errorBoundaryByPath: <Path extends RoutePath>(path: Path) => FileRouteErrorBoundary<RouteIdByPath[Path]>;
	  /** Returns metadata modules for a virtual route id. Written generated files narrow this per app. */
	  export const metadataById: <Id extends RouteId>(id: Id) => FileRouteMetadataModules<Id>;
	  /** Returns metadata modules for a virtual route path. Written generated files narrow this per app. */
	  export const metadataByPath: <Path extends RoutePath>(path: Path) => FileRouteMetadataModules<RouteIdByPath[Path]>;
	  /** Generated file-route manifest modules used by diagnostics and tooling. */
	  export const fileRouteModules: readonly import("./file-routes.js").FileRouteManifestModule[];
  /** Generated route metadata used by diagnostics and tooling. */
  export const fileRouteMetadata: readonly import("./file-routes.js").FileRouteRouteMetadata[];
  /** Broad virtual route tree type; written generated files provide precise app-specific unions. */
  export type RouteTree = typeof routeTree;
  /** Broad map type keyed by generated route id. */
	  export type RouteById = typeof routeById;
	  /** Broad map type keyed by route path. */
	  export type RouteByPath = typeof routeByPath;
	  /** Broad map type from route path to generated route id. */
	  export type RouteIdByPath = typeof routeIdByPath;
	  /** One generated file route definition. */
	  export type FileRoute = RouteTree[number];
  /** Broad file route id union for virtual modules. */
  export type FileRouteId = keyof RouteById;
  /** Broad file route path union for virtual modules. */
  export type FileRoutePath = keyof RouteByPath;
  /** Alias for the route path lookup map. */
  export type FileRouteByPath = RouteByPath;
  /** Params mapped by route id. Written generated files narrow this per app. */
  export type FileRouteParamsById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.Params<RouteById[Id]> };
  /** Search values mapped by route id. Written generated files narrow this per app. */
  export type FileRouteSearchById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.Search<RouteById[Id]> };
  /** Href options mapped by route id. Written generated files narrow this per app. */
  export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.HrefOptions<RouteById[Id]> };
  /** Href options for one virtual route id. */
  export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
  /** Href arguments mapped by route id. Written generated files narrow this per app. */
  export type FileRouteHrefArgsById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.HrefArgs<RouteById[Id]> };
  /** Href arguments for one virtual route id. */
  export type FileRouteHrefArgs<Id extends FileRouteId> = FileRouteHrefArgsById[Id];
  /** Params mapped by route path. Written generated files narrow this per app. */
  export type FileRouteParamsByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.Params<FileRouteByPath[Path]> };
  /** Search values mapped by route path. Written generated files narrow this per app. */
  export type FileRouteSearchByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.Search<FileRouteByPath[Path]> };
  /** Href options mapped by route path. Written generated files narrow this per app. */
  export type FileRouteHrefOptionsByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.HrefOptions<FileRouteByPath[Path]> };
  /** Href arguments mapped by route path. Written generated files narrow this per app. */
  export type FileRouteHrefArgsByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.HrefArgs<FileRouteByPath[Path]> };
	  /** Route match narrowed to one virtual route path pattern. */
	  export type FileRouteMatch<Path extends FileRoutePath> = import("@effect-ui/core").Route.Match<FileRouteByPath[Path]>;
	  /** Layout modules keyed by virtual route id. */
	  export type FileRouteLayoutsById = typeof fileRouteLayoutsById;
	  /** Error boundary modules keyed by virtual route id when present. */
	  export type FileRouteErrorBoundaryById = typeof fileRouteErrorBoundaryById;
	  /** Metadata modules keyed by virtual route id. */
	  export type FileRouteMetadataById = typeof fileRouteMetadataById;
	  /** Layout modules for one virtual route id. */
	  export type FileRouteLayouts<Id extends FileRouteId> = FileRouteLayoutsById[Id];
	  /** Error boundary module for one virtual route id, or undefined when none is scoped. */
	  export type FileRouteErrorBoundary<Id extends FileRouteId> = FileRouteErrorBoundaryById[Id];
	  /** Metadata modules for one virtual route id. */
	  export type FileRouteMetadataModules<Id extends FileRouteId> = FileRouteMetadataById[Id];
	  /** Friendly alias for the virtual route id union. */
	  export type RouteId = FileRouteId;
  /** Friendly alias for the virtual route path union. */
  export type RoutePath = FileRoutePath;
  /** Friendly alias for params keyed by route id. */
  export type ParamsById = FileRouteParamsById;
  /** Friendly alias for search values keyed by route id. */
  export type SearchById = FileRouteSearchById;
  /** Friendly alias for href options keyed by route id. */
  export type HrefById = FileRouteHrefOptionsById;
  /** Friendly alias for href options for one virtual route id. */
  export type Href<Id extends RouteId> = FileRouteHrefOptions<Id>;
  /** Friendly alias for href arguments keyed by route id. */
  export type HrefArgsById = FileRouteHrefArgsById;
  /** Friendly alias for href arguments for one virtual route id. */
  export type HrefArgs<Id extends RouteId> = FileRouteHrefArgs<Id>;
  /** Friendly alias for params keyed by route path. */
  export type ParamsByPath = FileRouteParamsByPath;
  /** Friendly alias for search values keyed by route path. */
  export type SearchByPath = FileRouteSearchByPath;
  /** Friendly alias for href options keyed by route path. */
  export type HrefByPath = FileRouteHrefOptionsByPath;
  /** Friendly alias for href arguments keyed by route path. */
  export type HrefArgsByPath = FileRouteHrefArgsByPath;
  /** Friendly alias for route matches narrowed by generated route path. */
  export type Match<Path extends RoutePath> = FileRouteMatch<Path>;
  /** Generated file-route companion modules. */
  export type FileRouteModules = typeof fileRouteModules;
  /** Generated route metadata projection. */
  export type FileRouteMetadata = typeof fileRouteMetadata;
  export default routes;
}

declare module "virtual:effect-ui/app-graph" {
  /** Static app graph generated from file routes, server functions, and actions. */
  export type StartAppGraph = import("./app-graph.js").StartAppGraph;
  /** Static diagnostics projected from generated manifests only. */
  export type StartAppGraphDiagnostics = import("./app-graph.js").StartAppGraphDiagnostics;
  /** Diagnostics policy violation raised before the virtual module is usable. */
  export type StartAppGraphDiagnosticsPolicyViolation = import("./app-graph.js").StartAppGraphDiagnosticsPolicyViolation;

  /** Generated static app graph. */
  export const graph: StartAppGraph;
  /** Static manifest diagnostics that do not import route implementation modules. */
  export const diagnostics: StartAppGraphDiagnostics;
  /** Policy violations after the virtual module's Effect guard succeeds. */
  export const diagnosticsPolicyViolations: readonly StartAppGraphDiagnosticsPolicyViolation[];
  /** Generated route graph entries. */
  export const routes: StartAppGraph["routes"];
  /** Generated server-function graph entries. */
  export const serverFunctions: StartAppGraph["serverFunctions"];
  /** Generated action graph entries. */
  export const actions: StartAppGraph["actions"];
  export default graph;
}

declare module "virtual:effect-ui/app-graph/runtime-diagnostics" {
  /** Static app graph generated from file routes, server functions, and actions. */
  export type StartAppGraph = import("./app-graph.js").StartAppGraph;
  /** Runtime diagnostics layered onto the generated app graph. */
  export type StartAppGraphDiagnostics = import("./app-graph.js").StartAppGraphDiagnostics;
  /** Diagnostics policy violation raised before the virtual module is usable. */
  export type StartAppGraphDiagnosticsPolicyViolation = import("./app-graph.js").StartAppGraphDiagnosticsPolicyViolation;

  /** Generated static app graph. */
  export const graph: StartAppGraph;
  /** Runtime-aware diagnostics for routes, resources, collections, actions, and server functions. */
  export const diagnostics: StartAppGraphDiagnostics;
  /** Policy violations after the virtual module's Effect guard succeeds. */
  export const diagnosticsPolicyViolations: readonly StartAppGraphDiagnosticsPolicyViolation[];
  /** Generated route graph entries. */
  export const routes: StartAppGraph["routes"];
  /** Generated server-function graph entries. */
  export const serverFunctions: StartAppGraph["serverFunctions"];
  /** Generated action graph entries. */
  export const actions: StartAppGraph["actions"];
  export default graph;
}
