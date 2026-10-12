import { App } from "@sunfall/arc-start";
import { KeyValueStore } from "effect/persistence";
import ProjectConsole from "./App.js";
import { routes } from "./routeTree.gen.js";

// The one app definition: `server.tsx` and `main.tsx` both derive their wiring
// from it. In the browser, the served Resources load over RPC and the served
// Actions go over the action transport. Durable Action submissions persist to
// the client Layer's KeyValueStore (localStorage; the Layer is built only in
// the browser).
export const app = App.define({
  root: ProjectConsole,
  routes,
  client: KeyValueStore.layerStorage(() => localStorage),
});
