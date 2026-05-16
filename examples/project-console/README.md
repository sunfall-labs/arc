# Project Console Example

This example is the copyable golden path for Effect UI. It exercises branded
routes, file-route generation, Resources, Collections, Start server functions,
Start actions, no-JS form fallback, SSR, hydration, capability-based mocking,
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
  starter payloads at `.test-dist/starters/basic`,
  `.test-dist/starters/react`, and `.test-dist/starters/project-console`. The
  generated payloads rewrite workspace protocol dependencies to local
  `.effect-ui-packages/*` file dependencies, remove monorepo Vite aliases,
  write standalone `tsconfig.json` files, verify app manifests against their
  copyable source manifests, and dry-run package installation outside the
  workspace.
- Keep `src/domain.contract.ts` browser-safe. Put server implementations and
  seed data in `src/domain.server.ts`.
- Keep `src/start-options.ts` explicit. It is the app graph source for server
  functions, actions, file routes, diagnostics, and generated route output.
- Keep `src/routeTree.gen.ts` generated. Do not hand-edit it.
- Keep `pnpm leak-scan` in your copied app. It checks the built client for
  server-only module names and seed-data strings.
- The source `vite.config.ts` in this example points at workspace source
  packages for framework development. The generated starter strips those
  aliases so copied apps depend on generated local `@effect-ui/*` file package
  entries instead.
