import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { App, createRequestHandler } from "@sunfall/arc-start";
import { Effect, Layer } from "effect";
import { KeyValueStore } from "effect/persistence";
import { Tasks } from "./indexes.js";
import { ProjectApiLive, Projects } from "./model.js";

// #region route-preload
const ProjectRoute = Route.define("/projects/:id", {
  preload: () => Projects.preload(),
});
// #endregion

const routes = [ProjectRoute] as const;

const Root = Component.define("Root", function* (props: { readonly href: string }) {
  const router = yield* Component.router(
    [Route.withComponent(ProjectRoute, () => <p>Project</p>)] as const,
    { initialHref: props.href },
  );
  return () => (
    <RouterProvider router={router}>
      <RouterOutlet router={router} />
    </RouterProvider>
  );
});
const AppServerLive = Layer.mergeAll(ProjectApiLive, KeyValueStore.layerMemory);
const AppClientLive = Layer.mergeAll(
  ProjectApiLive,
  KeyValueStore.layerStorage(() => localStorage),
);

// #region client-layer
export const app = App.define({
  root: Root,
  routes,
  collections: [Projects],
  client: Layer.mergeAll(
    ProjectApiLive,
    KeyValueStore.layerStorage(() => localStorage),
  ),
});
// #endregion

{
  // #region declared-collections
  // Declared once: the server dehydrates them, the browser hydrates them.
  const app = App.define({
    root: Root,
    routes,
    collections: [Projects, Tasks],
    client: AppClientLive,
  });

  // src/server.tsx
  const handleRequest = createRequestHandler(app, { server: AppServerLive });

  // src/main.tsx
  Effect.runFork(App.launch(app));
  // #endregion
  void handleRequest;
}
