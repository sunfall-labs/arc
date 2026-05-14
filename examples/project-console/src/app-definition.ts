import { defineApp } from "@effect-ui/core";
import { ProjectApiLive } from "./domain.js";
import { routeById, routeTree } from "./routeTree.gen.js";

export const HomeRoute = routeById.route_root;
export const ProjectsRoute = routeById.route_projects;
export const ProjectRoute = routeById.route_projects_$id;

export const app = defineApp({
  routes: routeTree,
  client: { name: "BrowserLive" },
  server: ProjectApiLive
});
