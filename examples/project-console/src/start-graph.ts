import { projectConsoleActions } from "./domain.js";
import { serverFunctions } from "./domain.server.js";
import { routeById, routes } from "./routeTree.gen.js";

// Narrow example-only summary used by SSR headers and tests. Production app
// topology comes from the generated `virtual:sunfall-arc/app-graph` artifact,
// which the Start plugin derives from the same definitions.
export const projectConsoleStartGraph = {
  routes,
  routeById,
  serverFunctions,
  actions: projectConsoleActions,
} as const;

export const projectConsoleStartGraphSummary = {
  routes: projectConsoleStartGraph.routes.map((route) => route.path),
  serverFunctions: projectConsoleStartGraph.serverFunctions.map((fn) => fn.name),
  actions: projectConsoleStartGraph.actions.map((action) => action.name),
} as const;

export const projectConsoleStartGraphHeader = [
  `routes=${projectConsoleStartGraphSummary.routes.length}`,
  `server-functions=${projectConsoleStartGraphSummary.serverFunctions.length}`,
  `actions=${projectConsoleStartGraphSummary.actions.length}`,
].join("; ");
