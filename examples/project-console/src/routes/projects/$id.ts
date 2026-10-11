import { defineFileRoute } from "@sunfall/arc-start";
import { Effect } from "effect";
import { ProjectById, ProjectList, preloadProjectRouteEffect } from "../../domain.js";
import { ProjectNotFound, ProjectRouteParams, ProjectRouteSearch } from "../../domain.contract.js";
import { ProjectSummaries, ProjectWorkItems } from "../../project-collections.js";

export const Route = defineFileRoute("/projects/:id")({
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  // A missing project is this route's typed preload failure: Start encodes it
  // with this schema, so the hydrated failure view reads its `id`.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preloadCollections: [ProjectSummaries, ProjectWorkItems],
  preload: ({ params }) =>
    Effect.all(
      [
        preloadProjectRouteEffect(params),
        ProjectSummaries.preloadEffect(),
        ProjectWorkItems.preloadEffect(),
      ],
      { discard: true },
    ).pipe(
      Effect.catch((error) =>
        error instanceof ProjectNotFound ? Effect.fail(error) : Effect.die(error),
      ),
    ),
});
