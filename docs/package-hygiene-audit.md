# Package Hygiene Audit

Last updated: 2026-05-14.

This audit checks package manifests against package-source imports and public
exports. It supports the release-engineering charter workstream.

## Current Sweep Results

- `@effect-ui/start`
  - Source entrypoints import `effect` directly in runtime, manifests, Vite,
    adapters, hydration, routing, and streaming modules.
  - `packages/start/package.json` now declares `effect` as a direct dependency
    instead of relying on transitive workspace packages.
  - `pnpm-lock.yaml` was updated to keep the workspace lock consistent.
- Other package manifests match direct runtime imports found in this sweep:
  - `@effect-ui/core`: `effect`
  - `@effect-ui/db`: `@effect-ui/core`, `@tanstack/db-ivm`, `effect`
  - `@effect-ui/devtools`: `@effect-ui/core`, `effect`
  - `@effect-ui/solid`: `@effect-ui/core`, `effect`, `solid-js`
  - `@effect-ui/solid-db`: `@effect-ui/core`, `@effect-ui/db`,
    `@effect-ui/solid`, `effect`, `solid-js`
  - `@effect-ui/tsrx`: `@tsrx/vite-plugin-solid`, `vite-plugin-solid`, with
    `vite` as a peer dependency.

## Verification Evidence

- Import sweep:
  - `rg -n "from \"(@effect-ui/[^\"]+|effect|solid-js|vite|@tsrx/[^\"]+|@tanstack/db-ivm)\"" packages/*/src examples/project-console/src -g '*.ts'`
- Manifest and lockfile files reviewed:
  - root `package.json`
  - `packages/*/package.json`
  - `examples/project-console/package.json`
  - `pnpm-lock.yaml`
- `pnpm install --lockfile-only --offline` completed successfully after the
  manifest change.
- `pnpm --filter @effect-ui/start build` passed.
- `pnpm --filter @effect-ui/start typecheck` passed.
- `pnpm verify` passed after the package hygiene change: package build,
  workspace typecheck, type tests, 34 package test files / 300 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.

## Follow-Up

- Re-run this audit after adding a new package export path, adapter, or runtime
  dependency.
- If packages become public on npm, add publish metadata and revisit whether
  framework package dependencies should be direct dependencies or peer
  dependencies.
