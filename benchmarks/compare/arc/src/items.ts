import { Action, Resource, type Server } from "@sunfall/arc-core";
import { Context, Effect, Filter, Layer, Schema } from "effect";
import type { Item } from "../../shared/model";
import { getItem, ItemNotFound, ItemSchema, listItems, toggleItem } from "./items.contract.js";

// The service boundary Resources and the Action depend on. The browser's
// Layer calls server functions; the server's Layer reads the store directly.
export interface ItemsApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Item>, Server.ClientError>;
  readonly get: (id: string) => Effect.Effect<Item, ItemNotFound | Server.ClientError>;
  readonly toggle: (id: string) => Effect.Effect<Item, ItemNotFound | Server.ClientError>;
}
export const ItemsApi = Context.Service<ItemsApi>("compare/ItemsApi");

export const ItemsApiClient = Layer.succeed(ItemsApi, {
  list: () => listItems.effect("all"),
  get: (id) => getItem.effect(id),
  toggle: (id) => toggleItem.effect(id),
});

export const ItemsTag = Resource.tag("Items");
export const ItemTag = Resource.tag<{ readonly id: string }>("Item", { key: ({ id }) => id });

export const ItemList = Resource.define({
  name: "Items.list",
  input: Schema.Literal("all"),
  output: Schema.Array(ItemSchema),
  // Keyed rows: the toggle patches one row by id.
  rows: { key: (item) => item.id },
  load: () => ItemsApi.use((api) => api.list()),
  provides: () => [ItemsTag],
});
export const ItemsRef = ItemList("all");

export const ItemById = Resource.define({
  name: "Items.byId",
  input: Schema.String,
  output: ItemSchema,
  error: ItemNotFound,
  load: (id) =>
    ItemsApi.use((api) => api.get(id)).pipe(
      // Only a missing item is the typed failure; a transport failure is a defect.
      Effect.catchFilter(Filter.tagged("ItemNotFound"), Effect.fail, Effect.die),
    ),
  provides: (item) => [ItemTag({ id: item.id })],
});

/** Flips one item. The row flips at once; success reloads the list and the item. */
export const ToggleItem = Action.define({
  name: "Items.toggle",
  input: Schema.String,
  output: ItemSchema,
  error: ItemNotFound,
  optimistic: (id, transaction) =>
    transaction.update(ItemsRef, id, (item) => ({ ...item, done: !item.done })),
  run: (id) =>
    ItemsApi.use((api) => api.toggle(id)).pipe(
      Effect.catchFilter(Filter.tagged("ItemNotFound"), Effect.fail, Effect.die),
    ),
  invalidates: (item) => [ItemsTag, ItemTag({ id: item.id })],
});

/** Actions the server serves; the browser submits them over the action transport. */
export const servedActions = [ToggleItem] as const;
