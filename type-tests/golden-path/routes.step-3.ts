import { Resource, Route } from "@sunfall/arc-core";
import { Schema } from "effect";
import { ProjectById, ProjectId, ProjectList, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preloadResources: [ProjectList],
  preload: () => Resource.preload(ProjectsRef),
});

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)]),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
