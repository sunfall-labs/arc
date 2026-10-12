import type { Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Loading } from "solid-js";
import { formatPrice, statusLabel } from "../../../../shared/model";
import { ItemById } from "../../items.js";
import { BackLink, NotFoundView } from "../../views.js";
import type { route } from "./$id.js";

/** The `/items/:id` route component. */
export default Component.define("ItemPage", function* (props: Route.Props<typeof route>) {
  const item = yield* Component.resource(ItemById);
  return () => (
    <Loading fallback={<p>Loading item</p>}>
      <article class="detail" data-testid="detail" data-id={item(props.params.id).id}>
        <h1>{item(props.params.id).name}</h1>
        <dl>
          <dt>Category</dt>
          <dd>{item(props.params.id).category}</dd>
          <dt>Price</dt>
          <dd>{formatPrice(item(props.params.id).price)}</dd>
          <dt>Status</dt>
          <dd data-testid="status">{statusLabel(item(props.params.id).done)}</dd>
        </dl>
        <BackLink />
      </article>
    </Loading>
  );
}).pipe(
  Component.catchTags({ ItemNotFound: (error) => <NotFoundView id={error.id} /> }),
  Component.catchAll(() => <p role="alert">Item failed to load.</p>),
);
