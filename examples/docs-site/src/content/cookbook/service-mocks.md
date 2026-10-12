---
{
  "title": "Service mocks in tests",
  "category": "testing",
  "summary": "Test Resources and Actions by swapping an Effect service Layer instead of importing server-only handlers.",
  "order": 5,
  "related": ["resource-from-server-function"],
}
---

# Service mocks in tests

## Depend on an Effect service

Application definitions should depend on an Effect service (`Context.Service`). Tests can provide a `Layer` that satisfies the same interface, so the Resource or Action stays unchanged.

```ts
const ProjectApiTest = Layer.succeed(ProjectApi, {
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
    yield* Resource.preload(ProjectById(makeProjectId("atlas")));
    return yield* Resource.read(ProjectById(makeProjectId("atlas")));
  }),
);
```

## Keep tests browser-safe

This keeps tests browser-safe. They exercise the public app boundary without importing `.server.ts` modules.
