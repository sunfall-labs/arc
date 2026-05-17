# Sharp Cast Audit

Last updated: 2026-05-16.

This audit records sharp-cast cleanup evidence and the remaining named
type-erasure boundaries after the typed-error, route decode, action-result,
Start CLI, runtime, Solid adapter, DB query-builder, wildcard-boundary, and
test assertion cleanup sweeps. The broad sharp-cast grep is still used as a
review input, but it currently reports named package/example seams rather than
zero hits.

## Current Sweep Results

- No package, example, or script source currently contains raw
  `throw new Error(...)`, `throw new TypeError(...)`, or raw `Error`
  subclass sites.
- No package source currently contains raw Promise method choreography such as
  `.then(...)`, `.finally(...)`, `Promise.resolve(...)`, or `new Promise(...)`
  outside tests and host-boundary code.
- No package, example, or type-test implementation source currently contains
  `new Promise(...)`, `Promise.resolve`, `.then(...)`, or `.finally(...)`; Node
  listener/timer adapter-test helpers use `Effect.callback(...)` and
  `Effect.sleep(...)`. Raw `scripts/` grep hits are expected in
  `scripts/audit-effect-first.mjs` because that audit script embeds scanner
  fixture strings for banned Promise forms.
- No package, example, or type-test implementation source currently contains
  `Promise.resolve`, `.then(...)`, or `.finally(...)`; the Effect-first audit
  script owns the scanner fixture strings that exercise those patterns.
- No package source or type-test source currently contains `async` callback
  syntax or Promise method choreography; example test files keep `async` only
  at test/host boundaries, and `scripts/audit-effect-first.mjs` keeps Promise
  method fixture strings for scanner self-tests.
- No package, example, or type-test implementation source currently contains
  direct Promise `.catch(...)` outside Effect's `Effect.catch(...)` operator.
  Raw `scripts/` hits are expected in `scripts/audit-effect-first.mjs` scanner
  fixture strings for banned catch forms.
- Erased Promise-shaped Resource loader returns are recovered only at the
  Resource runtime boundary and converted to typed `EffectInputCallbackError`
  failures, so bad JavaScript or `any` inputs do not require a new broad cast or
  leave resource state pending.
- The devtools extension transport structurally validates inspected-window
  `DevtoolsPanels` payloads before rendering them, so the bridge normalizer no
  longer needs a raw panel payload cast.
- `effectUiStart(...)` now returns the concrete `EffectUiStartPlugin`
  interface, so Start tests call Vite plugin hooks directly instead of
  re-narrowing a broad `PluginOption` with `as never` hook-context casts.
- No package, example, script, or type-test source currently contains `as any`
  or `@ts-ignore`; the latest touched form/router negative tests use explicit
  `@ts-expect-error`, and form snapshots use a precise mutable helper instead
  of a broad cast.
- The current broad sharp-cast grep still reports named Adapter seams in Core
  runtime/action/effect-input helpers, React runtime/router/render-scope
  bridges, Solid runtime/router/link JSX bridges, Start
  request-runtime/preload/handler/transport host boundaries, Devtools detached
  value serialization, DB schema/SQLite negative validation fixtures, React-DB
  and Solid-DB delayed-cleanup runtime test helpers, project-console runtime
  helpers, and public type-test assertion fixtures. Treat those as explicit
  review targets, not as hidden cleanup debt.
- DB flush/background-sync helpers retain a named Effect result assertion at
  the heterogeneous collection coordination boundary. The loop yields
  `AnyCollection` handles while the public return type computes the precise
  union from the caller's `Collections` iterable, so the cast is localized to
  the boundary where TypeScript cannot connect the erased iteration value back
  to the conditional public channel aliases.
- DB query builder variance no longer appears in the broad `as unknown as`
  sweep: `QueryBuilder` carries predicate and ordering functions across
  context-widening joins through `NextContext extends TContext`, and its
  identity projection branch is isolated behind `projectCurrentContext(...)`.
  Type tests cover the joined row shape exposed to callers.
- `QueryBuilder.projectorFor(...)` now carries selected projectors across joins
  with a direct function assertion instead of a broad `unknown` bridge.
- `packages/core/src/runtime.ts` still has a named ManagedRuntime service
  boundary, but ResourceStore injection now has an exact `Exclude<...>` type and
  run-method service erasure is centralized behind `provideManagedServices(...)`
  instead of repeated `as unknown as` casts.
- Core runtime service erasure now sits at the `ManagedRuntime<any, ER>` value
  boundary inside `fromManagedRuntime(...)`; the runtime no longer casts provided
  Effects themselves to satisfy `ManagedRuntime` run methods.
- `EffectUiRuntime.provide(...)` now returns a scoped Effect, and its
  ManagedRuntime service satisfaction is centralized behind
  `provideRuntimeServices(...)`. Solid router preloads can fork that Effect under
  `UiScope` without a local service-erasure cast.
- Solid Resource and Solid-DB collection/live-query hooks expose the underlying
  `*Effect` operations directly through the active runtime instead of erasing
  requirements at each hook method.
- Core Action and Resource public Effect helpers now pass `Fiber.join`,
  interruption, in-flight Resource refresh, and scoped workflow Effects directly
  to the runtime instead of casting each call site to a runtime-erased
  `Effect.Effect<..., any>`.
- Core runtime top-level helpers no longer cast the input Effect before handing
  it to the active runtime, `UiScope` finalizer/fork plumbing relies on Effect's
  Scope typing directly, and `Signal.watch(...)` forks `EffectInput` work without
  a local scoped-Effect assertion.
- Core server schema wrappers now carry typed `decodeWire<T>(...)` results through
  `Server.encode*/decode*` helpers without repeated call-site casts. `ServerClient`
  preserves each server function's requirements, so local and mock clients no
  longer need outer generator assertions.
- `toEffect(...)` and route preload effects now pass their converted `EffectInput`
  values through Effect/runtime helpers directly.
- Start request-runtime provision, request-handler runners, StartAction
  submission fibers, response stream pull/cancel programs, and hydration sync
  helpers now pass Effects directly through `EffectUiRuntime`/Effect primitives
  instead of erasing requirements at each call site.
- Start RPC/action request-runtime failures now become explicit protocol defect
  responses through Effect error handling, and Start action hydration runtime
  failures are converted with `Effect.die(...)` instead of a local
  never-error assertion.
- Start preload now scopes request-runtime provision with `Effect.scoped(...)`,
  and the Node adapter runs handler Effects through the core runtime helper
  instead of asserting a raw `Effect.runPromise(...)` input.
- Project-console UI fire-and-forget work now flows through a generic
  `runUiEffect(...)` helper and `Effect.catch(...)` without example-local
  `Effect.Effect<..., any>` assertions.
- Core and Start schema encode/decode helpers now cast the dynamic schema value
  to `Schema.Decoder`/`Schema.Encoder` at the schema boundary, letting
  `Schema.decodeUnknownEffect(...)` and `Schema.encodeUnknownEffect(...)` return
  their Effect types directly.
- Core `toEffect(...)` now preserves Effect generics through an overloaded guard
  and maps PromiseLike fallbacks instead of casting the whole Effect.
- DB query joins now express carried filter/order variance with
  `NextContext extends TContext`, and the unprojected result path uses a named
  `projectCurrentContext(...)` boundary instead of broad `unknown` bridges.
- DB sync adapters, SQLite persistence helpers, flush policies, and server
  collection adapters now rely on typed `toEffect(...)` wrappers, explicit method
  return types, or a named server-collection PromiseLike bridge instead of
  scattering `Effect.Effect<..., R>` assertions through adapter methods.
- DB collection persistence, load, mutation-handler, change-feed, and live-query
  source preload paths now use named Effect helpers or direct Effect
  combinators.
- The DB default projector boundary remains because an unprojected query returns
  the current context shape, while `QueryBuilder` also supports selected result
  shapes through the same class; it is now named instead of expressed as a broad
  inline `unknown` bridge.
- The DB `QueryRoot.from(...)` constructor now instantiates `QueryBuilder` with
  the intended context/result types directly instead of casting the builder
  through `never`.
- The DB incremental live-query custom `flatMap` operator now registers through
  a named `IOperator` bridge instead of casting the operator object through
  `never`; the bridge documents the `@tanstack/db-ivm` gap where
  `addOperator(...)` is typed to internal classes while runtime dispatch uses
  the exported structural operator interface.
- `Capability.define(...)` now expresses `useEffect(...)` with explicit
  overloads and returns `Effect.provideService(...)` directly, so the
  capability implementation no longer needs bottom-type casts for callback
  inference or service provision.
- Framework type-id declarations now preserve their `unique symbol` types with
  self-type assertions such as `as typeof ActionTypeId` instead of bottoming out
  through `as never`.
- Test-only `as unknown as` and `as never` casts have been reduced, but the
  broad source sharp-cast grep for `as Effect.Effect`, `as unknown as`,
  `as never`, `as any`, and `@ts-ignore` still reports named package/example
  seams that must stay documented or be removed in later sweeps.

## Verification Evidence

The current full verification gate is recorded in the Review 210 ledgers: 11
package builds, workspace typecheck, type tests, public API inventory audit,
Effect-first audit over 408 files, 53 root test files / 1064 tests,
package-level verifies, generated starter-suite packaging/verifies for
basic/react/project-console, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, build, and leak scans. The
remaining command-result bullets in this section are historical evidence for
the individual cleanup slices that produced this audit.
Review 165 kept the sharp-edge docs current while tightening committed Program
dispatch acknowledgement races, DB hydration/snapshot correctness, Start host
EffectInput/abort seams, generated route identity, public API pins, and Promise
static extraction guardrails.

- Sharp grep:
  - `rg -n "as Effect\\.Effect|as unknown as |as never|as any|@ts-ignore" packages/*/src examples/*/src scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Raw throw/subclass grep:
  - `rg -n "throw new Error|throw new TypeError|extends Error" packages examples scripts -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Test/source `any` grep:
  - `rg -n "as any|@ts-ignore" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Promise-method grep:
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples type-tests -g '*.ts' -g '*.tsx'`
  - Raw `scripts/` hits are expected in `scripts/audit-effect-first.mjs`
    scanner fixture strings; `pnpm audit:effect-first` is the authoritative
    guardrail for distinguishing those fixtures from implementation usage.
- Promise-constructor/method grep:
  - `rg -n "new Promise|Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples type-tests -g '*.ts' -g '*.tsx'`
  - Raw `scripts/` hits are expected in `scripts/audit-effect-first.mjs`
    scanner fixture strings; keep them covered by `pnpm audit:effect-first`.
- Promise-catch grep:
  - `rg -n "\\.catch\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs' | rg -v "Effect\\.catch"`
  - Raw `scripts/` hits are expected in `scripts/audit-effect-first.mjs`
    scanner fixture strings; `pnpm audit:effect-first` is the authoritative
    guardrail for distinguishing those fixtures from implementation usage.
- Historical `pnpm verify` passed after the cast/fire-and-forget cleanup stack: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/start/test/adapters.test.ts` passed after the
  adapter test raw Promise helper cleanup.
- Historical `pnpm verify` passed after the adapter test Promise helper cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm exec vitest run packages/devtools/test/devtools.test.ts packages/db/test/server-collection.test.ts packages/start/test/rpc.test.ts packages/start/test/app-graph.test.ts`
  passed after replacing remaining `as any` test casts: 4 files, 35 tests.
- `pnpm typecheck` passed after replacing remaining `as any` test casts.
- `pnpm verify` passed after replacing remaining `as any` test casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 316
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.
- `pnpm exec vitest run packages/core/test/stable-stringify.test.ts packages/core/test/resource.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/server-collection.test.ts packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`
  passed after replacing raw throw sentinels in negative tests: 6 files, 107
  tests.
- `pnpm typecheck` passed after replacing raw throw sentinels in negative tests.
- `pnpm verify` passed after replacing raw throw sentinels in negative tests: 9
  package builds, workspace typecheck, type tests, 38 root test files / 316
  tests, devtools-panel verify, devtools-extension verify, basic starter
  verify, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.
- `pnpm exec vitest run packages/start/test/adapters.test.ts packages/solid-db/test/solid-db.test.ts packages/db/test/server-collection.test.ts packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
  passed after replacing remaining test Promise-method conveniences: 5 files,
  73 tests.
- `pnpm typecheck` passed after replacing remaining test Promise-method
  conveniences.
- `pnpm verify` passed after replacing remaining test Promise-method
  conveniences: 9 package builds, workspace typecheck, type tests, 38 root
  test files / 316 tests, devtools-panel verify, devtools-extension verify,
  basic starter verify, project-console starter packaging, project-console
  typecheck, 4 project-console test files / 23 tests, project-console build,
  and leak scan.
- `pnpm typecheck:types` passed after replacing type-test Promise method syntax
  with declared Promise values.
- `pnpm verify` passed after replacing type-test Promise method syntax: 9
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
- `pnpm verify` passed after replacing remaining direct Promise catch
  suppression in tests: 9 package builds, workspace typecheck, type tests, 38
  root test files / 320 tests, devtools-panel verify, devtools-extension verify
  with 1 extension test file / 6 tests, basic starter verify, project-console
  starter packaging, project-console typecheck, 4 project-console test files /
  23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/example-devtools-extension typecheck` and
  `pnpm --filter @effect-ui/example-devtools-extension test` passed after
  replacing the inspected-window bridge payload cast with structural
  `DevtoolsPanels` validation.
- `pnpm --filter @effect-ui/example-devtools-extension verify` passed after
  replacing the inspected-window bridge payload cast with structural
  `DevtoolsPanels` validation.
- `pnpm verify` passed after structurally validating devtools extension bridge
  payloads: 9 package builds, workspace typecheck, type tests, 38 root test
  files / 320 tests, devtools-panel verify, devtools-extension verify with 1
  extension test file / 6 tests, basic starter verify, project-console starter
  packaging, project-console typecheck, 4 project-console test files / 23
  tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`,
  `pnpm exec vitest run packages/start/test/start.test.ts -t "Vite preset|server modules|generated file route definitions|build policy"`,
  and `pnpm exec vitest run packages/start/test/start.test.ts` passed after
  tightening `effectUiStart(...)` to return `EffectUiStartPlugin` and removing
  Start Vite plugin hook `as never` casts.
- `pnpm verify` passed after adding `EffectUiStartPlugin`: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm typecheck` and
  `pnpm exec vitest run packages/devtools/test/devtools.test.ts packages/db/test/server-collection.test.ts packages/core/test/form.test.ts packages/core/test/server.test.ts`
  passed after replacing negative-test `as unknown as` casts with explicit
  `@ts-expect-error` assertions: 4 files, 32 tests.
- `pnpm --filter @effect-ui/start typecheck` and
  `pnpm exec vitest run packages/start/test/start.test.ts` passed after
  replacing the legacy Effect Cause shape fallback casts with public
  `cause.reasons` access.
- `pnpm verify` passed after removing test-only unknown casts: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file /
  6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
  passed after removing the `QueryRoot.from(...)` builder `as never` cast: 2
  files, 35 tests.
- `pnpm verify` passed after removing the `QueryRoot.from(...)` builder
  `as never` cast: 9 package builds, workspace typecheck, type tests, 38 root
  test files / 320 tests, devtools-panel verify, devtools-extension verify with
  1 extension test file / 6 tests, basic starter verify, project-console starter
  packaging, project-console typecheck, 4 project-console test files / 23
  tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck` and
  `pnpm exec vitest run packages/db/test/live-query-collection.test.ts packages/db/test/collection.test.ts`
  passed after replacing the inline IVM custom operator `as never` cast with the
  named `IOperator` bridge: 2 files, 35 tests.
- `pnpm verify` passed after replacing the inline IVM custom operator cast with
  the named `IOperator` bridge: 9 package builds, workspace typecheck, type
  tests, 38 root test files / 320 tests, devtools-panel verify,
  devtools-extension verify with 1 extension test file / 6 tests, basic starter
  verify, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/capability.test.ts` passed after
  replacing the `Capability.define(...)` implementation bottom casts with
  typed overloads and direct `Effect.provideService(...)` return typing: 1 test
  file, 4 tests.
- `pnpm verify` passed after replacing the `Capability.define(...)`
  implementation casts: 9 package builds, workspace typecheck, type tests, 38
  root test files / 320 tests, devtools-panel verify, devtools-extension verify
  with 1 extension test file / 6 tests, basic starter verify, project-console
  starter packaging, project-console typecheck, 4 project-console test files /
  23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/runtime.test.ts packages/core/test/resource.test.ts packages/core/test/action.test.ts`
  passed after replacing repeated runtime run-method service-erasure casts with
  exact ResourceStore provision plus a named `provideManagedServices(...)`
  boundary: 3 files, 48 tests.
- `pnpm verify` passed after consolidating runtime service-erasure casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
  passed after replacing the `QueryBuilder.projectorFor(...)` broad `unknown`
  bridge with a direct projector assertion: 2 files, 35 tests.
- `pnpm verify` passed after replacing the `QueryBuilder.projectorFor(...)`
  broad `unknown` bridge: 9 package builds, workspace typecheck, type tests, 38
  root test files / 320 tests, devtools-panel verify, devtools-extension verify
  with 1 extension test file / 6 tests, basic starter verify, project-console
  starter packaging, project-console typecheck, 4 project-console test files /
  23 tests, project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/action-result.test.ts packages/core/test/server.test.ts packages/core/test/action.test.ts packages/core/test/form.test.ts packages/core/test/signal.test.ts packages/core/test/resource.test.ts packages/core/test/capability.test.ts packages/core/test/runtime.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
  passed after replacing type-id `as never` declarations with self-type
  assertions: 10 files, 111 tests.
- `pnpm verify` passed after replacing type-id `as never` declarations: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`,
  `pnpm --filter @effect-ui/solid typecheck`,
  `pnpm --filter @effect-ui/solid-db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/solid-db/test/solid-db.test.ts packages/core/test/runtime.test.ts`
  passed after moving runtime-provided scoped Effects into the core runtime
  boundary and removing Solid/Solid-DB hook call-site casts: 2 files, 7 tests.
- `pnpm verify` passed after the runtime scoped-provide and Solid adapter cast
  cleanup: 9 package builds, workspace typecheck, type tests, 38 root test files /
  320 tests, devtools-panel verify, devtools-extension verify with 1 extension
  test file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts packages/core/test/runtime.test.ts`
  passed after removing Action/Resource runtime call-site casts: 3 files, 48
  tests.
- `pnpm verify` passed after removing Action/Resource runtime call-site casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/runtime.test.ts packages/core/test/scope.test.ts packages/core/test/signal.test.ts`
  passed after removing core runtime/scope/signal helper casts: 3 files, 15
  tests.
- `pnpm verify` passed after removing core runtime/scope/signal helper casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm --filter @effect-ui/start
  typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/server.test.ts packages/core/test/route-server.test.ts packages/start/test/rpc.test.ts packages/start/test/start.test.ts -t "server function|Server|RPC|browser runtimes call server functions"`
  passed after tightening `ServerClient` requirement typing and centralizing
  server schema decode casts: 4 files, 20 selected tests.
- `pnpm verify` passed after the server/effect-input cast cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging, project-console
  typecheck, 4 project-console test files / 23 tests, project-console build, and
  leak scan.
- `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/sync-adapter.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/flush-policy.test.ts packages/db/test/server-collection.test.ts`
  passed after removing DB adapter-local EffectInput casts: 4 files, 20 tests.
- `pnpm verify` passed after the DB adapter EffectInput cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging, project-console
  typecheck, 4 project-console test files / 23 tests, project-console build, and
  leak scan.
- `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts packages/db/test/change-feed.test.ts`
  passed after replacing DB collection index-source Effect casts: 2 matched files,
  35 tests.
- `pnpm verify` passed after the DB collection EffectInput cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging, project-console
  typecheck, 4 project-console test files / 23 tests, project-console build, and
  leak scan.
- `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/start/test/adapters.test.ts packages/start/test/start.test.ts -t "hydration|adapter|Node|fetch|StartAction|stream|request handler"`
  passed after removing Start runtime call-site casts: 2 files, 20 selected
  tests.
- `pnpm verify` passed after the Start runtime call-site cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/start typecheck`,
  `pnpm --filter @effect-ui/example-project-console typecheck`, and
  `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts examples/project-console/src/*.test.ts -t "server function|RPC|action|StartAction|request handler|hydration|adapter|App"`
  passed after the Start runtime-boundary and project-console UI effect cast
  cleanup: 7 files, 42 selected tests.
- `pnpm verify` passed after the Start runtime-boundary and example UI effect
  cleanup: 9 package builds, workspace typecheck, type tests, 38 root test files
  / 320 tests, devtools-panel verify, devtools-extension verify with 1 extension
  test file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm --filter @effect-ui/start
  typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck:types`,
  and
  `pnpm exec vitest run packages/core/test/server.test.ts packages/core/test/form.test.ts packages/core/test/runtime.test.ts packages/core/test/route-server.test.ts packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
  passed after the schema, EffectInput, Start preload/adapter, and DB query
  variance cast cleanup: 9 files, 135 tests.
- `pnpm verify` passed after the broad sharp-cast cleanup: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/core/test/runtime.test.ts packages/core/test/resource.test.ts packages/core/test/action.test.ts packages/core/test/scope.test.ts packages/core/test/server.test.ts`
  passed after moving core runtime service erasure to the ManagedRuntime value
  boundary: 5 files, 55 tests.
- `pnpm verify` passed after the final broad sharp-cast sweep: 9 package builds,
  workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.
- `pnpm --filter @effect-ui/db typecheck`,
  `pnpm --filter @effect-ui/start typecheck`, `pnpm typecheck:types`, and
  `pnpm exec vitest run packages/db/test/sync-adapter.test.ts packages/start/test/streaming.test.ts`
  passed after replacing the last test-only `as Effect.Effect` assertions with
  `toEffect(...)` and an explicitly typed stream effect.
- At that historical checkpoint, the broad sharp-cast grep over packages,
  examples, scripts, and type tests reported no hits. Current sweeps use the
  same command as a named-seam review input, and current named hits are listed
  in `Current Sweep Results`:
  `rg -n 'as Effect\.Effect|as unknown as |as never|as any|@ts-ignore' packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`.
- `pnpm verify` passed after the test sharp Effect assertion cleanup: 9 package
  builds, workspace typecheck, type tests, 38 root test files / 320 tests,
  devtools-panel verify, devtools-extension verify with 1 extension test file / 6
  tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.

## Follow-Up

- Keep new casts out of package, example, script, and type-test source unless
  they sit at a named boundary like runtime service erasure, query context
  variance, schema decoding, or external library type-surface adaptation.
- If the runtime or query builder type model changes, re-run this audit and
  either remove these casts or keep the justification current.
