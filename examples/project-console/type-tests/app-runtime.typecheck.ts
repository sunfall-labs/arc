import { createRequestHandler } from "@sunfall/arc-start";
import { Layer } from "effect";
import { app } from "../src/app-definition.js";
import { implementations, ProjectDemoStoreLive } from "../src/domain.server.js";

// The implementations read the demo store: the server Layer must provide it.
createRequestHandler(app, { server: ProjectDemoStoreLive, implementations });

// @ts-expect-error Without the demo store the implementations cannot run.
createRequestHandler(app, { server: Layer.empty, implementations });
