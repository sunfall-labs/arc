import { App } from "@sunfall/arc-start";
import { App as Root } from "./app.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";
import { routes } from "./routes.js";

export const app = App.define({
  root: Root,
  routes,
  actions: servedActions,
  client: ProjectApiMemory, // stand-in: a real client Layer calls server functions
});
