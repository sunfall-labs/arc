# Package Hygiene Audit

Last updated: 2026-05-16.

This audit checks package manifests against package-source imports and public
exports. It supports the release-engineering charter workstream.

## Current Sweep Results

- Package manifests now include publish-readiness metadata while remaining
  private until the actual npm publication decision:
  - `description` summarizes each package's public role for registry and
    generated starter surfaces.
  - `license: "UNLICENSED"` avoids implying a public license while the
    workspace remains private and no root LICENSE file exists.
  - `main` and `types` point at the root built entrypoint for older tooling.
  - `files: ["dist"]` limits publication payloads to build output.
  - `sideEffects: false` documents that framework package modules are intended
    to be tree-shakable.
- Package TypeScript build info now writes to package-local `.tsbuildinfo`
  files instead of `dist/.tsbuildinfo`, so publishable `dist` payloads do not
  include compiler cache files.
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
  - `@effect-ui/react`: `@effect-ui/core`, `effect`, `react`
  - `@effect-ui/react-db`: `@effect-ui/core`, `@effect-ui/db`,
    `@effect-ui/react`, `effect`, `react`
  - `@effect-ui/solid`: `@effect-ui/core`, `effect`, `solid-js`
  - `@effect-ui/solid-db`: `@effect-ui/core`, `@effect-ui/db`,
    `@effect-ui/solid`, `effect`, `solid-js`
  - `@effect-ui/start-fetch`: `@effect-ui/start`
  - `@effect-ui/start-node`: `@effect-ui/start`
  - `@effect-ui/tsrx`: `@tsrx/vite-plugin-solid`, `vite-plugin-solid`, with
    `vite` as a peer dependency.
- Review149 added `pnpm example:pack-dry-run` as the current source package
  payload gate, and Review150 expanded it to all 11 framework packages plus the
  five starter/example source packages. Framework package payloads must be
  `package.json` plus `dist/*`; source package payloads must stay source-only
  and reject generated output, dependency directories, lockfiles, build info,
  local metadata, and missing `.gitignore` files. The basic, React, and
  generated project-console starters are the standalone copyable paths; the
  devtools panel and extension are workspace examples. Root `pnpm verify`
  includes this gate.
- Review155 tightened the same Effect-backed dry-run gate so it also enforces
  documented release metadata: every target remains `private` and
  `UNLICENSED`, every target has a non-empty `files` allowlist, dist packages
  carry descriptions, `sideEffects: false`, `main`/`types` entries under
  `./dist/`, and source packages that require copy hygiene list `.gitignore`.
- Review156 tightened source-package payload validation again: devtools panel,
  devtools extension, project console, basic starter, and React starter dry-runs
  now require their concrete copyable source files and directories instead of
  passing when only `.gitignore` is present.
- Review157 tightened the source-package payload gate from broad directories to
  concrete entrypoint files: app/server/route/virtual-module/leak-scan files for
  starters, panel/extension runtime files for devtools examples, and the config
  files required to copy and verify each source package.
- Review163 tightened the source-package payload gate from required-file checks
  to exact manifest comparison: each source package dry-run must match the
  source tree after excluding generated output, dependency directories,
  lockfiles, build info, and local metadata.
- Review164 tightened the framework dist-package dry-run gate: package payload
  validation now compares packed `dist/*.js`, `dist/*.d.ts`, and source-map
  stems against `src/**/*.ts(x)` source stems, with the Start virtual module
  handled explicitly. Stale generated dist artifacts and missing built
  declaration/JavaScript files now fail the release rehearsal.

## Verification Evidence

- Import sweep:
  - `rg -n "from \"(@effect-ui/[^\"]+|effect|solid-js|vite|@tsrx/[^\"]+|@tanstack/db-ivm)\"" packages/*/src examples/project-console/src -g '*.ts'`
- Manifest and lockfile files reviewed:
  - root `package.json`
  - `packages/*/package.json`
  - `examples/basic-starter/package.json`
  - `examples/devtools-extension/package.json`
  - `examples/devtools-panel/package.json`
  - `examples/project-console/package.json`
  - `pnpm-lock.yaml`
- Description sweep:
  - `rg -n '"description"' packages/*/package.json`
- License sweep:
  - `rg -n '"license": "UNLICENSED"' package.json packages/*/package.json examples/*/package.json`
- `pnpm install --lockfile-only --offline` completed successfully after the
  manifest change.
- `pnpm install --lockfile-only --offline` completed successfully after adding
  the Node and Fetch host adapter facade packages.
- `pnpm --filter @effect-ui/start build` passed.
- `pnpm --filter @effect-ui/start typecheck` passed.
- `pnpm verify` passed after the package hygiene change: package build,
  workspace typecheck, type tests, 34 package test files / 300 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.
- `pnpm build` and `pnpm typecheck` passed after the package publish metadata
  hardening sweep.
- `pnpm build` passed after adding package descriptions.
- `pnpm build` and `pnpm typecheck` passed after moving package
  `.tsbuildinfo` outputs out of `dist`.
- Individual package dry-run packs passed after refreshing workspace links,
  after adding package descriptions, and after adding `UNLICENSED` metadata:
  - `pnpm --filter @effect-ui/core pack --dry-run`
  - `pnpm --filter @effect-ui/db pack --dry-run`
  - `pnpm --filter @effect-ui/devtools pack --dry-run`
  - `pnpm --filter @effect-ui/start pack --dry-run`
  - `pnpm --filter @effect-ui/start-fetch pack --dry-run`
  - `pnpm --filter @effect-ui/start-node pack --dry-run`
  - `pnpm --filter @effect-ui/solid pack --dry-run`
  - `pnpm --filter @effect-ui/solid-db pack --dry-run`
  - `pnpm --filter @effect-ui/tsrx pack --dry-run`
- Historical framework package dry-run pack payloads contained only `dist` JavaScript,
  declaration, source-map files, and package manifests; no `.tsbuildinfo`
  compiler cache files are included.
- `pnpm build && pnpm example:pack-dry-run` passed after Review150 and verified
  all 16 package payloads: 11 framework dist packages, 19 basic starter files,
  24 React starter files, 30 project-console files, 10 devtools panel files,
  and 15 devtools extension files.
- The latest full `pnpm verify` passed after Review164 with 11 package builds,
  workspace typecheck, public type tests, public API inventory audit,
  Effect-first audit over 274 files, 53 root test files / 1003 tests,
  devtools verifies, generated starter packaging, the 16-target dry-run gate,
  project-console typecheck/tests/build, and leak scan.
- Review163 focused `pnpm example:pack-dry-run` passed across all 16 package
  payloads after adding exact source-package manifest comparison.
- Review164 focused `pnpm example:pack-dry-run` passed across all 16 package
  payloads after adding dist artifact/source-stem validation: core 201 files,
  db 145, devtools 65, devtools-extension 15, devtools-panel 10,
  project-console 30, react 25, react-db 17, solid 25, solid-db 17, start 260,
  start-fetch 5, start-node 5, starter-basic 19, starter-react 24, and tsrx 5.
- Review155 focused `pnpm example:pack-dry-run` passed across all 16 package
  payloads after adding manifest metadata enforcement to the dry-run gate.
- Review156 focused `pnpm example:pack-dry-run` passed across all 16 package
  payloads after adding concrete source payload file/directory requirements to
  the dry-run gate.
- Review157 focused `pnpm example:pack-dry-run` passed across all 16 package
  payloads after requiring concrete source entrypoints: core 201 files, db 145,
  devtools 65, devtools-extension 15, devtools-panel 10, project-console 30,
  react 25, react-db 17, solid 25, solid-db 17, start 256, start-fetch 5,
  start-node 5, starter-basic 19, starter-react 24, and tsrx 5.
- `pnpm verify` passed after adding the Node and Fetch adapter facade packages:
  9 package builds, workspace typecheck, type tests, 35 package test files /
  308 tests, example typecheck, 4 example test files / 23 tests, example build,
  and leak scan.
- `pnpm verify` passed after adding package descriptions: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 315 tests,
  devtools-panel verify, devtools-extension verify, basic starter verify,
  project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.
- `pnpm build` passed after adding `UNLICENSED` metadata to the workspace,
  framework packages, examples, and starter manifests.
- `pnpm verify` passed after adding `UNLICENSED` metadata: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.

## Follow-Up

- Re-run this audit after adding a new package export path, adapter, or runtime
  dependency.
- If packages become public on npm, flip `private`, choose the public license
  and repository metadata, and revisit whether framework package dependencies
  should be direct dependencies or peer dependencies.
- Use package-local dry-run pack checks for publication rehearsal; recursive
  workspace pack is not the release signal while workspace protocol replacement
  is still a pnpm publication concern.
