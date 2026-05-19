import { defineApp } from "@sunfall/arc-core";
import { RuntimeProvider } from "@sunfall/arc-solid";
import {
  createStartStreamedHtmlResponseEffect,
  createRequestHandler,
  htmlChunk,
} from "@sunfall/arc-start";
import { Effect, Layer, Stream } from "effect";
import { createComponent, generateHydrationScript, renderToString } from "solid-js/web";
import App from "./App.js";
import { ProjectApiLive } from "./domain.js";
import { ProjectDemoStoreLive } from "./domain.server.js";
import { ProjectSummaries, ProjectWorkItems } from "./project-collections.js";
import { isRoutePathMatch } from "./routeTree.gen.js";
import { projectConsoleAppBaseOptions } from "./app-definition.js";
import { projectConsoleStartGraphHeader, projectConsoleStartGraphSummary } from "./start-graph.js";
import { projectConsoleServerRegistry } from "./start-options.js";
import "./styles.css";

export const ProjectConsoleServerLive = Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive);

export const serverApp = defineApp({
  ...projectConsoleAppBaseOptions,
  server: ProjectConsoleServerLive,
  registry: projectConsoleServerRegistry,
});

const shellOpen = (options: {
  readonly solidHydrationScript: string;
  readonly title: string;
}): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="sunfall-arc-start-graph" content="${projectConsoleStartGraphHeader}" />
    <title>${options.title}</title>
    ${options.solidHydrationScript}
  </head>
  <body>
    <div id="root">`;

const shellClose = (hydrationScript: string): string => `    ${hydrationScript}
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export const handleRequest = createRequestHandler(serverApp, {
  collections: [ProjectSummaries, ProjectWorkItems],
  render: ({ request, match, hydrationPlan, runtime }) => {
    return Effect.gen(function* () {
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
      const title = isRoutePathMatch("/projects/:id", match)
        ? `${match.params.id} · Sunfall Arc Project Console`
        : "Sunfall Arc Project Console";
      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk(
          shellOpen({
            solidHydrationScript: generateHydrationScript(),
            title,
          }),
        ),
        chunks: Stream.make(htmlChunk(`${body}</div>\n`)),
        hydrationPlan,
        tail: htmlChunk(shellClose(hydrationPlan.root.script)),
        headers: {
          "x-sunfall-arc-render": "streaming",
          "x-sunfall-arc-start-graph": projectConsoleStartGraphHeader,
          "x-sunfall-arc-start-routes": projectConsoleStartGraphSummary.routes.join(","),
        },
      });
    });
  },
});

export default handleRequest;
