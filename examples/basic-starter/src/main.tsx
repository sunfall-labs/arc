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
hydrateFromDocument(document, undefined, { runtime });

Effect.runFork(Component.launch(App, root, { runtime, hydrate: root.hasChildNodes() }));
