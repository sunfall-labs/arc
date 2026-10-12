import { Resource, Route } from "@sunfall/arc-core";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

export const route = Route.define("/cookbook/:slug", {
  params: RecipeRouteParams,
  preload: ({ params }) => Resource.preload([RecipeIndex("all"), RecipeBySlug(params.slug)]),
});
