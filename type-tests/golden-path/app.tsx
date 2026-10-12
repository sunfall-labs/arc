import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import { ProjectNotFound } from "./projects.js";
import { ProjectRoute, ProjectsRoute } from "./routes.js";

// A route view adapts route params to a feature Component.
const ProjectRouteView = Component.define(
  "ProjectRouteView",
  function* (props: Route.Props<typeof ProjectRoute>) {
    const Page = yield* ProjectPage;
    return () => <Page id={props.params.id} />;
  },
);

const routes = [
  Route.withComponent(ProjectsRoute, () => <p>Pick a project.</p>),
  Route.withComponent(ProjectRoute, ProjectRouteView),
] as const;

export const App = Component.define("App", function* (props: { readonly initialHref?: string }) {
  const router = yield* Component.router(
    routes,
    props.initialHref === undefined ? {} : { initialHref: props.initialHref },
  );
  const Sidebar = yield* ProjectSidebar;

  return () => (
    <RouterProvider router={router}>
      <Sidebar />
      <main>
        <RouterOutlet<typeof routes>
          failure={(state) =>
            state.error?._tag === "RoutePreloadError" &&
            state.error.cause instanceof ProjectNotFound ? (
              <p>No project "{state.error.cause.id}".</p>
            ) : (
              <p>Something went wrong.</p>
            )
          }
        />
      </main>
    </RouterProvider>
  );
});
