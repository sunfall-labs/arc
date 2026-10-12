import { isActionDefinition } from "@sunfall/arc-core";
import { implementations } from "./domain.server.js";
import { routeById, routes } from "./routeTree.gen.js";

// Narrow example-only summary used by SSR headers and tests.
export const projectConsoleStartGraph = {
  routes,
  routeById,
  implementations,
} as const;

export const projectConsoleStartGraphSummary = {
  routes: projectConsoleStartGraph.routes.map((route) => route.path),
  resources: projectConsoleStartGraph.implementations
    .filter((implementation) => !isActionDefinition(implementation))
    .map((implementation) => implementation.name),
  actions: projectConsoleStartGraph.implementations
    .filter((implementation) => isActionDefinition(implementation))
    .map((implementation) => implementation.name),
} as const;

export const projectConsoleStartGraphHeader = [
  `routes=${projectConsoleStartGraphSummary.routes.length}`,
  `resources=${projectConsoleStartGraphSummary.resources.length}`,
  `actions=${projectConsoleStartGraphSummary.actions.length}`,
].join("; ");
