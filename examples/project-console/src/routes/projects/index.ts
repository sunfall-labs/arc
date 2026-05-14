import { defineFileRoute } from "@effect-ui/start";
import { Effect } from "effect";
import { preloadProjectsEffect, ProjectsRef } from "../../domain.js";
import { ProjectSummaries } from "../../project-collections.js";

export const Route = defineFileRoute("/projects")({
  preloadResources: [ProjectsRef],
  preloadCollections: [ProjectSummaries],
  preload: () =>
    Effect.asVoid(
      Effect.all([
        preloadProjectsEffect,
        ProjectSummaries.preloadEffect()
      ])
    )
});
