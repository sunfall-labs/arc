import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../../content.js";
import { DocsRouteParams } from "../../docs-slugs.js";

export const Route = FileRoute.define("/docs/:slug")({
  params: DocsRouteParams,
  preloadResources: [RecipeIndex],
  preloadCollections: [],
  preload: () => Resource.preload(RecipeIndex("all")),
});
