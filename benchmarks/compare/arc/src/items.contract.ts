import { Server } from "@sunfall/arc-core";
import { Schema } from "effect";

// The browser-safe half of the item API: schemas, the typed failure, and the
// server-function contracts and clients.

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

export const ListItemsContract = Server.contract("Items.list", {
  input: Schema.Literal("all"),
  output: Schema.Array(ItemSchema),
});

export const GetItemContract = Server.contract("Items.get", {
  input: Schema.String,
  output: ItemSchema,
  error: ItemNotFound,
});

export const ToggleItemContract = Server.contract("Items.toggle", {
  input: Schema.String,
  output: ItemSchema,
  error: ItemNotFound,
});

export const listItems = Server.client(ListItemsContract);
export const getItem = Server.client(GetItemContract);
export const toggleItem = Server.client(ToggleItemContract);
