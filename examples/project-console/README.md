# Project Console Example

This example is the copyable golden path for Sunfall Arc. It exercises branded
routes, file-route generation, served Resources with keyed rows, served
Actions, no-JS form fallback, SSR, hydration, mocked Resource loads,
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
- Keep `src/model.ts`, `src/domain.ts`, and `src/project-actions.ts`
  browser-safe: they hold the schemas and the served Resources and Actions
  (`Resource.define` / `Action.define` without `load` / `run`). Put their
  server implementations (`Resource.implement` / `Action.implement`) and seed
  data in `src/domain.server.ts`; the Start Vite plugin keeps `*.server.ts`
  modules out of the browser build.
- `src/app-definition.ts` is the one app definition. `src/server.tsx` serves
  it with `createRequestHandler(app, { server, implementations })`;
  `src/start-options.ts` holds only file-route, diagnostics, and build-policy
  options.
- Keep `src/routeTree.gen.ts` generated. Do not hand-edit it.
- Keep `pnpm leak-scan` in your copied app. It checks the built client for
  server-only module names and seed-data strings.
- The source `vite.config.ts` in this example points at workspace source
  packages for framework development. The generated starter strips those
  aliases so copied apps depend on generated local `@sunfall/arc-*` file package
  entries instead.
