import { App } from "@sunfall/arc-start";
import { KeyValueStore } from "effect/persistence";
import Tracker from "./App.js";
import { trackerActions } from "./actions.js";
import { routes } from "./routeTree.gen.js";

// The one app definition: `server.tsx` and `main.tsx` both derive their
// wiring from it. Reads go through the server functions (RPC in the browser,
// in-process during SSR); every write is an Action the server serves. Durable
// moves persist in localStorage while they wait to sync.
export const app = App.define({
  root: Tracker,
  routes,
  actions: trackerActions,
  client: KeyValueStore.layerStorage(() => localStorage),
});
