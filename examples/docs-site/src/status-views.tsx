import { RouterLink } from "@sunfall/arc-solid";
import { CookbookRoute, DocsOverviewRoute, HomeRoute } from "./site-routes.js";

export function LoadingView() {
  return (
    <section class="statusView" aria-busy="true">
      <p class="statusCode">Loading</p>
      <h1>Loading this page</h1>
      <p>The route's Resources are still resolving.</p>
    </section>
  );
}

export function FailureView(props: { readonly error: unknown }) {
  return (
    <section class="statusView failure" role="alert">
      <p class="statusCode">Error</p>
      <h1>Could not load this page</h1>
      <p>
        {props.error instanceof Error ? props.error.message : "A docs Resource failed to load."}
      </p>
      <div class="statusLinks">
        <RouterLink route={HomeRoute} class="button secondary">
          Back to home
        </RouterLink>
      </div>
    </section>
  );
}

export function NotFoundView() {
  return (
    <section class="statusView">
      <p class="statusCode">404</p>
      <h1>Page not found</h1>
      <p>This page does not exist, or it moved. These are good places to pick the trail back up.</p>
      <div class="statusLinks">
        <RouterLink route={HomeRoute} class="button primary">
          Home
        </RouterLink>
        <RouterLink route={DocsOverviewRoute} class="button secondary">
          Documentation
        </RouterLink>
        <RouterLink route={CookbookRoute} class="button secondary">
          Cookbook
        </RouterLink>
      </div>
    </section>
  );
}
