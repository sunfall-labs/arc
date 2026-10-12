import { Title } from "@solidjs/meta";
import { A, createAsync, useParams, type RouteDefinition } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { Show } from "solid-js";
import { formatPrice, statusLabel } from "../../../../shared/model";
import { getItem } from "~/lib/items";

export const route = {
  preload: ({ params }) => getItem(params.id!),
} satisfies RouteDefinition;

export default function ItemDetail() {
  const params = useParams();
  // `deferStream` holds the response until the item resolves, so a missing
  // item can still set the 404 status before the headers are sent.
  const item = createAsync(() => getItem(params.id!), { deferStream: true });

  return (
    <Show
      when={item()}
      fallback={
        <section class="not-found" data-testid="not-found">
          <HttpStatusCode code={404} />
          <h1>Item not found</h1>
          <p>No item with id {params.id}.</p>
          <A class="back" href="/" data-testid="back">
            Back to items
          </A>
        </section>
      }
    >
      {(found) => (
        <article class="detail" data-testid="detail" data-id={found().id}>
          <Title>{found().name}</Title>
          <h1>{found().name}</h1>
          <dl>
            <dt>Category</dt>
            <dd>{found().category}</dd>
            <dt>Price</dt>
            <dd>{formatPrice(found().price)}</dd>
            <dt>Status</dt>
            <dd data-testid="status">{statusLabel(found().done)}</dd>
          </dl>
          <A class="back" href="/" data-testid="back">
            Back to items
          </A>
        </article>
      )}
    </Show>
  );
}
