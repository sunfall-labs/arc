import { defineFileRoute } from "@effect-ui/start";
import { Effect } from "effect";
import { ProjectById, preloadProjectRouteEffect, ProjectsRef } from "../../domain.js";
import { ProjectRouteParams, ProjectRouteSearch } from "../../domain.contract.js";
import { ProjectSummaries } from "../../project-collections.js";

export const Route = defineFileRoute("/projects/:id")({
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  preloadResources: [ProjectsRef, ProjectById],
  preloadCollections: [ProjectSummaries],
  preload: ({ params }) =>
    Effect.asVoid(
      Effect.all([
        preloadProjectRouteEffect(params),
        ProjectSummaries.preloadEffect()
      ])
    )
});
