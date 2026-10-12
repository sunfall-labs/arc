import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../../content.js";
import { DocsRouteParams } from "../../docs-slugs.js";
import { docsPageMeta, pageHead } from "../../page-meta.js";

export const route = Route.define("/docs/:slug", {
  params: DocsRouteParams,
  preload: () => Resource.preload(RecipeIndex("all")),
  head: ({ params }) => pageHead(docsPageMeta(params.slug)),
});
