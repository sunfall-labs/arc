import { App } from "@sunfall/arc-start";
import { App as Root } from "./app.js";
import { Projects } from "./collection.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";
import { routes } from "./routes.js";

export const app = App.define({
  root: Root,
  routes,
  collections: [Projects],
  actions: servedActions,
  client: ProjectApiMemory, // stand-in: a real client Layer calls server functions
});
