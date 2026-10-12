import { App } from "@sunfall/arc-start";
import Root from "./App.js";
import { ItemsApiClient, servedActions } from "./items.js";
import { routes } from "./routeTree.gen.js";

// The one app definition `server.tsx` and `main.tsx` both derive from. In the
// browser, ItemsApi calls server functions and the toggle goes over the
// action transport.
export const app = App.define({
  root: Root,
  routes,
  actions: servedActions,
  client: ItemsApiClient,
});
