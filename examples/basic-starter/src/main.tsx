import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Effect, Layer } from "effect";
import App from "./App.js";

class StarterRootMissing extends Data.TaggedError("StarterRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("root");

if (!root) {
  throw new StarterRootMissing({
    id: "root",
    guidance: 'Add a root element with id="root" to the document shell.',
  });
}

const runtime = makeRuntime(Layer.empty);

// Restore the server's hydration payload into the runtime, then hydrate the
// server-rendered markup with the same tree.
Effect.runFork(
  runtime
    .provide(hydrateFromDocument(document))
    .pipe(Effect.andThen(Component.launch(App, root, { runtime, hydrate: root.hasChildNodes() }))),
);
