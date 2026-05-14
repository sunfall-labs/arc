# Effect-First Audit

Last updated: 2026-05-14.

This audit supports the charter rule: push async lifecycle, teardown, tracing,
retry, streaming, and adapter work down into Effect primitives wherever
possible. Promises are acceptable only at host/platform boundaries; public
framework APIs should return `Effect` so callers decide where to run them.
Framework internals should prefer `Effect`, `Fiber`, `Scope`, and Effect-native
interruption.

## Classification

| Class | Rule | Examples |
| --- | --- | --- |
| Host boundary | Promise is acceptable because the platform API requires it. | Web Stream `pull`/`cancel`, Vite callback launchers, browser callbacks, test assertions over platform `Response` methods. |
| Host runner | Convert an Effect to a Promise only at the final host/test edge. | `runtime.runPromise(handler(request))`, `Effect.runPromise(Resource.prefetchEffect(ref))`. |
| Public API | Return Effects for async work; callers choose where to run them. | `Resource.prefetchEffect(...)`, `action.submitEffect(...)`, `createRequestHandler(...)`. |
| Internal follow-up | Convert to Effect unless there is a concrete host-boundary reason. | Promise state machines, `.then(...)` lifecycle sequencing, unstructured async helpers. |

## Current Sweep Results

- `packages/start/src/index.ts`
  - Kept Web Stream `pull` and `cancel` as host-boundary async callbacks.
  - Moved response stream pull, cancel, error, and finalization lifecycle into
    Effect programs that the Web Stream host callbacks run through the request
    runtime.
  - Request-runtime provision, request-handler Promise wrappers, StartAction
    fiber joins/workflow launches, and stream pull/cancel programs now hand
    Effects directly to runtime/Effect primitives instead of adding local
    requirement-erasure casts.
  - RPC and action request-runtime failures are handled inside the Effect
    pipeline as protocol defect responses, and action response hydration uses
    Effect error handling to convert runtime provision failures to defects.
  - Runtime disposal and request trace emission happen from the same
    `disposeEffect` finalizer.
  - Added trace tests for response stream close, cancellation, and request
    failure paths.
- `packages/start/src/hydration.ts`
  - Hydration sync helpers now run schema/collection hydration Effects directly
    through the selected runtime without local requirement erasure.
  - Public hydration runtime options are typed as opaque
    `EffectUiRuntime<unknown, unknown>` values because hydration does not depend
    on caller-specific runtime service or error details.
- `packages/core/src/runtime.ts`
  - Replaced Promise `.then(...)` disposal sequencing with a single
    `disposeEffect` program owned by the runtime boundary.
  - `EffectUiRuntime.provide(...)` now exposes a scoped Effect backed by a named
    `provideRuntimeServices(...)` boundary, so UI adapters can fork provided
    work under `UiScope` instead of erasing requirements locally.
  - Top-level `runPromise`, `runPromiseExit`, and `runFork` helpers now pass the
    input Effect directly to the active runtime boundary.
  - ManagedRuntime service erasure is now named at the
    `ManagedRuntime<any, ER>` value boundary, so runtime helpers no longer cast
    provided Effect programs.
- `packages/core/src/effect-like.ts`, `packages/core/src/form.ts`,
  `packages/core/src/server.ts`, and `packages/start/src/index.ts`
  - EffectInput conversion preserves existing Effect generics through the
    overloaded `isEffectLike(...)` guard, PromiseLike conversion maps the
    resolved value instead of casting the whole Effect, and schema helpers assert
    decoder/encoder views at the schema boundary instead of asserting Effect
    program shapes.
  - EffectInput type helpers use `unknown` wildcards instead of `any`, runtime
    service-erasure helpers return `unknown` requirements, and Resource
    invalidation Effects expose a generic requirement parameter for refreshed
    refs instead of hard-coding `any`.
  - Server, Route, Capability, DB collection/query aggregate, and Start action
    result extraction helpers now use inferred placeholder type parameters
    instead of `any` placeholders.
  - Arbitrary Action, Server, Resource family, and collection transaction
    boundaries are named through local `Any*` aliases instead of repeated inline
    wildcard type applications.
- `packages/core/src/route.ts`, `packages/core/src/app.ts`,
  `packages/solid/src/index.ts`, `packages/start/src/index.ts`, and
  `packages/start/src/virtual-modules.d.ts`
  - Arbitrary route lists and route helper constraints now carry params/search
    as opaque `unknown` values while preserving concrete route inference through
    the returned helper types.
- `packages/db/src/index.ts`
  - Removed live-query collection convenience methods that returned Promises;
    the public collection surface now exposes the Effect-native operations
    directly.
- `packages/db/src/sync-adapter.ts`, `packages/db/src/sqlite-persistence.ts`,
  `packages/db/src/flush-policy.ts`, and `packages/db/src/server-collection.ts`
  - Adapter EffectInput conversions now stay in typed helpers and Effect
    combinators. Server collection PromiseLike support is isolated behind a
    named bridge before entering the collection sync adapter path.
- `packages/db/src/index.ts`
  - Collection persistence, restore, load, mutation handlers, change-feed
    subscriptions, live-query persistence, and source preloads now reuse
    `collectionInputEffect(...)` or direct Effect combinators instead of local
    requirement-erasure casts.
- `packages/core/src/effect-like.ts`, `packages/core/src/route.ts`, and
  `packages/core/src/server.ts`
  - Effect-input and route preload helpers now hand converted Effects directly to
    Effect/runtime APIs.
  - Server local/mock client calls preserve function requirements in the returned
    Effect, keeping server test/local work inside the Effect service model.
- `packages/solid/src/index.ts`
  - Replaced unmatched router preload `Promise.resolve()` with an Effect no-op
    run through the active runtime boundary.
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
  - Public prefetch/refresh, in-flight `Fiber.join`, and stale refresh paths now
    pass Effects directly through the runtime boundary without local requirement
    erasure.
- `packages/core/src/action.ts` and `packages/start/src/index.ts`
  - Replaced public action submit `Promise.finally(...)` cleanup with tokened
    in-flight submission records and `Effect.ensuring`.
  - Stale action fibers can no longer clear newer submissions, and reset still
    interrupts the tracked fiber.
  - Native `submitEffect` calls now participate in the same tracked submission
    fiber model as public `submit` calls, including `latest` interruption and
    `exhaust` joining semantics.
  - Core Action now delegates `Fiber.join`, workflow fibers, and reset
    interruption to the runtime boundary without per-call `Effect.Effect`
    assertions.
  - Start action client options now accept an opaque
    `EffectUiRuntime<unknown, unknown>` because the client boundary only needs
    to run/provide hydration and invalidation Effects.
  - Start collection trace, request-runtime teardown, response finalizer, and
    response completion helpers now accept opaque runtimes because they only
    inspect resource-store state or execute already-built cleanup Effects.
- `packages/core/src/scope.ts` and `packages/core/src/signal.ts`
  - Scope finalizers, scoped forks, and `Signal.watch(...)` use Effect's own
    Scope and `EffectInput` typing directly, without local Effect assertions.
  - `UiScope` now creates its closeable Effect scope through
    `Effect.runSync(Scope.make("sequential"))` instead of calling
    `Scope.makeUnsafe(...)` directly.
- `packages/solid/src/index.ts` and `packages/solid-db/src/index.ts`
  - Moved router preload completion, background resource preload, collection
    preload, and live-query preload error handling into Effect programs before
    crossing the Solid/browser `runPromise` boundary.
  - Solid Resource and Solid-DB collection/live-query helpers now pass the
    underlying `*Effect` operations directly to the active runtime.
  - Solid Resource hook requirement defaults now use `unknown`, and route outlet
    internals use record/unknown-shaped UI boundaries instead of `Component<any>`
    or `value: any`.
  - Solid runtime provider/router props, the runtime context, `useRuntime()`,
    and the Solid-DB collection subscription helper now use opaque
    runtime/source types outside the core ambient runtime boundary.
- `packages/devtools/src/index.ts`
  - Devtools action-state recording accepts opaque Action state/instance
    generics when it only reads names, state tags, inputs, and invalidation
    plans.
  - Panel HTML rendering, DOM mount/update/unmount behavior, and the
    Effect-scoped panel mount helper now delegate to
    `packages/devtools/src/panel-renderer.ts`, keeping browser UI lifecycle work
    behind a focused renderer module.
  - Scoped inspected-window bridge install/uninstall behavior now delegates to
    `packages/devtools/src/bridge.ts`, keeping bridge cleanup behind an
    Effect-scoped module.
  - Store mutation/subscription recording and panel projection now delegate to
    `packages/devtools/src/store.ts` and `packages/devtools/src/panels.ts`, so
    the root facade exposes the same public contracts with smaller internal
    modules.
  - Serialization, invalidation plan projection, route-plan projection, and
    defensive request-trace copies now delegate to
    `packages/devtools/src/serialization.ts`, keeping JSON-safe devtools
    contracts separate from live runtime objects.
  - Snapshot summary projection, request-trace summaries, app-graph summaries,
    and causal graph construction now delegate to
    `packages/devtools/src/summary.ts`, keeping derived inspection facts behind
    a focused module.
- `packages/db/src/live-query-runtime.ts`
  - Live-query source preload/refetch loops and the incremental IVM runtime now
    live behind a focused runtime module. Query callers still receive Effect
    preload/refetch operations from the DB root facade.
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
  - Moved Vite dev middleware request conversion, SSR handler loading,
    response writing, and error forwarding into `handleSsrDevMiddlewareEffect`;
    the Vite middleware callback now only launches that Effect program.
- `packages/start/src/start-transport-protocol.ts`
  - Start RPC and Start Action JSON/form decoding, response shaping, schema
    encode/decode, failure classification, invalidation payload serialization,
    and client response parsing now live in a focused Effect-native transport
    protocol module.
  - The Start root request handler now delegates wire-level protocol work to
    that module and keeps orchestration around Request Runtime provisioning,
    tracing, SSR preload, and response lifecycle.
- `packages/start/src/adapters.ts`
  - Node handler Promise entrypoints now use the core runtime helper for handler
    Effects rather than casting the input to raw `Effect.runPromise(...)`.
- `scripts/package-project-console-starter.mjs`
  - Replaced the remaining raw async path-existence adapter with
    `Effect.tryPromise`, `Effect.as`, and typed `ENOENT` handling.
  - The CLI entrypoint now reports success and failure from inside the Effect
    pipeline instead of using a top-level `try`/`catch` around
    `Effect.runPromise(...)`.
- `examples/project-console/src/App.tsx`
  - UI fire-and-forget effects now use a generic runtime helper and
    `Effect.catch(...)` directly instead of erasing Effect errors and
    requirements at each call site.
  - The example UI helper accepts an opaque runtime when it deliberately
    observes no runtime-specific service or error detail.
- Test and example host-boundary helpers
  - Replaced remaining low-friction `Promise.resolve(...)`, `.then(...)`,
    `.catch(...)`, and `.finally(...)` test conveniences with Effect-backed
    helpers or direct `await`.
  - Replaced type-test Promise method syntax with declared Promise values so
    compile-time host-boundary assertions no longer look like runtime Promise
    choreography.
  - Replaced type-test `async` negative cases with declared Promise values, so
    the type suite still rejects Promise-returning framework callbacks without
    embedding async callback syntax.
  - Node server/listener and timer adapter-test helpers now use
    `Effect.callback(...)` and `Effect.sleep(...)`; no raw `new Promise(...)`
    helpers remain in the checked source, examples, scripts, or type tests.

## Remaining Promise Sites To Review

- `packages/solid/src/index.ts`
  - Uses Promises at Solid/browser boundaries for preload, suspense throws, and
    ignored background prefetches. Keep only where Solid expects a Promise.
- `packages/db/src/index.ts`
  - Collection load, refetch, flush, persistence, restore, live-query preload,
    and mutations expose `*Effect` APIs so callers keep error observation and
    runtime selection in Effect.
- `packages/start/src/vite.ts` and `packages/start/src/adapters.ts`
  - Promise use is Vite, Node, and fetch host-boundary work. Keep any future
    helper as an Effect program before it crosses the host boundary.
- `packages/start/src/cli.ts`
  - The bin entry runs the Effect-native CLI program at the process boundary:
    `runStartDiagnosticsCliEffect` and `runStartDiagnosticsCliMainEffect`.
- `packages/start/test/adapters.test.ts`
  - Node listener/close and timer test helpers use `Effect.callback(...)` and
    `Effect.sleep(...)` instead of raw `new Promise(...)` wrappers.
- Tooling scripts:
  - The project-console starter packaging script keeps filesystem checks inside
    Effect programs; no raw async or Promise method chains remain there.
- Source grep follow-up:
  - `rg -n "\\basync\\b|new Promise|Promise\\.resolve|\\.then\\(|\\.finally\\(" packages/*/src scripts -g '*.ts' -g '*.mjs'`
    currently finds no package source or tooling script hits.
  - `rg -n "\\.catch\\(" packages/*/src scripts -g '*.ts' -g '*.mjs' | rg -v "Effect\\.catch"`
    currently finds no non-Effect catch hits.
  - `rg -n "\\.catch\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs' | rg -v "Effect\\.catch"`
    currently finds no direct Promise catch hits outside the docs that record
    historical evidence.
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts -g '*.ts' -g '*.tsx' -g '*.mjs'`
    currently finds no package, example, or script hits.
  - `rg -n "new Promise|Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
    currently reports no hits.
  - `rg -n "Promise\\.all|Promise\\.race|Promise\\.resolve|new Promise|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
    currently reports no hits.
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
    currently finds no hits outside the docs that record historical evidence.

## Verification Evidence

- `pnpm exec vitest run packages/core/test/runtime.test.ts packages/start/test/start.test.ts`
  passed after the first cleanup pass.
- `pnpm exec vitest run packages/db/test/live-query-collection.test.ts packages/solid-db/test/solid-db.test.ts`
  passed after replacing no-op Promise wrappers with Effect operations.
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
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm exec vitest run packages/start/test/start.test.ts -t "Vite dev
  middleware"`, and `pnpm exec vitest run packages/start/test/start.test.ts`
  passed after moving the Vite dev middleware body into an Effect program.
- Full `pnpm verify` passed after moving the Vite dev middleware body into an
  Effect program.
- `pnpm exec vitest run packages/start/test/adapters.test.ts packages/solid-db/test/solid-db.test.ts packages/db/test/server-collection.test.ts packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
  passed after replacing remaining test Promise-method conveniences: 5 files,
  73 tests.
- `pnpm typecheck` passed after replacing remaining test Promise-method
  conveniences.
- Full `pnpm verify` passed after replacing remaining test Promise-method
  conveniences.
- `pnpm typecheck:types` passed after replacing type-test Promise method syntax
  with declared Promise values.
- Full `pnpm verify` passed after replacing type-test Promise method syntax: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm exec vitest run packages/core/test/action.test.ts packages/start/test/adapters.test.ts examples/project-console/src/domain.mock.test.ts`
  passed after replacing remaining direct Promise catch suppression in tests: 3
  files, 32 tests.
- `pnpm typecheck` passed after replacing remaining direct Promise catch
  suppression in tests.
- Full `pnpm verify` passed after replacing remaining direct Promise catch
  suppression in tests: 9 package builds, workspace typecheck, type tests, 38
  root test files / 320 tests, devtools-panel verify, devtools-extension verify
  with 1 extension test file / 6 tests, basic starter verify, project-console
  starter packaging, project-console typecheck, 4 project-console test files /
  23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/start/test/adapters.test.ts packages/start/test/start.test.ts -t "hydration|adapter|Node|fetch|StartAction|stream|request handler"`
  passed after removing Start runtime call-site casts: 2 files, 20 selected
  tests.
- Full `pnpm verify` passed after removing Start runtime call-site casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm --filter @effect-ui/example-project-console typecheck`, and
  `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts examples/project-console/src/*.test.ts -t "server function|RPC|action|StartAction|request handler|hydration|adapter|App"`
  passed after the Start runtime-boundary and project-console UI effect cast
  cleanup: 7 files, 42 selected tests.
- Full `pnpm verify` passed after the Start runtime-boundary and example UI
  effect cleanup: 9 package builds, workspace typecheck, type tests, 38 root
  test files / 320 tests, devtools-panel verify, devtools-extension verify with
  1 extension test file / 6 tests, basic starter verify, project-console
  starter packaging, project-console typecheck, 4 project-console test files /
  23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm --filter @effect-ui/start
  typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`,
  and
  `pnpm exec vitest run packages/core/test/server.test.ts packages/core/test/form.test.ts packages/core/test/runtime.test.ts packages/core/test/route-server.test.ts packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
  passed after the broad sharp-cast cleanup: 9 files, 135 tests.
- Full `pnpm verify` passed after the broad sharp-cast cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/runtime.test.ts packages/core/test/resource.test.ts packages/core/test/action.test.ts packages/core/test/scope.test.ts packages/core/test/server.test.ts`
  passed after moving runtime service erasure to the ManagedRuntime value
  boundary: 5 files, 55 tests.
- Full `pnpm verify` passed after the final broad sharp-cast sweep: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm starter:project-console:package` passed after moving the starter
  packaging script entrypoint reporting into the Effect pipeline.
- Full `pnpm verify` passed after moving the starter packaging script entrypoint
  reporting into Effect: 9 package builds, workspace typecheck, type tests, 38
  root test files / 320 tests, devtools-panel verify, devtools-extension verify
  with 1 extension test file / 6 tests, basic starter verify,
  project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/runtime.test.ts packages/core/test/resource.test.ts packages/core/test/action.test.ts packages/core/test/scope.test.ts packages/core/test/server.test.ts`
  passed after removing explicit `Effect.Effect<..., any>` annotations: 5 files,
  55 tests.
- Full `pnpm verify` passed after the explicit Effect-any cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/solid typecheck` and `pnpm typecheck:types` passed
  after tightening Solid Resource hook requirement defaults and route outlet UI
  wildcard types.
- Full `pnpm verify` passed after the Solid UI wildcard cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm --filter @effect-ui/example-project-console typecheck` passed after
  tightening opaque Start hydration/action runtime options and the
  project-console UI helper from `any` to `unknown`.
- Full `pnpm verify` passed after the opaque runtime option wildcard cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm --filter @effect-ui/solid typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`, and `pnpm typecheck:types`
  passed after tightening Start trace/finalizer helpers, Solid runtime
  provider/router surfaces, `useRuntime()`, and the Solid-DB subscription helper
  to opaque runtime/source types. The only remaining
  `EffectUiRuntime<any, any>` source hits are the core ambient runtime accessors
  that preserve caller error typing for `runFork`, `runPromiseExit`, and
  resource/action workflows.
- Full `pnpm verify` passed after the runtime helper wildcard cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/db typecheck`,
  `pnpm --filter @effect-ui/devtools typecheck`,
  `pnpm --filter @effect-ui/solid typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`,
  `pnpm --filter @effect-ui/start typecheck`, and `pnpm typecheck:types`
  passed after replacing ignored `any` placeholders with inferred parameters,
  moving arbitrary route constraints to `unknown`, and tightening read-only
  devtools action recording. The conditional-helper placeholder grep now reports
  no hits.
- Full `pnpm verify` passed after the conditional helper and route wildcard
  cleanup: 9 package builds, workspace typecheck, type tests, 38 root test files
  / 320 tests, devtools-panel verify, devtools-extension verify with 1 extension
  test file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm exec vitest run packages/core/test/scope.test.ts packages/core/test/signal.test.ts`,
  and `pnpm typecheck:types` passed after replacing direct `Scope.makeUnsafe`
  usage with `Scope.make(...)` run through Effect.
- Full `pnpm verify` passed after the `UiScope` creation primitive cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm typecheck:types` passed after replacing type-test `async` negative
  cases with declared Promise values. The async/Promise-method grep over
  package source, scripts, and type tests now reports no hits.
- Full `pnpm verify` passed after the type-test async callback cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/db typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`,
  `pnpm --filter @effect-ui/start typecheck`, and `pnpm typecheck:types` passed
  after naming arbitrary Action, Server, Resource family, and collection
  transaction wildcard boundaries.
- Full `pnpm verify` passed after the named arbitrary wildcard boundary cleanup:
  9 package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/*.test.ts` passed after naming the DB
  query engine's heterogeneous row/context wildcard boundaries.
- Full `pnpm verify` passed after the DB query wildcard boundary cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/runtime.test.ts packages/core/test/signal.test.ts packages/db/test/collection.test.ts`
  passed after naming optimistic signal patch storage, ambient runtime
  service-erasure, and DB collection retry wildcard boundaries.
- Full `pnpm verify` passed after the core runtime and signal wildcard boundary
  cleanup: 9 package builds, workspace typecheck, type tests, 38 root test files
  / 320 tests, devtools-panel verify, devtools-extension verify with 1 extension
  test file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck`,
  `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/sync-adapter.test.ts packages/start/test/streaming.test.ts`
  passed after removing the last test-only `as Effect.Effect` assertions. The
  broad sharp-cast grep over packages, examples, scripts, and type tests now
  reports no hits.
- Full `pnpm verify` passed after the test sharp Effect assertion cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/db typecheck`,
  `pnpm --filter @effect-ui/solid typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`,
  `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts packages/core/test/signal.test.ts packages/core/test/scope.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts packages/start/test/start.test.ts packages/start/test/adapters.test.ts`
  passed after moving package-source fire-and-forget effects from floating
  Promise runners to detached fibers. The package-source `void runPromise` grep
  now reports no hits.
- Full `pnpm verify` passed after the package fire-and-forget Promise cleanup:
  9 package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/example-devtools-panel verify`,
  `pnpm --filter @effect-ui/example-devtools-extension verify`, and
  `pnpm --filter @effect-ui/example-project-console typecheck` passed after
  moving remaining example fire-and-forget effects to detached fibers. The
  package/example/script/type-test `void runPromise` grep now reports no hits.
- Full `pnpm verify` passed after the example fire-and-forget Promise cleanup:
  9 package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/start/test/adapters.test.ts` passed after
  replacing Start adapter test `new Promise(...)` listener/timer helpers with
  `Effect.callback(...)` and `Effect.sleep(...)`.
- Full `pnpm verify` passed after the adapter test Promise helper cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/solid-db/test/solid-db.test.ts packages/core/test/scope.test.ts packages/core/test/resource-store.test.ts`
  passed after converting small async test wrappers to returned
  `Effect.runPromise(...)` programs.
- Full `pnpm verify` passed after the small async test wrapper cleanup: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/solid typecheck`, and
  `pnpm exec vitest run packages/core/test/capability.test.ts packages/core/test/server.test.ts packages/solid/test/router.test.ts`
  passed after converting Capability, Server contract, and Solid router tests
  to returned Effect programs with assertions in `Effect.sync(...)` and cleanup
  in Effect finalizers. The Solid router effect now reads previous state with
  `untrack(...)` so its own state updates do not relaunch preloads, and the
  Solid router test explicitly loads Solid's browser build for its happy-dom
  client-router coverage.
- Full `pnpm verify` passed after the core/Solid async test boundary cleanup:
  9 package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck` and
  `pnpm exec vitest run packages/core/test/runtime.test.ts` passed after
  converting Effect UI runtime tests to returned Effect programs. Public
  Promise boundaries under test stay behind `Effect.promise(...)`, while
  runtime disposal now runs through `Effect.ensuring(...)`.
- Full `pnpm verify` passed after the core runtime async test cleanup: 9 package
  builds, workspace typecheck, type tests, 39 root test files / 321 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck` and
  `pnpm exec vitest run packages/core/test/signal.test.ts` passed after
  converting Signal stream tests to returned scoped Effect programs with
  assertions inside `Effect.sync(...)`.
- Full `pnpm verify` passed after the core Signal async test cleanup: 9 package
  builds, workspace typecheck, type tests, 39 root test files / 321 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck` and
  `pnpm exec vitest run packages/core/test/form.test.ts` passed after
  converting Form validation tests to returned Effect programs. Success and
  failure assertions now run inside `Effect.sync(...)`, with expected validation
  failures captured through `Effect.exit(...)`.
- Full `pnpm verify` passed after the core Form async test cleanup: 9 package
  builds, workspace typecheck, type tests, 39 root test files / 321 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck` and
  `pnpm exec vitest run packages/core/test/action-result.test.ts` passed after
  converting ActionResult tests to returned Effect programs. Expected
  success-channel exits are captured through `Effect.exit(...)`, and public
  Action/Resource Promise boundaries under test stay behind
  `Effect.promise(...)`.
- Full `pnpm verify` passed after the core ActionResult async test cleanup: 9
  package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck` and
  `pnpm exec vitest run packages/core/test/route-server.test.ts` passed after
  converting route preload/navigation and Server contract tests to returned
  Effect programs. Public route/server/Response Promise APIs under test stay
  behind `Effect.promise(...)`, and expected schema failures are captured
  through `Effect.exit(...)`.
- Full `pnpm verify` passed after the core route/server async test cleanup: 9
  package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/action-manifest.test.ts packages/start/test/server-function-manifest.test.ts`
  passed after converting Start manifest tests to returned Effect programs.
  Duplicate, parse, and unsafe-client-reference failures now stay behind
  `Effect.exit(...)`, with manifest assertions inside `Effect.sync(...)`.
- Full `pnpm verify` passed after the Start manifest async test cleanup: 9
  package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/route-manifest.test.ts packages/start/test/file-routes.test.ts`
  passed after converting route-manifest and file-route manifest tests to
  returned Effect programs. Parse and duplicate failures now stay behind
  `Effect.exit(...)`, with artifact assertions inside `Effect.sync(...)`.
- Full `pnpm verify` passed after the Start route/file-route async test cleanup:
  9 package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/server-collection.test.ts` passed
  after converting server-collection tests to returned Effect programs. Public
  collection Promise APIs under test stay behind `Effect.promise(...)`, with
  payload assertions inside `Effect.sync(...)`.
- Full `pnpm verify` passed after the DB server-collection async test cleanup:
  9 package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/live-query-collection.test.ts` passed
  after converting live-query collection tests to returned Effect programs.
  Read-only mutation rejection is captured through `Effect.tryPromise(...)` and
  `Effect.exit(...)`.
- Full `pnpm verify` passed after the DB live-query collection async test
  cleanup: 9 package builds, workspace typecheck, type tests, 39 root test
  files / 321 tests, devtools-panel verify, devtools-extension verify with 1
  extension test file / 6 tests, basic starter verify, project-console starter
  packaging, project-console typecheck, 4 project-console test files / 23
  tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/persisted-options.test.ts` passed
  after converting persisted-options tests to returned Effect programs.
  Runtime-specific Promise boundaries now sit behind `Effect.promise(...)`,
  optimistic mutation work uses `runtime.runFork(...)` plus `Fiber.join(...)`,
  and teardown is handled by Effect finalizers.
- Full `pnpm verify` passed after the DB persisted-options async test cleanup:
  9 package builds, workspace typecheck, type tests, 39 root test files / 321
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/sqlite-persistence.test.ts` passed
  after converting SQLite persistence tests to returned Effect programs. Storage
  `EffectInput` operations now run through `toEffect(...)`, runtime-specific
  collection round trips stay behind `Effect.promise(...)`, and teardown uses
  Effect finalizers.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/rpc.test.ts` passed after
  converting Start RPC protocol tests to returned Effect programs. Platform JSON
  parsing is isolated behind `Effect.tryPromise(...)`; transport success and
  failure assertions now stay inside Effect pipelines.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/streaming.test.ts` passed after
  converting Start streaming tests to returned Effect programs. Stream
  collection, sequencing, typed failure, and interruption checks now stay inside
  Effect pipelines; `Response.text()` remains the host Promise seam.
- Full `pnpm verify` passed after the internal module extraction and request
  failure diagnostics slice. Resource lifetime/dependency helpers, DB
  collection state/mutation/persistence/query planning, Start request
  runtime/trace/fetch, and Vite manifest/virtual-module helpers now live behind
  focused modules while public entrypoints stay Effect-first. The gate covered
  9 package builds, workspace typecheck, type tests, 39 root test files / 322
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/app-graph.test.ts` passed after
  converting Start app-graph tests to returned Effect programs. Manifest
  construction now composes Effects directly, policy failures are captured with
  `Effect.exit(...)`, and the file no longer uses async wrappers or Promise
  matcher assertions.
- `pnpm typecheck` and focused Core/Start tests passed after adding
  `Resource.requestFamily`, Effect-native Start request metrics/spans, and the
  additive Effect RPC compatibility descriptor layer. New tests that touch the
  added public surface return Effect programs and isolate host Promise reads
  with `Effect.tryPromise(...)`.
- Full `pnpm verify` passed after the Resource RequestResolver and Start Effect
  observability slice: 9 package builds, workspace typecheck, type tests, 40
  root test files / 327 tests, devtools-panel verify, devtools-extension
  verify, basic starter verify, project-console starter packaging/typecheck/
  tests/build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/sync-adapter.test.ts` passed after
  converting DB sync-adapter tests to returned Effect programs. Generic,
  server, Resource, query-client, and scoped change-feed adapter sequencing now
  stays inside `Effect.gen(...)`, leaving `Effect.runPromise(...)` only at the
  Vitest host boundary.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck`,
  `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/effect-rpc-compat.test.ts`,
  and
  `pnpm exec vitest run packages/start/test/action-manifest.test.ts packages/start/test/app-graph.test.ts`
  passed after extracting the Start transport protocol module.
- Full `pnpm verify` passed after the architecture-deepening module sweep: 9
  package builds, workspace typecheck, type tests, 40 root test files / 328
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- `pnpm typecheck` and focused Core, DB, Devtools, Start, and project-console
  tests passed after the Effect-first coordination follow-up. The audited
  Action, Resource, Collection, StartAction, devtools, and example-domain tests
  now use Effect fibers, `Effect.all(...)`, `Effect.flip(...)`, and
  `Effect.scoped(runtime.provide(...))` instead of Promise handles for internal
  scheduling.
- Full `pnpm verify` passed after the Effect-first coordination follow-up: 9
  package builds, workspace typecheck, type tests, 40 root test files / 328
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/flush-policy.test.ts` passed after
  converting DB flush-policy tests to returned Effect programs. Runtime-scoped
  hydrate/flush/background-sync sequencing now runs through
  `runtime.provide(...)`, and runtime disposal is handled with
  `Effect.ensuring(...)`.
- DB Collection runtime work now delegates `Collection.define(...)` load,
  refetch, direct writes, change batches, mutation queue execution, persistence
  handoff, and preload collection to `packages/db/src/collection-runtime.ts`.
  `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck`, and 7 DB test
  files / 58 tests passed after the extraction.
- Full `pnpm verify` passed after the DB Collection Runtime extraction: 9
  package builds, workspace typecheck, type tests, 40 root test files / 328
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- Full `pnpm verify` passed after the Start Request Handler, Core Resource
  Runtime, and Devtools Summary extractions: 9 package builds, workspace
  typecheck, type tests, 40 root test files / 328 tests, devtools-panel verify,
  devtools-extension verify, basic starter verify, project-console starter
  packaging/typecheck/tests/build, and leak scan.
- DB Query builder behavior now lives in `packages/db/src/query-builder.ts`,
  and Live Query Collection adaptation now lives in
  `packages/db/src/live-query-collection.ts` instead of the DB root facade.
  Project-console domain mock/domain tests and the basic-starter SSR test now
  return Effect programs rather than using async wrappers, with host response
  text reads isolated behind `Effect.tryPromise`. DB typecheck, workspace
  typecheck/type tests, DB query-focused tests, example typechecks, and focused
  example tests passed.
- Core route/server Effect-returning seams now defer preload invocation,
  navigation match/schema decode, and server route handler invocation until the
  returned Effect is run. Sync preload/handler/schema failures are observed
  through typed `RoutePreloadError`, `RouteNavigationError`, and
  `ServerRouteHandlerError` Effect error channels rather than `unknown`. The
  last package/example/script/type-test Promise-method coordinator, a Start
  adapter `Promise.race(...)`, now uses
  `Effect.raceFirst(...)` around an `Effect.tryPromise(...)` host stream read.
  Core and Start typechecks plus focused route/runtime and adapter tests passed.
- DB collection transaction ids now allocate from Collection State and hydrate
  from restored pending mutations, keeping optimistic mutation identity scoped
  to the active Collection Store instead of a module-global counter.
- Devtools graph/panel id creation now lives in `graph-ids.ts`, and bounded
  Store fact-reference repair lives in `fact-identity.ts`; request trace facts
  receive deterministic ids before runtime-event summarization.
- Start file-route segment parsing now lives in `file-route-segments.ts`, so
  sync discovery and Effect manifest generation share malformed dynamic-param
  handling instead of maintaining separate parser semantics.
- Start RPC and action client behavior now lives in `start-rpc-client.ts` and
  `start-action-client.ts`, keeping fetch, decode, hydration, Layer, and action
  concurrency workflows behind focused Effect-first client Modules.
- Core Action submission versioning, fiber coordination, invalidation-plan
  state, stale interruption, and reset interruption now live behind a shared
  Action Submission Controller used by both `Action.use(...)` and Start's
  `StartAction.use(...)`.
- Stateful `StartAction.use(...)` now checks the accepted submission before
  running response hydration, keeping stale transport responses from applying
  Resource or Collection hydration side effects.
- DB collection snapshot validation, cloning, pending mutation conversion,
  JSON encode/decode, and hydration application now live in
  `collection-snapshot-codec.ts`; invalid persisted snapshot JSON, direct
  hydrate snapshots, and hydration payloads now fail as typed
  `CollectionSnapshotCodecError` values in the Effect error channel.
- Collection mutation commits now catch remote-handler failure before commit and
  run post-commit persistence afterward, so a persistence failure cannot roll
  back rows that already reflect a successful remote mutation.
- DB collection contracts and registry diagnostics now live outside the package
  root in `collection-contract.ts` and `collection-registry.ts`, so internal DB
  modules depend on focused Effect-aware contracts rather than the facade.
- Devtools serialization now has a bounded policy for arbitrary runtime values,
  and Store snapshot/event facts are detached before projection.
- Start callable manifest deserialization now uses Manifest Entry Core helpers
  for JSON parsing, version/path validation, callable identity checks, and
  import-client validation across server functions and actions.
- Core Action and Server function definitions now register through a shared
  Core Definition Registry, and `defineApp(...)` snapshots that registry unless
  an explicit app registry is supplied.
- DB Collection registry behavior now lives behind an explicit registry adapter
  with isolated construction, default-registry access, duplicate policy, and
  duplicate diagnostics.
- Start app graph diagnostics can now be rebuilt from runtime route candidates,
  and policy failures use a diagnostics-bearing exception instead of ad hoc
  thrown messages.
- Default generic error parameters now use `never` across Core, DB, Solid DB,
  and Start action inference; callers must spell concrete error channels when
  partial generics would otherwise hide failures.
- The latest Promise-method audit across packages, examples, scripts, and type
  tests reports no `Promise.all`, `Promise.race`, `Promise.resolve`,
  `new Promise`, `.then(...)`, or `.finally(...)` hits.
- Escalated `pnpm verify` passed after the Start stale action hydration guard,
  DB direct typed hydration and post-commit persistence fixes, DB and Core
  registry locality, Start runtime diagnostics, default generic error cleanup,
  and docs reconciliation work: 9 package builds, workspace typecheck, type
  tests, 42 root test files / 361 tests, devtools-panel verify,
  devtools-extension verify, basic starter verify, project-console starter
  packaging/typecheck/tests/build, and leak scan.
- Full `pnpm verify` passed after the shared Action Submission Controller,
  DB Collection contract/registry extraction, typed `CollectionSnapshotCodecError`
  propagation, Devtools graph/fact/serialization cleanup, Start
  file-route/client/callable manifest extractions, and Project Console typed
  codec error handling: 9 package builds, workspace typecheck, type tests,
  40 root test files / 349 tests, devtools-panel verify, devtools-extension
  verify, basic starter verify, project-console starter packaging/typecheck/
  tests/build, and leak scan.
- Full `pnpm verify` passed after the DB query/live-query extraction, Core
  typed route/server Effect seams, Start manifest/trace/diagnostics cleanup,
  Core Signal Dependency Tracker extraction, and Core Form validation race
  guard: 9 package builds, workspace typecheck, type tests, 40 root test files
  / 336 tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- Signal dependency tracking now has one internal tracker for `watch(...)` and
  `Signal.derive(...)`, so duplicate source reads are de-duped and reentrant
  updates queue one follow-up computation. Focused Signal and Scope tests plus
  Core typecheck passed after the extraction.
- Form validation now snapshots values and uses a validation revision so stale
  async schema/custom validation results cannot overwrite state after
  `setField(...)`, `reset(...)`, or a newer validation. Focused Form and
  ActionResult tests plus Core typecheck passed.
- Collection mutation transaction ids now live on Collection State and hydrate
  from restored pending mutation ids, preventing fresh writes from colliding
  with restored optimistic transactions. Focused DB collection/persistence tests
  plus DB typecheck passed.
