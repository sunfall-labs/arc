import type { diagnostics, graph } from "virtual:effect-ui/app-graph";
import type { manifest as actionManifest } from "virtual:effect-ui/actions";
import type { manifest as routeManifest } from "virtual:effect-ui/file-routes";
import type { manifest as serverFunctionManifest } from "virtual:effect-ui/server-functions";

export type ProjectConsoleStartGraph = typeof graph;
export type ProjectConsoleStartDiagnostics = typeof diagnostics;

export type ProjectConsoleStartManifestVersions = {
  readonly graph: ProjectConsoleStartGraph["version"];
  readonly routes: typeof routeManifest.version;
  readonly serverFunctions: typeof serverFunctionManifest.version;
  readonly actions: typeof actionManifest.version;
};
