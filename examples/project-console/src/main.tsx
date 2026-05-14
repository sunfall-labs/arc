import { RuntimeProvider, createEffectRuntime } from "@effect-ui/solid";
import { BrowserRpcLive, hydrateFromDocument } from "@effect-ui/start";
import { Layer } from "effect";
import { hydrate, render } from "solid-js/web";
import App from "./App.js";
import { ProjectApiLive } from "./domain.js";
import { ProjectSummaries } from "./project-collections.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

const runtime = createEffectRuntime(Layer.mergeAll(BrowserRpcLive, ProjectApiLive));
hydrateFromDocument(document, undefined, {
  runtime,
  collections: [ProjectSummaries]
});

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
