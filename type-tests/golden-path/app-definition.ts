import { App } from "@sunfall/arc-core";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";
import { routes } from "./routes.js";

export const app = App.define({
  routes,
  client: { name: "BrowserLive" },
  server: ProjectApiMemory,
  registry: { actions: servedActions, serverFunctions: [] },
});
