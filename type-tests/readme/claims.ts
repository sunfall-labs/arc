// Pins the claims README.md makes about its quick start.
import { App, createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "./app.js";
import { implementations } from "./server.js";

// The app's root is fully handled and needs no browser services: the read and
// the write run on the server.
App.define({ root: app.root, routes: app.routes });
// @ts-expect-error a server Layer without Todos cannot run the implementations
createRequestHandler(app, { server: Layer.empty, implementations });
