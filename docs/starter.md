# Basic Starter

The smallest checked starter lives at
[`examples/basic-starter`](../examples/basic-starter). It is a full-stack
starter, not a marketing demo.

Run it locally:

```sh
pnpm starter:dev
```

Verify it:

```sh
pnpm starter:verify
```

The starter includes:

- one file route generated into `src/routeTree.gen.ts`;
- one route-owned Resource preload declared in route metadata;
- Start SSR through `createRequestHandler`;
- browser hydration through `hydrateFromDocument`;
- a production leak scan for `starter.server` sentinels.

Use the project console when you need the larger golden path with forms,
actions, local-first collections, mocks, and diagnostics. Use the basic starter
when you need the smallest copyable app shell.
