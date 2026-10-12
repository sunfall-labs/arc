# Sunfall Arc Basic Starter

This is the smallest checked starter path for a full-stack Sunfall Arc app. It
keeps the same shape as the project console without the local-first DB,
actions, or diagnostics demo data.

Run it locally:

```sh
pnpm --filter @sunfall/arc-starter-basic dev
```

Verify the starter:

```sh
pnpm --filter @sunfall/arc-starter-basic verify
```

The starter proves:

- Start SSR with an Effect-returning `createRequestHandler`;
- browser hydration that runs `hydrateFromDocument(...)` on the client runtime
  before `Component.launch` hydrates the server markup;
- a route-owned Resource preload declared in file route metadata;
- server-only module leakage checks after production build.
