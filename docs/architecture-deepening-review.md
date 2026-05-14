# Architecture Deepening Review

This ledger tracks repeated `$improve-codebase-architecture` reviews. Each
finding uses the project vocabulary from `CONTEXT.md` and the architecture
language of Module, Interface, Implementation, Seam, Adapter, Depth, Leverage,
and Locality.

The goal is not to claim literal perfection from one pass. The goal is to keep
review findings concrete, fix the ones that should move now, and leave only
explicitly scoped future work.

## Review 1: Internal Runtime Modules

Status: fixed.

- Resource Lifetime Module: extracted Resource Lifetime, Resource Dependency
  Graph, Resource Event Stream, duration parsing, and identifiers from the
  Resource Definition facade.
- Collection Store and Mutation Queue Module: extracted collection row/index
  state, pending mutation queue transitions, persistence, and Query Plan
  Diagnostics from the DB root facade.
- Start Request Runtime Module: extracted Request Runtime creation, provision,
  local server client installation, response-body finalization, and request
  teardown facts from Start root request handling.
- Start Transport Module: extracted Effect-shaped Start Fetch transport and
  request trace facts from the Start root facade.
- Start Manifest Wall Module: extracted manifest assembly, route discovery,
  virtual module generation, app graph policy validation, and generated route
  definition writes from the Vite adapter.

Evidence:

- `pnpm typecheck` passed.
- `pnpm build` passed.
- `pnpm test` passed with local server binding allowed: 39 files / 322 tests.
- `pnpm verify` passed end to end.

## Review 2: Effect Runtime Compatibility

Status: fixed in the current worktree.

- Resource Request Family: `Resource.requestFamily(...)` lets a Resource
  Definition keep Resource Store state, TTL, hydration, tags, and invalidation
  while delegating sibling load batching to Effect `RequestResolver`.
- Start Request Observability: Start request handling now emits Effect metrics,
  log annotations, and spans alongside JSON-safe `StartRequestTrace` facts.
- Effect RPC Compatibility: Start server functions can be described as
  `effect/unstable/rpc` descriptors and grouped as an `RpcGroup`, while the
  current Start transport remains the serving Adapter.

Evidence:

- `pnpm typecheck` passed.
- `pnpm exec vitest run packages/core/test/resource.test.ts packages/start/test/effect-rpc-compat.test.ts packages/start/test/start.test.ts` passed:
  3 files / 85 tests.

## Review 3: Deepening Candidates

Status: items 1-6 are fixed in the current worktree.

1. Devtools Inspection Module
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/bridge.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/src/panel-renderer.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/src/summary.ts`,
     `packages/devtools/test/devtools.test.ts`, `examples/devtools-*`.
   - Problem: snapshot storage, serialization, request trace records, summary
     building, causal graph construction, panel model generation, HTML
     rendering, and bridge installation shared one large Implementation.
   - Fix: `packages/devtools/src/serialization.ts` owns serialization,
     invalidation plan projection, route-plan projection, and defensive trace
     copies; `packages/devtools/src/store.ts` owns bounded snapshot storage and
     event recording; `packages/devtools/src/panels.ts` owns summary to
     panel-contract projection; `packages/devtools/src/panel-renderer.ts` owns
     deterministic panel HTML rendering, panel-id validation,
     DOM mount/update/unmount behavior, and the Effect-scoped mount helper; and
     `packages/devtools/src/bridge.ts` owns the scoped app-side inspected-window
     bridge install/uninstall lifecycle. `packages/devtools/src/summary.ts`
     owns request trace summaries, app-graph summaries, resource indexing,
     runtime event summaries, and causal graph construction. The devtools root
     remains the public facade and contract surface.
   - Benefits: store bugs, serialization bugs, summary bugs, causal graph bugs,
     panel model bugs, renderer bugs, and bridge lifecycle bugs now have narrow
     implementation interfaces while public imports stay stable.
   - Evidence: `pnpm --filter @effect-ui/devtools build` passed,
     `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests. Full `pnpm typecheck` and `pnpm test` also passed:
     40 files / 328 tests.

2. Live Query Runtime Module
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: Query Plan Diagnostics are extracted, but `QueryBuilder`,
     `LiveQuery`, Live Query Collection, and the incremental IVM engine still
     sit in the DB root.
   - Fix: `packages/db/src/live-query-runtime.ts` now owns the IVM graph,
     source synchronization, join stream construction, grouping, ordering,
     windowing, output multiplicity handling, and source preload/refetch loops.
     The DB root keeps the compact Query and Collection facades.
   - Benefits: incremental query behavior now has better locality and a smaller
     implementation interface. Query callers keep the same DSL leverage, while
     runtime bugs in joins, grouped rows, ordering, and source deltas live in
     the Live Query Runtime Module instead of the DB root.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/start/test/file-routes.test.ts packages/start/test/file-route-modules.test.ts packages/start/test/route-manifest.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 6 files / 70 tests.

3. Start Transport Protocol Module
   - Status: fixed.
   - Files: `packages/start/src/index.ts`, `packages/start/src/rpc.ts`,
     `packages/start/src/request-trace.ts`, `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: JSON/form decoding, RPC response encoding, Start Action Request
     handling, Progressive Action Result encoding, invalidation hydration, and
     failure classification lived in the Start root.
   - Fix: moved protocol decoding, response shaping, schema encode/decode,
     failure classification, invalidation payload serialization, action
     response metadata, client response parsing, and progressive form metadata
     into `start-transport-protocol.ts`. The Start root now orchestrates the
     Request Runtime and delegates wire rules to that Module.
   - Benefits: Start transport behavior now has better locality; JSON/form
     protocol bugs, action response metadata bugs, and client decode bugs can be
     tested through one protocol interface instead of searching the full Start
     root. The root module keeps leverage as the request handler facade.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` and
     `pnpm typecheck` passed,
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/effect-rpc-compat.test.ts`
     passed: 3 files / 67 tests, and
     `pnpm exec vitest run packages/start/test/action-manifest.test.ts packages/start/test/app-graph.test.ts`
     passed: 2 files / 16 tests.

4. Route Grammar Module
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/core/src/route-grammar.ts`,
     `packages/start/src/file-routes.ts`,
     `packages/start/src/file-route.ts`,
     `packages/start/src/file-route-modules.ts`,
     `packages/start/src/generated-route-definitions.ts`.
   - Problem: core Route matching/building and Start file-route manifest
     generation encoded overlapping route grammar rules.
   - Fix: `packages/core/src/route-grammar.ts` now owns canonical route path
     segments, param-name rules, optional param handling, path building,
     matching, manifest path rendering, route-id slugs, segment ordering, and
     segment-prefix checks. Core `route(...)` uses that grammar directly, and
     Start file routes now act as an Adapter from filesystem `$id` segments
     into the same grammar.
   - Benefits: route grammar bugs now have one implementation and one test
     surface. Core Route keeps leverage for typed navigation, while Start keeps
     locality around filesystem naming and manifest policy instead of
     re-encoding path semantics.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed,
     `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/start/test/file-routes.test.ts packages/start/test/file-route-modules.test.ts packages/start/test/route-manifest.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 6 files / 70 tests.

5. Start Diagnostics Contract Module
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/src/diagnostics-report.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/devtools/src/index.ts`.
   - Problem: Start App Graph Diagnostics are generated, validated, formatted
     into repair reports, and projected into devtools across separate
     Implementations.
   - Fix target: own diagnostic fact classification, policy violations,
     owner/guidance mapping, and devtools-ready projection in one diagnostics
     contract Module.
   - Fix: `packages/start/src/start-diagnostics-contract.ts` now owns
     diagnostic report facts, policy violation classification, owner grouping,
     and repair guidance; `packages/start/src/diagnostics-report.ts` remains a
     formatting facade.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/app-graph.test.ts packages/start/test/effect-rpc-compat.test.ts`
     passed: 3 files / 69 tests.

6. Solid Runtime Adapter Module
   - Status: fixed.
   - Files: `packages/solid/src/index.ts`, `packages/solid/src/runtime.ts`,
     `packages/solid/src/router.ts`, `packages/solid/src/hooks.ts`,
     `packages/solid-db/src/index.ts`, `packages/solid-db/src/collection.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/src/shared.ts`,
     `packages/solid/test/router.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: runtime context, browser navigation, route preload scopes, route
     rendering scopes, Resource hooks, Action hooks, Stream hooks, and DB hooks
     shared broad adapter Implementations. The deletion test showed the root
     Modules were acting as low-locality containers rather than deep
     interfaces.
   - Fix: kept the public Solid and Solid DB roots as facade Modules, then moved
     Runtime Spine ownership, router lifecycle, Resource/Action/stream hooks,
     Collection hook adaptation, Live Query hook adaptation, and collection
     subscription glue behind focused internal Modules.
   - Benefits: Solid callers keep the same compact interface while maintainers
     get better locality. Router lifecycle bugs now live near route scope
     management, hook bugs live near hook adaptation, and Solid DB query
     subscription bugs live behind the shared collection subscription seam.
   - Evidence: `pnpm --filter @effect-ui/solid typecheck` passed,
     `pnpm --filter @effect-ui/solid-db typecheck` passed, and
     `pnpm exec vitest run packages/solid/test/router.test.ts packages/solid-db/test/solid-db.test.ts`
     passed: 2 files / 2 tests.

## Review 4: Effect-First Coordination Follow-Up

Status: fixed for the findings in this pass; larger runtime-root candidates
remain open.

1. Devtools Store Module
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: the public devtools root still owned snapshot mutation, event
     sequencing, bounded history, action tracking, route/request recording, and
     summary/panel/causal graph reads. The Module was deep for callers, but its
     Implementation had poor locality.
   - Fix: `store.ts` now owns the Devtools Store runtime and exposes Effect
     operations as the implementation interface. Plain store methods are sync
     Adapters over those Effects for existing host callers. `serialization.ts`
     owns JSON-safe value projection, invalidation plan projection, route-plan
     projection, and defensive request-trace copies.
   - Benefits: Store ordering, limits, copies, and event recording now have one
     test surface. The public root keeps its facade leverage while future
     summary and causal-graph Modules can depend on a narrower Store interface.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests.

2. Effect-first test coordination
   - Status: fixed for the audited sites.
   - Files: `packages/core/test/action.test.ts`,
     `packages/core/test/resource.test.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/persisted-options.test.ts`,
     `packages/db/test/sqlite-persistence.test.ts`,
     `packages/start/test/start.test.ts`,
     `examples/project-console/src/domain.mock.test.ts`.
   - Problem: several tests coordinated Action, Resource, Collection, and
     StartAction concurrency with Promise handles even though the behavior under
     test was Effect-native scheduling.
   - Fix: replaced Promise lifetimes with `Effect.runFork(...)`,
     `runtime.runFork(...)`, `Fiber.join(...)`, `Fiber.await(...)`,
     `Effect.all(...)`, `Effect.flip(...)`, and
     `Effect.scoped(runtime.provide(...))` so internal sequencing stays inside
     Effect. Host Promise conversion remains at the Vitest boundary.
   - Benefits: tests now exercise the same fibers, interruption, and runtime
     provisioning semantics as the library. This improves locality for
     scheduler bugs and keeps Promise use as a host Adapter instead of an
     internal coordination seam.
   - Evidence: `pnpm typecheck` passed,
     `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts`
     passed: 2 files / 43 tests,
     `pnpm exec vitest run packages/db/test/sqlite-persistence.test.ts packages/db/test/persisted-options.test.ts packages/db/test/collection.test.ts`
     passed: 3 files / 40 tests,
     `pnpm exec vitest run examples/project-console/src/domain.mock.test.ts`
     passed: 1 file / 7 tests, and
     `pnpm exec vitest run packages/start/test/start.test.ts` passed:
     1 file / 57 tests.
   - Full gate: escalated `pnpm verify` passed after this follow-up with
     9 package builds, workspace typecheck, type tests, 40 root test files /
     328 tests, devtools-panel verify, devtools-extension verify, basic starter
     verify, project-console starter packaging/typecheck/tests/build, and leak
     scan.

3. Collection Runtime Module
   - Status: fixed for the root collection runtime.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-ids.ts`,
     `packages/db/src/collection-errors.ts`,
     `packages/db/src/collection-preload.ts`,
     `packages/db/test/*.test.ts`.
   - Problem: the DB root still owned Collection Definition construction,
     runtime store access, load/refetch, direct writes, change batches,
     optimistic mutation execution, event publication, and persistence
     coordination, so unrelated Query and adapter work had to share one large
     Implementation.
   - Fix: `collection-runtime.ts` now owns the runtime store, preload
     collection, load/refetch, pending mutation execution, direct writes,
     change-feed writes, persistence handoff, and `Collection.define(...)`
     implementation. `collection-ids.ts`, `collection-errors.ts`, and
     `collection-preload.ts` hold the stable symbols, tagged errors, and
     preload collector contract. The DB root remains the public Collection and
     Query facade.
   - Benefits: Collection runtime bugs now have a focused implementation
     interface and test surface. Query, sync adapters, flush policy, and
     persistence helpers can depend on a smaller runtime module instead of
     re-entering the full DB root.
   - Evidence: `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck`, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/flush-policy.test.ts packages/db/test/persisted-options.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/live-query-collection.test.ts packages/db/test/server-collection.test.ts packages/db/test/sync-adapter.test.ts`
     passed: 7 files / 58 tests.
   - Full gate: escalated `pnpm verify` passed after this extraction with 9
     package builds, workspace typecheck, type tests, 40 root test files / 328
     tests, devtools-panel verify, devtools-extension verify, basic starter
     verify, project-console starter packaging/typecheck/tests/build, and leak
     scan.

Open candidates from this pass:

- Start Request Handler Module: Start root still owns RPC/action/SSR endpoint
  selection, Request Runtime provisioning, request trace mutation,
  ResponseContext application, and stream finalization orchestration.
- Resource Runtime Module: core Resource still owns family cache lookup,
  in-flight fiber coordination, suspense reads, invalidation execution,
  dehydration, and hydration behind one large Implementation.
