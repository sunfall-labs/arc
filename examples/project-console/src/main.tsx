import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app-definition.js";
import "./styles.css";

Effect.runFork(App.launch(app));
