---
{
  "title": "Capability mocks in tests",
  "category": "testing",
  "summary": "Test Resources and Actions by swapping a Capability layer instead of importing server-only handlers.",
  "order": 5,
  "related": ["resource-from-server-function"],
}
---

# Capability mocks in tests

## Depend on a Capability

Application definitions should depend on a Capability. Tests can provide a layer that satisfies the same interface, so the Resource or Action stays unchanged.

```ts
const ProjectApiTest = ProjectApi.layer({
  get: (id) => Effect.succeed({ id, name: "Atlas" }),
  list: () => Effect.succeed([{ id: makeProjectId("atlas"), name: "Atlas" }]),
});
```

## Run the Resource with a test layer

Run the same Resource through a runtime with the test layer.

```ts
const runtime = makeRuntime(ProjectApiTest);

const projectEffect = runtime.provide(
  Effect.gen(function* () {
    yield* Resource.prefetchEffect(ProjectById(makeProjectId("atlas")));
    return Resource.read(ProjectById(makeProjectId("atlas")));
  }),
);
```

## Keep tests browser-safe

This keeps tests browser-safe. They exercise the public app boundary without importing `.server.ts` modules.
