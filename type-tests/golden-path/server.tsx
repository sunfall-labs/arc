import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ProjectApiMemory } from "./projects.memory.js";

export const handleRequest = createRequestHandler(app, {
  server: ProjectApiMemory,
  document: ({ match }) => ({
    title: match === undefined ? "Projects" : `Projects · ${match.href}`,
  }),
});
