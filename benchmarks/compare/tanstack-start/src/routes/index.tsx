import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  countLabel,
  formatPrice,
  matchesQuery,
  statusLabel,
  type Item,
} from "../../../shared/model";
import { itemsQuery, toggleItem } from "../items";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.query({ ...itemsQuery, staleTime: "static" }),
  component: ListPage,
});

function ListPage() {
  const { data: items } = useSuspenseQuery(itemsQuery);
  const [query, setQuery] = useState("");
  const toggle = useToggleItem();
  const visible = items.filter((item) => matchesQuery(item, query));

  return (
    <section className="list-page">
      <div className="toolbar">
        <h1>Items</h1>
        <input
          className="filter"
          type="search"
          placeholder="Filter by name"
          aria-label="Filter by name"
          data-testid="filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="count" data-testid="count">
          {countLabel(visible.length, items.length)}
        </p>
      </div>
      <ul className="items" data-testid="items">
        {visible.map((item) => (
          <li
            key={item.id}
            className="item"
            data-id={item.id}
            data-done={item.done ? "true" : "false"}
          >
            <Link className="item-name" to="/items/$id" params={{ id: item.id }}>
              {item.name}
            </Link>
            <span className="item-category">{item.category}</span>
            <span className="item-price">{formatPrice(item.price)}</span>
            <button
              type="button"
              className="toggle"
              data-testid={`toggle-${item.id}`}
              aria-pressed={item.done ? "true" : "false"}
              onClick={() => toggle.mutate(item.id)}
            >
              {statusLabel(item.done)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Optimistic updates via the cache, as in the TanStack Query guide: patch the
// list at once, roll back on error, refetch after the server answers.
function useToggleItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => toggleItem({ data: id }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: itemsQuery.queryKey });
      const previous = queryClient.getQueryData<Item[]>(itemsQuery.queryKey);
      queryClient.setQueryData<Item[]>(itemsQuery.queryKey, (items) =>
        items?.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(itemsQuery.queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey }),
  });
}
