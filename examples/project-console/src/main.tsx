import { RuntimeProvider, createEffectRuntime } from "@effect-ui/solid";
import { BrowserRpcLive, hydrateFromDocument } from "@effect-ui/start";
import { Data, Layer } from "effect";
import { hydrate, render } from "solid-js/web";
import App from "./App.js";
import { ProjectApiLive } from "./domain.js";
import { ProjectSummaries } from "./project-collections.js";
import "./styles.css";

class ProjectConsoleRootMissing extends Data.TaggedError("ProjectConsoleRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("root");

if (!root) {
  throw new ProjectConsoleRootMissing({
    id: "root",
    guidance: "Add a root element with id=\"root\" to the document shell."
  });
}

const runtime = createEffectRuntime(Layer.mergeAll(BrowserRpcLive, ProjectApiLive));
hydrateFromDocument(document, undefined, {
  runtime,
  collections: [ProjectSummaries]
});

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
