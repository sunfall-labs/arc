import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ProjectStoreMemory } from "./projects.memory.js";
import { projectById, projectList } from "./projects.server.js";
import { renameProject } from "./rename.server.js";

export const handleRequest = createRequestHandler(app, {
  // Provides what the implementations need (`ProjectStore`).
  server: ProjectStoreMemory,
  implementations: [projectList, projectById, renameProject],
  document: ({ match }) => ({
    title: match === undefined ? "Projects" : `Projects · ${match.href}`,
  }),
});
