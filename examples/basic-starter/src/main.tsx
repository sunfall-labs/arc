import { makeRuntime } from "@sunfall/arc-core";
import { RuntimeProvider } from "@sunfall/arc-solid";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { hydrate, render } from "@solidjs/web";
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

const Root = () => (
  <RuntimeProvider runtime={runtime}>
    <App />
  </RuntimeProvider>
);

if (root.hasChildNodes()) {
  hydrate(Root, root);
} else {
  render(Root, root);
}
