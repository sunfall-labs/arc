import { Resource } from "@sunfall/arc-core";
import { defineFileRoute } from "@sunfall/arc-start";
import { Effect } from "effect";
import { ProjectList } from "../domain.js";
import { ProjectSummaries, ProjectWorkItems } from "../project-collections.js";

export const Route = defineFileRoute("/")({
  preloadResources: [ProjectList],
  preloadCollections: [ProjectSummaries, ProjectWorkItems],
  preload: () =>
    Effect.all(
      [
        Resource.prefetchEffect(ProjectList("all")),
        ProjectSummaries.preloadEffect(),
        ProjectWorkItems.preloadEffect(),
      ],
      { discard: true },
    ),
});
