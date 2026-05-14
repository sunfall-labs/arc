# Release Notes Draft

This is the current release-candidate snapshot for the pre-release Effect UI
framework. Package manifests remain private, so this is not an npm release note
yet.

## Stable For The First External App

- Core runtime primitives: Signals, Resources, Actions, Forms, Routes,
  Capabilities, server contracts, scoped UI work, and request-local runtimes.
- Public async library APIs return Effects; Promise use is reserved for
  explicit runtime, Suspense, stream, CLI, Vite, or host-platform boundaries.
- LSP-facing JSDoc describes the purpose and composition model for the core,
  DB, Solid, Start, Node, and Fetch concepts.
- Start request handling: SSR, RPC, Start actions, hydration payloads, streamed
  HTML responses, request traces, and build diagnostics.
- Node and Fetch host facades: `@effect-ui/start-node` and
  `@effect-ui/start-fetch`.
- Devtools data contracts: snapshots, summaries, causal graphs, request traces,
  panel models, deterministic HTML rendering, the checked panel app shell, and
  the checked browser-extension shell with an inspected-window bridge.
- Local-first DB surface: Collections, live queries, persistence, sync adapter
  seams, mutation queues, and flush policies.
- Solid adapters: runtime provider, router, Resource hooks, Action hooks,
  stream hooks, and collection hooks.
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

Latest full gate on May 14, 2026:

- 9 package builds;
- workspace typecheck and public type tests;
- 42 root test files / 361 tests;
- devtools panel verify;
- devtools extension verify;
- basic starter verify;
- project console starter packaging;
- project console typecheck;
- 4 project console test files / 23 tests;
- project console production build;
- project console server-only leak scan.
- `pnpm benchmark` refreshed the SSR, route preload, Resource, live query, and
  RPC transport baselines.
- The latest `pnpm verify` includes the rich project-console starter packaging
  gate and the devtools extension verify gate.
- Package description metadata has been added and package-local dry-run packs
  passed for all 9 framework packages.
- The Start diagnostics CLI now runs its parse/load/render flow through an
  Effect-native runner; the bin entry is the Promise boundary.
- The Vite dev SSR middleware now keeps request conversion, handler loading,
  response writing, and error forwarding inside an Effect program.
- Resource, DB collection, and Start request/Vite internals are split into
  focused modules behind the same public entrypoints.
- Start request traces now classify RPC/action failures by layer with a
  `failureKind` fact that devtools summaries can display.
- The devtools extension now keeps sample data as a fallback and updates from a
  live inspected-page `__EFFECT_UI_DEVTOOLS__` panel payload when present.
- Apps can expose that payload through `installDevtoolsBridgeEffect(...)`, which
  scopes `globalThis.__EFFECT_UI_DEVTOOLS__` setup and cleanup inside Effect.
- The latest devtools extension verify includes 1 extension test file / 6 tests
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
- Start action client and hydration runtime options now use opaque
  `EffectUiRuntime<unknown, unknown>` types where the public option only needs a
  runtime boundary, not caller-specific service or error detail.
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
- The latest `pnpm verify` passed after Core Definition Registry, DB Collection
  registry locality, Start app graph runtime diagnostics, stale Start action
  hydration guard, DB direct hydration/post-commit persistence fixes, and
  default generic error cleanup: 9 package builds, workspace typecheck, type
  tests, 42 root test files / 361 tests, devtools panel verify, devtools
  extension verify, basic starter verify, project-console starter packaging/
  typecheck/tests/build, and leak scan.
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
