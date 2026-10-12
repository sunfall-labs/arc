import { Resource, Route } from "@sunfall/arc-core";
import { Schema } from "effect";
import { ItemById, ItemNotFound } from "../../items.js";

export const route = Route.define("/items/:id", {
  params: Schema.Struct({ id: Schema.String }),
  // A missing item is the route's typed preload failure: Start encodes it with
  // this schema, and the hydrating client renders the same not-found view.
  error: ItemNotFound,
  preloadResources: [ItemById],
  preload: ({ params }) => Resource.preload(ItemById(params.id)),
});
