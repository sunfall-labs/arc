import { routeById, routeTree } from "./routeTree.gen.js";
import {
  projectConsoleActionManifest,
  projectConsoleServerFunctionManifest
} from "./start-options.js";

export const projectConsoleStartGraph = {
  routes: routeTree,
  routeById,
  serverFunctions: projectConsoleServerFunctionManifest,
  actions: projectConsoleActionManifest
} as const;

export const projectConsoleStartGraphSummary = {
  routes: projectConsoleStartGraph.routes.map((route) => route.path),
  serverFunctions: projectConsoleStartGraph.serverFunctions.map((entry) => entry.name),
  actions: projectConsoleStartGraph.actions.map((entry) => entry.name)
} as const;

export const projectConsoleStartGraphHeader = [
  `routes=${projectConsoleStartGraphSummary.routes.length}`,
  `server-functions=${projectConsoleStartGraphSummary.serverFunctions.length}`,
  `actions=${projectConsoleStartGraphSummary.actions.length}`
].join("; ");
