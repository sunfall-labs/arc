# Ultimate Goal Checklist

This file is the required tracking artifact for
[`docs/ultimate-goal-prompt.md`](./ultimate-goal-prompt.md).

Legend:

- `[x]` means the current repository has implementation, tests, docs, and
  verification evidence for the claim.
- `[ ]` means the item is still a future win condition or needs stronger
  verification before it can be claimed.

Last evidence pass: May 16, 2026.

## Prompt-To-Artifact Audit

- [x] Full multi-day AI/human team prompt exists.
  - Evidence: [`docs/ultimate-goal-prompt.md`](./ultimate-goal-prompt.md) now
    defines required reading, tracking rules, north star, non-negotiables,
    seven workstreams, operating mode, definition of done, final deliverables,
    comparison-blog requirement, and completion audit.
- [x] Checklist was improved into an evidence ledger.
  - Evidence: this file maps prompt requirements, workstreams, verification,
    shipped capabilities, and remaining gaps to concrete paths, tests, and
    command results.
- [x] Build/refine loop was run against the repo instead of only editing prose.
  - Evidence: `pnpm verify` passed after the sandboxed first run hit local
    listener `EPERM`; the approved rerun completed package build, typecheck,
    type tests, runtime tests, example typecheck/tests/build, and leak scan.
- [x] Friendly comparison blog post exists with code examples.
  - Evidence: [`docs/effect-ui-framework-comparison.md`](./effect-ui-framework-comparison.md).
- [x] The work stayed scoped.
  - Evidence: implementation edits were limited to Start request tracing,
    devtools request-trace summaries/causal graph support, type coverage, and
    docs/audit artifacts; no broad refactor or unrelated cleanup was performed.

## Start Of Push

- [x] Initial overnight operating requirement recorded.
  - Evidence: `docs/framework-perfection-charter.md` requires continuing the
    current push until 8:00 AM America/Denver on May 14, 2026, with
    Effect-first implementation and focused verification after each slice.
- [x] Required docs read by the current owner:
  - `CONTEXT.md`
  - `docs/best-framework-plan.md`
  - `docs/winning-spec.md`
  - `docs/architecture.md`
  - `docs/effect-style.md`
  - `docs/invariants.md`
  - `docs/competitiveness.md`
  - `docs/devtools.md`
  - `docs/db.md`
  - Evidence: final pass inspected the required docs and used their vocabulary
    for this checklist and the comparison blog.
- [x] Current repo state inspected and summarized.
  - Evidence: `git status --short` showed the workspace contents as untracked;
    no destructive cleanup was performed. `rg --files` confirmed packages,
    example app, docs, type tests, and CI workflow.
- [x] Workstreams assigned by package/file ownership.
  - Evidence:
    - Core Runtime: `packages/core/src`, `packages/core/test`,
      `type-tests/framework.test-d.ts`
    - Start: `packages/start/src`, `packages/start/test`,
      `examples/project-console/src/server*.ts`
    - DB: `packages/db/src`, `packages/db/test`, `packages/solid-db/src`
    - Compiler/App Graph: `packages/start/src/{file-routes,app-graph,vite}.ts`
    - Devtools: `packages/devtools/src`, `packages/devtools/test`
    - UI/TSRX/Example: `packages/solid/src`, `packages/tsrx/src`,
      `examples/project-console`
    - Docs/Product: `docs/`
- [x] Highest-leverage gaps identified against `docs/best-framework-plan.md`.
  - Evidence: `docs/competitiveness.md` names the active win conditions:
    golden-path full-stack loop, resource/action ergonomics, devtools
    causality, and production build wall.
- [x] Acceptance criteria written for each active workstream.
  - Evidence: sections below retain the prompt's per-workstream acceptance
    criteria and add verification evidence.
- [x] Focused verification commands agreed for each workstream.
  - Evidence: release gate is `pnpm verify`; focused commands are package
    tests such as `vitest run packages/core/test/*.ts`, Start tests,
    DB tests, devtools tests, type tests, and example tests/build.

## Core Runtime And Reactivity

- [x] `Signal` semantics are documented, tested, and ergonomic for latest-value
  reactivity and stream interop.
  - Evidence: `packages/core/test/signal.test.ts`; docs in
    `docs/architecture.md` and `docs/effect-style.md`.
- [x] `Resource` lifecycle covers initial, pending, refreshing, stale, success,
  failure, previous value, hydration, GC, retry, and event publication.
  - Evidence: `packages/core/test/resource.test.ts` covers status inspection,
    stale/GC timing, refresh-with-previous, typed failures, hydration cache
    population, retry, delete, and PubSub events.
- [x] `Resource` invalidation remains semantic through tags/refs and publishes
  inspectable invalidation plans.
  - Evidence: `packages/core/test/resource.test.ts`,
    `packages/core/test/action.test.ts`, and `packages/devtools/test/devtools.test.ts`.
- [x] `Resource` hydration populates visible state and Effect-backed cache state.
  - Evidence: `hydrates resource state and Effect cache without loading` in
    `packages/core/test/resource.test.ts`; Start hydration tests also prove no
    duplicate resource load after hydration.
- [x] `Action` lifecycle covers idle, pending, success, failure, typed input,
  typed output, typed errors, and latest invalidation plan.
  - Evidence: `packages/core/test/action.test.ts`; negative type cases in
    `type-tests/framework.test-d.ts`.
- [x] `Action` concurrency modes are tested for `latest`, `exhaust`, and
  `parallel`.
  - Evidence: `packages/core/test/action.test.ts`.
- [x] `Action` optimistic transactions commit on success and roll back on
  failure or interruption.
  - Evidence: optimistic success/failure/interruption tests in
    `packages/core/test/action.test.ts`.
- [x] `ActionResult` supports success, validation failure, redirect, domain
  failure, and result-carried invalidation.
  - Evidence: `packages/core/test/action-result.test.ts`.
- [x] `Route` APIs preserve schema/branded params and search inference.
  - Evidence: `packages/core/test/route-server.test.ts` and
    `type-tests/framework.test-d.ts`.
- [x] `Server` contract/client/implement flow stays browser-safe and
  schema-backed.
  - Evidence: `packages/core/test/server.test.ts`,
    `packages/core/test/route-server.test.ts`,
    `packages/start/test/server-function-manifest.test.ts`.
- [x] Server local/mock clients preserve Effect service requirements.
  - Evidence: `ServerClient.call(...)` returns an Effect with the target server
    function's requirements, while browser RPC clients still satisfy that surface
    with host-boundary Effects.
- [x] `Capability` services and layers remain the preferred app dependency seam.
  - Evidence: `packages/core/test/capability.test.ts` and
    `examples/project-console/src/domain.mock.test.ts`.
- [x] `Form` derives field names and field values from schemas.
  - Evidence: `packages/core/test/form.test.ts` and negative type assertions in
    `type-tests/framework.test-d.ts`.
- [x] Every async public API in the current surface is Effect-native.
  - Evidence: `prefetchEffect`, `refreshEffect`, `submitEffect`,
    `createRequestHandlerEffect`/`createRequestHandler`, collection `*Effect`
    APIs, adapter `*Effect` APIs, and the Start diagnostics CLI's
    `runStartDiagnosticsCliEffect` are covered by source exports and tests.
- [x] Promise boundaries are documented as host/platform adapters.
  - Evidence: `docs/effect-style.md` and `docs/architecture.md`.
- [x] Resource public preload/refresh APIs are Effect-native and track
  in-flight lifecycle with fibers.
  - Evidence: `packages/core/src/resource.ts`; `packages/core/test/resource.test.ts`
    covers dedupe and runtime-disposal interruption.
- [x] Resource Store has LSP-facing public seams instead of requiring private
  map access.
  - Evidence: `packages/core/src/resource-store.ts` exposes `eventBus`,
    `moduleRegistry`, `fiberRegistry`, and `diagnostics`; Resource Store tests
    use those seams for event/module/fiber assertions.
- [x] Core Action and Resource runtime calls keep service erasure at the runtime
  boundary.
  - Evidence: `packages/core/src/action.ts` and `packages/core/src/resource.ts`
    pass `Fiber.join`, interruption, in-flight refresh, and workflow Effects
    directly through `EffectUiRuntime` methods.
- [x] Program runtime errors preserve Runtime Spine failures.
  - Evidence: `packages/core/src/program.ts`, `packages/solid/src/hooks.ts`,
    `packages/react/src/hooks.ts`, and `type-tests/framework.test-d.ts` keep
    Program-domain failures separate from adapter/runtime provision failures
    through `Program.RuntimeError<E, ER>` and hook `ER` parameters.
- [x] Program timeline retention is an internal runtime policy.
  - Evidence: `packages/core/src/program-runtime-timeline.ts` owns Program event
    retention and disabled timeline behavior, with coverage in
    `packages/core/test/program.test.ts`.
- [x] Program facade is separated from contract, story, and runtime execution.
  - Evidence: `packages/core/src/program.ts` preserves public exports while
    `program-contract.ts`, `program-primitives.ts`, `program-story.ts`, and
    `program-runtime.ts` own focused internal Modules.
- [x] Program dispatch and subscription lifecycle is Effect-owned.
  - Evidence: `packages/core/src/program-runtime.ts` tracks pending
    `dispatchEffect(...)` acknowledgements with `Deferred`, completes them
    during disposal, restarts subscriptions from committed model changes, and
    uses subscription generations to drop stale emissions.
- [x] Start agent graph CLI semantics and formatting are separated.
  - Evidence: `packages/start/src/start-agent-graph-contract.ts`,
    `start-agent-graph-query.ts`, `start-agent-graph-display.ts`,
    `start-agent-graph-formatter.ts`, `start-agent-graph-impact.ts`, and
    `start-agent-graph-vocabulary.ts` own DTO contracts, query matching,
    display policy, text formatting, impact planning, and graph-kind
    vocabulary behind the stable `agent-graph.ts` facade. Start diagnostics
    DTO decoding now validates resource/tag/collection registry facts and
    rejects malformed preload/action enum strings before policy/reporting,
    `start-app-graph-diagnostics-policy.ts` owns route preload diagnostics
    policy validation for resolved runtime/Vite adapters while static build
    validation stays on static app graph facts, and
    Start agent graph constructors, diagnostics failures, and Core `Program`
    namespace aliases/direct contracts plus app graph DTO/errors/deserializer
    declarations and exported app-graph helper projectors have declaration-site
    JSDoc pinned by the public API audit for LSP hovers. The same audit now
    checks public Source Surface local-module docs bidirectionally against root
    barrel re-exports and explicit namespace-backed source-module allowances.
- [x] Core runtime service erasure is named at the runtime value boundary.
  - Evidence: `packages/core/src/runtime.ts` erases ManagedRuntime services at
    the `ManagedRuntime<any, ER>` value boundary, so runtime helpers no longer
    cast provided Effect programs.
- [x] Core scope and signal helper plumbing uses Effect primitive types directly.
  - Evidence: `packages/core/src/scope.ts` and `packages/core/src/signal.ts`
    no longer need local scoped-Effect assertions for finalizers, forks, or
    `Signal.watch(...)`; `UiScope` creates its closeable scope through
    `Effect.runSync(Scope.make("sequential"))` instead of direct
    `Scope.makeUnsafe(...)`, and full `pnpm verify` passed after the cleanup.
- [x] Core schema and EffectInput helpers keep assertions at data boundaries.
  - Evidence: `packages/core/src/server.ts`, `packages/core/src/form.ts`, and
    `packages/core/src/effect-like.ts` no longer cast whole Effect programs for
    schema decoding/encoding or EffectInput conversion.
- [x] Core Effect helper types avoid explicit Effect-any annotations.
  - Evidence: `packages/core/src/effect-like.ts`, `packages/core/src/runtime.ts`,
    and `packages/core/src/resource.ts` removed explicit
    `Effect.Effect<..., any>` annotations from package source.
- [x] Conditional helper types avoid ignored `any` placeholders.
  - Evidence: core Server/Route/Capability helpers, DB collection/query
    aggregate helpers, and Start action-result helpers use inferred placeholder
    parameters; focused package typechecks and public type tests passed, and the
    placeholder grep reports no hits. Full `pnpm verify` passed after this
    cleanup.
- [x] Remaining arbitrary wildcard boundaries are named where they are part of
  public assignability.
  - Evidence: core Action/Server/Resource, DB flush-policy, Solid-DB, and Start
    action surfaces use local `Any*` aliases or existing exported aliases for
    arbitrary definitions instead of repeated inline wildcard applications;
    focused typechecks, public type tests, and full `pnpm verify` passed.
- [x] DB query context erasure is named at runtime graph boundaries.
  - Evidence: `packages/db/src/index.ts` uses local `AnyCollectionRow`,
    `AnyQueryContext`, `AnyQueryAggregateRecord`, `AnyQueryGrouping`, and
    `AnyQueryBuilder` aliases around live-query joins, group-by, and IVM
    execution; DB typecheck, public type tests, DB Vitest files, and full
    `pnpm verify` passed.
- [x] DB store-explicit collection snapshots have one Interface.
  - Evidence: `packages/db/src/collection-definition-snapshot.ts` owns the
    marker, guard, store-explicit snapshot Interface, snapshot dispatch, hydrate
    preflight and store-aware hydrate application, and incomplete-marker error;
    `collection-persistence.ts` and `live-query-collection.ts` consume it, and
    DB tests pin incomplete markers plus complete store-explicit hydrate
    application as typed snapshot behavior.
- [x] Core runtime and optimistic signal erasure boundaries are named.
  - Evidence: `packages/core/src/action.ts` names optimistic signal patch
    storage with `AnyWritableSignal` and `AnySignalPatchState`;
    `packages/core/src/runtime.ts` names ambient runtime/service-erasure
    boundaries with `RuntimeManagedBoundary` and `CurrentRuntimeBoundary`;
    focused Core/DB typechecks, public type tests, and focused runtime/action/
    signal/collection tests passed. Full `pnpm verify` also passed.
- [x] Broad sharp-cast audit is clean across source and tests.
  - Evidence: DB change-feed tests use `toEffect(...)`, Start streaming tests
    use an explicitly typed blocking stream effect, and
    `rg -n 'as Effect\.Effect|as unknown as |as never|as any|@ts-ignore' packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
    reports no hits; focused DB/Start typechecks, public type tests, and touched
    tests passed. Full `pnpm verify` also passed.
- [x] Package source avoids raw Promise method lifecycle cleanup.
  - Evidence: action and Start action submitters use `Effect.ensuring` for
    in-flight cleanup; Solid/Solid DB background preloads catch inside Effect;
    source grep finds no `.then(...)`, `.finally(...)`, or non-Effect
    `.catch(...)` calls in package source.
- [x] Package fire-and-forget effects use fibers instead of floating Promises.
  - Evidence: Core reset/scope/signal/resource detaches, DB void write/hydrate
    APIs, Solid/Solid-DB background preloads, Start action reset, and Vite SSR
    dev middleware now use `runFork(...)` or `Effect.runFork(...)`; the
    package-source `void runPromise` grep reports no hits, and focused
    lifecycle typechecks/tests passed. Full `pnpm verify` also passed.
- [x] Example fire-and-forget effects also use fibers.
  - Evidence: devtools panel/extension entrypoints and the project-console UI
    helper use `Effect.runFork(...)` or `runtime.runFork(...)`; the
    package/example/script/type-test `void runPromise` grep reports no hits, and
    focused example verifies/typecheck passed. Full `pnpm verify` also passed.
- [x] Raw Promise constructor/method helpers are absent from source and tests.
  - Evidence: Start adapter listener/close/timer helpers use
    `Effect.callback(...)` and `Effect.sleep(...)`; `rg -n "new Promise|Promise\\.resolve|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
    reports no hits, and Start typecheck, public type tests, and Start adapter
    tests passed. Full `pnpm verify` also passed.
- [x] Low-risk Effect-shaped tests avoid async wrappers.
  - Evidence: Solid-DB, UiScope, and Resource Store tests return
    `Effect.runPromise(...)` programs; focused Core/Solid-DB typechecks, public
    type tests, and touched tests passed. Full `pnpm verify` also passed.
- [x] Compile-time rejection rules have type tests.
  - Evidence: `type-tests/framework.test-d.ts` and `pnpm typecheck:types`.
- [x] Compile-time Promise rejection tests avoid Promise-shaped callback syntax.
  - Evidence: `type-tests/framework.test-d.ts` uses declared Promise values for
    negative Promise-return checks; `pnpm typecheck:types` passed and the
    async/Promise-method grep over package source, scripts, and type tests
    reports no hits. Full `pnpm verify` passed after this cleanup.
- [x] Runtime lifecycle guarantees have behavioral tests.
  - Evidence: core runtime/resource/action/scope/server/route tests in
    `packages/core/test`.
- [x] Browser router link policy is shared across framework adapters.
  - Evidence: `packages/core/src/browser-router.ts` owns RouterLink hover/click
    decisions, React/Solid link adapters consume it, and Core/React/Solid router
    tests cover the shared policy and host wiring.
- [x] Package-source validation failures use typed errors instead of raw
  `Error`/`TypeError` throws.
  - Evidence: `docs/error-message-audit.md`,
    `packages/core/test/stable-stringify.test.ts`, and focused DB/devtools/Start
    tests added in the typed-error sweep; `StartDiagnosticsCliUsageError` now
    covers invalid diagnostics CLI input with usage guidance.

## Full-Stack Start Layer

- [x] SSR preload, render, server RPC, action handling, hydration, and teardown
  run through request runtimes.
  - Evidence: `packages/start/test/start.test.ts` request-runtime, RPC, action,
    hydration, and stream-finalizer tests.
- [x] Route params/search constraints stay opaque when helpers only carry
  arbitrary routes.
  - Evidence: `packages/core/src/route.ts`, `packages/core/src/app.ts`,
    `packages/solid/src/index.ts`, `packages/start/src/index.ts`, and
    `packages/start/src/virtual-modules.d.ts` use
    `Route.Definition<string, unknown, unknown>` at arbitrary route boundaries,
    while focused Core/Solid/Start typechecks, public type tests, and full
    `pnpm verify` passed.
- [x] Start client and hydration runtime options keep caller details opaque
  where the runtime is only an execution boundary.
  - Evidence: `packages/start/src/index.ts` and `packages/start/src/hydration.ts`
    keep services opaque while carrying generic runtime error parameters with
    `never` defaults for action client and hydration runtime options. Focused
    Start typecheck, public type tests, and full `pnpm verify` passed.
- [x] Start trace and teardown helpers avoid runtime wildcards except at the
  core ambient runtime boundary.
  - Evidence: Start collection trace, request-runtime teardown, response
    finalizer, and response completion helpers use
    generic runtime error parameters or `never` where host failures are
    intentionally erased, and focused Start typecheck plus public type tests and
    full `pnpm verify` passed.
- [x] Start runtime call sites keep service erasure at runtime/host boundaries.
  - Evidence: `packages/start/src/index.ts` and
    `packages/start/src/hydration.ts` pass request-runtime provision,
    request-handler work, StartAction fibers, response stream pull/cancel
    programs, and hydration sync Effects directly through runtime/Effect
    primitives.
- [x] Request runtimes use fresh request-local `ResourceStore` and
  `Collection.Store` state.
  - Evidence: `uses a fresh resource store for each SSR request`,
    `dehydrates DB collections from the SSR request runtime`, and DB collection
    runtime-isolation tests.
- [x] Streamed responses keep request runtimes open until body close or
  cancellation.
  - Evidence: `responseWithStreamFinalizer` handles stream `pull` completion
    and `cancel`; `keeps request runtime fibers alive until streamed response
    bodies close` verifies the lifecycle.
- [x] `ResponseContext` supports status, headers, and cookies across SSR, RPC,
  actions, and server routes.
  - Evidence: core server-route test, Start render/RPC tests, and Start action
    response code applies the same `ResponseContext` after action execution.
- [x] Server functions are contract-first with shared clients and server-only
  handlers.
  - Evidence: `Server.contract`/`Server.client`/`Server.implement` tests,
    project-console `domain.contract.ts` and `domain.server.ts`, manifest
    browser-safe client-reference tests.
- [x] Server function manifests have deterministic ids, schema flags, duplicate
  detection, and browser-safe references.
  - Evidence: `packages/start/test/server-function-manifest.test.ts`.
- [x] Start action manifests have deterministic ids and behavior metadata.
  - Evidence: `packages/start/test/action-manifest.test.ts`.
- [x] JSON Start actions decode input, run action definitions, encode typed
  results, hydrate refreshed refs, and replay invalidation metadata.
  - Evidence: Start action tests in `packages/start/test/start.test.ts`.
- [x] Plain form Start actions support no-JS validation, redirect, success, and
  failure flows.
  - Evidence: `packages/start/test/start.test.ts`,
    `examples/project-console/src/server.test.ts`, and
    `examples/project-console/src/full-stack-golden.test.ts`.
- [x] `StartAction.use` gives components Action-like state over the Start
  transport.
  - Evidence: `exposes a StartAction client instance with Action-like state` in
    `packages/start/test/start.test.ts`.
- [x] File-route generation writes deterministic route definitions and type
  maps.
  - Evidence: `packages/start/test/file-routes.test.ts`,
    `packages/start/test/start.test.ts`, and generated
    `examples/project-console/src/routeTree.gen.ts`.
- [x] Browser/server boundary checks prevent `.server.ts` leaks.
  - Evidence: Start transform test, manifest unsafe-reference tests, example
    production leak scan.
- [x] Deployment adapters cover current Node/fetch behavior with tests.
  - Evidence: `packages/start/test/adapters.test.ts`.
- [x] Start integration tests cover request isolation, hydration, progressive
  actions, redirects, validation, and leak scans.
  - Evidence: `packages/start/test/start.test.ts` and example SSR/golden tests.

## Data Layer And Local-First Foundation

- [x] Collections are runtime/request-local definitions with isolated row state.
  - Evidence: `packages/db/src/runtime-collection-store.ts` owns store lookup
    and initialization, and `packages/db/test/collection.test.ts` covers
    runtime/store isolation.
- [x] Collection load/refetch/mutation handlers are Effect-first.
  - Evidence: DB source exports `*Effect` methods; type tests reject async
    loaders; collection/server/sync tests exercise Effect handlers.
- [x] DB adapter EffectInput conversion stays behind named typed seams.
  - Evidence: sync, SQLite persistence, flush-policy, and server-collection
    adapters use typed helpers/combinators or a named PromiseLike bridge before
    entering collection Effects.
- [x] DB collection internals avoid local Effect requirement erasure outside query
  variance.
  - Evidence: DB collection persistence, load, mutation, change-feed, and
    source-preload paths use named Effect helpers or direct Effect combinators.
- [x] DB query variance boundaries are named or expressed in helper types.
  - Evidence: `packages/db/src/index.ts` carries joined filter/order functions
    through `NextContext extends TContext`, and the unprojected identity path is
    isolated behind `projectCurrentContext(...)`.
- [x] Collection retry policy uses Effect `Schedule`.
  - Evidence: collection load and mutation retry tests.
- [x] Collection mutation workflow owns optimistic commit/rollback and pending
  replay.
  - Evidence: `packages/db/src/collection-mutation-workflow.ts` owns
    insert/update/delete and flush orchestration; collection mutation, pending
    queue, rollback persistence, and optimistic rebase tests cover it.
- [x] Optimistic insert/update/delete mutations publish events and preserve
  rollback rows.
  - Evidence: collection optimistic success/failure, pending queue, rollback,
    and event tests.
- [x] Pending mutation queues can persist, restore, inspect, and flush.
  - Evidence: `packages/db/test/collection.test.ts`,
    `packages/db/test/persisted-options.test.ts`,
    `packages/db/test/flush-policy.test.ts`.
- [x] Secondary indexes support scalar and multi-value lookup.
  - Evidence: collection index tests and multi-value indexed join tests.
- [x] Indexed joins use declared collection indexes where possible.
  - Evidence: `uses declared collection indexes for indexed joins` and query
    diagnostics tests.
- [x] Live queries expose materialized, inspectable derived views.
  - Evidence: `packages/db/test/collection.test.ts` and
    `packages/db/test/live-query-collection.test.ts`.
- [x] Query diagnostics explain sources, joins, row counts, and estimated cost.
  - Evidence: `describes query plans with indexed join cost diagnostics`.
- [x] Query context identity is centralized.
  - Evidence: `packages/db/src/query-context-identity.ts` owns source alias/key
    identity, merged context identity, ordered tie-break identity, IVM metadata,
    and collection row delta identity shared by `query-execution-plan.ts` and
    `live-query-runtime.ts`.
- [x] Collection persistence supports string storage and SQLite-shaped adapters.
  - Evidence: `packages/db/test/collection.test.ts`,
    `packages/db/test/sqlite-persistence.test.ts`.
- [x] Sync adapters cover server functions, resources, host APIs, and
  TanStack Query-shaped sources.
  - Evidence: `packages/db/test/sync-adapter.test.ts` and
    `packages/db/test/server-collection.test.ts`.
- [x] Background flush policy can skip/defer work through Effect services.
  - Evidence: `packages/db/test/flush-policy.test.ts`.
- [x] Start SSR collects and hydrates route-touched and route-declared
  collections.
  - Evidence: Start collection preload/hydration tests.
- [x] Devtools can observe collection events without private row maps.
  - Evidence: `Collection.Store` event API and devtools collection-event tests.
- [x] Example app demonstrates collections, indexes, optimistic mutation,
  sync, and hydration.
  - Evidence: `examples/project-console/src/project-collections.ts`,
    `domain.mock.test.ts`, `server.test.ts`, and `full-stack-golden.test.ts`.

## Compiler, Manifests, And App Graph

- [x] Generated file-route manifests are deterministic and validated.
  - Evidence: `packages/start/test/file-routes.test.ts` and
    `packages/start/test/route-manifest.test.ts`.
- [x] Duplicate route paths fail before runtime.
  - Evidence: `rejects files that collapse to the same route path`.
- [x] Malformed dynamic route segments fail before runtime.
  - Evidence: `rejects malformed dynamic route params`.
- [x] Generated route files assert imported route literal paths.
  - Evidence: generated-route tests in `packages/start/test/start.test.ts`.
- [x] Generated route type maps expose route id, path, params, search, and href
  option views.
  - Evidence: `packages/start/src/virtual-modules.d.ts`,
    generated route file tests, and type tests.
- [x] Server function manifests validate names, ids, exports, schemas, and
  browser references.
  - Evidence: `packages/start/test/server-function-manifest.test.ts`.
- [x] Action manifests validate ids, exports, endpoint references, and behavior
  metadata.
  - Evidence: `packages/start/test/action-manifest.test.ts`.
- [x] Start app graph includes routes, server functions, actions, endpoints,
  module ownership, schemas, resources, tags, collections, and preload
  declarations.
  - Evidence: `packages/start/test/app-graph.test.ts` and Vite virtual graph
    tests.
- [x] Static diagnostics use `present`, `absent`, or `unknown` rather than
  guessing.
  - Evidence: app graph diagnostics tests.
- [x] Strict build policy can reject missing wire schemas.
  - Evidence: Start build policy tests.
- [x] Strict build policy can reject unknown route preload resources.
  - Evidence: app graph diagnostics policy tests.
- [x] Strict build policy can reject unknown route preload collections.
  - Evidence: app graph diagnostics policy tests.
- [x] Strict build policy can reject unknown action behavior metadata.
  - Evidence: Start build policy tests.
- [x] Diagnostics reports group issues by source owner with concrete repair
  guidance.
  - Evidence: `prints an agent-readable Start diagnostics repair report`.
- [x] App graph artifacts are consumable by CI, devtools, tests, and agents.
  - Evidence: `loadStartAppGraphDiagnostics(...)`, `effect-ui-start
    diagnostics`, devtools summary tests, and generated virtual modules.
- [x] Start diagnostics CLI command vocabulary has one Effect v4 source of truth.
  - Evidence: `packages/start/src/start-diagnostics-cli-contract.ts` feeds
    graph/impact query-kind subcommands, validation text, and impact verify
    commands while `packages/start/src/cli.ts` keeps the real Effect v4
    `Command` tree.

## Devtools And Observability

- [x] Devtools store exposes Effect-native read/write methods.
  - Evidence: `packages/devtools/test/devtools.test.ts`.
- [x] Devtools snapshots are JSON-safe.
  - Evidence: JSON serialization and non-JSON normalization tests.
- [x] Devtools summaries normalize resources, actions, invalidations, routes,
  runtime events, app graph facts, and collections.
  - Evidence: devtools summary and golden-path tests.
- [x] Causal graph nodes and edges are deterministic.
  - Evidence: causal graph determinism tests.
- [x] Route plans show matched route, params, search, preloaded refs, and
  hydration.
  - Evidence: `describeRoutePlan` tests.
- [x] Resource timelines have public facts for pending, success, failure,
  hydration, deletion, GC, stale/refresh, and invalidation events.
  - Evidence: `Resource.StoreEvent` variants in `packages/core/src/resource-store.ts`,
    status tests, resource event tests, and devtools runtime-event summaries.
- [x] Action timelines include state, input, invalidation plan, concurrency, and
  Start action metadata.
  - Evidence: action tracking tests, Start-shaped action tests, and app graph
    action behavior metadata.
- [x] Collection timelines include load, hydrate, mutation, rollback,
  persistence, sync, and pending queue facts.
  - Evidence: `Collection.StoreEvent` variants, DB tests, sync diagnostics, and
    devtools collection-event tests.
- [x] Server RPC traces separate domain failures, protocol errors, transport
  errors, defects, and interruption.
  - Evidence: Start RPC/action transport code and tests distinguish typed
    protocol failures, transport failures, schema/domain failures, defects, and
    interruption payloads.
- [x] Request traces include services, request context, response context,
  resources, collections, fibers, streams, and teardown.
  - Progress: `@effect-ui/devtools` now exposes a structured
    `DevtoolsRequestTrace` data contract, store recording API, summary, and
    causal graph integration.
  - Progress: `@effect-ui/start` request handlers now emit a structurally
    compatible trace through `onRequestTrace` for SSR, server RPC, Start
    actions, response stream close, response stream cancellation, and request
    failure paths.
  - Evidence: teardown includes runtime disposal, reason, start/completion
    timestamps, duration, and before/after Resource Store snapshots with focused
    Start and devtools tests.
  - Verification: `pnpm verify` passed after the richer teardown trace slice:
    34 package test files / 300 tests, example typecheck, 4 example test files /
    23 tests, example build, and leak scan.
- [x] Devtools panels have documented target data models.
  - Evidence: `docs/devtools.md` target panels and `DevtoolsPanels` panel-model
    sections.
- [x] Devtools panels have a browser-embeddable UI renderer.
  - Evidence: `renderDevtoolsPanelsHtml`, `renderDevtoolsPanelsHtmlEffect`,
    `mountDevtoolsPanels`, and `mountDevtoolsPanelsEffect` in
    `packages/devtools/src/index.ts`, with focused devtools tests and public
    type tests.
- [x] Devtools never read private runtime maps.
  - Evidence: devtools consumes public app graph diagnostics, serialized
    invalidation plans, route plans, Resource events, Collection events, and
    action instances.

## UI Adapter, TSRX, And Example App

- [x] TSRX Vite integration uses the Solid target correctly.
  - Evidence: `examples/project-console/vite.config.ts` and example build.
- [x] TSRX typechecking uses `tsrx-tsc` with the TypeScript plugin.
  - Evidence: `examples/project-console/package.json`, `pnpm example:typecheck`.
- [x] Solid runtime adapter owns component scopes and route scopes.
  - Evidence: `packages/solid/src/index.ts` forks runtime-provided scoped route
    preload Effects under `UiScope`; Solid-DB adapter tests cover collection and
    live-query hooks.
- [x] Component APIs stay compact and ergonomic.
  - Evidence: `packages/solid/src/index.ts` exports `RuntimeProvider`,
    `RouterProvider`, `useResource`, `useAction`, `useSignal`; example app uses
    them directly.
- [x] Solid hook wildcard defaults avoid UI-local `any` where requirements are
  opaque.
  - Evidence: `packages/solid/src/index.ts` defaults Resource hook
    requirements to `unknown` and uses record/unknown-shaped route outlet
    boundaries.
- [x] Solid runtime provider and router surfaces keep runtime/source details
  opaque where they only cross UI execution boundaries.
  - Evidence: `packages/solid/src/index.ts` uses
    generic runtime/source parameters with `never` defaults for
    provider/router surfaces and a `never` runtime-error context, while
    `packages/solid-db/src/index.ts` uses an opaque runtime for collection
    subscription. Solid, Solid-DB, public type tests, and full `pnpm verify`
    passed.
- [x] Example UI fire-and-forget helpers keep runtime details opaque.
  - Evidence: `examples/project-console/src/App.tsx` accepts
    an opaque runtime service channel with a generic runtime error parameter in
    the local UI effect helper, and the project-console typecheck and full
    `pnpm verify` passed.
- [x] Example app uses schema-branded route params and domain ids.
  - Evidence: `examples/project-console/src/domain.contract.ts`,
    `domain.test.ts`, and generated route type tests.
- [x] Example app demonstrates resources with stale/refresh/error UI.
  - Evidence: resources in `domain.ts`, UI states in `App.tsx`, and domain/mock
    tests.
- [x] Example app demonstrates Start actions with pending, success, validation,
  redirect, failure, invalidation, and hydration metadata.
  - Evidence: `domain.mock.test.ts`, `server.test.ts`, and
    `full-stack-golden.test.ts`.
- [x] Example app demonstrates collections and live query or indexed query use.
  - Evidence: `project-collections.ts` and example tests.
- [x] Example app demonstrates capability-based mocking in tests.
  - Evidence: `examples/project-console/src/domain.mock.test.ts`.
- [x] Example app demonstrates SSR and hydration without duplicate fetches.
  - Evidence: example SSR tests plus Start hydration idempotency tests.
- [x] Example app demonstrates no-JS form fallback.
  - Evidence: plain form POST tests in `examples/project-console/src/server.test.ts`.
- [x] Example app production build passes server-only leak scan.
  - Evidence: example-local `pnpm build` and `pnpm leak-scan` scripts are
    delegated by root scripts and passed inside `pnpm verify`.
- [x] Example UI fire-and-forget work stays Effect-first.
  - Evidence: `examples/project-console/src/App.tsx` routes background
    invalidation/refetch work through a generic `runUiEffect(...)` helper and
    `Effect.catch(...)` instead of local Effect requirement-erasure casts.

## Docs, Product, And Developer Experience

- [x] `docs/best-framework-plan.md` reflects the product north star.
- [x] `docs/winning-spec.md` reflects current execution goals and success
  metrics.
- [x] `docs/architecture.md` matches implementation reality.
- [x] `docs/effect-style.md` explains idiomatic Effect UI code.
- [x] `docs/invariants.md` captures non-negotiable product guarantees.
- [x] `docs/competitiveness.md` explains the competitive and winning bars.
- [x] `docs/devtools.md` documents observable facts and target panels.
- [x] `docs/migration-notes.md` maps common source-framework patterns onto the
  Effect UI golden path.
- [x] `docs/release-notes.md` records the current stable, experimental, and
  limited surfaces.
- [x] `docs/db.md` explains collections, live queries, persistence, sync, and
  hydration.
  - Evidence: docs were inspected in the final pass; their terminology matches
    current source/test surfaces.
- [x] Examples in docs are copyable or clearly illustrative.
  - Evidence: docs use APIs covered by `type-tests/framework.test-d.ts` and
    package tests; `examples/project-console/README.md` now records the
    copyable example path, monorepo-only alias caveat, and checked rich-starter
    packaging command; `docs/starter.md` points to `examples/basic-starter` as
    the minimal checked starter, `examples/react-starter` as the checked React
    adapter starter, and documents the generated project-console starter
    payload.
- [x] New architectural decisions are recorded in docs or ADRs.
  - Evidence: no new architecture decision was introduced in this pass; existing
    decisions remain in docs. No ADR needed.
- [x] Agent workflows can discover owners through docs and generated artifacts.
  - Evidence: this checklist ownership map, Start diagnostics repair report, and
    generated app graph/route tree artifacts.
- [x] Friendly comparison blog post explains the current position against
  top-tier frameworks with code examples.
  - Evidence: [`docs/effect-ui-framework-comparison.md`](./effect-ui-framework-comparison.md).

## Verification Gate

- [x] Focused tests pass for each changed package.
  - Latest focused evidence: Review 155 ran Core/React/Solid/DB/Devtools/Start
    package typechecks, public type tests, public API audit, Effect-first audit
    over 272 files, DB collection tests 1 file / 116 tests, Devtools tests 1
    file / 73 tests, Start start/app-graph tests 2 files / 170 tests,
    Core/React/Solid hook/router tests 5 files / 76 tests, script syntax
    checks, `pnpm example:pack-dry-run` across 16 package targets, and
    `git diff --check`. Latest full evidence:
    `pnpm verify` ran all root package tests after Review 155: 53 test files /
    941 tests.
- [x] Type tests pass after compile-time API changes.
  - Evidence: `pnpm typecheck:types` completed inside `pnpm verify`.
- [x] Example typecheck passes.
  - Evidence: `pnpm example:typecheck` completed inside `pnpm verify`.
- [x] Example tests pass.
  - Evidence: root example tests passed, React starter verify passed with 1
    starter test file / 3 tests, and project-console passed 4 test files / 27
    tests.
- [x] Example build passes.
  - Evidence: Vite production builds for the basic starter, React starter, and
    project-console completed inside `pnpm verify`.
- [x] Example leak scan passes.
  - Evidence: example-local `pnpm leak-scan` returned no matches for
    server-only seed data or server module sentinels.
- [x] Copyable starter-suite packaging passes.
  - Evidence: `pnpm starter:package` verifies basic, React, and
    project-console generated starters, rewrites workspace dependencies to local
    file packages, removes monorepo aliases, installs outside the workspace,
    and runs each generated starter's own `verify` script.
- [x] Starter packaging script host reporting stays Effect-driven.
  - Evidence: `scripts/package-project-console-starter.mjs` reports success and
    failure inside the Effect pipeline, with top-level await kept as the Node
    host boundary.
- [x] `pnpm verify` passes from the repo root.
  - Evidence: approved rerun completed successfully. The first sandboxed run
    reached tests and failed only because local `127.0.0.1` listener binding was
    blocked with `EPERM`.
- [x] Verification output summary is recorded in the final handoff.
  - Evidence: see "Final Handoff" below.

## Daily Checkpoints

### Day 1

- Completed:
  - Prompt audited and refined.
  - Checklist converted from empty boxes into evidence-backed tracking.
  - Release gate run and confirmed green.
  - Comparison blog post added.
- Evidence:
  - `pnpm verify` passed after localhost-binding approval.
  - Runtime package tests at that checkpoint: 33 files, 292 tests.
  - Example tests: 4 files, 23 tests.
  - Example build and leak scan passed.
- Blockers:
  - No blocker for current docs/prompt/blog deliverables.
  - The richer Start request-runtime teardown gap from this checkpoint has since
    been closed; current remaining gaps are listed below.
- Next owners:
  - Devtools owners should build the first UI panel against the richer request
    trace payload.

### Trace Slice

- Completed:
  - Devtools request trace data model, snapshot storage, summary data, runtime
    event, and causal graph integration.
  - Start `onRequestTrace` hook for SSR, server RPC, Start actions, and response
    stream close.
  - Stream cancellation and request failure trace assertions.
  - Effect-first stream finalizer so Web Stream callbacks run one Effect program
    at the host boundary.
  - Type-test compatibility from `StartRequestTrace` to `DevtoolsRequestTrace`.
- Evidence:
  - `pnpm exec vitest run packages/start/test/start.test.ts` passed: 1 file,
    51 tests.
  - `pnpm typecheck` passed.

### Typed Error Slice

- Completed:
  - Replaced remaining package-source raw `Error`/`TypeError` throws with typed
    `Data.TaggedError` classes carrying repair guidance.
  - Added stable stringify cycle-path diagnostics and preserved repeated
    acyclic reference support.
  - Added focused core, DB, devtools, and Start tests for the new errors.
- Evidence:
  - `rg -n "throw new (TypeError|Error)" packages/*/src -g '*.ts'` found no
    remaining raw package-source throws.
  - `pnpm exec vitest run packages/core/test/stable-stringify.test.ts packages/db/test/server-collection.test.ts packages/db/test/sqlite-persistence.test.ts packages/devtools/test/devtools.test.ts packages/start/test/start.test.ts`
    passed: 5 files, 79 tests.
  - `pnpm typecheck` passed.
  - `pnpm verify` passed: 34 package test files / 298 tests, example
    typecheck, 4 example test files / 23 tests, example build, and leak scan.
- Remaining:
  - Richer teardown details if the next tests reveal missing facts.

### Resource Fiber Slice

- Completed:
  - Replaced Resource public in-flight Promise bookkeeping with an Effect
    `Fiber` record.
  - Runtime disposal, hydration, and resource deletion now interrupt tracked
    public prefetch/refresh fibers.
  - Added tests for public prefetch dedupe and runtime-disposal interruption.
- Evidence:
  - `pnpm exec vitest run packages/core/test/resource.test.ts` passed: 1 file,
    24 tests.
  - `pnpm typecheck` passed.
  - `pnpm verify` passed: 34 package test files / 300 tests, example
    typecheck, 4 example test files / 23 tests, example build, and leak scan.

### Promise Method Slice

- Completed:
  - Removed remaining package-source `.then(...)`, `.finally(...)`, and
    non-Effect `.catch(...)` calls.
  - Moved action, Start action, Solid router, Solid resource preload, and
    Solid DB preload cleanup/error handling into Effect programs.
- Evidence:
  - `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts packages/start/test/start.test.ts packages/solid-db/test/solid-db.test.ts`
    passed: 4 files, 92 tests.
  - `pnpm typecheck` passed.
  - `pnpm verify` passed: 34 package test files / 300 tests, example
    typecheck, 4 example test files / 23 tests, example build, and leak scan.

## Final Handoff

- [x] Shipped capabilities summarized.
  - Evidence: workstream sections above.
- [x] Changed packages/docs/examples listed.
  - Evidence: changed docs include `README.md`,
    `docs/ultimate-goal-prompt.md`, `docs/ultimate-goal-checklist.md`,
    `docs/effect-ui-framework-comparison.md`,
    `docs/framework-perfection-charter.md`,
    `docs/public-api-inventory.md`, `docs/perfection-progress.md`,
    `docs/effect-first-audit.md`, and
    `docs/example-copyability-and-leak-audit.md`.
- [x] Completed checklist items have evidence notes.
  - Evidence: every checked item above has path/test/command evidence.
- [x] Remaining unchecked competitive-bar items listed.
  - Evidence: platform-specific deployment packages beyond generic Node/fetch
    remain future production-readiness items from `docs/winning-spec.md`.
- [x] Remaining unchecked winning-bar items listed.
  - Evidence: next section.
- [x] Next recommended workstreams listed.
  - Evidence: next section.
- [x] Architectural decisions needing ADRs or docs updates listed.
  - Evidence: no new ADR required for the Start Action Response Codec
    extraction.
- [x] `pnpm verify` latest result recorded.
  - Evidence: root `pnpm verify` passed on May 16, 2026 after the Review 155
    runtime identity, persistence commit, Devtools cleanup/redaction, Start
    diagnostics, and script guardrail slice: 11 package builds, workspace
    typecheck, type tests, public API inventory audit, Effect-first audit over
    272 files, 53 root test files / 941 tests, devtools-panel verify with 1
    panel test file / 2 tests,
    devtools-extension verify with 1 extension test file / 20 tests, basic
    starter verify with 1 starter test file / 2 tests, React starter verify
    with 1 starter test file / 3 tests, generated starter-suite
    packaging/verifies for basic/react/project-console, 16-target package
    dry-run gate, project-console typecheck, 4 project-console test files / 27
    tests, project-console build, and leak scans.
- [x] Latest focused verification recorded.
  - Evidence: Review 155 records focused Core/React/Solid/DB/Devtools/Start
    package typechecks, public type tests, public API audit, Effect-first audit
    over 272 files, DB/Devtools/Start/Core/React/Solid focused tests, script
    syntax checks, the 16-target package dry-run metadata/payload gate, and
    `git diff --check`. Full verification is recorded in the Review155 full
    gate above.

## Remaining Winning-Bar Items

- [x] Turn the documented devtools target panels into an actual browser or app
  UI once the trace payload is stable.
  - Evidence: `@effect-ui/devtools` now exposes deterministic HTML rendering
    and an Effect-scoped DOM mount helper for the `DevtoolsPanels` contract.
- [x] Integrate the browser panel renderer into a dedicated app shell.
  - Evidence: `examples/devtools-panel` mounts the renderer in a Vite app shell
    and `pnpm devtools-panel:verify` passed.
- [x] Package the devtools panel as a browser extension.
  - Evidence: `examples/devtools-extension` builds a Manifest V3 devtools page
    and panel page around the public renderer, verifies panel registration and
    manifest shape, reads live inspected-page payloads from
    `globalThis.__EFFECT_UI_DEVTOOLS__` when present, and
    `pnpm devtools-extension:verify` passed.
- [x] Add copyable starter-suite packaging.
  - Evidence: `scripts/package-project-console-starter.mjs` generates
    `.test-dist/starters/basic`, `.test-dist/starters/react`, and
    `.test-dist/starters/project-console`, rewrites workspace protocol
    dependencies to local `.effect-ui-packages/*` file dependencies, removes
    monorepo Vite aliases, writes standalone `tsconfig.json` files, verifies app
    manifests, runs isolated non-workspace installs, and executes generated
    `verify` scripts through `pnpm starter:package`.
- [ ] Add broader host-specific adapter packages when real host behavior is
  needed beyond the generic Node/fetch facades.
  - Evidence: current Node/fetch deployment guidance exists in
    `docs/deployment.md`, tested Node/fetch adapter facades exist as
    `@effect-ui/start-node` and `@effect-ui/start-fetch`, and
    Cloudflare/Vercel Edge/Netlify Edge/Bun/static recipes exist in
    `docs/deployment.md`; platform-specific packages with behavior beyond the
    generic Node/fetch facades remain future work.
- [x] Add benchmarks for SSR, route preload, resource cache behavior, DB live
  query behavior, and RPC/action transport.
  - Evidence: `benchmarks/framework-baseline.bench.ts` and
    `docs/benchmark-baseline-audit.md`.

## Next Recommended Workstreams

Use [`docs/framework-perfection-charter.md`](./framework-perfection-charter.md)
as the several-week cleanup, improvement, iteration, and release-candidate
quality goal.

1. Extend request traces with any missing response context, collection, and
   request-fiber details uncovered by real panel usage.
2. Add platform-specific adapter packages only where a host needs behavior
   beyond the generic Node/fetch facades and documented recipes.
3. Keep the project-console starter packaging aligned with published package
   versions once package publication is finalized.
