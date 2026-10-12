import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { ProjectById, ProjectId, ProjectList, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preloadResources: [ProjectList],
  preload: () => Resource.preload(ProjectsRef),
});

const preloadProject = (id: ProjectId) =>
  Effect.all([Resource.preload(ProjectsRef), Resource.preload(ProjectById(id))], {
    discard: true,
  }).pipe(
    // A load callback that throws is a bug, not a typed failure.
    Effect.catchTag("EffectInputCallbackError", Effect.die),
  );

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preload: ({ params }) => preloadProject(params.id),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
