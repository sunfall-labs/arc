import { RuntimeProvider } from "@effect-ui/solid";
import {
  createStartStreamedHtmlResponseEffect,
  createRequestHandler,
  htmlChunk
} from "@effect-ui/start";
import { Effect, Stream } from "effect";
import { createComponent, generateHydrationScript, renderToString } from "solid-js/web";
import App from "./App.js";
import { ProjectSummaries } from "./project-collections.js";
import { isRoutePathMatch } from "./routeTree.gen.js";
import { createProjectConsoleApp } from "./app-definition.js";
import { projectConsoleStartGraphHeader, projectConsoleStartGraphSummary } from "./start-graph.js";
import { projectConsoleServerRegistry } from "./start-options.js";
import "./styles.css";

export const serverApp = createProjectConsoleApp(projectConsoleServerRegistry);

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

export const handleRequest = createRequestHandler(serverApp, {
  collections: [ProjectSummaries],
  render: ({ request, match, hydrationPlan, runtime }) => {
    return Effect.gen(function* () {
      const url = new URL(request.url);
      const href = `${url.pathname}${url.search}`;
      const body = renderToString(() =>
        createComponent(RuntimeProvider, {
          runtime,
          get children() {
            return createComponent(App, { initialHref: href, runtime });
          }
        })
      );
      const title = isRoutePathMatch("/projects/:id", match)
        ? `${match.params.id} · Effect UI Project Console`
        : "Effect UI Project Console";
      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk(
          shellOpen({
            solidHydrationScript: generateHydrationScript(),
            title
          })
        ),
        chunks: Stream.make(htmlChunk(body)),
        hydrationPlan,
        tail: htmlChunk(shellClose(hydrationPlan.root.script)),
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
