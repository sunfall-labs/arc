import { App } from "@sunfall/arc-start";
import ProjectConsole from "./App.js";
import { ProjectApiLive, projectConsoleActions } from "./domain.js";
import { ProjectSummaries, ProjectWorkItems } from "./project-collections.js";
import { routes } from "./routeTree.gen.js";

// The one app definition: `server.tsx` and `main.tsx` both derive their wiring
// from it. In the browser, `ProjectApiLive` calls server functions over RPC
// and the served Actions go over the action transport.
export const app = App.define({
  root: ProjectConsole,
  routes,
  collections: [ProjectSummaries, ProjectWorkItems],
  actions: projectConsoleActions,
  client: ProjectApiLive,
});
