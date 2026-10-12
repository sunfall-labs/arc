import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app-definition.js";
import { currentDocsSiteHref } from "./site-base.js";

Effect.runFork(
  App.launch(app, {
    // The site may be served under a base path; the app renders base-free hrefs.
    href: currentDocsSiteHref(),
    // Prerendered snapshots are as fresh as the page that carries them.
    hydration: import.meta.env.DEV ? {} : { timestamp: "now" },
  }),
);
