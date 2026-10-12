import { App } from "@sunfall/arc-start";
import Root from "./App.js";
import { routes } from "./routeTree.gen.js";

// The one app definition: the server handler and the browser entry both
// derive their wiring from it.
export const app = App.define({
  root: Root,
  routes,
  // Every page's head: a route's `head` title, or the app's name.
  head: (page) => ({ ...page, title: page.title ?? "Sunfall Arc Starter" }),
});
