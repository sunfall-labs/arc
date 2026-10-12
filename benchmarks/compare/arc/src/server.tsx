import { Route } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ItemsApiServer, serverFunctions } from "./items.server.js";
import { routeById } from "./routeTree.gen.js";

/** Built browser assets for a production document (from Vite's build manifest). */
export interface ClientAssets {
  readonly entry: string;
  readonly css: ReadonlyArray<string>;
  readonly modulepreload: ReadonlyArray<string>;
}

/**
 * The Start handler. Without `assets` (Vite dev) the document references the
 * source entry; `server.mjs` passes the built entry, its CSS, and its static
 * imports for production.
 */
export const createHandler = (assets?: ClientAssets) =>
  createRequestHandler(app, {
    server: ItemsApiServer,
    serverFunctions,
    document: ({ match }) => ({
      title: Route.isMatch(routeById.route_items_$id, match) ? `Item ${match.params.id}` : "Items",
      ...(assets === undefined
        ? {}
        : {
            clientEntry: assets.entry,
            links: [
              ...assets.css.map((href) => ({ rel: "stylesheet", href })),
              ...assets.modulepreload.map((href) => ({ rel: "modulepreload", href })),
            ],
          }),
    }),
  });

export default createHandler();
