import { RuntimeProvider } from "@sunfall/arc-solid";
import {
  createStartStreamedHtmlResponseEffect,
  createRequestHandler,
  htmlChunk,
} from "@sunfall/arc-start";
import { Effect, Stream } from "effect";
import { createComponent, generateHydrationScript, renderToString } from "solid-js/web";
import App from "./App.js";
import { app } from "./app-definition.js";
import "./starter.server.js";
import "./styles.css";

const shellOpen = (solidHydrationScript: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sunfall Arc Starter</title>
    ${solidHydrationScript}
  </head>
  <body>
    <div id="root">`;

const shellClose = (hydrationScript: string): string => `    ${hydrationScript}
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export const handleRequest = createRequestHandler(app, {
  render: ({ hydrationRootScript, hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const body = renderToString(() =>
        createComponent(RuntimeProvider, {
          runtime,
          get children() {
            return createComponent(App, {});
          },
        }),
      );

      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk(shellOpen(generateHydrationScript())),
        chunks: Stream.make(htmlChunk(`${body}</div>\n`)),
        hydrationPlan,
        tail: htmlChunk(shellClose(hydrationRootScript)),
        headers: {
          "x-sunfall-arc-starter": "basic",
        },
      });
    }),
});

export default handleRequest;
