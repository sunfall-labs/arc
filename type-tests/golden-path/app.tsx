import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import { ProjectRoute, ProjectsRoute } from "./routes.js";

const routes = [
  Route.withComponent(ProjectsRoute, () => <p>Pick a project.</p>),
  // The third argument maps the route's params to the page's props.
  Route.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id })),
] as const;

// Start passes the root the href it renders: the request's on the server, the
// page's in the browser.
export const App = Component.define("App", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  const Sidebar = yield* ProjectSidebar;

  return () => (
    <RouterProvider router={router}>
      <Sidebar />
      <main>
        <RouterOutlet
          router={router}
          failure={({ error }) =>
            error?._tag === "RoutePreloadError" && error.cause._tag === "ProjectNotFound" ? (
              <p>No project "{error.cause.id}".</p>
            ) : (
              <p>Something went wrong.</p>
            )
          }
        />
      </main>
    </RouterProvider>
  );
});
