import { Resource, Route } from "@sunfall/arc-core";
import { ItemList, ItemsRef } from "../items.js";

export const route = Route.define("/", {
  preloadResources: [ItemList],
  preload: () => Resource.preload(ItemsRef),
});
