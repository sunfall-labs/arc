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
- Remaining package-source `as unknown as` casts are concentrated in two
  intentional boundaries:
  - `packages/core/src/runtime.ts`: `ManagedRuntime` run methods erase the
    provided service environment after `ResourceStore` is injected. The casts
    are the runtime spine boundary between the framework's active runtime and
    Effect's managed runtime.
  - `packages/db/src/index.ts`: `QueryBuilder` carries predicate, projector,
    and ordering functions across context-widening joins. The casts are now
    centralized behind `filtersFor`, `projectorFor`, and `ordersFor`; type
    tests cover the joined row shape exposed to callers.
- The DB default projector cast remains because an unprojected query returns
  the current context shape, while `QueryBuilder` also supports selected result
  shapes through the same class.
- Test-only `as unknown as` casts remain only for legacy Effect Cause shape
  inspection.

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
- `pnpm verify` passed after replacing negative-test `as unknown as` casts: 9
  package builds, workspace typecheck, type tests, 38 root test files / 320
  tests, devtools-panel verify, devtools-extension verify with 1 extension test
  file / 6 tests, basic starter verify, project-console starter packaging,
  project-console typecheck, 4 project-console test files / 23 tests,
  project-console build, and leak scan.

## Follow-Up

- Keep new casts out of package source unless they sit at a named boundary like
  runtime service erasure, query context variance, or schema decoding.
- If the runtime or query builder type model changes, re-run this audit and
  either remove these casts or keep the justification current.
