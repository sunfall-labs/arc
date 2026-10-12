import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";
import { cookbookMeta, pageHead } from "../../page-meta.js";

export const route = Route.define("/cookbook", {
  preload: () => Resource.preload(RecipeIndex("all")),
  head: () => pageHead(cookbookMeta),
});
