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
- The cleanup backlog is checked through the benchmark baseline audit, and the
  latest full verification gate is green.
- The final no-new-improvements clean-sweep gate is still open: sweep 30 found
  and added benchmark work, so it cannot count as a no-op clean sweep.

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
| 28 | Runtime leak and teardown audit | `packages/core/src/resource-store.ts`; `packages/core/test/resource-store.test.ts`; `docs/runtime-leak-teardown-audit.md` | Resource Store disposal now shuts down its event `PubSub` through `Effect.ensuring`, including the module-finalizer failure path. | Run focused Resource Store tests and keep the browser/server leak audit separate. |
| 29 | Example copyability and leak audit | `examples/project-console/README.md`; `examples/project-console/package.json`; `examples/project-console/src/server.test.ts`; `docs/example-copyability-and-leak-audit.md` | Example-owned test/leak/verify scripts, local Vitest dependency, copy guidance, and stronger server-module leak sentinels make the app easier to lift out safely. Example-local verify and root delegated example scripts passed. | Keep replacing workspace caveats with published package versions near RC. |
| 30 | Benchmark baseline audit | `benchmarks/framework-baseline.bench.ts`; `package.json`; `docs/benchmark-baseline-audit.md`; `docs/framework-perfection-charter.md` | Added the first repeatable Vitest benchmark suite for SSR, route preload, Resource cache behavior, live query materialization, and RPC transport. `pnpm benchmark`, `pnpm typecheck`, and full `pnpm verify` passed. | Begin no-new-improvements clean sweeps only after the remaining release-candidate hardening work stabilizes. |
| 31 | Devtools panel model | `packages/devtools/src/index.ts`; `packages/devtools/test/devtools.test.ts`; `docs/devtools.md`; `docs/public-api-inventory.md`; `type-tests/framework.test-d.ts` | Added `DevtoolsPanels`, `describeDevtoolsPanels`, Effect wrappers, and store `getPanels` accessors so a UI can render stable app graph, route, resource, action, collection, request, diagnostics, and causal graph panels without private reads. Focused devtools tests, workspace typecheck, and full `pnpm verify` passed. | Continue toward a browser/app UI only after product surface work resumes. |
| 32 | Package publish metadata hardening | `packages/*/package.json`; `docs/package-hygiene-audit.md`; `docs/perfection-progress.md` | Added `main`, `types`, `files`, and `sideEffects` metadata to framework packages while keeping them private until the npm publication decision. Package build and workspace typecheck passed. | Final npm publication still needs `private` flipped plus descriptions/repository/license decisions. |
| 33 | Docs drift sweep after panel and package hardening | `docs/package-hygiene-audit.md`; `docs/public-api-inventory.md`; `docs/ultimate-goal-checklist.md`; `docs/perfection-progress.md` | Removed stale benchmark-future language, recorded publish metadata verification, and updated public API notes for the new panel and package metadata surfaces. Targeted docs drift, raw-error, and Promise-method greps are clean. | Keep the no-new-improvements gate separate from implementation sweeps that still find fixes. |
| 34 | Route schema decode cast cleanup | `packages/core/src/route.ts`; `packages/core/test/route-server.test.ts`; `packages/start/test/start.test.ts`; `packages/devtools/test/devtools.test.ts`; `docs/perfection-progress.md` | Removed the remaining raw `as any` function cast around route schema decoding and narrowed through `Schema.Decoder`. Focused route/Start/devtools tests plus workspace typecheck passed. | Keep broad sharp-edge sweeps running, but only treat no-op passes as clean sweeps. |
| 35 | Package pack dry-run verification | `docs/package-hygiene-audit.md`; package-local `pnpm pack --dry-run` commands | Refreshed workspace links with `pnpm install`, then package-local dry-run packs passed for core, db, devtools, start, solid, solid-db, and tsrx. | Keep recursive workspace pack out of the release signal until workspace protocol replacement is finalized. |
| 36 | Full verification after release hardening | `pnpm verify` | Package build, workspace typecheck, type tests, 35 package test files / 302 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed. | Use this as the latest green gate before starting clean no-op sweeps. |
| 37 | Package compiler-cache exclusion | `packages/*/tsconfig.json`; `docs/package-hygiene-audit.md`; `docs/perfection-progress.md`; package-local `pnpm pack --dry-run` commands | Moved package `tsBuildInfoFile` outputs out of `dist`, rebuilt packages, and reran all package-local dry-run packs. The payloads no longer include `.tsbuildinfo` compiler cache files. | Keep package-local dry-run packs in the release rehearsal checklist. |
| 38 | Native action concurrency alignment | `packages/core/src/action.ts`; `packages/start/src/index.ts`; `packages/core/test/action.test.ts`; `packages/start/test/start.test.ts`; `docs/effect-first-audit.md`; `pnpm verify` | `submitEffect` now uses the same tracked fiber concurrency model as public `submit`, so native Effect submissions honor `latest` interruption and `exhaust` joins. Focused core/StartAction tests, workspace typecheck, and full `pnpm verify` passed. | Continue Effect-first sweeps; this was another improvement sweep, not a clean no-op sweep. |
| 39 | Start handler type naming cleanup | `packages/start/src/vite.ts`; `type-tests/framework.test-d.ts`; `docs/public-api-inventory.md`; `docs/perfection-progress.md` | Renamed the Vite-only sync-or-async SSR module handler type to `StartSsrRequestHandler`, leaving the root `StartRequestHandler` as the Promise host-boundary handler returned by `createRequestHandler`. Workspace typecheck and focused Start handler tests passed. | Continue converting "needs decision" inventory notes into code or docs decisions. |
| 40 | ActionResult field-error cast cleanup | `packages/core/src/action-result.ts`; `packages/core/test/action-result.test.ts`; `docs/perfection-progress.md` | Replaced the double-cast construction of single-field validation failures with a typed `FormFieldErrors` object and added a regression test for `ActionResult.fieldError`. Focused ActionResult tests and workspace typecheck passed. | Keep reducing sharp casts when the local type model can express the value directly. |
| 41 | Project console Effect-first event handlers | `examples/project-console/src/App.tsx`; `docs/example-copyability-and-leak-audit.md`; `docs/perfection-progress.md` | Replaced UI-level Promise chains with a browser-boundary `runUiEffect` helper and Effect-native invalidation/action submissions. Example typecheck, 4 example test files / 23 tests, build, and leak scan passed. | Keep example code aligned with the framework style guide, not just functionally correct. |
| 42 | Public API release decisions | `docs/public-api-inventory.md`; `docs/perfection-progress.md` | Converted remaining "needs decision" API inventory notes into explicit release decisions for expert-public type IDs, runtime accessors, Vite helpers, SQLite/storage adapters, devtools data contracts, Solid re-exports, and the TSRX preset. | Re-open only concrete rename, hide, or docs tasks as future inventory findings. |
| 43 | Full verification after API and example cleanup | `pnpm verify`; `docs/perfection-progress.md` | Package build, workspace typecheck, type tests, 35 package test files / 307 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed after the latest API, core, and example cleanup stack. | Use this as the latest green checkpoint for subsequent sweeps. |
| 44 | Root README release entrypoint | `README.md`; `docs/perfection-progress.md` | Added the missing repository README with the framework purpose, start-here docs, verification commands, package map, and current release bar. | Keep README claims backed by docs, tests, or ledger evidence. |
| 45 | Final handoff docs drift refresh | `docs/ultimate-goal-checklist.md`; `docs/docs-drift-audit.md`; `docs/perfection-progress.md` | Updated final handoff evidence and drift audit scope to include the latest API, core, README, and example cleanup stack plus the 307-test full verification result. | Keep historical checkpoint counts only where they are explicitly historical. |
| 46 | Start CLI diagnostics guard | `packages/start/src/cli.ts`; `docs/perfection-progress.md` | Replaced the Start diagnostics CLI's trusted `error.diagnostics` cast with a structural app-graph diagnostics guard before rendering repair reports. Focused diagnostics CLI tests and workspace typecheck passed. | Keep dynamic error payloads guarded before turning them into agent-facing repair data. |
| 47 | Solid runtime default cast cleanup | `packages/solid/src/index.ts`; `docs/perfection-progress.md` | Replaced Solid adapter casts around the default runtime with `currentOrDefaultRuntime()` and direct `defaultRuntime` use. Solid package typecheck and workspace typecheck passed. | Continue removing casts where the runtime API already provides the shape. |
| 48 | Core default runtime cast cleanup | `packages/core/src/runtime.ts`; `docs/perfection-progress.md` | Removed the unnecessary `unknown` cast from `currentOrDefaultRuntime()` now that `defaultRuntime` is assignable to the helper's expert-public return type. Core package typecheck and workspace typecheck passed. | Leave only the runtime generic-boundary casts that are required by `ManagedRuntime` service erasure. |
| 49 | Persisted collection option cast narrowing | `packages/db/src/index.ts`; `docs/perfection-progress.md` | Replaced the whole-object persisted collection option cast with object reconstruction and a narrow policy cast for `Schedule` variance. DB package typecheck, workspace typecheck, and focused persistence tests passed. | Continue isolating unavoidable casts to the exact invariant field. |
| 50 | Query join result typing | `packages/db/src/index.ts`; `type-tests/framework.test-d.ts`; `docs/perfection-progress.md` | Tightened DB query join return types so unprojected joins expose the joined row context instead of the pre-join result shape. DB typecheck, workspace typecheck/type tests, and focused join tests passed. | Keep type tests around query builder shape changes; the remaining casts are now tied to builder context variance. |
| 51 | Query builder cast boundary consolidation | `packages/db/src/index.ts`; `docs/perfection-progress.md` | Centralized the query builder's join/grouping variance casts behind named helper methods instead of repeating them in each join path. DB typecheck, workspace typecheck, and focused join/grouping tests passed. | Treat these helpers as the documented variance boundary for future QueryBuilder changes. |
| 52 | Project console root error typing | `examples/project-console/src/main.tsx`; `docs/perfection-progress.md` | Replaced the example entrypoint's generic missing-root `Error` with a tagged `ProjectConsoleRootMissing` error carrying repair guidance. Example typecheck, build, leak scan, and raw `Error` grep passed. | Keep examples on the same tagged-error standard as package source. |
| 53 | Full verification after cast and example cleanup | `pnpm verify`; `docs/perfection-progress.md` | Package build, workspace typecheck, type tests, 35 package test files / 307 tests, example typecheck, 4 example test files / 23 tests, example build, and leak scan passed after the latest core, DB, Start CLI, and example cleanup stack. | Use this as the latest green checkpoint before the next sweep. |
| 54 | Sharp cast audit | `docs/sharp-cast-audit.md`; `docs/framework-perfection-charter.md`; `docs/perfection-progress.md`; sharp grep | Recorded the remaining package-source casts as runtime service-erasure and query context-variance boundaries, with the latest full verify as supporting evidence. | Treat new casts as findings unless they get an equally concrete boundary justification. |
| 55 | Node and fetch deployment guide | `docs/deployment.md`; `README.md`; `docs/ultimate-goal-checklist.md`; `docs/framework-perfection-charter.md`; `docs/perfection-progress.md`; `packages/start/test/adapters.test.ts` | Added deployment guidance for the tested `@effect-ui/start/adapters` Node and fetch surfaces, including current limits for host-specific packages and starter packaging. Focused adapter tests passed with localhost binding enabled: 1 file / 6 tests. | Keep host-specific recipes aligned with adapter tests as new packages land. |

## Thirty-Sweep Gate

The final goal requires 30 full code sweeps without finding more improvements.
This ledger records 30 implementation/audit sweeps, but it does not satisfy the
final no-new-improvements gate yet because the latest sweeps still found
actionable work. Start the clean-sweep counter only when a full code/docs/test
pass finds no improvements to make.

- Devtools UI/docs polish around the richer request trace teardown facts.
- Promise-shaped internals that can be pushed down into Effect programs.
- New error classes and repair guidance introduced by later work.
- Docs drift against current implementation.
- Golden-file snapshots for generated artifacts if inline assertions stop being
  enough.

## Open Release-Candidate Slices

1. Turn the devtools panel model into an actual browser/app UI when product
   surface work resumes.
2. Re-run the public API inventory after any rename/removal work and update
   migration notes.
3. Run full `pnpm verify` and record the result before any handoff that claims
   release-candidate status.
4. After the remaining release-candidate slices stabilize, run the required
   no-new-improvements clean-sweep sequence.
