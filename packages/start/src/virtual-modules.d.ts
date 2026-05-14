declare module "virtual:effect-ui/server-functions" {
  export type ServerFunctionManifest = import("./server-function-manifest.js").ServerFunctionManifest;
  export type ServerFunctionManifestEntry =
    import("./server-function-manifest.js").ServerFunctionManifestEntry;

  export const manifest: ServerFunctionManifest;
  export const entries: ServerFunctionManifest["entries"];
  export default manifest;
}

declare module "virtual:effect-ui/actions" {
  export type ActionManifest = import("./action-manifest.js").ActionManifest;
  export type ActionManifestEntry = import("./action-manifest.js").ActionManifestEntry;

  export const manifest: ActionManifest;
  export const entries: ActionManifest["entries"];
  export default manifest;
}

declare module "virtual:effect-ui/file-routes" {
  export type FileRouteManifest = import("./file-routes.js").FileRouteManifest;
  export type FileRouteManifestEntry = import("./file-routes.js").FileRouteManifestEntry;

  export const manifest: FileRouteManifest;
  export const entries: FileRouteManifest["entries"];
  export const modules: FileRouteManifest["modules"];
  export default manifest;
}

declare module "virtual:effect-ui/routes" {
  export const routes: readonly import("@effect-ui/core").Route.Definition<string, unknown, unknown>[];
  export const routeTree: typeof routes;
  export const routeById: Readonly<Record<string, import("@effect-ui/core").Route.Definition<string, unknown, unknown>>>;
  export const routeByPath: Readonly<Record<string, import("@effect-ui/core").Route.Definition<string, unknown, unknown>>>;
  export const fileRouteModules: readonly import("./file-routes.js").FileRouteManifestModule[];
  export const fileRouteMetadata: readonly import("./file-routes.js").FileRouteRouteMetadata[];
  export type RouteTree = typeof routeTree;
  export type RouteById = typeof routeById;
  export type RouteByPath = typeof routeByPath;
  export type FileRoute = RouteTree[number];
  export type FileRouteId = keyof RouteById;
  export type FileRoutePath = keyof RouteByPath;
  export type FileRouteByPath = RouteByPath;
  export type FileRouteParamsById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.Params<RouteById[Id]> };
  export type FileRouteSearchById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.Search<RouteById[Id]> };
  export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: import("@effect-ui/core").Route.HrefOptions<RouteById[Id]> };
  export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
  export type FileRouteParamsByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.Params<FileRouteByPath[Path]> };
  export type FileRouteSearchByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.Search<FileRouteByPath[Path]> };
  export type FileRouteHrefOptionsByPath = { readonly [Path in keyof FileRouteByPath]: import("@effect-ui/core").Route.HrefOptions<FileRouteByPath[Path]> };
  export type FileRouteModules = typeof fileRouteModules;
  export type FileRouteMetadata = typeof fileRouteMetadata;
  export default routes;
}

declare module "virtual:effect-ui/app-graph" {
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
