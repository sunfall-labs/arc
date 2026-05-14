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

## Thirty-Sweep Gate

The final goal requires 30 full code sweeps without finding more improvements.
This ledger currently records 19 sweeps. The remaining 11 should cover:

- Richer Start request trace teardown facts beyond the current runtime-disposed
  marker.
- Promise-shaped internals that can be pushed down into Effect programs.
- New error classes and repair guidance introduced by later work.
- Docs drift against current implementation.
- Generated artifact determinism and source attribution.
- Type-test coverage for compile-time rejection rules.
- Runtime leak and teardown behavior under stress.
- Example app copyability and starter extraction.
- Package dependency and export hygiene.
- Browser/server boundary leak checks beyond the existing example scan.
- Benchmark baselines for SSR, preload, collections, live queries, and transport.

## Open Release-Candidate Slices

1. Harden `DevtoolsRequestTrace` teardown facts beyond the current runtime
   disposal marker.
2. Add a docs page or section that explains request traces as the bridge between
   app graph facts and runtime events.
3. Add a benchmark baseline artifact before calling release engineering done.
4. Re-run the public API inventory after any rename/removal work and update
   migration notes.
5. Continue the action/resource Promise-internals audit and replace the
   remaining `.then(...)` state where an Effect primitive gives better
   interruption or locality.
6. Run full `pnpm verify` and record the result before any handoff that claims
   release-candidate status.
