---
{
  "title": "Route preload and hydration",
  "category": "routing",
  "summary": "Declare the Resources a route owns so SSR, streamed hydration, diagnostics, and agents share the same route-data contract.",
  "order": 2,
  "related": ["resource-from-server-function"],
}
---

# Route preload and hydration

## Declare route-owned data

File routes should declare the data they own. Arc can then explain and verify what a page needs before rendering it.

```ts
export const Route = defineFileRoute("/projects/:id")({
  params: ProjectRouteParams,
  preloadResources: [ProjectById],
  preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
});
```

## Render with preload data

On the server, Start runs preload through the request runtime before rendering. The response carries streamed hydration chunks for the touched Resources.

```ts
export const handleRequest = createRequestHandler(app, {
  render: ({ hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      // `embed` checks the request runtime provides every service App needs.
      const body = renderToString(() => createComponent(Component.embed(App, runtime), {}));

      return yield* createStartStreamedHtmlResponseEffect({
        shell: htmlChunk('<!doctype html><div id="root">'),
        chunks: Stream.make(htmlChunk(body)),
        hydrationPlan,
        tail: htmlChunk("</div>"),
      });
    }),
});
```

## Hydrate before mount

On the client, hydrate the payload, then hydrate the same Component tree. Resource readers read synchronously from the hydrated state, so there is no loading flash and no refetch.

```ts
const runtime = makeRuntime(Layer.empty);
hydrateFromDocument(document, undefined, { runtime });
Effect.runFork(Component.launch(App, root, { runtime, hydrate: root.hasChildNodes() }));
```
