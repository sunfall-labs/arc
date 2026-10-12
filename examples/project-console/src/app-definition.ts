import { App } from "@sunfall/arc-start";
import { Layer } from "effect";
import { KeyValueStore } from "effect/persistence";
import ProjectConsole from "./App.js";
import { ProjectApiLive } from "./domain.js";
import { projectConsoleActions } from "./project-actions.js";
import { routes } from "./routeTree.gen.js";

// The one app definition: `server.tsx` and `main.tsx` both derive their wiring
// from it. In the browser, `ProjectApiLive` calls server functions over RPC
// and the served Actions go over the action transport. Durable Action
// submissions persist to the client Layer's KeyValueStore (localStorage; the
// Layer is built only in the browser).
export const app = App.define({
  root: ProjectConsole,
  routes,
  actions: projectConsoleActions,
  client: Layer.mergeAll(
    ProjectApiLive,
    KeyValueStore.layerStorage(() => localStorage),
  ),
});
