# Effect-First Audit

Last updated: 2026-05-14.

This audit supports the charter rule: push async lifecycle, teardown, tracing,
retry, streaming, and adapter work down into Effect primitives wherever
possible. Promises are acceptable at host boundaries and public convenience
APIs; framework internals should prefer `Effect`, `Fiber`, `Scope`, and
Effect-native interruption.

## Classification

| Class | Rule | Examples |
| --- | --- | --- |
| Host boundary | Promise is acceptable because the platform API requires it. | Web Stream `pull`/`cancel`, Vite middleware, Node/fetch adapters, public browser callbacks. |
| Public convenience | Promise is acceptable when an Effect-first API exists beside it. | `Resource.prefetch(...)` beside `Resource.prefetchEffect(...)`, `createRequestHandler(...)` beside `createRequestHandlerEffect(...)`. |
| Internal follow-up | Convert to Effect unless there is a concrete host-boundary reason. | Promise state machines, `.then(...)` lifecycle sequencing, unstructured async helpers. |

## Current Sweep Results

- `packages/start/src/index.ts`
  - Kept Web Stream `pull` and `cancel` as host-boundary async callbacks.
  - Moved response stream pull, cancel, error, and finalization lifecycle into
    Effect programs that the Web Stream host callbacks run through the request
    runtime.
  - Runtime disposal and request trace emission happen from the same
    `disposeEffect` finalizer.
  - Added trace tests for response stream close, cancellation, and request
    failure paths.
- `packages/core/src/runtime.ts`
  - Replaced Promise `.then(...)` disposal sequencing with a single
    `disposeEffect` run from the public `dispose()` host-boundary method.
- `packages/db/src/index.ts`
  - Replaced live-query collection `Promise.resolve(...)` no-ops with
    `runPromise(definition.*Effect(...))` so public Promise helpers still
    delegate to Effect-native methods.
- `packages/solid/src/index.ts`
  - Replaced unmatched router preload `Promise.resolve()` with
    `runtime.runPromise(Effect.void)` so the public Promise path stays behind
    the runtime boundary.
- `type-tests/framework.test-d.ts`
  - Added structural compatibility coverage from `StartRequestTrace` to
    `DevtoolsRequestTrace`, keeping Start independent of devtools while still
    proving the emitted data contract.
- `packages/core/src/stable-stringify.ts`
  - Replaced repeated-reference `WeakSet` tracking with active-path tracking.
    The implementation now permits shared acyclic references and reports true
    cycles with a typed error that carries both paths.
- `packages/core/src/resource.ts`
  - Replaced Promise `.then(...)` in public Resource in-flight dedupe with an
    Effect fiber record.
  - Runtime disposal, hydration, and resource deletion now interrupt tracked
    public prefetch/refresh fibers instead of only clearing a Promise handle.
- `packages/core/src/action.ts` and `packages/start/src/index.ts`
  - Replaced public action submit `Promise.finally(...)` cleanup with tokened
    in-flight submission records and `Effect.ensuring`.
  - Stale action fibers can no longer clear newer submissions, and reset still
    interrupts the tracked fiber.
  - Native `submitEffect` calls now participate in the same tracked submission
    fiber model as public `submit` calls, including `latest` interruption and
    `exhaust` joining semantics.
- `packages/solid/src/index.ts` and `packages/solid-db/src/index.ts`
  - Moved router preload completion, background resource preload, collection
    preload, and live-query preload error handling into Effect programs before
    crossing the Solid/browser `runPromise` boundary.
- `packages/start/src/cli.ts`
  - Moved the diagnostics CLI parse/load/render path into
    `runStartDiagnosticsCliEffect`.
  - The Promise-returning CLI helpers now only run that Effect program at the
    bin/host boundary.
- `packages/start/src/vite.ts`
  - Moved the app graph diagnostics loader's create-server/load-module/close
    lifecycle into `loadStartAppGraphDiagnosticsRawEffect`.
  - The Promise API now runs that Effect program, while
    `loadStartAppGraphDiagnosticsEffect` maps failures into
    `StartAppGraphDiagnosticsRunnerError`.
- `scripts/package-project-console-starter.mjs`
  - Replaced the remaining raw async path-existence adapter with
    `Effect.tryPromise`, `Effect.as`, and typed `ENOENT` handling.

## Remaining Promise Sites To Review

- `packages/solid/src/index.ts`
  - Uses Promises at Solid/browser boundaries for preload, suspense throws, and
    ignored background prefetches. Keep only where Solid expects a Promise.
- `packages/db/src/index.ts`
  - Most Promise methods delegate to `*Effect` APIs. Continue reviewing
    fire-and-forget write helpers for whether they should expose Effect-first
    error observation.
- `packages/start/src/vite.ts` and `packages/start/src/adapters.ts`
  - Promise use is mostly Vite, Node, and fetch host-boundary work. Keep
    auditing any helper that can become an Effect program before it crosses the
    host boundary.
- `packages/start/src/cli.ts`
  - Remaining Promise helpers are bin-entry wrappers over
    `runStartDiagnosticsCliEffect` and `runStartDiagnosticsCliMainEffect`.
- Tooling scripts:
  - The project-console starter packaging script keeps filesystem checks inside
    Effect programs; no raw async or Promise method chains remain there.
- Source grep follow-up:
  - `rg -n "Promise\\.resolve\\(|new Promise|\\.then\\(|\\.finally\\(" packages/*/src -g '*.ts'`
    currently finds no package source hits.
  - `rg -n "\\.catch\\(" packages/*/src -g '*.ts' | rg -v "Effect\\.catch"`
    currently finds no package source hits.

## Verification Evidence

- `pnpm exec vitest run packages/core/test/runtime.test.ts packages/start/test/start.test.ts`
  passed after the first cleanup pass.
- `pnpm exec vitest run packages/db/test/live-query-collection.test.ts packages/solid-db/test/solid-db.test.ts`
  passed after replacing no-op Promise helpers.
- `pnpm exec vitest run packages/core/test/stable-stringify.test.ts packages/db/test/server-collection.test.ts packages/db/test/sqlite-persistence.test.ts packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`
  passed after the typed-error sweep.
- `pnpm verify` passed after the typed-error sweep: package build, workspace
  typecheck, type tests, 34 package test files / 298 tests, example typecheck,
  4 example test files / 23 tests, example build, and leak scan.
- `pnpm exec vitest run packages/core/test/resource.test.ts` passed after the
  Resource in-flight fiber sweep: 1 file, 24 tests.
- `pnpm typecheck` passed after the Resource in-flight fiber sweep.
- `pnpm verify` passed after the Resource in-flight fiber sweep: package build,
  workspace typecheck, type tests, 34 package test files / 300 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.
- `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts packages/start/test/start.test.ts packages/solid-db/test/solid-db.test.ts`
  passed after the Promise-method cleanup: 4 files, 92 tests.
- `pnpm typecheck` passed after the Promise-method cleanup.
- `pnpm verify` passed after the Promise-method cleanup: package build,
  workspace typecheck, type tests, 34 package test files / 300 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.
- `pnpm exec vitest run packages/core/test/action.test.ts` passed after the
  native action concurrency sweep: 1 file, 18 tests.
- `pnpm exec vitest run packages/start/test/start.test.ts -t "StartAction"`
  passed after the native StartAction concurrency sweep: 1 file, 2 selected
  tests.
- `pnpm typecheck` passed after the native action concurrency sweep.
- `pnpm verify` passed after the native action concurrency sweep: package
  build, workspace typecheck, type tests, 35 package test files / 306 tests,
  example typecheck, 4 example test files / 23 tests, example build, and leak
  scan.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/start.test.ts -t "Start diagnostics
  CLI"` passed after the CLI Effect runner sweep.
- `pnpm exec vitest run packages/start/test/start.test.ts`, `pnpm typecheck`,
  and full `pnpm verify` passed after the CLI Effect runner sweep.
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm exec vitest run packages/start/test/start.test.ts -t "stream"`, and
  `pnpm exec vitest run packages/start/test/start.test.ts` passed after moving
  response stream pull/cancel lifecycle into Effect programs.
- Full `pnpm verify` passed after moving response stream pull/cancel lifecycle
  into Effect programs.
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm exec vitest run packages/start/test/start.test.ts -t "diagnostics
  through Vite"`, and `pnpm exec vitest run packages/start/test/start.test.ts`
  passed after moving the Vite diagnostics loader lifecycle under Effect.
- Full `pnpm verify` passed after moving the Vite diagnostics loader lifecycle
  under Effect.
- `pnpm starter:project-console:package` passed after replacing the starter
  packaging path-existence adapter with an Effect program.
- Full `pnpm verify` passed after replacing the starter packaging
  path-existence adapter with an Effect program.
