import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";
import { DocsRouteParams } from "../../docs-slugs.js";

export const route = Route.define("/docs/:slug", {
  params: DocsRouteParams,
  preloadResources: [RecipeIndex],
  preload: () => Resource.preload(RecipeIndex("all")),
});
