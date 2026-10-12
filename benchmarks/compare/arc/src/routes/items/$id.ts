import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { ItemById } from "../../items.js";

export const route = Route.define("/items/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preloadResources: [ItemById],
  // A missing item is the preload's verdict, not a failure: Start answers 404
  // and the router (server and hydrating client) settles `NotFound`.
  preload: ({ params }) =>
    Resource.preload(ItemById(params.id)).pipe(
      Effect.catchTag("ItemNotFound", () => Route.notFound()),
    ),
});
