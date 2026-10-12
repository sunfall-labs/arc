import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../content.js";

export const Route = FileRoute.define("/")({
  preloadResources: [RecipeIndex],
  preloadCollections: [],
  preload: () => Resource.preload(RecipeIndex("all")),
});
