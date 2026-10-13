import { Machine, Message, Model, State, type Route } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { Effect, Schema } from "effect";
import { createMemo, For, Loading } from "solid-js";
import { countLabel, formatPrice, matchesQuery, statusLabel } from "../../../shared/model";
import { ItemList, ToggleItem } from "../items.js";
import type { route } from "./index.js";
import { route as ItemRoute } from "./items/$id.js";

// Client-only UI state: the filter text, changed only by its TypedFilter message.
const FilterModel = Model({ Filtering: { query: Schema.String } });
const FilterMessage = Message({ TypedFilter: { query: Schema.String } });
const ItemFilter = State.define({
  name: "Items.filter",
  machine: Machine.make({
    state: FilterModel,
    event: FilterMessage,
    initial: FilterModel.Filtering({ query: "" }),
  }).onAny(FilterMessage.TypedFilter, ({ event }) => FilterModel.Filtering({ query: event.query })),
});

/** The `/` route component: the server-rendered list, a filter, and a toggle per row. */
export default Component.define("ItemsPage", function* (_props: Route.Props<typeof route>) {
  const items = yield* Component.resource(ItemList);
  const filter = yield* Component.state(ItemFilter);
  const toggle = yield* Component.action(ToggleItem);
  const flip = yield* Component.callback("toggle", (id: string) =>
    toggle.submit(id).pipe(Effect.ignore),
  );

  return () => {
    const visible = createMemo(() =>
      items("all").filter((item) => matchesQuery(item, filter.model().query)),
    );
    return (
      <Loading fallback={<p>Loading items</p>}>
        <section class="list-page">
          <div class="toolbar">
            <h1>Items</h1>
            <input
              class="filter"
              type="search"
              placeholder="Filter by name"
              aria-label="Filter by name"
              data-testid="filter"
              value={filter.model().query}
              onInput={(event) => filter.send.TypedFilter({ query: event.currentTarget.value })}
            />
            <p class="count" data-testid="count">
              {countLabel(visible().length, items("all").length)}
            </p>
          </div>
          <ul class="items" data-testid="items">
            <For each={visible()} keyed={(item) => item.id}>
              {(item) => (
                <li class="item" data-id={item().id} data-done={item().done ? "true" : "false"}>
                  <RouterLink
                    route={ItemRoute}
                    options={{ params: { id: item().id } }}
                    class="item-name"
                  >
                    {item().name}
                  </RouterLink>
                  <span class="item-category">{item().category}</span>
                  <span class="item-price">{formatPrice(item().price)}</span>
                  <button
                    type="button"
                    class="toggle"
                    data-testid={`toggle-${item().id}`}
                    aria-pressed={item().done ? "true" : "false"}
                    onClick={() => flip(item().id)}
                  >
                    {statusLabel(item().done)}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Loading>
    );
  };
}).pipe(Component.catchAll(() => <p role="alert">Items failed to load.</p>));
