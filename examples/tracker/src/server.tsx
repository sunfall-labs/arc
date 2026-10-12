import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations } from "./api.server.js";
import { TrackerDatabaseLive } from "./db.server.js";
import "./styles.css";

export const handleRequest = createRequestHandler(app, {
  server: TrackerDatabaseLive,
  implementations,
});

export default handleRequest;
