import { defineApp } from "@sunfall/arc-core";
import { RuntimeProvider } from "@sunfall/arc-solid";
import {
  createStartStreamedHtmlResponseEffect,
  createRequestHandler,
  htmlChunk,
} from "@sunfall/arc-start";
import { Effect, Stream } from "effect";
import { createComponent, generateHydrationScript, renderToString } from "solid-js/web";
import App from "./App.js";
import { docsSiteAppBaseOptions } from "./app-definition.js";
import { DocsContentApiLive } from "./content.js";
import { docsSiteServerRegistry } from "./start-options.js";
import "./styles.css";

export const serverApp = defineApp({
  ...docsSiteAppBaseOptions,
  server: DocsContentApiLive,
  registry: docsSiteServerRegistry,
});

const shellOpen = (solidHydrationScript: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sunfall Arc Cookbook</title>
    <link rel="stylesheet" href="/src/styles.css" data-sunfall-arc-docs-dev-style />
    ${solidHydrationScript}
  </head>
  <body>
    <div id="root">`;

const shellClose = (hydrationScript: string): string => `</div>
    ${hydrationScript}
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export const handleRequest = createRequestHandler(serverApp, {
  render: ({ request, hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const href = `${url.pathname}${url.search}`;
      const body = renderToString(() =>
        createComponent(RuntimeProvider, {
          runtime,
          get children() {
            return createComponent(App, { initialHref: href, runtime });
          },
        }),
      );

      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk(shellOpen(generateHydrationScript())),
        chunks: Stream.make(htmlChunk(body)),
        hydrationPlan,
        tail: htmlChunk(shellClose(hydrationPlan.root.script)),
        headers: {
          "x-sunfall-arc-docs": "cookbook",
        },
      });
    }),
});

export default handleRequest;
