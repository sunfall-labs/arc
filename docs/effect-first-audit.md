# Effect-First Audit

Last updated: 2026-05-16.

This audit supports the charter rule: push async lifecycle, teardown, tracing,
retry, streaming, and adapter work down into Effect primitives wherever
possible. Promises are acceptable only at host/platform boundaries; public
framework APIs should return `Effect` so callers decide where to run them.
Framework internals should prefer `Effect`, `Fiber`, `Scope`, and Effect-native
interruption.

## Classification

| Class | Rule | Examples |
| --- | --- | --- |
| Host boundary | Promise is acceptable because the platform API requires it. | Web Stream `pull`/`cancel`, Vite callback launchers, browser callbacks, React/Solid Suspense, test assertions over platform `Response` methods. |
| Host runner | Convert an Effect to a Promise only at the final host/test edge. | `Effect.runPromise(runtime.provide(handler(request)))`, `Effect.runPromise(Resource.prefetchEffect(ref))`. |
| Public API | Return Effects for async work; callers choose where to run them. | `Resource.prefetchEffect(...)`, `action.submitEffect(...)`, `createRequestHandler(...)`. |
| Internal follow-up | Convert to Effect unless there is a concrete host-boundary reason. | Promise state machines, `.then(...)` lifecycle sequencing, unstructured async helpers. |

## Current Sweep Results

- `scripts/audit-effect-first.mjs`
  - The executable audit now preserves template interpolation code while
    sanitizing strings, so non-Effect `.catch(...)` and other banned async
    patterns inside `${...}` expressions are still visible.
  - Promise return-type detection now handles multiline signatures, and direct
    `await` usage is reported as its own seam with explicit script allowances
    for host runners.
  - Self-tests cover multiline Promise returns, template interpolation
    detection, bare await detection, and the existing `Deferred.await` Effect
    operator exemption.
  - The Review 134 pass removed stale `Effect.runPromise` allowances for
    Start fetch and Vite implementation files and tightened
    `request-runtime-response.ts` to the single remaining host seam.
  - The Review 135 pass tightened the Start fetch adapter `Promise<Response>`
    return-type allowance to the single public host facade.
  - The Review 136 pass made approved Effect-first occurrences exact per-file
    count checks, so deleted occurrences or cross-file moves fail until the
    audit contract is updated.
  - The Review 139 pass anchors approved Effect-first occurrences to named
    local seams with context matchers, so deleting an approved occurrence and
    adding a different same-pattern occurrence in the same file no longer
    preserves the audit.
  - The Review 142 pass bans `Promise.allSettled(...)`, `Promise.any(...)`,
    and typed Promise member chains such as `.then<T>(...)`, `.catch<T>(...)`,
    and `.finally<T>(...)`, with self-tests proving those holes stay closed
    while `Effect.catch<T>(...)` remains allowed.
  - The Review 143 pass broadened `PromiseLike<T>` detection to any audited
    type surface, including aliases and `extends`, and moved banned Promise
    member scans over sanitized joined source so bracket and multiline
    choreography cannot evade line-local checks.
  - The Review 144 pass added package-source declaration files to scope, caught
    optional Promise statics/member calls, and anchored structural thenable type
    surfaces to runtime guard seams.
  - The Review 145 pass added example Vite configs to scope and catches
    parenthesized/extracted Promise choreography such as `(Promise.all)(...)`,
    `(client.then)(...)`, and `client.then.call(...)`.
  - The Review 148 pass catches Promise static extraction through assignments
    and destructuring, including aliased destructuring such as
    `const { all: promiseAll } = Promise`, so extracted combinators cannot
    bypass the Effect-first guardrail.
  - The Review 149 pass catches static no-substitution template keys such as
    ``Promise[`all`]`` and ``client[`then`]`` for direct calls and extracted
    Promise statics, closing the remaining valid JavaScript member-access form.
  - The Review 150 pass catches newer Promise factory statics,
    `Promise.try(...)` and `Promise.withResolvers(...)`, including extracted
    dot, bracket, and template-literal forms, so library internals cannot grow
    Promise-first factory seams by using newer JavaScript APIs.
  - The Review 156 pass catches Promise constructors destructured from global
    host objects such as `globalThis` and `window`, including aliased
    destructuring, so `const { Promise: P } = globalThis; new P(...)` cannot
    bypass the constructor guard.
  - The Review 157 pass catches nested and computed global Promise extraction
    such as `const { Promise: { all } } = globalThis` and
    `const { ["Promise"]: P } = globalThis`, so extracted static calls cannot
    bypass the Effect-first guardrail.
- `packages/start/src/start-fetch.ts` and `packages/start/src/file-route.ts`
  - Custom Start fetchers and file-route preload helpers now reject
    Promise-shaped erased JavaScript values before they cross deeper runtime
    seams. File-route preload failures are typed `FileRoutePreloadError` values
    with guidance to return Effects instead.
  - Resource selector throws during file-route preload are captured through the
    typed preload failure path instead of escaping as ambiguous host defects.
- `packages/start/src/request-runtime-lifecycle.ts`,
  `packages/start/src/request-runtime-response.ts`,
  `packages/start/src/start-request-handler.ts`, and `packages/start/src/streaming.ts`
  - The Request Runtime Lifecycle Module runs selected Start response Effects
    through failure/interruption teardown, ResponseContext application, request
    trace emission, runtime disposal, and streamed response finalization before
    host response values leave the Effect-owned path.
  - Request Runtime response completion now emits one finalization state shape
    for both buffered and streamed responses, keeping teardown snapshots,
    stream facts, and request trace emission inside one Effect-owned lifecycle
    path.
  - `createStartStreamedHtmlResponseEffect(...)` lets starters append
    `StartRenderHydrationPlan` streamed resource chunks before the tail without
    rebuilding that stream policy in each server entry.
- `packages/core/src/resource-ui-binding.ts`,
  `packages/react/src/hooks.ts`, and `packages/solid/src/hooks.ts`
  - Core now owns adapter-neutral Resource UI binding policy for ref identity,
    runtime-bound refresh/prefetch Effects, automatic preload fibers, keyed
    preload failures, observer failure swallowing, stale preload interruption,
    state matching helpers, and Suspense preload-token dedupe.
  - React and Solid keep only host reactivity and host Suspense thenable
    throwing at their adapter seams while sharing the Effect-first Resource
    preload policy.
- `packages/db/src/collection-reactive-binding.ts`,
  `packages/react-db/src/shared.ts`, and `packages/solid-db/src/shared.ts`
  - React DB and Solid DB share the DB-owned collection/live-query subscription,
    runtime binding, source comparison, preload controller, and state-error
    helpers. Adapter code stays focused on host reactivity while async preload
    work remains Effect-first.
  - Live-query input/dependency selection now lives in the same DB-owned helper
    family, so React DB and Solid DB reuse one runtime-bound `Query.live(...)`
    policy.
- `packages/db/src/runtime-collection-store.ts`
  - Runtime Collection Store lookup, initialization, diagnostics, event
    subscription, and synchronous `runWithCollectionStore(...)` override
    locality now live in one Effect-first Module. Collection Runtime consumes
    that store seam while keeping load, mutation, persistence, and change-feed
    workflows as Effects.
- `packages/db/src/collection-write-commit.ts`
  - Direct Collection writes now share one Effect-owned commit sequence:
    snapshot, apply, persist, restore on persistence failure, and publish
    `CollectionWritten` only after persistence succeeds. Row ingress and
    validation stay with Collection Runtime callers.
- `packages/db/src/live-query-collection-materialization.ts`
  - Live Query Collection projection state now lives in one Effect-first
    Module: per-store keyed rows, lookup maps, index buckets, state/version
    signals, `Ready.updatedAt`, and snapshots. The public read-only collection
    facade stays in `live-query-collection.ts`.
- `packages/db/src/query-source-adapter.ts`
  - Collection Query Source Adapter owns query-readable collection access:
    rows, row counts, declared index checks, indexed row probes, indexed join
    key extraction, version/state signals, and preload/refetch Effect
    selection for normal Collections and Live Query Collections.
- `packages/core/src/resource-runtime.ts` and `packages/db/src/collection-persistence.ts`
  - Core Resource sync reads and Effect reads share one read decision before
    crossing into thrown render-control values or typed Effect failures.
  - DB collection hydration validation and application share one planned
    validation/preflight path before any hydration mutation runs.
- `packages/core/src/scope.ts`, `packages/react/src/runtime.ts`,
  `packages/solid/src/runtime.ts`, and router adapters
  - `UiScope` late finalizers use a configured Effect runner, so cleanup
    registered after disposal still runs through the owning Runtime Spine
    instead of the ambient/default runtime.
- `packages/devtools/src/index.ts`
  - `bootDevtoolsPanels(...)` centralizes panel mount, bridge polling, and
    scoped cleanup as Effect/Fiber-owned work for both the standalone panel app
    and browser extension panel shell.
- `packages/core/src/program.ts`, `packages/solid/src/hooks.ts`, and
  `packages/react/src/hooks.ts`
  - Program runtime startup/provision failures now flow through
    `Program.RuntimeError<E, ER>` and adapter hook error parameters instead of
    being collapsed into `unknown` or local Promise-style dispatch rejection.
  - Program dispatch remains an Effect-first state-machine operation; runtime
    failures are recorded as typed Program failures and surfaced through
    `dispatchEffect(...)`.
- `vitest.config.ts` and `examples/react-starter`
  - The workspace Vitest runner now isolates the React starter behind the React
    JSX transform and starter `@` alias instead of sending React components
    through the Solid JSX transform. The root verification gate also includes
    the React starter package verify, keeping its typecheck/test/build/leak scan
    in the main Effect-first release gate.
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
  - Public hydration runtime options are generic over the runtime error channel
    with a `never` default, so hydration can stay service-opaque without
    publishing `unknown` as an error type.
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
    subscriptions, live-query persistence, and source preloads now use named
    Effect helpers or direct Effect combinators instead of local
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
  - Start action client options now accept runtime boundaries generic over the
    runtime error channel with `never` as the default, because the client seam
    only needs to run/provide hydration and invalidation Effects.
  - Start collection trace, request-runtime teardown, response finalizer, and
    response completion helpers now accept generic runtime error channels where
    needed and `never` where the seam deliberately erases host failure.
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
- `scripts/audit-effect-first.mjs`
  - The executable audit now rejects async function syntax and non-Effect
    `.catch(...)` calls across checked source, examples, scripts, and public
    type tests. `Effect.catch(...)` remains allowed, with self-tests proving the
    allowed and rejected cases.
- `scripts/package-project-console-starter.mjs`
  - Replaced the remaining raw async path-existence adapter with
    `Effect.tryPromise`, `Effect.as`, and typed `ENOENT` handling.
  - The CLI entrypoint now reports success and failure from inside the Effect
    pipeline instead of using a top-level `try`/`catch` around
    `Effect.runPromise(...)`.
  - Starter non-workspace installs and generated `verify` runs now use
    `Effect.callback(...)` around the Node child-process host seam, keeping
    command success and failure inside the Effect error channel.
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
  - The starter packaging script keeps filesystem and child-process checks
    inside Effect programs; no raw async or Promise method chains remain there.
  - The Effect-first audit script now matches spaced `Promise <T>` return
    shapes and unapproved `PromiseLike<T>` return seams, with self-tests for
    both patterns before scanning workspace files.
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

- Review 140 focused verification passed `pnpm audit:effect-first` over 249
  package/example/script/type-test files after adding the Program Runtime
  Scheduler source file without introducing Promise-shaped coordination.
- Review 141 focused verification kept `pnpm audit:effect-first` green over 249
  files after moving Project Console demo state behind an Effect `Ref` service
  and expanding the starter packaging script's Effect-driven manifest checks.
- Review 142 focused verification kept `pnpm audit:effect-first` green over 249
  files after tightening the scanner for `Promise.allSettled`,
  `Promise.any`, and typed Promise member chains.
- Review 143 focused verification kept `pnpm audit:effect-first` green over 249
  files after anchoring all approved `PromiseLike<T>` type seams and adding
  self-tests for alias, `extends`, bracket member, multiline static, and split
  typed member-chain forms.
- Review 144 focused verification kept `pnpm audit:effect-first` green over 250
  files after adding package-source `.d.ts` files to scope, catching optional
  Promise statics/member calls, and anchoring structural thenable type surfaces
  to runtime guard seams.
- Review 145 focused verification kept `pnpm audit:effect-first` green over 255
  files after adding example Vite configs to scope and catching parenthesized or
  extracted Promise statics/member calls.
- Review 146 focused verification kept `pnpm audit:effect-first` green over 258
  files after adding copyable starter leak-scan scripts to scope and anchoring
  their top-level Node host runners.
- Review 147 focused verification kept `pnpm audit:effect-first` green over 258
  files after replacing the remaining Start fetch raw invalid-return throw with
  a typed Effect failure and replacing raw audit self-test throws with explicit
  process-failure reporting.
- Review 148 focused verification kept `pnpm audit:effect-first` green over 258
  files after adding Promise static extraction bans for direct assignment,
  bracket assignment, destructuring, and aliased destructuring.
- Review 149 focused verification kept `pnpm audit:effect-first` green over 259
  files after adding the package dry-run verification script as an anchored host
  runner and adding template-literal member-key self-tests for Promise statics
  and non-Effect member calls.
- Review 150 focused verification kept `pnpm audit:effect-first` green over 259
  files after adding `Promise.try` and `Promise.withResolvers` direct/extracted
  guardrails.
- Review 154 focused verification kept `pnpm audit:effect-first` green over 272
  files after unwrapping `as`, `satisfies`, and type assertion expressions so
  typed literal Promise static element access is audited.
- Review 155 focused verification kept `pnpm audit:effect-first` green over 272
  files after moving `new Promise` detection into the TypeScript AST guard so
  direct, global, parenthesized, and aliased Promise constructor forms are
  rejected.
- Review 156 focused verification kept `pnpm audit:effect-first` green over 272
  files after adding object-binding extraction checks for Promise constructors
  destructured from `globalThis` and `window`.
- Review 139 focused verification passed `pnpm audit:effect-first` over 248
  package/example/script/type-test files after anchoring allowed occurrences to
  named seams and context matchers.
- The latest full gate is the Review 156 `pnpm verify` run: 11 package builds,
  workspace typecheck, public type tests, public API inventory audit,
  Effect-first audit over 272 files, 53 root test files / 949 tests,
  devtools-panel/devtools-extension/starter-suite/16-target package-dry-run/
  project-console gates, and leak scans.
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
- Start host-boundary Effect error channels now use typed failures instead of
  `unknown`: preload uses `StartPreloadError`, request handlers and adapters
  normalize failures to `StartRequestHandlerError`, fetch hooks default to
  `never` and map caller failures to `ServerTransportError`, and Vite
  diagnostics loading returns `StartAppGraphDiagnosticsLoadError`.
- Adjacent helper aliases now follow the same rule: Start request trace hooks,
  Action runtime options, Solid router preload, and Collection change-feed
  `emit(...)` no longer expose `unknown` as their Effect failure type.
- LSP-facing JSDoc now explains the Effect-first registry, action submission,
  snapshot codec, Start action, manifest, app graph, and hydration concepts
  added in the latest cleanup pass.
- `EffectInput` now guards Promise-like inferred callback returns before the
  `never extends A` conditional-type trap can accept them. Public type tests
  cover unannotated Promise-returning `Action.define(...)` and `Server.fn(...)`
  callbacks.
- The latest Promise-method audit across packages, examples, scripts, and type
  tests reports no `Promise.all`, `Promise.race`, `Promise.resolve`,
  `new Promise`, `.then(...)`, or `.finally(...)` hits.
- `toEffect(...)` and ActionResult conversion helpers now reject direct
  Promise-shaped values at the public type surface and still reject erased
  thenables with `EffectInputPromiseRejected` at runtime.
- Start app-graph diagnostics policy validation now has an Effect-returning
  exception-preserving seam, and the generated Vite module runs that Effect at
  the sync host boundary.
- Start file-route discovery now exposes `discoverFileRoutesEffect(...)` and
  keeps the sync discovery helper as a Vite/host facade.
- Core `Resource.read(...)` no longer throws Suspense Promises. Missing or
  expired reads throw typed `ResourcePending`; Solid and React
  `useResourceSuspense(...)` adapters own the UI Suspense host conversion by
  running `Resource.prefetchEffect(...)` through the active UI runtime without
  exposing Promise-shaped public types.
- Node server error hooks now accept pure values or Effects through
  `EffectInput`; Promise-shaped error hooks are rejected in public type tests.
- DB collection output schema failures now normalize to
  `CollectionSnapshotCodecError` during load, hydrate, direct writes, change
  feeds, and Solid DB preload handles instead of exposing raw schema errors.
- Start document hydration now reports malformed streamed chunks and root
  payload scripts as typed hydration errors in the Effect path instead of
  leaking parse throws as defects.
- Start Host Runtime Runner now owns the final host-required Promise/fork seams
  for Fetch, Node, and Vite facades. `fetch-adapter.ts`,
  `node-adapter.ts`, and `vite.ts` delegate runtime launch policy to
  `packages/start/src/start-host-runtime-runner.ts`; request/response
  translation remains in the adapters.
- Start Node Web Exchange now owns Node request conversion and response writing
  as an Effect-first Module shared by production Node and Vite dev SSR hosts.
  Its Node stream/cancel work stays behind `Effect.tryPromise(...)` inside the
  adapter seam, and public Node facade exports remain compatibility re-exports.
- Query Execution Plan now owns DB query validation, source preload/refetch,
  snapshot execution, diagnostics, stable equal-order tie-break identity, and
  final projection stages for one-shot and live query facades. The Module
  remains Effect-first and does not add Promise host seams.
- Query Context Identity now owns DB query source alias/key identity, merged
  context identity, ordered tie-break identity, IVM context metadata, and
  collection-row delta identity in a pure internal Module shared by Query
  Execution Plan and Live Query Runtime.
- Devtools request summaries and panels now preserve teardown snapshots and
  per-server-function/action failure owners, so inspection stays on structured
  Effect facts rather than raw event spelunking.
- DB change-feed emitters are now bound to the subscribed Collection Store,
  Query Sync post-commit invalidation is best-effort, Solid scope disposal uses
  the owning runtime, and Start/Devtools host-boundary metadata checks fail
  through typed Effect errors instead of escaping as raw callback defects.
- The Collection Change Feed Runtime now owns scoped feed subscription
  lifecycle, dispatcher fibers, adapter subscribe/unsubscribe normalization,
  `emit(...)` completion, host `emitChanges(...)` queueing, and failure
  publication as Effects, while Collection Runtime supplies the store-local row
  application Effect.
- The Browser Router Host Controller now owns history listener lifecycle,
  programmatic commits, initial navigation, typed route forwarding, and preload
  disposal for React and Solid router adapters without adding Promise host
  seams.
- The Action Execution Workflow now owns `Action.use(...)` callback
  normalization, retry, optimistic commit/rollback, stale interruption,
  invalidation planning/execution, and visible state updates as Effects, while
  the public facade keeps runtime requirement subtraction local.
- The Devtools Public Contract Module now owns public DTO and Interface
  vocabulary in one source file, while Store, Summary, Panel Contract, Bridge,
  renderer, causal graph, serialization, and app-graph helpers import those
  contracts directly instead of depending on the root facade.
- Devtools public type-test ownership now lives in `type-tests/devtools.test-d.ts`
  for pure Store, panel, bridge, serialization, DTO, and lifecycle assertions.
  The broad framework type test keeps only Core/DB/Start compatibility checks,
  including Start traces, Start app graph diagnostics, DB collection events, and
  Start action invalidation plans.
- The Core Resource Store diagnostics test now keeps prefetch, diagnostics
  reads, assertions, and runtime disposal inside one Effect program with
  `Effect.ensuring(...)`; Vitest remains the only Promise runner seam.
- The Devtools serialization policy now belongs to the public contract module.
  The serialization implementation re-exports that type for compatibility and
  imports from the contract, closing the contract-to-implementation back-edge.
- The default Start global fetch adapter now passes the `AbortSignal` supplied
  by Effect v4 `Effect.tryPromise(...)` into `globalThis.fetch`, merging it
  with caller-provided request/init signals so fiber interruption aborts the
  underlying host fetch.
- Start transport body readers now live in `start-transport-body.ts`: JSON
  request reads, action form reads, and response text reads are Effect-wrapped
  one-shot helpers that map host body failures to typed protocol or transport
  errors.
- Start diagnostics now acquires its temporary Vite server through
  `Effect.acquireRelease(...)` inside `Effect.scoped(...)`, keeping the
  `effect-ui-start` CLI diagnostics path and Vite build gate on the same
  scoped Effect resource lifetime.
- DB SQLite statement contracts are owned by `sqlite-persistence.ts`; the public
  `Collection.SQLiteStatement*` namespace names now alias those contracts from
  the DB root facade instead of redefining them.
- DB persisted option normalization now belongs to `collection-persistence.ts`;
  the DB root re-exports `persistedCollectionOptions(...)` and keeps
  `Collection.persistedOptions(...)` as a public facade alias.
- Start client transport now owns post-parse RPC/action HTTP status validation;
  the transport protocol parser no longer exports a status validator that only
  one client transport module consumed.
- Core Resource UI Binding now consumes Resource Runtime functions directly
  instead of value-importing the public `Resource` namespace for sibling module
  implementation calls.
- Core Action Execution Workflow now also consumes Resource Runtime invalidation
  planning/execution functions directly instead of routing internal action
  invalidation work through the public `Resource` facade.
- Start diagnostics CLI common flags now use Effect v4
  `Command.withSharedFlags(...)` on the root command; subcommands read the
  inherited config through the parent command context instead of repeating flag
  parsers.
- Start diagnostics CLI graph/impact query arguments now parse through Effect
  v4 `Argument.variadic(...)` and `Argument.mapEffect(...)`, reporting syntax
  failures as `CliError.InvalidValue` instead of local thrown values.
- Start diagnostics CLI runtime execution now runs the Effect v4 command tree
  directly through `Command.runWith(...)`; command handlers delegate to the
  diagnostics runner and built-in help/version/error actions use Effect CLI's
  formatter path.
- Start diagnostics CLI parser compatibility now also runs the Effect v4 command
  tree and interprets `CliError.ShowHelp` instead of hand-sniffing argv for
  command names, help flags, or unknown subcommands.
- Start diagnostics CLI graph/impact query kinds now live as nested Effect v4
  `Command` subcommands, with graph `--verbose` inherited through
  `Command.withSharedFlags(...)` and kind query text still validated by Effect
  `Argument` parsers.
- Start Diagnostics CLI Contract now owns the graph/impact query-kind catalog,
  `CliError.InvalidValue` expected text, and shell-safe impact verify command
  planning while `cli.ts` continues to build real Effect v4 `Command`
  subcommands from that shared contract.
- Start Agent Graph query, formatter, display, and impact planner Modules now
  keep diagnostics graph CLI projection and impact planning in Effect-friendly
  pure/Effect wrappers without introducing Promise-shaped CLI coordination.
- Start Vite Diagnostics Loader now owns temporary Vite server acquire/release,
  diagnostics virtual-module loading, graph DTO decoding, and diagnostics gate
  execution in `start-vite-diagnostics-loader.ts`; the Vite facade re-exports
  the public Interface.
- Start Action Request Codec now owns schema-backed JSON/form request encoding
  and decoding in `start-action-request-codec.ts`.
- Start Action Response Codec now owns action response DTOs, response metadata,
  response-mode selection, Exit-to-Response encoding, client parsing, and typed
  result decoding in `start-action-response-codec.ts`. Request and response
  codecs share Effect Schema helpers through `start-schema-codec.ts`.
- DB Collection Sync Load Policy now owns `preloadEffect(...)` and
  `refetchEffect(...)` orchestration in `collection-sync-load-policy.ts`,
  including in-flight `Deferred` ownership/joining, forced-refetch generation
  freshness, restore-before-load, load/refetch selection, retry, row
  replacement, lifecycle events, and load persistence.
- DB Collection Mutation Workflow now owns optimistic insert/update/delete and
  pending flush orchestration in `collection-mutation-workflow.ts`, including
  active mutation `Deferred` joining, `Schedule` retry, handler DTO detachment,
  commit/rollback, lifecycle events, and mutation persistence.
- Browser Route Render Decision now lives in Core browser-router, so React and
  Solid route outlets share one adapter-neutral decision for pending, failure,
  not-found, ready component props, empty ready routes, and stable render keys.
- Browser Router Link Decision now lives in Core browser-router, so React and
  Solid RouterLink adapters share one adapter-neutral decision for hover
  preloading, modified clicks, browser-handled targets/downloads, outside-router
  routes, and replace navigation.
- Program Runtime Timeline now owns Program event retention and disabled
  timeline behavior without adding a Promise-shaped host boundary; `program.ts`
  continues to run queue, command, subscription, and disposal work with Effect
  fibers and scopes.
- Program Contract, Primitives, Story Harness, and Runtime Coordinator now split
  public Program surface, pure constructors, deterministic story execution, and
  live Queue/Fiber/Scope execution without introducing Promise-shaped async
  work.
- Program Runtime Coordinator lifecycle now keeps dispatch acknowledgements,
  subscription restart ownership, stale subscription emission dropping, and
  post-dispose update guards inside Effect fibers and `Deferred`s without adding
  Promise-shaped coordination.
- Devtools Fact Identity now owns first-match fact index helpers for Store and
  Summary matching. The cleanup is pure identity policy, so no Promise-shaped
  host boundary or Effect runtime seam was added.
- Devtools Panels and Store no longer expose internal single-adapter runtime
  injection seams. Effect wrappers and store Effect methods stay intact while
  pure projection dependencies live in the owning Modules.
- Review 129 added the Start Agent Graph Vocabulary Module and kept the focused
  Effect-first audit green over 244 auditable package/example/script/type-test
  files. The new Module is pure graph vocabulary and adds no Promise-shaped
  host boundary.
- Review 130 added the DB Store-Explicit Collection Snapshot Module and kept
  the focused Effect-first audit green over 245 auditable
  package/example/script/type-test files. The Module centralizes snapshot
  dispatch and hydrate preflight without introducing Promise-shaped host work.
- Review 131 added hover-only docs for public Program type aliases, Start agent
  graph constructors, and Start diagnostics loader failures while keeping the
  focused Effect-first audit green over the same 245 auditable files.
- Review 132 extracted the Start App Graph Diagnostics Policy Module and kept
  the focused Effect-first audit green over 246 auditable
  package/example/script/type-test files. The Module owns typed policy errors
  and validation Effects without adding Promise-shaped host work.
- Review 133 added docs/type-test/CLI verification hooks for public app graph
  diagnostics and kept the focused Effect-first audit green over the same 246
  auditable files.
- Review 134 tightened stale `Effect.runPromise` allowances while keeping the
  focused Effect-first audit green over the same 246 auditable files.
- Review 135 tightened the Start fetch adapter Promise-return allowance while
  keeping the focused Effect-first audit green over the same 246 auditable
  files.
- The latest full `pnpm verify` passed after the Review 156 Durable Commit
  Races, Query Redaction, And Guardrail Pins slice: 11 package builds, workspace
  typecheck, type tests, public API inventory audit, Effect-first audit over 272
  package/example/config/script/type-test/generated-template files, 53 root test
  files / 949 tests,
  devtools-panel verify with 1 panel test file / 2 tests,
  devtools-extension verify with 1 extension test file / 20 tests, basic starter
  verify with 1 starter test file / 2 tests, React starter verify with 1
  starter test file / 3 tests, generated starter-suite packaging/verifies for
  basic/react/project-console, 16-target package dry-run gate, project-console
  typecheck, 4 project-console test files / 27 tests, build, and leak scans.
  Review 75
  added the public API inventory audit to the full gate, Review 86 kept the
  scanner green over the expanded public type-test scope, Review 113 expanded
  the scanner to 226 files, Review 115 expanded it to 227 files, Review 116
  expanded it to 228 files, Review 120 expanded it to 230 files, Review 121
  expanded it to 231 files, Review 123 expanded it to 232 files, Review
  124 expanded it to 233 files, Review 125 expanded it to 237 files, Review
  127 expanded it to 242 files, Review 128 expanded it to 243 files, Review
  129 focused audit expanded it to 244 files, Review 130 focused audit
  expanded it to 245 files, Review 131 kept that 245-file scope green after
  hover-only public docs changes, Review 132 expanded it to 246 files while
  keeping the scope green, Review 133 kept that 246-file scope green, Review
  139 expanded it to 248 files with exact seam anchors, Review 140 expanded it
  to 249 files with the Program Runtime Scheduler Module, Review 142 kept that
  249-file scope green while tightening Promise member-pattern detection,
  Review 143 kept it green while broadening `PromiseLike<T>` and
  bracket/multiline Promise detection, and Review 144 expanded it to 250 files
  by adding package-source declaration files while catching optional Promise
  calls and structural thenable type surfaces, and Review 145 expanded it to
  255 files by adding example Vite configs while catching parenthesized
  Promise choreography, Review 148 kept the 258-file scope green while catching
  Promise static extraction through assignment and destructuring, and Review
  149 expanded it to 259 files with the package dry-run script while catching
  static template-literal member keys, and Review 150 kept that 259-file scope
  green while catching `Promise.try` and `Promise.withResolvers`. Review157
  kept the focused audit green over 273 files while catching nested and
  computed global Promise extraction.
- An earlier full `pnpm verify` passed after the Start stale action hydration guard,
  DB direct typed hydration and post-commit persistence fixes, DB and Core
  registry locality, Start runtime diagnostics, default generic error cleanup,
  LSP-facing JSDoc refresh, EffectInput Promise inference/runtime guards, Start
  diagnostics/file-route/Solid suspense host-seam cleanup, Start host-boundary
  typed errors, helper-alias default error cleanup, Devtools request panel
  serialization, and docs reconciliation work: 9 package builds, workspace
  typecheck, type tests, 43 root test files / 366 tests, devtools-panel verify,
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
