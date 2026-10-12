import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";
import { blogPostMeta, pageHead } from "../../page-meta.js";

export const route = Route.define("/blog/introducing-sunfall-arc", {
  preload: () => Resource.preload(RecipeIndex("all")),
  head: () => ({ ...pageHead(blogPostMeta), meta: [{ property: "og:type", content: "article" }] }),
});
