import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations } from "./content.server.js";
import "./styles.css";

// The head (title, description, Open Graph tags) is each route's `head`
// through `docsSiteHead`; the document adds the dev stylesheet and a header.
export const handleRequest = createRequestHandler(app, {
  implementations,
  document: () => ({
    links: [{ rel: "stylesheet", href: "/src/styles.css", "data-sunfall-arc-docs-dev-style": "" }],
    headers: { "x-sunfall-arc-docs": "cookbook" },
  }),
});

export default handleRequest;
