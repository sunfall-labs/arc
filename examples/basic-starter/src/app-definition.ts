import { App } from "@sunfall/arc-core";
import { routes } from "./routeTree.gen.js";

export const app = App.define({
  routes,
  client: { name: "BrowserLive" },
});
