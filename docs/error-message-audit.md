# Error Message Audit

Last updated: 2026-05-14.

This audit supports the charter requirement that public failures include owner,
cause, and repair guidance. The current pass focused on package source errors
that were still raw `Error` or `TypeError` throws.

## Current Sweep Results

- `packages/core/src/stable-stringify.ts`
  - Replaced circular-data `TypeError` with
    `StableStringifyCircularData`.
  - Added `path`, `referencePath`, and guidance so callers can identify the
    value that must be changed or replace default keying with an explicit key.
  - Repeated acyclic references now stringify normally; only active cycles
    fail.
- `packages/db/src/server-collection.ts`
  - Replaced missing collection identity `TypeError` with
    `ServerCollectionMissingIdentity`.
  - Guidance tells the caller to provide a stable `name` or `id` for keying,
    sync, and tracing.
- `packages/db/src/sqlite-persistence.ts`
  - Replaced SQLite table/statement `TypeError`s with
    `SQLitePersistenceInvalidTableName` and
    `SQLitePersistenceUnsupportedStatement`.
  - Errors now expose the invalid table name or SQL operation plus adapter
    repair guidance.
- `packages/devtools/src/index.ts`
  - Replaced invalidation-target and action-invalidation conflict
    `TypeError`s with `DevtoolsUnknownInvalidationTarget` and
    `DevtoolsActionInvalidationPlanConflict`.
  - Guidance distinguishes local invalidation refs from serialized transport
    snapshots.
- `packages/start/src/hydration.ts`
  - Replaced malformed streamed hydration chunk `Error` with
    `StartHydrationChunkParseError`.
  - Error payload includes the stream sequence, malformed value, and guidance
    to use the Start serialization helpers.
- `packages/start/src/cli.ts`
  - Replaced the diagnostics CLI usage `Error` subclass with
    `StartDiagnosticsCliUsageError`, a tagged error carrying the message and
    CLI usage guidance.
  - Invalid CLI input now stays on the Effect runner path and returns a
    structured usage result instead of relying on an untyped exception shape.

## Verification Evidence

- `rg -n "throw new (TypeError|Error)" packages/*/src -g '*.ts'` found no
  remaining raw package-source throws.
- `pnpm typecheck` passed after the typed-error sweep.
- `pnpm exec vitest run packages/core/test/stable-stringify.test.ts packages/db/test/server-collection.test.ts packages/db/test/sqlite-persistence.test.ts packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`
  passed: 5 files, 79 tests.
- `pnpm verify` passed after the typed-error sweep: package build, workspace
  typecheck, type tests, 34 package test files / 298 tests, example typecheck,
  4 example test files / 23 tests, example build, and leak scan.
- `rg -n "throw new (TypeError|Error)|extends Error" packages/*/src -g '*.ts'`
  found no remaining raw package-source throws or raw `Error` subclasses after
  the CLI usage-error sweep.
- `rg -n "throw new Error|throw new TypeError|extends Error" packages examples scripts -g '*.ts' -g '*.tsx' -g '*.mjs'`
  found no remaining raw package, example, or script throws/subclasses after
  replacing negative-test sentinels with `expect.fail(...)`.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/start.test.ts -t "Start diagnostics
  CLI"` passed after the CLI usage-error sweep.
- Full `pnpm verify` passed after the CLI usage-error sweep: 38 root test files
  / 315 tests plus devtools panel, devtools extension, starter, rich starter
  packaging, project-console build, and leak-scan gates.
- `pnpm exec vitest run packages/core/test/stable-stringify.test.ts packages/core/test/resource.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/server-collection.test.ts packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`
  passed after replacing negative-test raw throw sentinels: 6 files, 107 tests.
- `pnpm typecheck` passed after replacing negative-test raw throw sentinels.
- `pnpm verify` passed after replacing negative-test raw throw sentinels: 9
  package builds, workspace typecheck, type tests, 38 root test files / 316
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.

## Follow-Up

- Keep adding typed `Data.TaggedError` classes for new public validation
  failures.
- Re-check docs and examples after future API renames so thrown `_tag` names
  stay aligned with documented repair paths.
