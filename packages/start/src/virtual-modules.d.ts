declare module "virtual:sunfall-arc/server-functions" {
  /** Generated server-function manifest discovered by the Start Vite plugin. */
  export type ServerFunctionManifest =
    import("./server-function-manifest.js").ServerFunctionManifest;
  /** One server-function manifest entry, including server and client module facts. */
  export type ServerFunctionManifestEntry =
    import("./server-function-manifest.js").ServerFunctionManifestEntry;

  /** Complete generated server-function manifest. */
  export const manifest: ServerFunctionManifest;
  /** Server-function manifest entries. */
  export const entries: ServerFunctionManifest["entries"];
  export default manifest;
}

declare module "virtual:sunfall-arc/actions" {
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

declare module "virtual:sunfall-arc/file-routes" {
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

declare module "virtual:sunfall-arc/routes" {
  /**
   * Generated route definitions discovered by the Vite plugin.
   *
   * Virtual modules are intentionally app-agnostic in this declaration file, so
   * route maps are broad `Route.Definition<string, unknown, unknown, any>` records.
   * Use the written `routeTree.gen.ts` artifact when an app needs precise
   * route-id, path, params, search, and href-option unions in editor hovers.
   */
  export const routes: readonly import("@sunfall/arc-core").Route.Definition<
    string,
    unknown,
    unknown,
    any
  >[];
  /** Broad virtual map keyed by generated route id. */
  export const routeById: Readonly<
    Record<string, import("@sunfall/arc-core").Route.Definition<string, unknown, unknown, any>>
  >;
  /** Layout module exports scoped to each generated route id. */
  export const fileRouteLayoutsById: Readonly<Record<string, readonly unknown[]>>;
  /** Nearest error boundary module export keyed by generated route id. */
  export const fileRouteErrorBoundaryById: Readonly<Partial<Record<string, unknown>>>;
  /** Metadata module exports scoped to each generated route id. */
  export const fileRouteMetadataById: Readonly<Record<string, readonly unknown[]>>;
  /** Returns layout modules for a virtual route id. Written generated files narrow this per app. */
  export const layoutsById: <Id extends FileRouteId>(id: Id) => FileRouteLayouts<Id>;
  /** Returns the nearest error boundary for a virtual route id, when one exists. */
  export const errorBoundaryById: <Id extends FileRouteId>(id: Id) => FileRouteErrorBoundary<Id>;
  /** Returns metadata modules for a virtual route id. Written generated files narrow this per app. */
  export const metadataById: <Id extends FileRouteId>(id: Id) => FileRouteMetadataModules<Id>;
  /** Generated file-route manifest modules used by diagnostics and tooling. */
  export const fileRouteModules: readonly import("./file-routes.js").FileRouteManifestModule[];
  /** Generated route metadata used by diagnostics and tooling. */
  export const fileRouteMetadata: readonly import("./file-routes.js").FileRouteRouteMetadata[];
  /** Broad virtual route tree type; written generated files provide precise app-specific unions. */
  export type RouteTree = typeof routes;
  /** Broad map type keyed by generated route id. */
  export type RouteById = typeof routeById;
  /** One generated file route definition. */
  export type FileRoute = RouteTree[number];
  /** Broad file route id union for virtual modules. */
  export type FileRouteId = keyof RouteById;
  /** Params mapped by route id. Written generated files narrow this per app. */
  export type FileRouteParamsById = {
    readonly [Id in FileRouteId]: import("@sunfall/arc-core").Route.Params<RouteById[Id]>;
  };
  /** Search values mapped by route id. Written generated files narrow this per app. */
  export type FileRouteSearchById = {
    readonly [Id in FileRouteId]: import("@sunfall/arc-core").Route.Search<RouteById[Id]>;
  };
  /** Href options mapped by route id. Written generated files narrow this per app. */
  export type FileRouteHrefOptionsById = {
    readonly [Id in FileRouteId]: import("@sunfall/arc-core").Route.HrefOptions<RouteById[Id]>;
  };
  /** Href options for one virtual route id. */
  export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
  /** Href arguments mapped by route id. Written generated files narrow this per app. */
  export type FileRouteHrefArgsById = {
    readonly [Id in FileRouteId]: import("@sunfall/arc-core").Route.HrefArgs<RouteById[Id]>;
  };
  /** Href arguments for one virtual route id. */
  export type FileRouteHrefArgs<Id extends FileRouteId> = FileRouteHrefArgsById[Id];
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
  /** Generated file-route companion modules. */
  export type FileRouteModules = typeof fileRouteModules;
  /** Generated route metadata projection. */
  export type FileRouteMetadata = typeof fileRouteMetadata;
}

declare module "virtual:sunfall-arc/app-graph" {
  /** Static app graph generated from file routes, server functions, and actions. */
  export type StartAppGraph = import("./app-graph.js").StartAppGraph;
  /** Static diagnostics projected from generated manifests only. */
  export type StartAppGraphDiagnostics = import("./app-graph.js").StartAppGraphDiagnostics;
  /** Diagnostics policy violation raised before the virtual module is usable. */
  export type StartAppGraphDiagnosticsPolicyViolation =
    import("./app-graph.js").StartAppGraphDiagnosticsPolicyViolation;

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

declare module "virtual:sunfall-arc/app-graph/runtime-diagnostics" {
  /** Static app graph generated from file routes, server functions, and actions. */
  export type StartAppGraph = import("./app-graph.js").StartAppGraph;
  /** Runtime diagnostics layered onto the generated app graph. */
  export type StartAppGraphDiagnostics = import("./app-graph.js").StartAppGraphDiagnostics;
  /** Diagnostics policy violation raised before the virtual module is usable. */
  export type StartAppGraphDiagnosticsPolicyViolation =
    import("./app-graph.js").StartAppGraphDiagnosticsPolicyViolation;

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
