import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { hydrateFromDocument, makeActionTransportLayer } from "@sunfall/arc-start";
import { Effect, Layer } from "effect";
import { App } from "./app.js";
import { Projects } from "./collection.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";

const root = document.getElementById("root")!;
const collections = [Projects];

const runtime = makeRuntime(
  Layer.mergeAll(
    ProjectApiMemory, // stand-in: a real client Layer calls server functions
    makeActionTransportLayer({ actions: servedActions, collections }),
  ),
);

// Restore the server's Resource and Collection snapshot, then hydrate the
// server markup with the same tree: preloaded reads render synchronously.
Effect.runFork(
  runtime
    .provide(hydrateFromDocument(document, undefined, { collections }))
    .pipe(Effect.andThen(Component.launch(App, root, { runtime, hydrate: true }))),
);
