import { Resource } from "@sunfall/arc-core";
import { defineFileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../../content.js";
import { DocsRouteParams } from "../../docs-content.js";

export const Route = defineFileRoute("/docs/:slug")({
  params: DocsRouteParams,
  preloadResources: [RecipeIndex],
  preloadCollections: [],
  preload: () => Resource.prefetchEffect(RecipeIndex("all")),
});
