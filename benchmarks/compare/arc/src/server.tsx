import { Route } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ItemsApiServer, serverFunctions } from "./items.server.js";
import { routeById } from "./routeTree.gen.js";

/**
 * The Start handler. `vite dev` serves it; `vite build` also emits
 * `dist/server/index.js`, which serves it in production with the built
 * client's entry, stylesheets, and route chunk preloads.
 */
export default createRequestHandler(app, {
  server: ItemsApiServer,
  serverFunctions,
  document: ({ match }) => ({
    title: Route.isMatch(routeById.route_items_$id, match) ? `Item ${match.params.id}` : "Items",
  }),
});
