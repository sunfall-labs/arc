import { Component } from "@sunfall/arc-solid";
import {
  createRequestHandler,
  createStartStreamedHtmlResponse,
  htmlChunk,
} from "@sunfall/arc-start";
import { createComponent, generateHydrationScript, renderToString } from "@solidjs/web";
import { Effect, Stream } from "effect";
import { App } from "./app.js";
import { app } from "./app-definition.js";
import { Projects } from "./collection.js";

export const handleRequest = createRequestHandler(app, {
  collections: [Projects],
  // Start has already run the matched route's preload on this request's runtime.
  render: ({ request, hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const body = renderToString(() =>
        createComponent(Component.embed(App, runtime), { initialHref: url.pathname + url.search }),
      );

      return yield* createStartStreamedHtmlResponse({
        shell: htmlChunk(
          `<!doctype html><html><head>${generateHydrationScript()}</head><body><div id="root">`,
        ),
        chunks: Stream.make(htmlChunk(`${body}</div>`)),
        hydrationPlan,
        tail: htmlChunk(
          `${hydrationPlan.root.script}<script type="module" src="/src/main.tsx"></script></body></html>`,
        ),
      });
    }),
});
