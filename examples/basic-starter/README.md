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
- one app definition (`App.define` in `src/app-definition.ts`) that the
  server handler and the browser entry both derive their wiring from;
- browser hydration in one line: `App.launch(app)` restores the server's
  payload and hydrates the server markup;
- a route-owned Resource preload declared in file route metadata;
- server-only module leakage checks after production build.
