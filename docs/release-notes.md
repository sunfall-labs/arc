# Release Notes Draft

This is the current release-candidate snapshot for the pre-release Effect UI
framework. Package manifests remain private, so this is not an npm release note
yet.

## Stable For The First External App

- Core runtime primitives: Signals, Programs, Resources, Actions, Forms, Routes,
  Capabilities, server contracts, scoped UI work, and request-local runtimes.
- Public async library APIs return Effect v4 values; Promise-shaped entrypoints
  are reserved for explicit runtime, Suspense, stream, CLI, Vite, or host
  compatibility boundaries.
- LSP-facing JSDoc describes the purpose and composition model for the core,
  DB, Solid, Start, Node, and Fetch concepts.
- Start request handling: SSR, RPC, Start actions, hydration payloads, streamed
  HTML responses, request traces, and build diagnostics.
- Start agent graph and impact inspection: `effect-ui-start graph`,
  `effect-ui-start impact`, `createStartAgentGraph(...)`, and
  `createStartAgentGraphImpact(...)` expose the resolved app topology as typed,
  queryable route/action/resource/collection/module/finding facts plus concise
  edit briefs. Text output is concise by default, with raw graph ids/facts/edges
  behind `--verbose` and full machine payloads behind `--json`.
- Node and Fetch host facades: `@effect-ui/start-node` and
  `@effect-ui/start-fetch`.
- Devtools data contracts: snapshots, summaries, causal graphs, request traces,
  panel models, deterministic HTML rendering, the checked panel app shell, and
  the checked browser-extension shell with an inspected-window bridge.
- Local-first DB surface: Collections, live queries, persistence, sync adapter
  seams, mutation queues, and flush policies.
- Solid adapters: runtime provider, router, Program hooks, Resource hooks,
  Action hooks, stream hooks, and collection hooks.
- React adapters: runtime provider, component scopes, Signal/Stream/Program/
  Resource/Action hooks, Suspense read adapters, and React DB hooks.
- Starter paths: `examples/basic-starter` for the smallest full-stack shell,
  `examples/project-console` for the golden-path app, and
  `pnpm starter:project-console:package` for a generated rich starter payload.

## Experimental Or Expert-Public

- Start Vite helpers, virtual module helpers, diagnostics loaders, and generated
  app graph artifacts are public for CI, starter tooling, and agent workflows,
  but remain expert-facing.
- DB query builder internals intentionally keep a small cast boundary around
  joined context variance and the default projector.
- DB incremental live queries use a named `IOperator` bridge for the custom IVM
  flatMap operator instead of an inline bottom-type cast.
- DB query joins now carry selected projectors with a narrower direct function
  assertion; the remaining broad query casts are limited to predicate/order
  variance and the unprojected identity branch.
- Core and DB type-id declarations preserve `unique symbol` types with
  self-type assertions instead of `as never` bottom casts.
- Core runtime integration with Effect `ManagedRuntime` keeps a documented
  service-erasure boundary centralized behind `provideManagedServices(...)` and
  `provideRuntimeServices(...)`; `EffectUiRuntime.provide(...)` exposes a scoped
  Effect for UI-scope forking.
- Core Capability helpers now use overloads for pure vs Effect-returning
  `useEffect(...)` callbacks and rely on `Effect.provideService(...)` return
  typing directly.
- Browser extension packaging is checked as an example shell, including a live
  inspected-app bridge that reads `globalThis.__EFFECT_UI_DEVTOOLS__`.
- Platform-specific packages beyond Node/fetch should wait for hosts that need
  real behavior beyond the generic facades and documented recipes.

## Verification Snapshot

Latest full gate on May 15, 2026:

- 11 package builds;
- workspace typecheck and public type tests;
- public API inventory audit;
- Effect-first audit over 218 package/example/script/type-test files;
- 52 root test files / 856 tests;
- devtools panel verify with 1 panel test file / 2 tests;
- devtools extension verify with 1 extension test file / 20 tests;
- basic starter verify with 1 starter test file / 2 tests;
- React starter verify with 1 starter test file / 3 tests;
- project console starter packaging;
- project console typecheck;
- 4 project console test files / 27 tests;
- project console production build;
- project console server-only leak scan.
- `pnpm benchmark` refreshed the SSR, route preload, Resource, live query, and
  RPC transport baselines.
- The latest `pnpm verify` includes the rich project-console starter packaging
  gate and the devtools extension verify gate.
- Review 81 extracted the expert-public Core Resource UI Binding Controller:
  React and Solid resource hooks now share Resource ref identity,
  runtime-bound refresh/prefetch Effects, automatic preload fibers, keyed
  preload failures, observer failure swallowing, stale preload interruption,
  state matching helpers, and Suspense preload-token dedupe while keeping host
  reactivity and host Suspense thenable throwing adapter-local.
- Review 82 extracted the internal Start Host Runtime Runner: Fetch Promise
  facades, Node callback facades, Vite diagnostics Promise hooks, and Vite dev
  middleware callback launches now share one Effect-to-host runtime policy for
  explicit/default runtime selection, `Effect.runPromise(...)`, `runFork(...)`,
  and response Scope lifetime wrapping.
- Review 83 extracted the internal Start Node Web Exchange Module: production
  Node and Vite dev SSR hosts now share Node origin reconstruction, Web Request
  conversion, Web Response writing, multiple `Set-Cookie` preservation, stream
  piping, and `HEAD` body cancellation while public Node adapter exports remain
  source-compatible.
- Review 84 extracted the internal DB Query Execution Plan Module: Query
  one-shot execution, diagnostics, live-query source/preload policy, and final
  projection stages now share one plan policy while Query Builder remains the
  immutable DSL and Live Query Runtime remains focused on IVM graph mechanics.
- Review 85 extracted the internal Solid Route Render Scope Controller:
  `RouterOutlet` now delegates route branch rendering, route-owned `UiScope`
  creation, Solid root cleanup, runtime-bound route finalizers, transition
  disposal ordering, and stale queued-render suppression while public Solid
  router APIs stay unchanged.
- Review 86 added a public API type-test manifest: every package export and
  Start subpath now maps to source, docs, and a focused type-test file, while
  the broad framework type test remains as cross-package integration coverage.
- Review 87 extracted the internal React Route Render Scope Controller:
  `RouterOutlet` now delegates route branch rendering, route-owned `UiScope`
  creation, keyed route frame remounting, runtime provider re-entry, and route
  finalizer policy while public React router APIs stay unchanged.
- Review 88 added a public API source-surface coverage gate: every package root
  barrel's local re-exported modules must now be named in the package's Source
  Surface docs, so exported source modules and LSP-facing explanations drift
  together.
- Review 89 extracted the internal DB Collection Value Detachment Module:
  collection value cloning, frozen transaction/value copies, mutation
  detachment, update-draft detachment, value-change diffs, and public row DTO
  detachment now share one policy instead of living in mutable Collection State.
- Review 80 extracted the internal Request Runtime Lifecycle Module: selected
  Start response Effects now share one lifecycle path for failure/interruption
  teardown, ResponseContext application, request trace emission, Request Runtime
  disposal, and streamed response finalization while `createRequestHandler*`
  facades stay unchanged.
- Review 79 extracted the internal Collection Query Source Adapter: Query
  Builder, Query Plan, Live Query State, and Live Query Runtime now share one
  source Interface for rows, row counts, declared index checks, indexed row
  probes, version/state signals, and preload/refetch Effects while `Query.*`
  and `Collection.liveQuery(...)` stay unchanged.
- Review 78 extracted the internal Live Query Collection Materialization
  Module: per-store projection entries, keyed lookups, index buckets,
  state/version signals, `Ready.updatedAt`, and snapshots now sit behind one
  private DB Module while `Collection.liveQuery(...)` stays the read-only public
  facade; the latest `pnpm verify` passed after this split.
- Review 77 extracted the internal Collection Write Commit Module: direct
  write insert/update/delete and change-batch paths now share one
  snapshot/persist/restore/event sequence while public Collection write facades
  stay unchanged; the latest `pnpm verify` passed after this split.
- Review 76 extracted the internal Runtime Collection Store Module: store
  construction, Resource Store module-registry lookup, Effect/sync store
  accessors, synchronous `runWithCollectionStore(...)` override locality,
  diagnostics, event subscriptions, and initial-data materialization now sit
  behind one DB Module while public access remains through the `Collection`
  facade.
- Review 75 tightened Browser History Adapter locality, runtime-bound UI scope
  creation, Start Transport Endpoint Envelope request-id alignment, public API
  inventory auditing, and LSP-facing Runtime Spine / Erased Runtime Runner /
  Resource Store / host seam vocabulary; the latest `pnpm verify` passed after
  those fixes.
- Review 74 tightened Core Resource read decision locality, DB collection
  hydration planning, React DB/Solid DB live-query selection policy, Start
  request-runtime finalization trace mapping, starter streamed HTML response
  construction, Devtools app-graph detachment locality, and Panel Contract
  overflow identity.
- Review 73 tightened `UiScope` late-finalizer runtime ownership, shared Core
  RouterLink hover/click policy for React and Solid, React provider-owned
  runtime recreation, Collection Store diagnostics, DB-owned reactive binding
  helpers for React DB/Solid DB, cached Live Query Collection indexes, Start
  fetch/file-route Promise-shaped rejection, Devtools panel boot lifecycle
  sharing, and deeper Promise/await audit scanning; the latest `pnpm verify`
  passed after those fixes.
- Review 72 tightened React/Solid adapter lifetimes, Program restart ownership,
  DB mutation finalization, Live Query Collection last-good projections,
  generation-keyed DB preload failures, change-feed late-drop policy, Start
  request trace diagnostics, starter route discovery, direct manifest export-name
  boundaries, devtools extension polling, app-graph normalizer docs, and
  executable async/non-Effect catch audit coverage; the latest `pnpm verify`
  passed after those fixes.
- Review 71 tightened Core browser-router ownership, React/Solid router
  delegation, React `useAction(...)` instance lifetime, Resource preload
  failure identity, public `ResourceStore` seams, static Start app graph
  imports, explicit runtime diagnostics, query-sync rollback naming, React
  DB/Solid DB source identity, Devtools entrypoint cleanup, and spaced
  `Promise <T>`/`PromiseLike<T>` audit coverage.
- Review 70 tightened React route render runtime/scope ownership, Solid and
  React Resource preload failure surfaces, lazy Start legacy hydration script
  serialization, starter streamed hydration usage, React DB dynamic live-query
  sources, DB query sync invalidation policy, Devtools bridge diagnostics docs,
  widened Effect-first audit scope, and checked Devtools entrypoint smoke tests;
  the latest `pnpm verify` passed after those fixes.
- Review 69 tightened React ordered preload matching, Program runtime error
  typing, Resource Store public seams, Start streamed hydration root scripts,
  app graph route preservation, Vite dev SSR trace locality, DB live-query
  read-only/persistence events, Devtools inspected-window timeout and invalid
  payload diagnostics, and the checked React starter gate.
- Review 68 tightened Resource read collection, ActionResult metadata
  detachment, Solid preload route matching, Start collection-name resolution,
  DB active mutation/load coordination, live-query materialization ingress,
  Devtools request/app-graph depth, and React's internal Suspense host seam.
- Review 67 tightened Resource snapshot encoding/read effects, Start client
  transport and diagnostics validation, DB live-query materialization and
  change-feed dispatch, Solid DB mutation handles, and Devtools fact/panel
  scale contracts.
- Core `Program` and Solid `useProgram(...)` add the model/message/update loop
  as an Effect-native public API: commands are Effects, subscriptions are
  Streams, failures are typed state, and cleanup follows the active UI scope.
- Program instances now expose a bounded `timeline` signal for message
  transitions, command starts/completions/failures, subscription
  starts/emissions/failures, and disposal. Solid and React `useProgram(...)`
  handles expose the same timeline to UI/devtools code.
- Devtools now records Program timelines as first-class runtime facts through
  `recordProgramEvent(...)` and scoped `trackProgramEffect(...)`, with a
  Programs panel, event-level timeline rows, stable fallback names for unnamed
  tracked Programs, and causal graph `Program` targets backed by the shared
  bounded serialization policy.
- `DevtoolsSerializationPolicy` now includes `redactKeys`, and Devtools applies
  default redaction for common password, token, API-key, credential, cookie, and
  authorization-shaped keys before runtime facts reach summaries, panels, or
  bridges.
- Solid router hydration now starts matched SSR routes from `Ready` when
  Solid's hydration context is present, avoiding initial client-only pending
  fallback markup over already-preloaded server HTML.
- Core `Program.step(...)` and `Program.story(...)` add deterministic
  state-machine tests: updates run in Effect, returned commands are inspected
  explicitly, and tests can resolve command output back into typed messages.
- Core `Form.decodeFormDataEffect(...)` decodes browser forms through Effect
  Schema, preserves repeated fields as arrays, and returns typed
  `Form.ValidationError` failures for invalid field data.
- Project-console now dogfoods `useProgram(...)` for its rename/advance action
  panel. Rename submission now carries `FormData` as the host input and decodes
  it inside a Program command with `Form.decodeFormDataEffect(...)` before
  calling the Start action.
- Package description metadata has been added and package-local dry-run packs
  passed for all 9 framework packages.
- The Start diagnostics CLI now runs its parse/load/render flow through an
  Effect-native runner; the bin entry is the Promise boundary.
- The Vite dev SSR middleware now keeps request conversion, handler loading,
  response writing, and error forwarding inside an Effect program.
- Review 59 tightened registry-local SSR dispatch, structured DB live-query
  identity, Devtools bridge failure semantics, Start manifest/file-route
  validation, and LSP-facing host facade docs.
- Resource, DB collection, and Start request/Vite internals are split into
  focused modules behind the same public entrypoints.
- Start request traces now classify RPC/action failures by layer with a
  `failureKind` fact that devtools summaries can display.
- The devtools extension uses sample data only as the initial fallback and
  updates from a live inspected-page `__EFFECT_UI_DEVTOOLS__` panel payload when
  present; later missing or invalid bridge reads render diagnostics instead of
  keeping stale facts.
- Apps can expose that payload through `installDevtoolsBridgeEffect(...)`, which
  scopes `globalThis.__EFFECT_UI_DEVTOOLS__` setup and cleanup inside Effect.
- The latest devtools extension verify includes 1 extension test file / 20 tests
  plus the Manifest V3 production build.
- The latest `pnpm verify` also covers the private `UNLICENSED` workspace
  metadata sweep, the type-test Promise-method cleanup, and the test
  Promise-catch cleanup.
- The devtools extension now structurally validates inspected-window
  `DevtoolsPanels` bridge payloads before rendering live data.
- `effectUiStart(...)` now returns the concrete `EffectUiStartPlugin` type for
  Start Vite plugin hooks instead of exposing only Vite's broad `PluginOption`
  union.
- Test sources no longer use unknown-to-contract casts; negative
  runtime-validation tests use explicit `@ts-expect-error` assertions, and Start
  Cause helpers use public `cause.reasons` access.
- DB `QueryRoot.from(...)` now constructs its typed `QueryBuilder` directly
  instead of casting the builder through `never`.
- DB incremental live-query custom operators now register through a named
  `IOperator` bridge over `@tanstack/db-ivm`'s class-typed `addOperator(...)`
  surface.
- The latest `pnpm verify` passed after the type ID bottom-cast cleanup.
- Capability implementation casts for `useEffect(...)` and `provide(...)` were
  removed without changing the public pure/Effect callback behavior.
- Runtime run-method service-erasure casts were consolidated behind exact
  ResourceStore provision typing and one named ManagedRuntime boundary.
- Core Action and Resource public async APIs now expose Effect-native workflows
  for submission, preload, refresh, `Fiber.join`, stale refresh, and
  interruption.
- Core runtime helpers, `UiScope`, and `Signal.watch(...)` now rely on Effect
  primitive typing directly where TypeScript can already prove the scope shape.
- Core server wire helpers now centralize typed schema decoding, and
  `ServerClient.call(...)` preserves server function requirements for local/mock
  Effect execution.
- DB sync, SQLite persistence, flush-policy, and server-collection adapters now
  keep EffectInput conversion in typed helper seams instead of repeated
  adapter-local assertions.
- DB collection persistence, load, mutation, change-feed, and live-query preload
  paths now share the same typed EffectInput helper; DB query filter/order
  variance is expressed through helper types, and the default projector
  boundary is named instead of using a broad inline `unknown` bridge.
- Type-id declarations no longer appear in the broad `as never` cast sweep.
- The latest `pnpm verify` passed after tightening runtime-provided scoped
  Effects and removing Solid/Solid-DB hook call-site requirement erasure.
- Start request-runtime provision, request-handler wrappers, StartAction fiber
  workflows, response stream pull/cancel programs, and hydration sync helpers
  now pass Effects directly through runtime/Effect primitives instead of local
  requirement-erasure casts.
- The latest `pnpm verify` passed after the Start runtime call-site cast
  cleanup.
- Start RPC/action runtime-boundary failures now become explicit defect
  responses, action hydration runtime provision failures are converted through
  Effect error handling, and project-console UI fire-and-forget work no longer
  needs example-local Effect casts.
- The latest `pnpm verify` passed after the Start runtime-boundary and example
  UI effect cleanup.
- The broad sharp-cast grep now reports no source hits after schema,
  EffectInput, Start preload/adapter, DB query variance, and core runtime
  service-erasure cleanup.
- The latest `pnpm verify` passed after the broad sharp-cast cleanup.
- Core runtime service erasure now sits at the `ManagedRuntime<any, ER>` value
  boundary instead of casting provided Effect programs.
- The latest `pnpm verify` passed after the final broad sharp-cast sweep.
- The project-console starter packaging script now handles success/failure
  reporting inside the Effect pipeline, with top-level await kept as the Node
  host boundary.
- The latest `pnpm verify` passed after the starter packaging script entrypoint
  cleanup.
- Explicit `Effect.Effect<..., any>` annotations have been removed from package,
  example, script, and type-test source; Resource invalidation Effects now carry
  a generic requirement parameter for refreshed refs.
- The latest `pnpm verify` passed after the explicit Effect-any cleanup.
- Solid Resource hook requirement defaults now use `unknown`, and route outlet
  UI internals avoid `Component<any>` / `value: any` boundaries.
- `pnpm verify` passed after the Solid UI wildcard cleanup.
- Start action client and hydration runtime options now keep runtime services
  opaque while carrying a generic runtime error channel with `never` defaults,
  so public seams no longer publish `unknown` as an error type.
- `pnpm verify` passed after the opaque runtime option wildcard cleanup.
- Start trace/finalizer helpers and Solid runtime provider/router surfaces now
  use opaque runtime/source types; the only remaining
  `EffectUiRuntime<any, any>` source hits are core ambient runtime accessors
  that preserve caller error typing.
- `pnpm verify` passed after the runtime helper wildcard cleanup.
- Conditional helper types now use inferred placeholder parameters instead of
  ignored `any`, arbitrary route params/search constraints use opaque
  `unknown`, and read-only devtools action recording accepts opaque action
  generics.
- The latest `pnpm verify` passed after the conditional helper and route
  wildcard cleanup.
- `UiScope` now creates its closeable scope through `Scope.make(...)` run by
  Effect rather than calling `Scope.makeUnsafe(...)` directly.
- The latest `pnpm verify` passed after the `UiScope` creation primitive
  cleanup.
- Public type tests now use declared Promise values instead of `async`
  callbacks for negative Promise-return checks, keeping type coverage without
  Promise-shaped callback examples.
- The latest `pnpm verify` passed after the type-test async callback cleanup.
- Arbitrary Action, Server, Resource family, and collection transaction
  wildcard boundaries are now named through local `Any*` aliases instead of
  repeated inline wildcard type applications.
- The latest `pnpm verify` passed after the named arbitrary wildcard boundary
  cleanup.
- DB live-query row/context erasure is now named through local query boundary
  aliases instead of repeated inline wildcard record and builder applications.
- The latest `pnpm verify` passed after the DB query wildcard boundary cleanup.
- Core optimistic signal patch storage, ambient runtime service-erasure, and DB
  collection retry policy wildcard boundaries are now named through local
  aliases.
- The latest `pnpm verify` passed after the core runtime and signal wildcard
  boundary cleanup.
- The broad sharp-cast grep is clean across package, example, script, and
  type-test source after replacing the last two test-only `as Effect.Effect`
  assertions.
- The latest `pnpm verify` passed after the test sharp Effect assertion cleanup.
- Package-source fire-and-forget effects now run as detached fibers rather than
  floating `runPromise(...)` calls; Promise runners remain at Promise-returning
  host/API boundaries.
- The latest `pnpm verify` passed after the package fire-and-forget Promise
  cleanup.
- Example app entrypoints and UI helpers also run fire-and-forget effects as
  fibers; the broad `void runPromise` grep now reports no hits across packages,
  examples, scripts, and type tests.
- The latest `pnpm verify` passed after the example fire-and-forget Promise
  cleanup.
- The latest `pnpm verify` passed after refreshing docs drift for the wildcard
  and fire-and-forget sweeps.
- Start adapter tests now use `Effect.callback(...)`/`Effect.sleep(...)`
  listener and timer helpers instead of raw `new Promise(...)`; the broad raw
  Promise-constructor/method grep reports no hits across packages, examples,
  scripts, and type tests.
- The latest `pnpm verify` passed after the adapter test Promise helper cleanup.
- Solid-DB, UiScope, and Resource Store tests now return `Effect.runPromise(...)`
  programs instead of using async test wrappers for Effect sequencing.
- The latest `pnpm verify` passed after the small async test wrapper cleanup.
- Core Capability, Server contract, and Solid router tests now return Effect
  programs instead of using async wrappers for Effect sequencing; the Solid
  router effect avoids subscribing to its own state updates, and the router test
  explicitly loads the browser Solid build for happy-dom coverage.
- The latest `pnpm verify` passed after the core/Solid async test boundary
  cleanup.
- Core runtime tests now return Effect programs instead of async wrappers while
  exercising host Promise conversion only through explicit `Effect.promise(...)`
  boundaries.
- The latest `pnpm verify` passed after the core runtime async test cleanup.
- Core Signal stream tests now return scoped Effect programs instead of async
  wrappers, with stream collection assertions inside `Effect.sync(...)`.
- The latest `pnpm verify` passed after the core Signal async test cleanup.
- Core Form validation tests now return Effect programs instead of async
  wrappers or Promise `.resolves` assertions, with expected failures captured by
  `Effect.exit(...)`.
- The latest `pnpm verify` passed after the core Form async test cleanup.
- Core ActionResult tests now return Effect programs instead of async wrappers,
  with public Action/Resource Promise boundaries sequenced through
  `Effect.promise(...)`.
- The latest `pnpm verify` passed after the core ActionResult async test
  cleanup.
- Core route/server tests now return Effect programs instead of async wrappers
  or Promise matcher assertions, while keeping public route/server/Response
  Promise APIs under test behind `Effect.promise(...)`.
- The latest `pnpm verify` passed after the core route/server async test
  cleanup.
- Start action and server-function manifest tests now return Effect programs,
  with duplicate/parse/client-reference failures captured through
  `Effect.exit(...)`.
- The latest `pnpm verify` passed after the Start manifest async test cleanup.
- Start route-manifest and file-route manifest tests now return Effect programs,
  with parse/duplicate failures captured through `Effect.exit(...)`.
- The latest `pnpm verify` passed after the Start route/file-route async test
  cleanup.
- DB server-collection tests now return Effect programs while preserving public
  collection Promise APIs under test through `Effect.promise(...)`.
- The latest `pnpm verify` passed after the DB server-collection async test
  cleanup.
- DB live-query collection tests now return Effect programs, including
  read-only mutation rejection captured through `Effect.tryPromise(...)` and
  `Effect.exit(...)`.
- The latest `pnpm verify` passed after the DB live-query collection async test
  cleanup.
- DB persisted-options tests now return Effect programs, with runtime-specific
  Promise calls wrapped by Effect, optimistic mutation work joined through a
  fiber, and runtime cleanup handled by Effect finalizers.
- The latest `pnpm verify` passed after the DB persisted-options async test
  cleanup.
- DB SQLite persistence tests now return Effect programs, with storage
  `EffectInput` work run through `toEffect(...)` and Promise matcher assertions
  replaced by explicit Effect assertions.
- Start RPC protocol tests now return Effect programs. Server RPC/action
  response checks, browser client transport success, and non-JSON transport
  failures are asserted inside Effect pipelines, with only platform JSON
  parsing isolated behind `Effect.tryPromise(...)`.
- Start streaming tests now return Effect programs. Stream collection, sequence
  checks, typed stream failures, and interruption assertions stay inside Effect
  pipelines, with `Response.text()` isolated as the host Promise.
- Start app-graph tests now return Effect programs, and graph fixture
  construction composes manifest Effects directly.
- `Resource.requestFamily` lets Resource families delegate loads to Effect
  `RequestResolver` batching while preserving Resource state, hydration, TTL, and
  invalidation.
- Start request handling now exposes Effect-native request count, duration, and
  status metrics alongside the JSON-safe request trace hook.
- Start server functions can be described as additive
  `effect/unstable/rpc` compatibility descriptors without replacing the current
  Start RPC transport.
- Start diagnostics report formatting now sits behind a focused diagnostics
  contract module, and Solid/Solid-DB roots are facades over focused runtime,
  router, hook, collection, and live-query adapter modules.
- DB sync-adapter tests now return Effect programs for generic, server,
  Resource, query-client, and scoped change-feed adapters, with
  `Effect.runPromise(...)` reserved for the Vitest host boundary.
- Start RPC/action protocol work now lives in `start-transport-protocol.ts`:
  JSON/form request decoding, response shaping, schema encode/decode, failure
  classification, invalidation serialization, progressive action form metadata,
  and client response parsing are separated from request-runtime orchestration.
- DB live-query incremental IVM behavior now lives in `live-query-runtime.ts`,
  and Core/Start route path handling shares `route-grammar.ts` for matching,
  building, file-route manifest paths, route-id slugs, ordering, and prefix
  checks.
- Devtools panel rendering and DOM mount lifecycle now live in
  `panel-renderer.ts`, inspected-window bridge installation now lives in
  `bridge.ts`, panel projection lives in `panels.ts`, store mutation lives in
  `store.ts`, and JSON-safe invalidation/route/trace projection lives in
  `serialization.ts`. Snapshot summary projection, request-trace summaries,
  app-graph summaries, and causal graph construction now live in `summary.ts`,
  keeping the public devtools root focused on contracts and facade exports.
- Action, Resource, Collection, StartAction, devtools, and project-console tests
  now use Effect fibers and combinators for internal concurrency checks instead
  of Promise handles; Promise conversion remains at the host/test edge.
- DB flush-policy tests now return Effect programs for runtime-scoped
  collection hydration, pending mutation flushes, background sync decisions, and
  runtime disposal.
- DB Collection runtime behavior now lives in `collection-runtime.ts`, with
  collection symbols, tagged errors, and preload collection contracts split into
  focused internal modules behind the public DB root facade.
- Start server request lifecycle behavior now lives in
  `start-request-handler.ts`, with RPC/action endpoint execution in
  `start-request-endpoints.ts` and request preload plus collection hydration
  facts in `start-request-preload.ts`. SSR render orchestration, response
  context application, request trace mutation, and runtime/stream finalization
  stay behind the public Start facade.
- Core Resource runtime behavior now delegates through `resource-runtime.ts`;
  touched-ref collection, in-flight coordination, suspense reads, invalidation,
  dehydration, and hydration are separate from the public Resource Definition
  facade, and duplicate source exports were removed for Vite/Rolldown
  compatibility.
- Devtools summary behavior is now split across `summary-app-graph.ts`,
  `summary-facts.ts`, and `causal-graph.ts`, leaving `summary.ts` as the public
  summary facade while keeping app graph projection, runtime fact
  normalization, and causal graph construction separate.
- DB Query builder behavior now lives in `query-builder.ts`, and read-only
  Live Query Collection adaptation now lives in `live-query-collection.ts`, so
  the DB root re-exports the Query and Collection facades while those
  implementations have focused Modules.
- Project-console domain mock/domain tests and the basic starter SSR test now
  return Effect programs instead of async wrappers; response body text remains a
  host Promise boundary through `Effect.tryPromise(...)`.
- Core route/server Effect-returning helpers now defer route preload,
  navigation match/schema decode, and server route handler invocation until the
  returned Effect runs, with those boundary failures surfaced as
  `RoutePreloadError`, `RouteNavigationError`, and `ServerRouteHandlerError`
  instead of `unknown`. The Start adapter streaming timeout test now coordinates
  with `Effect.raceFirst(...)` rather than `Promise.race(...)`.
- Core Signal dependency tracking now uses one internal tracker for both
  `watch(...)` and `Signal.derive(...)`, de-duping repeated source reads and
  preserving queued recompute behavior for derived signals.
- Core Form validation now snapshots values and tracks validation revisions so
  stale async validation cannot overwrite state after a field change, reset, or
  newer validation.
- DB Collection transaction ids are now Collection Store-local and hydrate from
  restored pending mutations, preventing collisions between restored optimistic
  work and new local writes.
- Start manifest mechanics now share `manifest-entry-core.ts` across
  server-function and action manifests, the Start root no longer wildcard
  exports internal transport protocol helpers, request trace fact mutation is
  localized in `request-trace-recorder.ts`, and generated app-graph virtual
  modules reuse the shared diagnostics policy contract instead of embedding a
  second policy implementation.
- Devtools graph and panel ids now flow through `graph-ids.ts`, and bounded
  store fact references flow through `fact-identity.ts` so invalidation history
  trimming rebases action/runtime links and id-less request traces receive
  deterministic ids before summary or causal graph projection.
- Start file-route segment parsing now lives in `file-route-segments.ts`, so
  sync route discovery and Effect manifest generation share route group,
  pathless, static, dynamic, and invalid dynamic-param semantics.
- Start RPC and action client behavior now lives in `start-rpc-client.ts` and
  `start-action-client.ts`; the root facade re-exports the public client
  Interfaces without owning fetch, decode, hydration, Layer, and action
  concurrency implementation details.
- Core Action submission coordination now lives behind a shared Action
  Submission Controller, keeping versioning, current fiber ownership, stale
  interruption checks, invalidation-plan state, and reset interruption shared
  between `Action.use(...)` and Start's `StartAction.use(...)`.
- Stateful `StartAction.use(...)` submissions now guard decoded transport
  responses before applying Resource or Collection hydration side effects, so
  stale parallel or non-interruptible latest responses cannot mutate client
  hydration state.
- DB collection snapshot validation, cloning, pending mutation conversion,
  JSON encode/decode, and hydration application now live in
  `collection-snapshot-codec.ts`, giving persistence and hydration one snapshot
  policy. Invalid persisted snapshot JSON, direct hydrate snapshots, and
  hydration payloads now fail as typed `CollectionSnapshotCodecError` Effect
  errors instead of defects.
- DB mutation commits now separate remote-handler failure from post-commit
  persistence failure, so a failed persistence write after a successful remote
  mutation no longer rolls committed rows back.
- DB collection contracts and process-wide registry behavior now live in
  `collection-contract.ts` and `collection-registry.ts`; internal DB modules
  import those contracts directly while the DB root re-exports the public
  facade. The registry now exposes an explicit default Registry Adapter,
  isolated registry creation, deterministic duplicate handling, duplicate
  diagnostics, and an opt-in replacement policy for callers that need overwrite
  semantics.
- Devtools serialization now has an explicit bounded policy for deep, wide,
  long, circular, accessor, Map/Set, Error, and detached runtime values, and
  the Store copies caller-owned facts at set/get/record seams.
- Start server-function and action manifest deserialization now share Manifest
  Entry Core helpers for JSON parsing, version/path validation, callable entry
  identity checks, and import-client reference validation.
- Core now has a shared Definition Registry for Action and Server function
  definitions; `defineApp(...)` captures a registry snapshot by default and
  accepts explicit registry inputs for isolated app graphs.
- DB now exposes an explicit Collection Definition Registry Adapter with
  deterministic duplicate handling, duplicate diagnostics, a default registry,
  and isolated registry creation.
- Start app graph diagnostics can now be assembled from runtime route module
  candidates and policy violations can be thrown as diagnostics-bearing policy
  exceptions.
- Default generic error parameters now use `never` across Core, DB, Solid DB,
  and Start action inference so omitted error channels are infallible by
  default instead of `unknown`.
- Start host-boundary errors now have concrete Effect channels: preload,
  request handling, Node/fetch adapters, fetch transport hooks, and Vite/CLI
  diagnostics loading use `never` defaults or tagged errors/unions rather than
  publishing `unknown` failures.
- Start request trace hooks, Action runtime options, Solid router preload, and
  Collection change-feed `emit(...)` now also avoid `unknown` Effect failure
  channels in helper aliases.
- LSP-facing JSDoc now describes the Core Definition Registry, app registry
  snapshots, shared Action submission concurrency semantics, Action/Server
  registration helpers, DB Collection registry diagnostics, snapshot codec
  errors, Start action submission hydration, callable manifest entry assembly,
  runtime app graph diagnostics, and streamed hydration chunk consumption.
- `EffectInput` Promise-like return guards now reject unannotated
  `Action.define(...)` and `Server.fn(...)` callbacks that return Promises, so
  Promise work cannot hide behind inferred action or server-function output
  types.
- `toEffect(...)` now rejects thenables with `EffectInputPromiseRejected`, so
  host Promise work must be adapted explicitly with `Effect.tryPromise(...)`.
- Core Definition Registry duplicate registrations are now diagnosable through
  an isolated Registry Adapter, while Start RPC dispatch uses the app registry
  snapshot instead of later process globals.
- Start app-graph diagnostics policy validation and file-route discovery now
  expose Effect-first Interfaces, with sync facades only at Vite host hooks.
- Core `Resource.read(...)` now stays Effect-first by throwing typed
  `ResourcePending` for missing or expired data instead of Suspense Promises.
  Solid `useResourceSuspense(...)` owns the UI Suspense Promise at the adapter
  seam.
- Solid router failure state now preserves typed preload Causes, so failure
  renderers receive `Route.PreloadError | ER` instead of an `unknown` slot.
- Devtools request summaries and panels now keep teardown snapshots plus
  per-server-function/action failure owners, with hover docs on the public panel
  model.
- Start hydration now documents and reports typed chunk/root payload parse
  errors alongside Resource and Collection snapshot codec errors.
- DB collection output schema validation now reports
  `CollectionSnapshotCodecError` across load, hydrate, direct-write,
  change-feed, and Solid DB preload surfaces.
- Node server error hooks are EffectInput-only; host Promise work must be
  adapted explicitly with `Effect.tryPromise(...)`.
- The latest full `pnpm verify` passed after Review 86 added the public API
  type-test manifest while keeping public package exports unchanged: 11 package
  builds, workspace typecheck, public type tests, public API inventory audit,
  Effect-first audit over 216 files, 52 root test files / 856 tests,
  devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
  basic starter verify with 2 tests, React starter verify with 3 tests,
  project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
  leak scans.
- The previous full `pnpm verify` passed after Review 64 store-owned Resource
  load ownership, Start stream/manifest walls, DB hydration/dehydrate preflight,
  Devtools runtime-only causal facts, and panel row identity fixes: 9 package
  builds, workspace typecheck, public type tests, Effect-first audit, 45 root
  test files / 690 tests, devtools-panel verify, devtools-extension verify with
  15 tests, basic starter verify with 2 tests, project-console
  packaging/typecheck/tests/build, and leak scans.
- The earlier full `pnpm verify` passed after Review 61 registry requirement
  preservation, action invalidation typing, DB live-query snapshot locality,
  Devtools bounded serialization, and LSP docs/type-test fixes: 9 package
  builds, workspace typecheck, public type tests, Effect-first audit, 45 root
  test files / 643 tests, devtools-panel verify, devtools-extension verify with
  15 tests, basic starter verify with 2 tests, project-console
  packaging/typecheck/tests/build, and leak scans.
- The earlier full `pnpm verify` passed after Review 60 stream lifetime,
  runtime-local DB reactivity, Core/Devtools identity, Start preload locality,
  and diagnostics type-test fixes: 9 package builds, workspace typecheck, public
  type tests, Effect-first audit, 45 root test files / 632 tests,
  devtools-panel verify, devtools-extension verify with 15 tests, basic starter
  verify with 2 tests, project-console packaging/typecheck/tests/build, and leak
  scans.
- The earlier full `pnpm verify` passed after Review 59 registry-local dispatch,
  structured DB live-query identity, Devtools bridge failure semantics, Start
  manifest/file-route validation, and LSP docs/type-test drift fixes: 9 package
  builds, workspace typecheck, type tests, Effect-first audit, 45 root test
  files / 618 tests, devtools panel verify, devtools extension verify with 14
  tests, basic starter verify, project-console starter
  packaging/typecheck/tests/build, and leak scan.
- An earlier `pnpm verify` passed after Review 58 hydration walls, runtime
  ownership, DB contract validation, Devtools fact identity/import safety, and
  TSRX/Start public API docs coverage: 9 package builds, workspace typecheck,
  type tests, Effect-first audit, 45 root test files / 603 tests, devtools
  panel verify, devtools extension verify with 14 tests, basic starter verify,
  project-console starter packaging/typecheck/tests/build, and leak scan.
- The earlier `pnpm verify` passed after Review 57 atomic rollback, bounded
  devtools import, Start invalidation validation, Accept negotiation, and
  Core/Solid runtime cleanup: 9 package builds, workspace typecheck, type
  tests, Effect-first audit, 45 root test files / 585 tests, devtools panel
  verify, devtools extension verify with 14 tests, basic starter verify,
  project-console starter packaging/typecheck/tests/build, and leak scan.
- The earlier `pnpm verify` passed after DB pending optimistic hydration,
  runtime-bound change-feed emission, Solid owning-runtime disposal, Core
  reset/delete/finalizer/cookie cleanup, Start invalidation metadata/Accept
  hardening, and Devtools import/summary/panel contract safety: 9 package
  builds, workspace typecheck, type tests, 45 root test files / 571 tests,
  devtools panel verify, devtools extension verify with 14 tests, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- The previous `pnpm verify` passed after the shared Action Submission
  Controller, DB Collection contract/registry extraction, typed
  `CollectionSnapshotCodecError` propagation, Devtools graph/fact/serialization
  cleanup, Start file-route/client/callable manifest extractions, and Project
  Console typed codec error handling: 9 package builds, workspace typecheck,
  type tests, 40 root test files / 349 tests, devtools panel verify, devtools
  extension verify, basic starter verify, project-console starter packaging/
  typecheck/tests/build, and leak scan.
- The previous `pnpm verify` passed after the DB query/live-query extraction,
  DB transaction identity locality fix, Core typed route/server Effect seams,
  Start manifest/trace/diagnostics cleanup, Core Signal Dependency Tracker
  extraction, and Core Form validation race guard: 9 package builds, workspace
  typecheck, type tests, 40 root test files / 336 tests, devtools panel verify,
  devtools extension verify, basic starter verify, project-console starter
  packaging/typecheck/tests/build, and leak scan.
- The previous `pnpm verify` passed after the Start Request Handler, Core
  Resource Runtime, and Devtools Summary extractions: 9 package builds,
  workspace typecheck, type tests, 40 root test files / 328 tests, devtools
  panel verify, devtools extension verify, basic starter verify,
  project-console starter packaging/typecheck/tests/build, and leak scan.
- The earlier `pnpm verify` passed after the DB Collection Runtime extraction:
  9 package builds, workspace typecheck, type tests, 40 root test files / 328
  tests, devtools panel verify, devtools extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.
- The earlier architecture-deepening `pnpm verify` passed:
  9 package builds, workspace typecheck, type tests, 40 root test files / 328
  tests, devtools panel verify, devtools extension verify, basic starter
  verify, project-console starter packaging/typecheck/tests/build, and leak
  scan.

## Notable Limits

- Packages are still private and versioned `0.0.0-alpha.0`.
- Package manifests include pre-release descriptions, `UNLICENSED`, and build
  metadata, but final public npm repository/license decisions are still open.
- The browser extension live bridge expects the inspected app to expose
  `globalThis.__EFFECT_UI_DEVTOOLS__`; automatic injection is not part of the
  checked shell.
- The generated rich starter still uses pre-release `0.0.0-alpha.0`
  `@effect-ui/*` package placeholders until package publication is finalized.
- Cloudflare, Vercel, Netlify, Bun, and static deployment currently use recipes
  over Node/fetch facades rather than dedicated packages.
