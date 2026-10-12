---
{
  "title": "Served Resource",
  "category": "resources",
  "summary": "Declare a browser-safe Resource without a load, implement the load in a server-only module, and let Start serve it to SSR and the browser.",
  "order": 1,
  "related": ["route-preload-hydration", "server-mocks"],
}
---

# Served Resource

## Declare the Resource without a load

Define the Resource in a browser-safe module with its `input` and `output` schemas (and `error`, for the typed failures it reports) but no `load`. That makes it a served Resource: its load runs on the server, and the schemas are its wire contract. The Resource still owns its cache state, semantic tags, and policy.

```ts
export const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  error: ProjectNotFound,
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

## Implement the load server-only

Keep the load in a `.server.ts` module with `Resource.implement`. It may succeed only with the Resource's `output` and fail only with its `error`; the services it uses become the server Layer's to provide. The Start Vite plugin keeps `.server.ts` modules out of the browser build.

```ts
// projects.server.ts
export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);
```

## Serve it from the request handler

List the implementation in `createRequestHandler`. During SSR the load runs in-process on the request runtime; in the browser the same Resource loads over RPC. A failure outside the Resource's `error` schema (a lost connection, a missing implementation) is a defect, so components only ever see the typed failures you declared.

```ts
export const handleRequest = createRequestHandler(app, {
  server: ProjectStoreLive,
  implementations: [projectById],
});
```
