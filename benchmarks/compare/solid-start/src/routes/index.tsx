import { A, createAsync, useAction, useSubmissions, type RouteDefinition } from "@solidjs/router";
import { createMemo, createSignal, For } from "solid-js";
import { countLabel, formatPrice, matchesQuery, statusLabel } from "../../../shared/model";
import { getItems, toggleItem } from "~/lib/items";

export const route = {
  preload: () => getItems(),
} satisfies RouteDefinition;

export default function ItemList() {
  const items = createAsync(() => getItems());
  const [query, setQuery] = createSignal("");
  const toggle = useAction(toggleItem);

  // Optimistic UI: in-flight toggle submissions flip their row until the
  // action settles and the revalidated list replaces them.
  const submissions = useSubmissions(toggleItem);
  const pendingFlips = createMemo(() => {
    const flips = new Set<string>();
    for (const submission of submissions) {
      if (!submission.pending) continue;
      const id = submission.input[0];
      if (flips.has(id)) flips.delete(id);
      else flips.add(id);
    }
    return flips;
  });

  const visible = createMemo(() => (items() ?? []).filter((item) => matchesQuery(item, query())));

  return (
    <section class="list-page">
      <div class="toolbar">
        <h1>Items</h1>
        <input
          class="filter"
          type="search"
          placeholder="Filter by name"
          aria-label="Filter by name"
          data-testid="filter"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <p class="count" data-testid="count">
          {countLabel(visible().length, items()?.length ?? 0)}
        </p>
      </div>
      <ul class="items" data-testid="items">
        <For each={visible()}>
          {(item) => {
            const done = () => item.done !== pendingFlips().has(item.id);
            return (
              <li class="item" data-id={item.id} data-done={done() ? "true" : "false"}>
                <A class="item-name" href={`/items/${item.id}`}>
                  {item.name}
                </A>
                <span class="item-category">{item.category}</span>
                <span class="item-price">{formatPrice(item.price)}</span>
                <button
                  type="button"
                  class="toggle"
                  data-testid={`toggle-${item.id}`}
                  aria-pressed={done() ? "true" : "false"}
                  onClick={() => toggle(item.id)}
                >
                  {statusLabel(done())}
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}
