import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { itemStore } from "../../shared/data";

// Server functions: the handlers run on the server; the browser bundle gets
// RPC stubs.
export const fetchItems = createServerFn({ method: "GET" }).handler(async () => [
  ...itemStore.list(),
]);

export const fetchItem = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => itemStore.get(data) ?? null);

export const toggleItem = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const item = itemStore.toggle(data);
    if (item === undefined) {
      throw new Error(`No item ${data}`);
    }
    return item;
  });

export const itemsQuery = queryOptions({
  queryKey: ["items"],
  queryFn: () => fetchItems(),
});

export const itemQuery = (id: string) =>
  queryOptions({
    queryKey: ["items", id],
    queryFn: () => fetchItem({ data: id }),
  });
