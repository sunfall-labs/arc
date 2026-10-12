import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import "./starter.server.js";

// Preloads the matched route, renders `app.root` into Start's document, and
// streams the hydration payload `App.launch` restores in the browser.
export const handleRequest = createRequestHandler(app, {
  document: () => ({
    headers: { "x-sunfall-arc-starter": "basic" },
  }),
});

export default handleRequest;
