import { createEffectRuntime } from "@sunfall/arc-solid";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { hydrate, render } from "solid-js/web";
import App from "./App.js";
import { DocsContentApiStaticClient } from "./content.js";
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
  ? Layer.mergeAll(
      (await import("@sunfall/arc-start")).BrowserRpcLive,
      (await import("./content-live.js")).DocsContentApiLive,
    )
  : DocsContentApiStaticClient;
const runtime = createEffectRuntime(runtimeLayer);
hydrateFromDocument(document, undefined, {
  runtime,
  ...(import.meta.env.DEV ? {} : { updatedAt: "now" as const }),
});

const hydratedHref = currentDocsSiteHref();
const Root = () => <App runtime={runtime} hydratedHref={hydratedHref} />;

if (root.hasChildNodes()) {
  hydrate(Root, root);
} else {
  render(Root, root);
}
