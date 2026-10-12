import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

export const Route = FileRoute.define("/cookbook/:slug")({
  params: RecipeRouteParams,
  preloadResources: [RecipeIndex, RecipeBySlug],
  preloadCollections: [],
  preload: ({ params }) => Resource.preload([RecipeIndex("all"), RecipeBySlug(params.slug)]),
});
