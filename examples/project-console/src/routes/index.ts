import { Resource, Route } from "@sunfall/arc-core";
import { Effect } from "effect";
import { ProjectList } from "../domain.js";
import { ProjectSummaries, ProjectWorkItems } from "../project-collections.js";

export const route = Route.define("/", {
  preloadResources: [ProjectList],
  preloadCollections: [ProjectSummaries, ProjectWorkItems],
  preload: () =>
    Effect.all(
      [
        Resource.preload(ProjectList("all")),
        ProjectSummaries.preload(),
        ProjectWorkItems.preload(),
      ],
      { discard: true },
    ),
});
