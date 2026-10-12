import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../content.js";

export const route = Route.define("/", {
  preloadResources: [RecipeIndex],
  preloadCollections: [],
  preload: () => Resource.preload(RecipeIndex("all")),
});
