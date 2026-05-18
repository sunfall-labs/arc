import { createEffectRuntime } from "@sunfall/arc-solid";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { render } from "solid-js/web";
import App from "./App.js";
import { DocsContentApiLive } from "./content.js";
import { currentDocsSiteHref } from "./site-base.js";

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

const runtimeLayer = import.meta.env.DEV
  ? Layer.mergeAll((await import("@sunfall/arc-start")).BrowserRpcLive, DocsContentApiLive)
  : DocsContentApiLive;
const runtime = createEffectRuntime(runtimeLayer);
hydrateFromDocument(document, undefined, { runtime });

const hydratedHref = currentDocsSiteHref();
const Root = () => <App runtime={runtime} hydratedHref={hydratedHref} />;

root.textContent = "";
render(Root, root);
