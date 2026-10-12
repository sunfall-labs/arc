import { type AppDefinitionRegistryInput, App } from "@sunfall/arc-core";
import { ProjectApiLive } from "./domain.js";
import { routeById, routes } from "./routeTree.gen.js";

export const HomeRoute = routeById.route_root;
export const ProjectsRoute = routeById.route_projects;
export const ProjectRoute = routeById.route_projects_$id;

export const projectConsoleAppBaseOptions = {
  routes,
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
  App.define({
    ...projectConsoleAppBaseOptions,
    registry,
  });

export const app = createProjectConsoleApp(projectConsoleEmptyRegistry);
