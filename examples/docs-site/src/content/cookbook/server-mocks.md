---
{
  "title": "Server mocks in tests",
  "category": "testing",
  "summary": "Test served Resources and Actions with test implementations instead of importing server-only modules.",
  "order": 5,
  "related": ["served-resource"],
}
---

# Server mocks in tests

## Mock a served Resource's load

A served Resource loads through the runtime's server client. `Server.mockLayer` provides one that answers from test implementations, so the Resource definition stays unchanged and calls still pass through its wire schemas.

```ts
const ServerTest = Server.mockLayer(
  Resource.implement(ProjectById, (id) => Effect.succeed({ id, name: "Atlas" })),
  Resource.implement(ProjectList, () =>
    Effect.succeed([{ id: makeProjectId("atlas"), name: "Atlas" }]),
  ),
);
```

## Run the Resource with the mock layer

Run the same Resource through a runtime with the mock layer.

```ts
const runtime = makeRuntime(ServerTest);

const projectEffect = runtime.provide(
  Effect.gen(function* () {
    yield* Resource.preload(ProjectById(makeProjectId("atlas")));
    return yield* Resource.read(ProjectById(makeProjectId("atlas")));
  }),
);
```

## Run a served Action locally

`Action.implement` gives a served Action a test `run`. The result keeps the definition's optimistic patches and invalidations, so a test submits it locally and checks what the browser would see.

```ts
const rename = Action.use(
  Action.implement(RenameProject, ({ id, name }) => Effect.succeed({ id, name })),
  { runtime },
);
```

## Keep tests browser-safe

This keeps tests browser-safe. They exercise the public app boundary without importing `.server.ts` modules.
