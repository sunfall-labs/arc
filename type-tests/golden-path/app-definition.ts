import { App } from "@sunfall/arc-start";
import { App as Root } from "./app.js";
import { routes } from "./routes.js";

// Every read and write runs on the server, so the browser needs no Layer of its own.
export const app = App.define({ root: Root, routes });
