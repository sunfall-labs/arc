import { App } from "@sunfall/arc-start";
import DocsSite from "./App.js";
import { DocsContentApiStaticClient } from "./content.js";
import { DocsContentApiLive } from "./content-live.js";
import { routes } from "./routeTree.gen.js";

// The one app definition. In dev the browser loads recipes through server
// functions over RPC; the static production build reads only prerendered
// data, and Start compiles the RPC client out of `App.launch`.
export const app = App.define({
  root: DocsSite,
  routes,
  client: import.meta.env.DEV ? DocsContentApiLive : DocsContentApiStaticClient,
});
