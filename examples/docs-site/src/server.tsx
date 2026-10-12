import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { DocsContentApiLive } from "./content-live.js";
import { docsSiteServerFunctions } from "./content.server.js";
import "./styles.css";

export const handleRequest = createRequestHandler(app, {
  server: DocsContentApiLive,
  serverFunctions: docsSiteServerFunctions,
  document: () => ({
    title: "Sunfall Arc Cookbook",
    links: [{ rel: "stylesheet", href: "/src/styles.css", "data-sunfall-arc-docs-dev-style": "" }],
    headers: { "x-sunfall-arc-docs": "cookbook" },
  }),
});

export default handleRequest;
