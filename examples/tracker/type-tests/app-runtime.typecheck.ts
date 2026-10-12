import { createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "../src/app-definition.js";
import { implementations } from "../src/api.server.js";
import { TrackerDatabase } from "../src/db.server.js";

// The implementations read the database: the server Layer must provide it.
createRequestHandler(app, { server: TrackerDatabase(":memory:"), implementations });

// @ts-expect-error Without the database the implementations cannot run.
createRequestHandler(app, { server: Layer.empty, implementations });
