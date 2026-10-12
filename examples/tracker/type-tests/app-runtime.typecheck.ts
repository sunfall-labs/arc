import { createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "../src/app-definition.js";
import { serverFunctions } from "../src/api.server.js";
import { TrackerDatabase } from "../src/db.server.js";

// The server functions read the database: the server Layer must provide it.
createRequestHandler(app, { server: TrackerDatabase(":memory:"), serverFunctions });

// @ts-expect-error Without the database the server functions cannot run.
createRequestHandler(app, { server: Layer.empty, serverFunctions });
