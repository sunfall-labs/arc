---
{
  "title": "Resource from a server function",
  "category": "resources",
  "summary": "Define a browser-safe contract, place the handler in a server-only module, and expose the read through a Capability-backed Resource.",
  "order": 1,
  "related": ["route-preload-hydration", "capability-mocks"],
}
---

# Resource from a server function

## Define the browser-safe contract

Start with a shared contract. This module is safe for the browser because it only exports schemas, error types, and the typed client handle.

```ts
export const GetProjectContract = Server.contract<
  { readonly id: ProjectId },
  Project,
  ProjectError
>("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: ProjectSchema,
  error: ProjectErrorSchema,
});
```

## Keep implementation server-only

Keep the real implementation in a `.server.ts` module. Host work stays behind the server function boundary, and application code sees an Effect.

```ts
export const getProject = Server.implement(GetProjectContract, ({ id }) =>
  ProjectStore.use((store) => store.get(id)),
);
```

## Expose a Capability

Expose the contract through a named Capability. Resources and Actions depend on the Capability, not on a transport detail.

```ts
export const ProjectApiLive = ProjectApi.layer({
  get: (id) => getProjectClient.effect({ id }),
});
```

## Wrap it in a Resource

The Resource owns schema output, cache state, semantic tags, and retry policy.

```ts
export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
```
