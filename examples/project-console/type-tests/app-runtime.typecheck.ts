import { App, createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import ProjectConsole from "../src/App.js";
import { app } from "../src/app-definition.js";
import { ProjectApiLive } from "../src/domain.js";
import { projectConsoleActions } from "../src/project-collections.js";
import { ProjectDemoStoreLive } from "../src/domain.server.js";
import { routes } from "../src/routeTree.gen.js";

// The console's routes, route Components, Resources, and Actions need
// ProjectApi: the client Layer and the server Layer must both provide it.
App.define({
  root: ProjectConsole,
  routes,
  actions: projectConsoleActions,
  client: ProjectApiLive,
});
createRequestHandler(app, { server: Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive) });

// @ts-expect-error The client Layer must provide ProjectApi.
App.define({ root: ProjectConsole, routes, client: Layer.empty });
// @ts-expect-error Without a client Layer nothing provides ProjectApi.
App.define({ root: ProjectConsole, routes });
// @ts-expect-error The server Layer must provide ProjectApi.
createRequestHandler(app, { server: ProjectDemoStoreLive });
