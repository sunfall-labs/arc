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

Status: fixed for the findings in this pass. No open candidates remain from
Review 4.

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

4. Start Request Handler Module
   - Status: fixed.
   - Files: `packages/start/src/index.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/request-runtime.ts`,
     `packages/start/src/request-trace.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: the Start root still owned RPC/action/SSR endpoint selection,
     Request Runtime creation and provisioning, request trace mutation,
     ResponseContext application, and stream finalization orchestration.
   - Fix: `start-request-endpoints.ts` now owns server RPC/action endpoint
     execution, `start-request-preload.ts` owns request preload and collection
     hydration facts, and `start-request-handler.ts` owns endpoint selection,
     SSR render orchestration, response context application, request trace
     mutation, and runtime/stream finalization. The Start root remains the
     public facade and keeps client action/RPC helpers separate from server
     request lifecycle code.
   - Benefits: server request lifecycle bugs now have a focused Module and can
     depend on the existing request-runtime, request-trace, and transport
     protocol Interfaces without expanding the public root Implementation.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` and
     `pnpm typecheck` passed, and escalated
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts`
     passed: 3 files / 71 tests.

5. Resource Runtime Module
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-collector.ts`,
     `packages/core/src/resource-errors.ts`,
     `packages/core/src/resource-lifetime.ts`,
     `packages/core/src/resource-store.ts`.
   - Problem: the public Resource root still owned runtime store lookup,
     touched-ref collection, in-flight fiber coordination, suspense reads,
     invalidation execution, dehydration, hydration, and duplicate runtime
     contract declarations that broke Vite/Rolldown app-graph diagnostics.
   - Fix: `resource-runtime.ts` now owns store lookup, touched-ref collection,
     refresh/prefetch execution, suspense reads, invalidation execution,
     dehydration, and hydration. `resource.ts` keeps Resource Definition,
     family/tag diagnostics, and public Resource namespace wrappers.
     `resource-collector.ts` and `resource-errors.ts` hold the stable contract
     exports so source consumers do not see duplicate ESM exports.
   - Benefits: Resource runtime bugs now have better locality, and Start's Vite
     diagnostics path can parse Core source without duplicate export failures.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/resource.test.ts packages/core/test/resource-store.test.ts packages/core/test/runtime.test.ts packages/core/test/action.test.ts packages/core/test/action-result.test.ts packages/core/test/route-server.test.ts packages/start/test/start.test.ts`
     passed: 7 files / 128 tests.

Open candidates from this pass: none after the Start Request Handler and
Resource Runtime extractions. A fresh review should look for new candidates
instead of reopening the fixed Review 4 list.

## Review 5: Devtools Summary Follow-Up

Status: fixed for the finding in this pass. No open candidates remain from
Review 5.

1. Devtools Summary Contract Module
   - Status: fixed.
   - Files: `packages/devtools/src/summary.ts`,
     `packages/devtools/src/summary-app-graph.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: after the public devtools root was split, `summary.ts` became a
     new low-locality Implementation. It owned app graph summary projection,
     route/invalidation/request/runtime summary facts, resource indexing, and
     causal graph construction in one 1,400+ line Module.
   - Fix: `summary-app-graph.ts` now owns Start App Graph summary projection,
     `summary-facts.ts` owns normalized invalidation, route, request, runtime
     event, and resource index facts, and `causal-graph.ts` owns causal node and
     edge construction. `summary.ts` now composes those Modules into the public
     `DevtoolsSummary` facade.
   - Benefits: app graph summary bugs, runtime fact normalization bugs, and
     causal graph bugs now have separate implementation surfaces. The public
     devtools summary and causal graph exports remain stable.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests.

Full gate: escalated `pnpm verify` passed after the Start Request Handler,
Resource Runtime, and Devtools Summary extractions with 9 package builds,
workspace typecheck, type tests, 40 root test files / 328 tests,
devtools-panel verify, devtools-extension verify, basic starter verify,
project-console starter packaging/typecheck/tests/build, and leak scan.

Open candidates from this pass: none. The next architecture-deepening review
should start from a fresh scan rather than the fixed Review 4 or Review 5
findings.

## Review 6: DB Query Builder Follow-Up

Status: fixed for the finding in this pass. No open candidates remain from
Review 6.

1. Query Builder And Live Query Collection Modules
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: after Collection Runtime and Live Query Runtime were extracted,
     the DB root still owned the immutable Query Builder, aggregate helpers,
     one-shot query execution, live-query creation, query diagnostics, and
     read-only Live Query Collection adaptation. That kept Query behavior in a
     large facade Module instead of near Query Plan, Live Query Runtime, and
     collection-adapter concepts.
   - Fix: `query-builder.ts` now owns `QueryBuilder`, the public `Query`
     namespace implementation, aggregate helpers, source preloading, live query
     construction, and diagnostics delegation. `live-query-collection.ts` owns
     the adapter from a Live Query graph to a read-only Collection Definition.
     `index.ts` re-exports the Query interface and keeps Collection facade
     behavior.
   - Benefits: Query DSL, execution, and Live Query Collection adapter bugs now
     have focused Modules and test surfaces. The DB root keeps public leverage
     while Query Plan and Live Query Runtime remain the implementation seams for
     planning and incremental evaluation.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` and `pnpm typecheck`
     passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts packages/solid-db/test/solid-db.test.ts`
     passed: 3 files / 36 tests.

Open candidates from this pass: none. The next architecture-deepening review
should start from a fresh scan rather than the fixed Review 6 finding.

## Review 7: Core Effect Execution Seam

Status: fixed for the Core execution-seam finding in this pass. Follow-up
subagent probes are recorded in Review 8.

1. Core Effect Execution Seam
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/core/src/server.ts`,
     `packages/core/test/route-server.test.ts`.
   - Problem: `Route.preloadEffect(...)`,
     `Route.planNavigationEffect(...)`, and
     `Server.handleRouteEffect(...)` returned Effects while still invoking
     preload, route matching/schema decode, or route handlers during Effect
     construction. That made the Module Interface shallow: callers had to know
     hidden sync ordering and hidden throw modes even when composing Effects.
   - Fix: route preload invocation, navigation matching/schema decode, and
     server route handler invocation now run inside the returned Effect.
     Synchronous preload and handler failures are captured in typed Effect
     failure channels (`RoutePreloadError`, `RouteNavigationError`, and
     `ServerRouteHandlerError`), and schema decode failures from navigation
     planning are observed through the returned Effect instead of
     construction-time throws. The sync `route.match(...)` Interface remains
     unchanged.
   - Benefits: Effect-returning Interfaces now have better Locality and
     Leverage. Adapters can reason about route/server work as one Effect
     program, and tests cover the behavior through the public Interface instead
     of reaching into implementation order.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/core/test/runtime.test.ts`
     passed: 2 files / 23 tests.

2. Start Adapter Stream Coordination
   - Status: fixed.
   - Files: `packages/start/test/adapters.test.ts`.
   - Problem: one streaming adapter test still used `Promise.race(...)` for
     timeout coordination at the test seam.
   - Fix: replaced the Promise race with `Effect.raceFirst(...)` around an
     `Effect.tryPromise(...)` host read boundary.
   - Benefits: the test keeps host `ReadableStream` reads at the Adapter seam
     while scheduling and timeout coordination stay in Effect.
   - Evidence: the Promise-method grep over packages, examples, scripts, and
     type tests is clean. `pnpm --filter @effect-ui/start typecheck` passed,
     and the escalated
     `pnpm exec vitest run packages/start/test/adapters.test.ts` passed:
     1 file / 7 tests.

## Review 8: Fresh Large-Module Deletion-Test Follow-Up

Status: fixed for actionable findings in this pass. The Devtools probe found no
new Devtools split to make.

1. DB Query Builder And Live Query Collection
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/live-query-runtime.ts`.
   - Problem: the DB root still owned Query Builder construction, aggregate
     helpers, one-shot execution, live query creation, diagnostics delegation,
     and the Live Query Collection adapter. The public root Interface was
     useful, but the Implementation mixed Collection facade work with Query
     DSL and adapter behavior.
   - Fix: `query-builder.ts` now owns the Query Module and `Query` namespace
     implementation. `live-query-collection.ts` now owns the Adapter that turns
     a Live Query graph into a read-only Collection Definition. The DB root
     re-exports the public Query and Collection facades.
   - Benefits: Query and Live Query Collection behavior now have smaller test
     surfaces and better Locality while preserving public import leverage.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 2 files / 35 tests.

2. Start Manifest Entry Core
   - Status: fixed.
   - Files: `packages/start/src/manifest-entry-core.ts`,
     `packages/start/src/server-function-manifest.ts`,
     `packages/start/src/action-manifest.ts`.
   - Problem: server-function manifests and action manifests had separate
     Implementations for the same Manifest Wall mechanics: module id
     normalization, module classification, deterministic ids, entry validation,
     sort order, duplicate name/id/export checks, and browser-safe client
     reference validation.
   - Fix: `manifest-entry-core.ts` now owns the shared internal Manifest Entry
     Core. Server functions and actions remain separate public Modules and
     adapt their extra fields (`hasHandler` and action behavior metadata)
     through the shared seam.
   - Benefits: duplicate manifest bugs now have one implementation surface,
     while the public server-function/action Manifest Interfaces stay distinct.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/server-function-manifest.test.ts packages/start/test/action-manifest.test.ts packages/start/test/app-graph.test.ts`
     passed: 3 files / 21 tests.

3. Start Transport Public Interface
   - Status: fixed.
   - Files: `packages/start/src/index.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: the Start root had a curated transport/form/result export list,
     but also wildcard-exported `start-transport-protocol.ts`, leaking internal
     protocol helpers such as low-level request readers, response constructors,
     failure classifiers, and exit encoders.
   - Fix: removed the wildcard export. The root still exports the documented
     transport paths/headers through `rpc.ts`, browser clients, action form
     bridge, request predicates, invalidation-plan description, and Start
     action result types.
   - Benefits: the Start Transport Protocol remains a deep internal Module,
     while the root public Interface is narrower and easier to keep stable.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
     passed: 2 files / 64 tests.

4. Start Request Trace Recorder
   - Status: fixed.
   - Files: `packages/start/src/request-trace-recorder.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/request-trace.ts`.
   - Problem: endpoint and handler Modules directly mutated
     `StartRequestTraceFacts`, spreading failure-kind ordering, action/server
     function recording, route plan projection, and collection preload
     projection across request lifecycle code.
   - Fix: `request-trace-recorder.ts` now owns the mutation Interface for
     request trace facts. Endpoint and handler code records intent through
     `recordStartRequestTraceFailure`, server-function/action recorders, and
     preload recording.
   - Benefits: trace fact mutation rules have one Locality point without
     changing the final `StartRequestTrace` contract.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts`
     passed: 2 files / 64 tests.

5. Start App Graph Diagnostics Policy Contract
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/src/start-virtual-modules.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: app graph diagnostics policy validation lived in
     `app-graph.ts`, while the generated app graph virtual module embedded a
     second Implementation of unknown route preload policy violation
     collection and formatting.
   - Fix: `app-graph.ts` now exports
     `collectStartAppGraphDiagnosticsPolicyViolations` and
     `formatStartAppGraphDiagnosticsPolicyViolation`; the virtual module calls
     those helpers and reuses the existing unknown-route preload diagnostics
     functions.
   - Benefits: diagnostics policy semantics have one Interface whether callers
     validate in process or through Vite's resolved virtual module.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/app-graph.test.ts packages/start/test/start.test.ts packages/start/test/rpc.test.ts`
     passed: 3 files / 73 tests.

6. Devtools Large-Module Probe
   - Status: no action.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/summary.ts`,
     `packages/devtools/src/causal-graph.ts`.
   - Deletion test: passed. The Devtools root is a legitimate public
     contract/facade Module; `summary.ts` now composes focused summary Modules;
     and `causal-graph.ts` hides a large deterministic graph Implementation
     behind a small Interface. Splitting it now would expose one-adapter graph
     builder seams rather than increasing Depth.

Open candidates from this pass: none after the fixes above. Later follow-up
probes found new candidates, tracked in Review 9.

## Review 9: Core Signal Dependency Tracker Follow-Up

Status: fixed for the Signal Dependency Tracker finding. Other follow-up
probes still found actionable candidates in Core, DB, Devtools, and Start, so
this is not a clean-sweep point.

1. Signal Dependency Tracker Module
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/signal.ts`,
     `packages/core/src/signal-dependencies.ts`,
     `packages/core/test/signal.test.ts`,
     `packages/core/test/scope.test.ts`.
   - Problem: `watch(...)` and `Signal.derive(...)` each owned a separate
     dependency-tracking Implementation. `watch(...)` de-duped sources and
     queued reentrant runs; derived signals subscribed on every source read and
     dropped reentrant recomputes. A derived signal that read the same source
     twice could subscribe twice and recompute more than once for one update.
   - Fix: `signal-dependencies.ts` now owns the shared internal tracker for
     observer installation, source de-duping, cleanup, untracked reads, and
     queued reruns. `watch(...)` and `DerivedSignalImpl` are Adapters over the
     same dependency Interface.
   - Benefits: signal dependency semantics have one Locality point, while the
     public Signal Interface stays unchanged. Derived signals now get the same
     source de-duping and queued recompute behavior as `watch(...)`.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/signal.test.ts packages/core/test/scope.test.ts packages/core/test/route-server.test.ts packages/core/test/runtime.test.ts`
     passed: 4 files / 35 tests.

2. Form Validation Runtime
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/form.ts`,
     `packages/core/test/form.test.ts`,
     `packages/core/test/action-result.test.ts`.
   - Problem: `Form.validateEffect(...)` read and wrote shared form state
     across schema/custom validation without an epoch. If `setField(...)`,
     `reset(...)`, or another validation happened while validation was
     running, a stale validation could later commit `Valid` or `Invalid` state
     for old values.
   - Fix: form controllers now keep a validation revision. Field writes,
     reset, and validation starts advance the revision. Each validation
     snapshots values at start and only commits final form state when its
     revision is still current. Stale validations still return or fail with
     the captured validation result, but they do not mutate current state.
   - Benefits: the Form Module now owns async validation race semantics, giving
     callers a deeper Effect-first Interface and better Locality for future
     validation policy changes.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/form.test.ts packages/core/test/action-result.test.ts`
     passed: 2 files / 16 tests.

3. Collection Transaction Identity
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-mutation-queue.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: collection mutation transaction ids used a module-global
     counter. Hydrating a pending `ctx_1` into a fresh runtime could collide
     with the next newly-created transaction id, causing new pending mutations
     to alias restored mutation facts.
   - Fix: transaction identity now lives on Collection State. New optimistic
     mutations allocate ids from the active state, and hydration advances the
     state-local counter from restored pending transaction ids.
   - Benefits: optimistic mutation identity now has runtime/request Locality,
     and restored pending mutation facts cannot be overwritten by subsequent
     writes in the same Collection Store.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/persisted-options.test.ts packages/db/test/flush-policy.test.ts`
     passed: 3 files / 39 tests.

Open candidates still queued from follow-up probes: Core Definition Registry,
Core Action Submission Controller, Devtools Fact Identity, Devtools Store
Snapshot Detachment, Devtools Serialization Policy,
DB Collection Contract Module, DB Collection Registry Locality, DB Collection
Snapshot Codec, Start callable manifest entry assembly/deserialization, Start
App Graph Diagnostics Runtime, and Start File Route Path Decoder.
