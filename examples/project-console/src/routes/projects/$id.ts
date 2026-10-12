import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Filter } from "effect";
import {
  ProjectById,
  ProjectList,
  ProjectWorkItemList,
  WorkItemsRef,
  preloadProjectRouteEffect,
} from "../../domain.js";
import { ProjectNotFound, ProjectRouteParams, ProjectRouteSearch } from "../../model.js";

export const route = Route.define("/projects/:id", {
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  // A missing project is this route's typed preload failure: Start encodes it
  // with this schema, so the hydrated failure view reads its `id`.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById, ProjectWorkItemList],
  preload: ({ params }) =>
    Effect.all([preloadProjectRouteEffect(params), Resource.preload(WorkItemsRef)], {
      discard: true,
    }).pipe(
      // Only a missing project is this route's typed failure; any other
      // failure is a defect for the nearest error boundary.
      Effect.catchFilter(Filter.tagged("ProjectNotFound"), Effect.fail, Effect.die),
    ),
});
