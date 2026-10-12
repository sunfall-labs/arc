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
export const Route = FileRoute.define("/projects/:id")({
  params: ProjectRouteParams,
  preloadResources: [ProjectById],
  preload: ({ params }) => Resource.preload(ProjectById(params.id)),
});
```

## Render with preload data

On the server, Start runs preload through the request runtime, then renders the app's root into its document. The response carries streamed hydration chunks for the touched Resources.

```ts
export const app = App.define({ root: Root, routes, client: AppLive });

// server.tsx: the server Layer must provide everything the root needs.
export const handleRequest = createRequestHandler(app, { server: AppServerLive });
```

## Hydrate before mount

On the client, `App.launch` restores the payload into the browser runtime, then hydrates the same Component tree. Resource readers read synchronously from the hydrated state, so there is no loading flash and no refresh.

```ts
Effect.runFork(App.launch(app));
```
