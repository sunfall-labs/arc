import { defineApp, type AppDefinitionRegistryInput } from "@effect-ui/core";
import { ProjectApiLive } from "./domain.js";
import { routeById, routeTree } from "./routeTree.gen.js";

export const HomeRoute = routeById.route_root;
export const ProjectsRoute = routeById.route_projects;
export const ProjectRoute = routeById.route_projects_$id;

export const projectConsoleAppBaseOptions = {
  routes: routeTree,
  client: { name: "BrowserLive" },
  server: ProjectApiLive,
} as const;

export const projectConsoleEmptyRegistry = {
  actions: [],
  serverFunctions: [],
} as const;

export const createProjectConsoleApp = <const RegistryInput extends AppDefinitionRegistryInput>(
  registry: RegistryInput,
) =>
  defineApp({
    ...projectConsoleAppBaseOptions,
    registry,
  });

export const app = createProjectConsoleApp(projectConsoleEmptyRegistry);
