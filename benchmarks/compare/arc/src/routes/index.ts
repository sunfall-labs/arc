import { Resource, Route } from "@sunfall/arc-core";
import { ItemsRef } from "../items.js";

export const route = Route.define("/", {
  preload: () => Resource.preload(ItemsRef),
});
