import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app.js";

// The browser: restores the server's data and hydrates its markup.
Effect.runFork(App.launch(app));
