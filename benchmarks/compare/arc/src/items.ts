import { Action, Resource } from "@sunfall/arc-core";
import { Schema } from "effect";

// The browser-safe half of the item API: schemas, the typed failure, and the
// served Resources and Action. Their loads and run are the server's
// implementations (`items.server.ts`): in-process during SSR, over RPC and the
// action transport in the browser.

export const ItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  price: Schema.Number,
  done: Schema.Boolean,
});

export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", {
  id: Schema.String,
}) {}

export const ItemsTag = Resource.tag("Items");
export const ItemTag = Resource.tag<{ readonly id: string }>("Item", { key: ({ id }) => id });

export const ItemList = Resource.define({
  name: "Items.list",
  input: Schema.Literal("all"),
  output: Schema.Array(ItemSchema),
  // Keyed rows: the toggle patches one row by id.
  rows: { key: (item) => item.id },
  provides: () => [ItemsTag],
});
export const ItemsRef = ItemList("all");

export const ItemById = Resource.define({
  name: "Items.byId",
  input: Schema.String,
  output: ItemSchema,
  // Only a missing item is the typed failure; a transport failure is a defect.
  error: ItemNotFound,
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
  invalidates: (item) => [ItemsTag, ItemTag({ id: item.id })],
});
