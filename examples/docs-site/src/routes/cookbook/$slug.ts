import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { Effect } from "effect";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

export const Route = FileRoute.define("/cookbook/:slug")({
  params: RecipeRouteParams,
  preloadResources: [RecipeIndex, RecipeBySlug],
  preloadCollections: [],
  preload: ({ params }) =>
    Effect.all(
      [Resource.preload(RecipeIndex("all")), Resource.preload(RecipeBySlug(params.slug))],
      { discard: true },
    ),
});
