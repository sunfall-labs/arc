import { RuntimeProvider } from "@effect-ui/react";
import {
  createStartStreamedHtmlResponseEffect,
  createRequestHandler,
  htmlChunk,
} from "@effect-ui/start";
import { Effect, Stream } from "effect";
import { renderToString } from "react-dom/server";
import App from "./App.js";
import { app } from "./app-definition.js";
import "./starter.server.js";
import "./styles.css";

const shellOpen = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Effect UI React Starter</title>
  </head>
  <body>
    <div id="root">`;

const shellClose = (hydrationScript: string): string => `</div>
    ${hydrationScript}
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export const handleRequest = createRequestHandler(app, {
  render: ({ hydrationRootScript, hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const body = renderToString(
        <RuntimeProvider runtime={runtime}>
          <App />
        </RuntimeProvider>,
      );

      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk(shellOpen()),
        chunks: Stream.make(htmlChunk(body)),
        hydrationPlan,
        tail: htmlChunk(shellClose(hydrationRootScript)),
        headers: {
          "x-effect-ui-starter": "react",
        },
      });
    }),
});

export default handleRequest;
