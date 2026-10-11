import { Resource } from "@sunfall/arc-core";
import { defineFileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../../content.js";

export const Route = defineFileRoute("/docs")({
  preloadResources: [RecipeIndex],
  preloadCollections: [],
  preload: () => Resource.prefetchEffect(RecipeIndex("all")),
});
