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

Status: open for items 1-4; items 5-6 are fixed in the current worktree.

1. Devtools Inspection Module
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/test/devtools.test.ts`, `examples/devtools-*`.
   - Problem: snapshot storage, serialization, request trace records, summary
     building, causal graph construction, panel model generation, HTML
     rendering, and bridge installation still share one large Implementation.
   - Fix target: keep the public root as a facade while moving inspection
     contracts, summary, graph, panel, renderer, and bridge logic behind
     focused internal Modules.

2. Live Query Runtime Module
   - Files: `packages/db/src/index.ts`, `packages/db/src/query-plan.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: Query Plan Diagnostics are extracted, but `QueryBuilder`,
     `LiveQuery`, Live Query Collection, and the incremental IVM engine still
     sit in the DB root.
   - Fix target: put incremental evaluation, source synchronization, grouping,
     ordering, and windowing behind a Live Query Runtime Module.

3. Start Transport Protocol Module
   - Files: `packages/start/src/index.ts`, `packages/start/src/rpc.ts`,
     `packages/start/src/request-trace.ts`, `packages/start/src/start-fetch.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: JSON/form decoding, RPC response encoding, Start Action Request
     handling, Progressive Action Result encoding, invalidation hydration, and
     failure classification still live in the Start root.
   - Fix target: move protocol decoding, response shaping, failure
     classification, and action response metadata into a focused transport
     protocol Module.

4. Route Grammar Module
   - Files: `packages/core/src/route.ts`, `packages/start/src/file-routes.ts`,
     `packages/start/src/file-route.ts`,
     `packages/start/src/file-route-modules.ts`,
     `packages/start/src/generated-route-definitions.ts`.
   - Problem: core Route matching/building and Start file-route manifest
     generation encode overlapping route grammar rules.
   - Fix target: centralize route grammar and make File Route Manifest code an
     Adapter from file-system segments into that grammar.

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
