import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import {
  hydrateFromDocument,
  makeActionTransportLayer,
  makeRpcClientLayer,
} from "@sunfall/arc-start";
import { Data, Effect, Layer } from "effect";
import ProjectConsole from "./App.js";
import { ProjectApiLive, projectConsoleActions } from "./domain.js";
import { ProjectSummaries, ProjectWorkItems } from "./project-collections.js";
import "./styles.css";

class ProjectConsoleRootMissing extends Data.TaggedError("ProjectConsoleRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("root");

if (!root) {
  throw new ProjectConsoleRootMissing({
    id: "root",
    guidance: 'Add a root element with id="root" to the document shell.',
  });
}

const collections = [ProjectSummaries, ProjectWorkItems];
// Server functions go over RPC, and the Actions the server serves go over the
// action transport; the UI binds every Action the same way.
const runtime = makeRuntime(
  Layer.mergeAll(
    makeRpcClientLayer(),
    makeActionTransportLayer({ actions: projectConsoleActions, collections }),
    ProjectApiLive,
  ),
);

// Restore the server's hydration payload into the runtime, then hydrate the
// server-rendered markup with the same tree.
Effect.runFork(
  runtime
    .provide(hydrateFromDocument(document, undefined, { collections }))
    .pipe(
      Effect.andThen(
        Component.launch(ProjectConsole, root, { runtime, hydrate: root.hasChildNodes() }),
      ),
    ),
);
