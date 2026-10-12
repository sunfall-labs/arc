import { App } from "@sunfall/arc-start";
import DocsSite from "./App.js";
import { docsSiteHead } from "./page-meta.js";
import { routes } from "./routeTree.gen.js";

// The one app definition. In dev the browser loads the served recipe
// Resources over RPC; the static production build reads only prerendered
// data, and Start compiles the RPC client out of `App.launch`.
export const app = App.define({
  root: DocsSite,
  routes,
  head: docsSiteHead,
});
