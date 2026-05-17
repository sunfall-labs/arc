import type { diagnostics, graph } from "virtual:sunfall-arc/app-graph";
import type { manifest as actionManifest } from "virtual:sunfall-arc/actions";
import type { manifest as routeManifest } from "virtual:sunfall-arc/file-routes";
import type { manifest as serverFunctionManifest } from "virtual:sunfall-arc/server-functions";

export type ProjectConsoleStartGraph = typeof graph;
export type ProjectConsoleStartDiagnostics = typeof diagnostics;

export type ProjectConsoleStartManifestVersions = {
  readonly graph: ProjectConsoleStartGraph["version"];
  readonly routes: typeof routeManifest.version;
  readonly serverFunctions: typeof serverFunctionManifest.version;
  readonly actions: typeof actionManifest.version;
};
