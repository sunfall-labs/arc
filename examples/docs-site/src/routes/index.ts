import { Resource, Route } from "@sunfall/arc-core";
import { RecipeIndex } from "../content.js";
import { sitePitch } from "../page-meta.js";

export const route = Route.define("/", {
  preload: () => Resource.preload(RecipeIndex("all")),
  // No title: the site's head leads the homepage with the pitch.
  head: () => ({ description: sitePitch }),
});
