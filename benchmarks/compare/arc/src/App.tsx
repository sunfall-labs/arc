import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import "../../shared/styles.css";
import { routes } from "./routeTree.gen.js";
import { route as ItemRoute } from "./routes/items/$id.js";
import { NotFoundView } from "./views.js";

/** The app root: Start renders it on the server and `App.launch` hydrates it. */
const Root = Component.define("Root", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  return () => (
    <RouterProvider router={router}>
      <div class="shell">
        <header class="topbar">
          <a class="brand" href="/">
            Inventory
          </a>
        </header>
        <main class="page">
          <RouterOutlet
            router={router}
            failure={() => <p role="alert">Something went wrong.</p>}
            notFound={({ href }) => (
              <NotFoundView id={Route.match([ItemRoute], href)?.params.id ?? ""} />
            )}
          />
        </main>
      </div>
    </RouterProvider>
  );
});

export default Root;
