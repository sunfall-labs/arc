// Presentational leaves shared by the route components and the root: plain
// Solid functions.
import { RouterLink } from "@sunfall/arc-solid";
import { route as ItemsRoute } from "./routes/index.js";

export function BackLink() {
  return (
    <RouterLink route={ItemsRoute} class="back" data-testid="back">
      Back to items
    </RouterLink>
  );
}

export function NotFoundView(props: { readonly id: string }) {
  return (
    <section class="not-found" data-testid="not-found">
      <h1>Item not found</h1>
      <p>No item with id {props.id}.</p>
      <BackLink />
    </section>
  );
}
