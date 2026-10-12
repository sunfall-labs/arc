import { action, query } from "@solidjs/router";
import { itemStore } from "../../../shared/data";
import type { Item } from "../../../shared/model";

// Reads: router queries backed by server functions. The list and detail
// queries are cached per key and revalidated after every action by default.
export const getItems = query(async (): Promise<ReadonlyArray<Item>> => {
  "use server";
  return itemStore.list();
}, "items");

export const getItem = query(async (id: string): Promise<Item | undefined> => {
  "use server";
  return itemStore.get(id);
}, "item");

// Write: a router action backed by a server function. With no `revalidate`
// option, the router revalidates every active query when it settles.
export const toggleItem = action(async (id: string): Promise<Item | undefined> => {
  "use server";
  return itemStore.toggle(id);
}, "toggleItem");
