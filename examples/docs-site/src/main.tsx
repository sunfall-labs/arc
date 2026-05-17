import { RuntimeProvider, createEffectRuntime } from "@effect-ui/solid";
import { BrowserRpcLive, hydrateFromDocument } from "@effect-ui/start";
import { Data, Layer } from "effect";
import { hydrate, render } from "solid-js/web";
import App from "./App.js";
import { DocsContentApiLive } from "./content.js";

class DocsSiteRootMissing extends Data.TaggedError("DocsSiteRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("root");

if (!root) {
  throw new DocsSiteRootMissing({
    id: "root",
    guidance: 'Add a root element with id="root" to the document shell.',
  });
}

const runtime = createEffectRuntime(Layer.mergeAll(BrowserRpcLive, DocsContentApiLive));
hydrateFromDocument(document, undefined, { runtime });

const Root = () => (
  <RuntimeProvider runtime={runtime}>
    <App runtime={runtime} />
  </RuntimeProvider>
);

if (root.hasChildNodes()) {
  hydrate(Root, root);
} else {
  render(Root, root);
}
