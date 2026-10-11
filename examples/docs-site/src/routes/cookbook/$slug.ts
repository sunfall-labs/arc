import { Resource } from "@sunfall/arc-core";
import { defineFileRoute } from "@sunfall/arc-start";
import { Effect } from "effect";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

export const Route = defineFileRoute("/cookbook/:slug")({
  params: RecipeRouteParams,
  preloadResources: [RecipeIndex, RecipeBySlug],
  preloadCollections: [],
  preload: ({ params }) =>
    Effect.all(
      [
        Resource.prefetchEffect(RecipeIndex("all")),
        Resource.prefetchEffect(RecipeBySlug(params.slug)),
      ],
      { discard: true },
    ),
});
