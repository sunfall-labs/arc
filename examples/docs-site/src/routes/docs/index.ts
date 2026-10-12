import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";
import { docsOverviewMeta, pageHead } from "../../page-meta.js";

export const route = Route.define("/docs", {
  preload: () => Resource.preload(RecipeIndex("all")),
  head: () => pageHead(docsOverviewMeta),
});
