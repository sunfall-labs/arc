# Effect UI Basic Starter

This is the smallest checked starter path for a full-stack Effect UI app. It
keeps the same shape as the project console without the local-first DB,
actions, or diagnostics demo data.

Run it locally:

```sh
pnpm --filter @effect-ui/starter-basic dev
```

Verify the starter:

```sh
pnpm --filter @effect-ui/starter-basic verify
```

The starter proves:

- Start SSR with an Effect-returning `createRequestHandler`;
- browser hydration with the synchronous `hydrateFromDocument` host facade,
  which runs `hydrateFromDocumentEffect(...)` before the UI mounts;
- a route-owned Resource preload declared in file route metadata;
- server-only module leakage checks after production build.
