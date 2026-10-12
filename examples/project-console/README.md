# Project Console Example

This example is the copyable golden path for Sunfall Arc. It exercises branded
routes, file-route generation, Resources with keyed rows, Start server functions,
Start actions, no-JS form fallback, SSR, hydration, service-Layer mocking,
indexed live queries over Resource rows, Actions that patch rows optimistically,
and the production server-only leak scan.

## Run In This Repository

From the repository root:

```sh
pnpm example:dev
pnpm example:test
pnpm example:build
pnpm example:leak-scan
pnpm starter:package
```

From this example directory:

```sh
pnpm dev
pnpm test
pnpm build
pnpm leak-scan
pnpm verify
```

## Copying The Example

- Run `pnpm starter:package` from the repository root to generate standalone
  starter payloads at `.test-dist/starters/basic` and
  `.test-dist/starters/project-console`. The
  generated payloads rewrite workspace protocol dependencies to local
  `.sunfall-arc-packages/*` file dependencies, remove monorepo Vite aliases,
  write standalone `tsconfig.json` files, verify app manifests against their
  copyable source manifests, install outside the workspace, run each generated
  starter's own `verify` script, and clean generated install/build artifacts.
- Keep `src/domain.contract.ts` browser-safe. Put server implementations and
  seed data in `src/domain.server.ts`.
- `src/app-definition.ts` is the one app definition. The Start Vite plugin
  derives the app graph's server functions and Actions from
  `createRequestHandler(app, { serverFunctions })` in `src/server.tsx`;
  `src/start-options.ts` holds only file-route, diagnostics, and build-policy
  options.
- Keep `src/routeTree.gen.ts` generated. Do not hand-edit it.
- Keep `pnpm leak-scan` in your copied app. It checks the built client for
  server-only module names and seed-data strings.
- The source `vite.config.ts` in this example points at workspace source
  packages for framework development. The generated starter strips those
  aliases so copied apps depend on generated local `@sunfall/arc-*` file package
  entries instead.
