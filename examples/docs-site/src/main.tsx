import { createEffectRuntime } from "@sunfall/arc-solid";
import { BrowserRpcLive, hydrateFromDocument } from "@sunfall/arc-start";
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

const runtime = createEffectRuntime(
  import.meta.env.DEV ? Layer.mergeAll(BrowserRpcLive, DocsContentApiLive) : DocsContentApiLive,
);
hydrateFromDocument(document, undefined, { runtime });

const hydratedHref = currentDocsSiteHref();
const Root = () => <App runtime={runtime} hydratedHref={hydratedHref} />;

root.textContent = "";
render(Root, root);
