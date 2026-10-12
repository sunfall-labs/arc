import { Route } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "./app-definition.js";
import { ProjectApiLive } from "./domain.js";
import { ProjectDemoStoreLive, serverFunctions } from "./domain.server.js";
import { routeById } from "./routeTree.gen.js";
import { projectConsoleStartGraphHeader, projectConsoleStartGraphSummary } from "./start-graph.js";
import "./styles.css";

export const ProjectConsoleServerLive = Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive);

export const handleRequest = createRequestHandler(app, {
  server: ProjectConsoleServerLive,
  serverFunctions,
  document: ({ match }) => ({
    title: Route.isMatch(routeById.route_projects_$id, match)
      ? `${match.params.id} · Sunfall Arc Project Console`
      : "Sunfall Arc Project Console",
    meta: [{ name: "sunfall-arc-start-graph", content: projectConsoleStartGraphHeader }],
    headers: {
      "x-sunfall-arc-render": "streaming",
      "x-sunfall-arc-start-graph": projectConsoleStartGraphHeader,
      "x-sunfall-arc-start-routes": projectConsoleStartGraphSummary.routes.join(","),
    },
  }),
});

export default handleRequest;
