// Pins the claims README.md makes about its quick start.
import { App } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "./app.js";

// The app's root is fully handled and needs only the Todos service.
App.define({ root: app.root, routes: app.routes, client: app.client });
// @ts-expect-error a client Layer without Todos cannot define the app
App.define({ root: app.root, routes: app.routes, client: Layer.empty });
