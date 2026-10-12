import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { Effect } from "effect";
import { ProjectList } from "../domain.js";
import { ProjectSummaries, ProjectWorkItems } from "../project-collections.js";

export const Route = FileRoute.define("/")({
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
