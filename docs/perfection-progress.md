# Framework Perfection Progress

Last updated: 2026-05-14.

This ledger tracks implementation evidence for
`docs/framework-perfection-charter.md`. It is intentionally conservative: a
cleanup item is only checked when the repo has a file, test, generated artifact,
or command result that proves it.

## Current Status

- Charter exists: `docs/framework-perfection-charter.md`.
- Public API inventory exists: `docs/public-api-inventory.md`.
- Devtools request trace data contract exists in `@effect-ui/devtools`.
- Start request handlers emit structurally compatible request traces through
  `onRequestTrace` for SSR, server RPC, Start actions, and response stream
  close.
- Focused devtools and Start request trace coverage is green.
- Package-source raw validation throws were replaced with typed errors carrying
  repair guidance.
- Full verification is green after the typed-error sweep.
- Core Resource public in-flight dedupe is now fiber-backed and participates in
  runtime disposal.
- Full verification is green after the Resource fiber sweep.
- Package source has no remaining raw Promise method calls after the latest
  Effect-first cleanup.
- Full verification is green after the Promise-method cleanup.
- Request traces now include richer teardown duration and Resource Store
  before/after disposal snapshots.
- Full verification is green after the richer request teardown trace slice.
- Package dependency hygiene audit is recorded; `@effect-ui/start` now declares
  its direct `effect` dependency.
- Full verification is green after the package hygiene change.
- Generated artifact determinism audit is recorded and has focused Start
  manifest/module coverage.
- Full verification is green after the generated artifact audit.
- Docs drift audit is recorded; stale release-candidate follow-ups were updated
  after the completed teardown and Promise-method sweeps.
- The current operating window is recorded as work until 8:00 AM
  America/Denver on May 14, 2026, with Effect-first implementation as a standing
  requirement.
- The full charter is not complete. Benchmark baselines, remaining audits, and
  the 30 clean-sweep gate are still open.

## Sweep Ledger

| Sweep | Scope | Evidence | Result | Follow-up |
| --- | --- | --- | --- | --- |
| 1 | Charter-to-repo orientation | `docs/framework-perfection-charter.md`; package manifest review | Multi-week workstreams and completion audit are explicit. | Keep updating this ledger as slices land. |
| 2 | Package export inventory | `docs/public-api-inventory.md`; `package.json#exports` for every package | Every package export path is classified as public or expert public. | Convert each "needs decision" note into docs, rename, or removal. |
| 3 | Sharp-edge grep | `rg "TODO|FIXME|HACK|XXX|throw new Error|console\\.| as any| as never|Promise<|Promise\\." packages examples docs` | No broad TODO backlog surfaced; request trace remained the primary named product gap. | Run targeted error-message and Promise-helper audits instead of relying on broad grep. |
| 4 | Devtools request trace slice | `packages/devtools/src/index.ts`; `packages/devtools/test/devtools.test.ts` | Added `DevtoolsRequestTrace`, store recording, summaries, causal graph nodes, and runtime event linkage. | Keep the summary shape stable as Start emission broadens. |
| 5 | Focused devtools verification | `pnpm exec vitest run packages/devtools/test/devtools.test.ts`; `pnpm --filter @effect-ui/devtools typecheck` | 14 devtools tests passed; devtools package typecheck passed. | Run full `pnpm verify` after docs and any Start wiring changes. |
| 6 | Start request trace emission | `packages/start/src/index.ts`; `packages/start/test/start.test.ts`; `type-tests/framework.test-d.ts` | `createRequestHandler(..., { onRequestTrace })` emits Devtools-compatible traces for SSR, RPC, actions, and stream close. | Add cancellation/failure trace assertions and richer teardown details. |
| 7 | Focused Start/devtools verification | `pnpm exec vitest run packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`; `pnpm typecheck` | 63 focused tests passed; workspace typecheck and type tests passed. | Run full `pnpm verify` before handoff. |
| 8 | Full verification gate | `pnpm verify` | Package build, workspace typecheck, type tests, 33 package test files / 290 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Keep this green after the next trace-hardening slice. |
| 9 | Effect-first trace hardening | `packages/start/src/index.ts`; `packages/start/test/start.test.ts`; `docs/framework-perfection-charter.md` | Stream finalization now runs one Effect finalizer at the Web Stream boundary; Start traces cover stream cancellation and request failure paths. | Continue Promise-internal audit. |
| 10 | Full verification after trace hardening | `pnpm verify` | Package build, workspace typecheck, type tests, 33 package test files / 292 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Keep iterating toward the remaining cleanup audits. |
| 11 | Effect-first Promise audit | `docs/effect-first-audit.md`; `packages/core/src/runtime.ts` | Classified Promise sites and moved core runtime disposal sequencing into `disposeEffect`. | Re-run full verify and continue action/resource Promise audit. |
| 12 | Full verification after runtime cleanup | `pnpm verify` | Package build, workspace typecheck, type tests, 33 package test files / 292 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Continue action/resource Promise audit. |
| 13 | Effect-backed no-op Promise helpers | `packages/db/src/index.ts`; `packages/solid/src/index.ts`; `docs/effect-first-audit.md` | Replaced remaining `Promise.resolve(...)` source helpers with `runPromise(...Effect)` / `runtime.runPromise(Effect.void)`. | Run full verify after next source sweep. |
| 14 | Typed error and repair-guidance audit | `docs/error-message-audit.md`; `packages/core/src/stable-stringify.ts`; `packages/db/src/server-collection.ts`; `packages/db/src/sqlite-persistence.ts`; `packages/devtools/src/index.ts`; `packages/start/src/hydration.ts` | Removed package-source raw `Error`/`TypeError` throws and added owned typed errors with repair guidance plus focused tests. | Continue the Effect-first Promise-internals audit. |
| 15 | Full verification after typed-error sweep | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 298 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 16 | Resource in-flight Effect fiber sweep | `packages/core/src/resource.ts`; `packages/core/test/resource.test.ts`; `docs/effect-first-audit.md` | Public Resource prefetch/refresh dedupe now tracks a `Fiber` and runtime disposal interrupts in-flight public loads. Focused Resource tests and `pnpm typecheck` passed. | Keep verifying as the next Effect-first slice lands. |
| 17 | Full verification after Resource fiber sweep | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 300 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 18 | Package source Promise-method cleanup | `packages/core/src/action.ts`; `packages/core/src/resource.ts`; `packages/solid/src/index.ts`; `packages/solid-db/src/index.ts`; `packages/start/src/index.ts`; `docs/effect-first-audit.md` | Removed remaining package-source `.then(...)`, `.finally(...)`, and non-Effect `.catch(...)` calls by moving cleanup/error handling into Effect programs. Focused tests and `pnpm typecheck` passed. | Keep the source grep clean as new public Promise helpers are added. |
| 19 | Full verification after Promise-method cleanup | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 300 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 20 | Rich request teardown trace facts | `packages/start/src/index.ts`; `packages/devtools/src/index.ts`; `packages/start/test/start.test.ts`; `packages/devtools/test/devtools.test.ts` | Request traces now record start/completion timestamps, duration, and before/after Resource Store teardown snapshots; focused Start/devtools tests, typecheck, and type tests passed. | Run full verify before committing this slice. |
| 21 | Full verification after request teardown trace facts | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 300 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 22 | Package dependency hygiene audit | `docs/package-hygiene-audit.md`; `packages/start/package.json`; `pnpm-lock.yaml` | Manifest/import sweep found and fixed the missing direct `effect` dependency in `@effect-ui/start`; lockfile-only install plus Start build/typecheck passed. | Keep this audit current as new dependencies land. |
| 23 | Full verification after package hygiene | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 300 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 24 | Generated artifact determinism audit | `docs/generated-artifact-audit.md`; `packages/start/test/file-routes.test.ts`; `packages/start/src/vite.ts` | Added reversed-input serialization regression coverage for file route manifests and cleaned generated app graph module source formatting. Focused Start artifact tests and Start typecheck passed. | Keep generated artifact assertions current as virtual modules grow. |
| 25 | Full verification after generated artifact audit | `pnpm verify` | Package build, workspace typecheck, type tests, 34 package test files / 300 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Commit the verified slice and keep iterating. |
| 26 | Docs drift audit | `docs/docs-drift-audit.md`; `docs/ultimate-goal-checklist.md`; `docs/perfection-progress.md` | Removed stale follow-ups for already-shipped richer teardown facts and package-source Promise-method cleanup while preserving historical checkpoint counts as historical evidence. | Re-run before release-candidate handoff. |
| 27 | Type-test coverage audit | `type-tests/framework.test-d.ts`; `docs/type-test-coverage-audit.md`; `docs/framework-perfection-charter.md` | Added explicit request-trace teardown type assertions, kept Start teardown assignable to devtools, and rejected Promise-returning `onRequestTrace` handlers at compile time. | Run type-test verification before committing. |

## Thirty-Sweep Gate

The final goal requires 30 full code sweeps without finding more improvements.
This ledger currently records 27 sweeps. The remaining 3 should cover:

- Devtools UI/docs polish around the richer request trace teardown facts.
- Promise-shaped internals that can be pushed down into Effect programs.
- New error classes and repair guidance introduced by later work.
- Docs drift against current implementation.
- Golden-file snapshots for generated artifacts if inline assertions stop being
  enough.
- Runtime leak and teardown behavior under stress.
- Example app copyability and starter extraction.
- Package publish metadata and export hygiene before npm publication.
- Browser/server boundary leak checks beyond the existing example scan.
- Benchmark baselines for SSR, preload, collections, live queries, and transport.

## Open Release-Candidate Slices

1. Build the first devtools UI/panel surface against `DevtoolsSummary` and the
   richer request trace payload.
2. Add a benchmark baseline artifact before calling release engineering done.
3. Re-run the public API inventory after any rename/removal work and update
   migration notes.
4. Run full `pnpm verify` and record the result before any handoff that claims
   release-candidate status.
