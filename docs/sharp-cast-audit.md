# Sharp Cast Audit

Last updated: 2026-05-14.

This audit records the remaining package-source casts that broad grep still
finds after the typed-error, route decode, action-result, Start CLI, runtime,
and DB query-builder cleanup sweeps.

## Current Sweep Results

- No package, example, or script source currently contains raw
  `throw new Error(...)`, `throw new TypeError(...)`, or raw `Error`
  subclass sites.
- No package source currently contains raw Promise method choreography such as
  `.then(...)`, `.finally(...)`, `Promise.resolve(...)`, or `new Promise(...)`
  outside tests and host-boundary code.
- No package, example, or script source currently contains `Promise.resolve`,
  `.then(...)`, or `.finally(...)`; adapter tests keep `new Promise(...)` only
  for Node listener/timer host-boundary helpers.
- No package, example, script, or type-test source currently contains
  `Promise.resolve`, `.then(...)`, or `.finally(...)`.
- No package, example, script, or type-test source currently contains direct
  Promise `.catch(...)` outside Effect's `Effect.catch(...)` operator.
- The devtools extension transport structurally validates inspected-window
  `DevtoolsPanels` payloads before rendering them, so the bridge normalizer no
  longer needs a raw panel payload cast.
- `effectUiStart(...)` now returns the concrete `EffectUiStartPlugin`
  interface, so Start tests call Vite plugin hooks directly instead of
  re-narrowing a broad `PluginOption` with `as never` hook-context casts.
- No package, example, script, or type-test source currently contains `as any`
  or `@ts-ignore`; negative tests use explicit `@ts-expect-error` or
  `unknown`-to-contract casts for runtime validation shapes.
- Remaining package-source `as unknown as` casts are concentrated in the DB
  query builder boundary: `QueryBuilder` carries predicate and ordering
  functions across context-widening joins, and it still has an identity
  projection branch for unprojected queries. The join variance casts are
  centralized behind `filtersFor` and `ordersFor`; type tests cover the joined
  row shape exposed to callers.
- `QueryBuilder.projectorFor(...)` now carries selected projectors across joins
  with a direct function assertion instead of a broad `unknown` bridge.
- `packages/core/src/runtime.ts` still has a named ManagedRuntime service
  boundary, but ResourceStore injection now has an exact `Exclude<...>` type and
  run-method service erasure is centralized behind `provideManagedServices(...)`
  instead of repeated `as unknown as` casts.
- The DB default projector cast remains because an unprojected query returns
  the current context shape, while `QueryBuilder` also supports selected result
  shapes through the same class.
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
- Test-only `as unknown as` and `as never` casts have been removed; the broad
  sharp-cast grep now reports only three DB query context-variance `as unknown
  as` seams.

## Verification Evidence

- Sharp grep:
  - `rg -n " as unknown as | as any|throw new Error|throw new TypeError|Promise\\.resolve|new Promise|\\.then\\(|\\.finally\\(" packages/*/src examples/project-console/src -g '*.ts' -g '*.tsx'`
- Raw throw/subclass grep:
  - `rg -n "throw new Error|throw new TypeError|extends Error" packages examples scripts -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Test/source `any` grep:
  - `rg -n "as any|@ts-ignore" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Promise-method grep:
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts -g '*.ts' -g '*.tsx' -g '*.mjs'`
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
- Promise-catch grep:
  - `rg -n "\\.catch\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs' | rg -v "Effect\\.catch"`
- `pnpm verify` passed after the latest cast cleanup stack: package build,
  workspace typecheck, type tests, 35 package test files / 307 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.
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

## Follow-Up

- Keep new casts out of package source unless they sit at a named boundary like
  runtime service erasure, query context variance, schema decoding, or external
  library type-surface adaptation.
- If the runtime or query builder type model changes, re-run this audit and
  either remove these casts or keep the justification current.
