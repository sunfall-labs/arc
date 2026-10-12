import { App } from "@sunfall/arc-start";
import Root from "./App.js";
import { routes } from "./routeTree.gen.js";

// The one app definition `server.tsx` and `main.tsx` both derive from. In the
// browser, the served Resources load over RPC and the toggle goes over the
// action transport.
export const app = App.define({
  root: Root,
  routes,
  head: (page) => ({ title: page.title ?? "Items" }),
});
