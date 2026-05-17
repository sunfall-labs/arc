import { defineApp } from "@effect-ui/core";
import { routeTree } from "./routeTree.gen.js";

export const app = defineApp({
  routes: routeTree,
  client: { name: "ReactBrowserLive" },
});
