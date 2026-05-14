# Sharp Cast Audit

Last updated: 2026-05-14.

This audit records the remaining package-source casts that broad grep still
finds after the typed-error, route decode, action-result, Start CLI, runtime,
and DB query-builder cleanup sweeps.

## Current Sweep Results

- No package or project-console source currently contains raw
  `throw new Error(...)` or `throw new TypeError(...)` sites.
- No package source currently contains raw Promise method choreography such as
  `.then(...)`, `.finally(...)`, `Promise.resolve(...)`, or `new Promise(...)`
  outside tests and host-boundary code.
- Remaining `as unknown as` casts are concentrated in two intentional
  boundaries:
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

## Verification Evidence

- Sharp grep:
  - `rg -n " as unknown as | as any|throw new Error|throw new TypeError|Promise\\.resolve|new Promise|\\.then\\(|\\.finally\\(" packages/*/src examples/project-console/src -g '*.ts' -g '*.tsx'`
- `pnpm verify` passed after the latest cast cleanup stack: package build,
  workspace typecheck, type tests, 35 package test files / 307 tests, example
  typecheck, 4 example test files / 23 tests, example build, and leak scan.

## Follow-Up

- Keep new casts out of package source unless they sit at a named boundary like
  runtime service erasure, query context variance, or schema decoding.
- If the runtime or query builder type model changes, re-run this audit and
  either remove these casts or keep the justification current.
