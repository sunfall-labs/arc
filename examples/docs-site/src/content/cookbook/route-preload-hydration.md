---
{
  "title": "Route preload and hydration",
  "category": "routing",
  "summary": "Declare the Resources a route owns so SSR, streamed hydration, diagnostics, and agents agree on the same data edge.",
  "order": 2,
  "related": ["resource-from-server-function"],
}
---

# Route preload and hydration

## Declare route-owned data

File routes should declare the data they own. The app graph can then explain what a page needs before rendering it.

```ts
const RouteBuilder = defineFileRoute("/projects/:id");

export const Route = RouteBuilder.preload({
  params: ProjectRouteParams,
  resources: ({ resource }) => [resource(ProjectById, ({ params }) => params.id)],
}).route();
```

## Render with preload data

On the server, Start runs preload through the request runtime before rendering. The response carries streamed hydration chunks for the touched Resources.

```ts
export const handleRequest = createRequestHandler(app, {
  render: ({ hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const body = renderToString(() => (
        <RuntimeProvider runtime={runtime}>
          <App />
        </RuntimeProvider>
      ));

      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk("<!doctype html><div id=\"root\">"),
        chunks: Stream.make(htmlChunk(body)),
        hydrationPlan,
        tail: htmlChunk("</div>")
      });
    })
});
```

## Hydrate before mount

On the client, hydrate the payload before mounting the UI. Components can read synchronously from the hydrated Resource state.

```ts
const runtime = createEffectRuntime(Layer.empty);
hydrateFromDocument(document, undefined, { runtime });
```
