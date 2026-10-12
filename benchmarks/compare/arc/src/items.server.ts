import { Action, Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { itemStore } from "../../shared/data";
import { ItemById, ItemList, ItemNotFound, ToggleItem } from "./items.js";

const found = <A>(id: string, item: A | undefined): Effect.Effect<A, ItemNotFound> =>
  item === undefined ? Effect.fail(new ItemNotFound({ id })) : Effect.succeed(item);

/** The server's loads and run for the served Resources and Action: the in-memory store. */
export const implementations = [
  Resource.implement(ItemList, () => Effect.sync(() => itemStore.list())),
  Resource.implement(ItemById, (id) => Effect.suspend(() => found(id, itemStore.get(id)))),
  Action.implement(ToggleItem, (id) => Effect.suspend(() => found(id, itemStore.toggle(id)))),
] as const;
