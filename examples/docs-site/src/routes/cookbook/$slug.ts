import { Resource, Route } from "@sunfall/arc-core";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

export const route = Route.define("/cookbook/:slug", {
  params: RecipeRouteParams,
  preload: ({ params }) => Resource.preload([RecipeIndex("all"), RecipeBySlug(params.slug)]),
  // The recipe the preload loaded: its frontmatter title and summary.
  head: ({ params, read }) => {
    const recipe = read(RecipeBySlug(params.slug));
    return recipe === undefined ? {} : { title: recipe.title, description: recipe.summary };
  },
});
