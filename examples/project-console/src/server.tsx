import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations, ProjectDemoStoreLive } from "./domain.server.js";
import { projectConsoleStartGraphHeader, projectConsoleStartGraphSummary } from "./start-graph.js";
import "./styles.css";

export const handleRequest = createRequestHandler(app, {
  server: ProjectDemoStoreLive,
  implementations,
  document: () => ({
    headers: {
      "x-sunfall-arc-render": "streaming",
      "x-sunfall-arc-start-graph": projectConsoleStartGraphHeader,
      "x-sunfall-arc-start-routes": projectConsoleStartGraphSummary.routes.join(","),
    },
  }),
});

export default handleRequest;
