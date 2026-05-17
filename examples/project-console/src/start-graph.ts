import { routeById, routeTree } from "./routeTree.gen.js";
import {
  projectConsoleActionSources,
  projectConsoleServerFunctionSources,
} from "./start-options.js";

// Narrow example-only fallback used by SSR headers/tests before Vite virtual
// modules are available. Production app topology should come from the generated
// `virtual:effect-ui/app-graph` artifact.
export const projectConsoleStartGraph = {
  routes: routeTree,
  routeById,
  serverFunctions: projectConsoleServerFunctionSources,
  actions: projectConsoleActionSources,
} as const;

export const projectConsoleStartGraphSummary = {
  routes: projectConsoleStartGraph.routes.map((route) => route.path),
  serverFunctions: projectConsoleStartGraph.serverFunctions.map((source) => source.fn.name),
  actions: projectConsoleStartGraph.actions.map((source) => source.action.name),
} as const;

export const projectConsoleStartGraphHeader = [
  `routes=${projectConsoleStartGraphSummary.routes.length}`,
  `server-functions=${projectConsoleStartGraphSummary.serverFunctions.length}`,
  `actions=${projectConsoleStartGraphSummary.actions.length}`,
].join("; ");
