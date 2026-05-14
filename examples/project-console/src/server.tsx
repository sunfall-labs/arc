import { RuntimeProvider } from "@effect-ui/solid";
import {
  createHtmlResponseEffect,
  createRequestHandler,
  htmlChunk,
  streamHydrationChunk
} from "@effect-ui/start";
import { Effect, Stream } from "effect";
import { createComponent, generateHydrationScript, renderToString } from "solid-js/web";
import "./domain.server.js";
import App from "./App.js";
import { app } from "./app-definition.js";
import { ProjectSummaries } from "./project-collections.js";
import { projectConsoleStartGraphHeader, projectConsoleStartGraphSummary } from "./start-graph.js";
import "./styles.css";

const shellOpen = (options: {
  readonly solidHydrationScript: string;
  readonly title: string;
}): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="effect-ui-start-graph" content="${projectConsoleStartGraphHeader}" />
    <title>${options.title}</title>
    ${options.solidHydrationScript}
  </head>
  <body>
    <div id="root">`;

const shellClose = (hydrationScript: string): string => `</div>
    ${hydrationScript}
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export const handleRequest = createRequestHandler(app, {
  collections: [ProjectSummaries],
  render: ({ request, match, resources, hydrationScript, runtime }) => {
    return Effect.gen(function* () {
      const url = new URL(request.url);
      const href = `${url.pathname}${url.search}`;
      const body = renderToString(() =>
        createComponent(RuntimeProvider, {
          runtime,
          get children() {
            return createComponent(App, { initialHref: href });
          }
        })
      );
      const title = match?.route.path === "/projects/:id"
        ? `${(match.params as { readonly id: string }).id} · Effect UI Project Console`
        : "Effect UI Project Console";

      return yield* createHtmlResponseEffect({
        shell: htmlChunk(
          shellOpen({
            solidHydrationScript: generateHydrationScript(),
            title
          })
        ),
        chunks: Stream.make(
          htmlChunk(body),
          streamHydrationChunk(resources)
        ),
        tail: htmlChunk(shellClose(hydrationScript)),
        headers: {
          "x-effect-ui-render": "streaming",
          "x-effect-ui-start-graph": projectConsoleStartGraphHeader,
          "x-effect-ui-start-routes": projectConsoleStartGraphSummary.routes.join(",")
        }
      });
    });
  }
});

export default handleRequest;
