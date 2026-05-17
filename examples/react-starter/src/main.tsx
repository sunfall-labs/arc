import { RuntimeProvider, createEffectRuntime } from "@sunfall/arc-react";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App.js";

class ReactStarterRootMissing extends Data.TaggedError("ReactStarterRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("root");

if (!root) {
  throw new ReactStarterRootMissing({
    id: "root",
    guidance: 'Add a root element with id="root" to the document shell.',
  });
}

const runtime = createEffectRuntime(Layer.empty);
hydrateFromDocument(document, undefined, { runtime });

const Root = () => (
  <RuntimeProvider runtime={runtime}>
    <App hydrating={root.hasChildNodes()} />
  </RuntimeProvider>
);

if (root.hasChildNodes()) {
  hydrateRoot(root, <Root />);
} else {
  createRoot(root).render(<Root />);
}
