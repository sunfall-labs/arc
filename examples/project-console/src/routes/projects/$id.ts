import { Route } from "@sunfall/arc-core";
import { Effect, Filter } from "effect";
import { ProjectById, ProjectList, preloadProjectRouteEffect } from "../../domain.js";
import { ProjectNotFound, ProjectRouteParams, ProjectRouteSearch } from "../../domain.contract.js";
import { ProjectSummaries, ProjectWorkItems } from "../../project-collections.js";

export const route = Route.define("/projects/:id", {
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  // A missing project is this route's typed preload failure: Start encodes it
  // with this schema, so the hydrated failure view reads its `id`.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preloadCollections: [ProjectSummaries, ProjectWorkItems],
  preload: ({ params }) =>
    Effect.all(
      [preloadProjectRouteEffect(params), ProjectSummaries.preload(), ProjectWorkItems.preload()],
      { discard: true },
    ).pipe(
      // Only a missing project is this route's typed failure; transport
      // failures are defects for the nearest error boundary.
      Effect.catchFilter(Filter.tagged("ProjectNotFound"), Effect.fail, Effect.die),
    ),
});
