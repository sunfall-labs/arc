import { makeRuntime } from "@sunfall/arc-core";
import { hydrateFromDocument, makeRpcClientLayer } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { hydrate, render } from "@solidjs/web";
import App from "./App.js";
import { ProjectApiLive } from "./domain.js";
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

const runtime = makeRuntime(Layer.mergeAll(makeRpcClientLayer(), ProjectApiLive));
hydrateFromDocument(document, undefined, {
  runtime,
  collections: [ProjectSummaries, ProjectWorkItems],
});

const Root = () => <App runtime={runtime} />;

if (root.hasChildNodes()) {
  hydrate(Root, root);
} else {
  render(Root, root);
}
