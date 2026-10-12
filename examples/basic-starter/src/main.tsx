import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app-definition.js";

// Builds the browser runtime, restores the server's hydration payload, and
// hydrates the server-rendered root: the route-preloaded Resource reads
// synchronously (no loading flash).
Effect.runFork(App.launch(app));
