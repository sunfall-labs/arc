import { Server } from "@sunfall/arc-core";
import { Effect, Layer } from "effect";
import { itemStore } from "../../shared/data";
import {
  GetItemContract,
  ItemNotFound,
  ListItemsContract,
  ToggleItemContract,
} from "./items.contract.js";
import { ItemsApi } from "./items.js";

const found = <A>(id: string, item: A | undefined): Effect.Effect<A, ItemNotFound> =>
  item === undefined ? Effect.fail(new ItemNotFound({ id })) : Effect.succeed(item);

const list = () => Effect.sync(() => itemStore.list());
const get = (id: string) => Effect.suspend(() => found(id, itemStore.get(id)));
const toggle = (id: string) => Effect.suspend(() => found(id, itemStore.toggle(id)));

/** The server's ItemsApi: the in-memory store, no transport. */
export const ItemsApiServer = Layer.succeed(ItemsApi, { list, get, toggle });

/** Server functions the browser's ItemsApi calls over RPC. */
export const serverFunctions = [
  Server.implement(ListItemsContract, list),
  Server.implement(GetItemContract, get),
  Server.implement(ToggleItemContract, toggle),
] as const;
