import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";

export const route = Route.define("/blog/introducing-sunfall-arc", {
  preloadResources: [RecipeIndex],
  preload: () => Resource.preload(RecipeIndex("all")),
});
