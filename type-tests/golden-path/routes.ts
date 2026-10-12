import { Resource, Route } from "@sunfall/arc-core";
import { Schema } from "effect";
import { ProjectById, ProjectId, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preload: () => Resource.preload(ProjectsRef),
});

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)]),
  // The tab title, from what the preload loaded; kept current on navigation.
  head: ({ params, read }) => ({ title: read(ProjectById(params.id))?.name }),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
