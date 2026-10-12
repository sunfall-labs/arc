import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app-definition.js";

Effect.runFork(App.launch(app));
