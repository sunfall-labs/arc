import { makeRuntime } from "@sunfall/arc-core";
import { hydrateFromDocument } from "@sunfall/arc-start";
import { Data, Layer } from "effect";
import { hydrate, render } from "@solidjs/web";
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
      (await import("@sunfall/arc-start")).makeRpcClientLayer(),
      (await import("./content-live.js")).DocsContentApiLive,
    )
  : DocsContentApiStaticClient;
const runtime = makeRuntime(runtimeLayer);
hydrateFromDocument(document, undefined, {
  runtime,
  ...(import.meta.env.DEV ? {} : { timestamp: "now" as const }),
});

const hydratedHref = currentDocsSiteHref();
const Root = () => <App runtime={runtime} hydratedHref={hydratedHref} />;

if (root.hasChildNodes()) {
  hydrate(Root, root);
} else {
  render(Root, root);
}
