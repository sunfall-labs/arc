import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { Projects } from "./collection.js";
import { ProjectById, ProjectId, ProjectList, ProjectNotFound } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preloadResources: [ProjectList],
  preloadCollections: [Projects],
  preload: () => Projects.preload(),
});

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preloadCollections: [Projects],
  preload: ({ params }) =>
    Effect.all([Projects.preload().pipe(Effect.orDie), Resource.preload(ProjectById(params.id))]),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
