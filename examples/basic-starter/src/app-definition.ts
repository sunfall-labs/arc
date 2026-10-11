import { defineApp } from "@sunfall/arc-core";
import { routes } from "./routeTree.gen.js";

export const app = defineApp({
  routes,
  client: { name: "BrowserLive" },
});
