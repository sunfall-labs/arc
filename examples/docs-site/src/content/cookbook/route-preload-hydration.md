---
{
  "title": "Route preload and hydration",
  "category": "routing",
  "summary": "Load a route's Resources in its preload so SSR, hydration, and navigation share the same route data.",
  "order": 2,
  "related": ["served-resource"],
}
---

# Route preload and hydration

## Declare route-owned data

A route declares the data it owns once, in `preload`. Start records the Resources the preload loads, server renders the page with them, and hydrates exactly those, so nothing else lists them.

```ts
export const route = Route.define("/projects/:id", {
  params: ProjectRouteParams,
  preload: ({ params }) => Resource.preload(ProjectById(params.id)),
});
```

## Render with preload data

On the server, Start runs preload through the request runtime, then renders the app's root into its document. The document carries hydration chunks for the Resources the preload touched.

```ts
export const app = App.define({ root: Root, routes });

// server.tsx: the server Layer must provide everything the root and the
// served Resources and Actions (`implementations`) need.
export const handleRequest = createRequestHandler(app, {
  server: AppServerLive,
  implementations,
});
```

## Hydrate before mount

On the client, `App.launch` restores the payload into the browser runtime, then hydrates the same Component tree. Resource readers read synchronously from the hydrated state, so there is no loading flash and no refresh.

```ts
Effect.runFork(App.launch(app));
```
