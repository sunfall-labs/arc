import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations } from "./items.server.js";

/**
 * The Start handler. `vite dev` serves it; `vite build` also emits
 * `dist/server/index.js`, which serves it in production with the built
 * client's entry, stylesheets, and route chunk preloads.
 */
export default createRequestHandler(app, {
  implementations,
});
