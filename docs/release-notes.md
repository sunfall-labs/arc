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
  DB, React, React DB, Solid, Start, Node, and Fetch concepts.
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
  `examples/react-starter` for the React-focused starter,
  `examples/project-console` for the golden-path app, and
  `pnpm starter:package` for generated standalone starter payloads.

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

Latest full gate on May 17, 2026 after Review 240:

- 11 package builds;
- workspace typecheck and public type tests;
- public API inventory audit;
- Effect-first audit over 415 package/example/config/script/type-test/generated
  template/docs-snippet physical and virtual files;
- 53 root test files / 1170 tests;
- package-level verifies for the devtools panel, devtools extension, basic
  starter, React starter, and project console packages;
- starter-suite packaging for basic (20 app files / 5 local packages), React
  (25 app files / 4 local packages), and project console (31 app files / 6
  local packages);
- 16-target package dry-run gate for all framework packages plus the basic
  starter, React starter, project console, devtools panel, and devtools
  extension, including the `@effect-ui/start/virtual` declaration byte check
  and 149-file `@effect-ui/db` package rehearsal;
- project console typecheck;
- 4 project console test files / 27 tests;
- project console production build;
- project console server-only leak scan.
- Review 246 Effect Cleanup Capture And Vite Middleware Lifecycle closed the
  post-Review245 sweep: Action reset and StartAction reset synchronously
  capture active submission fibers before forking cleanup, Resource UI Binding
  disposal captures the current preload and retained ref owners, Query
  predicate helpers are now owned by the `Query.*` namespace, and Vite dev SSR
  middleware owns Node lifecycle setup, abort signal injection, host-fiber
  interruption, response writing, and `next(error)` containment for plugin and
  direct callers. The active Thirty-Sweep clean counter remains 0/30 until a
  fresh post-Review246 sweep reports no actionable findings.
- Review 245 Public API Symbol Reachability And Router Adapter Parity closed
  the post-Review244 sweep: public hover policy now checks symbol reachability
  through package entrypoints, namespace-only aliases are explicit, memory
  history same-href commits match the window Adapter, and RouterLink download
  facts normalize framework-absent `false`/`null` values before Core click and
  preload decisions. The active Thirty-Sweep clean counter remained 0/30; the later
  post-Review245 sweep found Review246 Effect cleanup capture and Vite
  middleware lifecycle work.
- Review 244 Effect Cleanup Ownership, DB Pins, And Evidence Policy closed the
  post-Review243 sweep: DB Query namespace scalar aliases now match the
  documented namespace-first Interface, React/Solid DB Effect handles are
  pinned, Devtools action invalidation conflicts fail through the typed Effect
  channel, sync cleanup conveniences take owner slots before forking cleanup,
  and current-evidence policy now checks the focused review, full gate, test
  count, and clean counter. The active Thirty-Sweep clean counter remains 0/30
  until the later post-Review244 sweep found Review245 public API symbol
  reachability and router Adapter parity work.
- Review 243 Browser Router And DB Public Interface Pins closed the
  post-Review242 sweep: outside-route Browser Router navigation now increments
  the navigation generation and disposes active preload `UiScope` work before
  writing typed failure state, so stale preloads cannot overwrite invalid
  navigation failures. DB Query direct type mirrors and SQLite default
  constants are now documented expert-public compatibility surfaces with
  direct type-test and manifest pins. The active Thirty-Sweep clean counter
  remained 0/30; the later post-Review243 sweep found Review244 Effect cleanup
  ownership, DB pins, Devtools typed failure, and current-evidence policy work.
- Review 242 Solid Route Update Suspense Outcome closed the post-Review241
  framework follow-up: navigation-time Solid route render thenables now become
  owned suspended outcomes, retry through the controller when the host thenable
  settles, and dispose tentative suspended route frames when a newer transition
  wins. `RouterOutlet` uses Solid `createResource(...)` as the host Suspense
  Adapter while real render failures still flow to ErrorBoundary. The active
  Thirty-Sweep clean counter remained 0/30; the later post-Review242 sweep
  found Review243 Browser Router Kernel and DB public Interface work.
- Review 241 Current Evidence Docs Drift closed the post-Review240 docs
  evidence finding: current-facing release docs now name the Review240 full
  verification gate, and the public API audit rejects stale "latest/current
  Review239" wording. The active Thirty-Sweep clean counter remained 0/30; the
  later post-Review241 framework follow-up found Review242 Solid route update
  Suspense outcome work.
- Review 240 Effect-First Cleanup, Suspense, And Public API Pins closed the
  post-Review239 sweep: best-effort cleanup catches full Causes, Start
  CLI/streaming response/command-runner/starter script ownership is
  signal-aware and Effect-first, React/Solid route Suspense and Solid Resource
  preload behavior are pinned, Core preload defects and DB sync/materialization
  edges have regressions, and dotted namespace public API type-test references
  are audited. The active Thirty-Sweep clean counter remained 0/30; the later
  post-Review240 sweep found Review241 current-evidence docs drift.
- Review 239 Main Runner, UI Lifetime, And Public Hover Cleanup closed the
  post-Review238 sweep: script and CLI entrypoints use signal-aware Effect v4
  main runners instead of top-level `Effect.runPromise(...)`, copyable starter
  leak scans carry standalone local runners, UI cleanup/preload paths catch
  full Causes, React route render finalizers are replaced at layout commit,
  Solid non-browser router cleanup disposes programmatic preload work, and
  DB/Start hovers pin the newly found public surfaces. The active
  Thirty-Sweep clean counter remained 0/30; the later post-Review239 sweep
  found Review240 cleanup, framework, Start tooling, DB, and public API
  ownership work.
- Review 237 Solid Initial Failed Render Cleanup Sequencing closed the
  post-Review236 framework follow-up: initial failed Solid route renders now
  enter the controller disposal chain before replacement renderers can run. The
  active Thirty-Sweep clean counter remained 0/30; the later post-Review237
  sweep found Review238 tooling, Resource UI cleanup, and LSP hover work.
- Review 236 Solid Failed Render Cleanup Sequencing closed the post-Review235
  framework finding: failed Solid route renders now carry the partially-created
  frame cleanup Effect back into the controller disposal chain, preserving the
  original render error for the host ErrorBoundary without detached cleanup
  fibers. The active Thirty-Sweep clean counter remained 0/30; the later
  post-Review236 framework follow-up found Review237 initial failed-render
  cleanup work.
- Review 235 Solid Route Render Scope Cleanup Sequencing closed the remaining
  Solid route-render cleanup follow-up: same-state outlet renderer swaps now
  share the same Effect/Fiber disposal sequencing as route transitions, and the
  internal route render controller exposes awaitable `disposeEffect()` cleanup
  while preserving sync `dispose()` for Solid cleanup hooks. The active
  Thirty-Sweep clean counter remained 0/30; the later post-Review235 framework
  sweep found Review236 failed-render cleanup work.
- Review 234 Cleanup Effects And Public Surface Pins closed bounded
  post-Review233 findings: DB and Core preload controllers now expose
  awaitable cleanup Effects while preserving sync host cleanup conveniences
  where immediate generation/current-ref ownership matters; Query diagnostics
  consumes one compiled Stage Plan and stale shallow helper seams were removed;
  Devtools panel lifecycle declarations and Core route-render identity helpers
  are pinned for public LSP/type-test ownership. The active Thirty-Sweep clean
  counter remained 0/30; the later post-Review234 Solid route-render follow-up
  found Review235 cleanup sequencing work.
- Review 233 Stage Plan And UI Cleanup Effects closed the post-Review232
  findings: Query Stage Plan now owns unique source adapters and identity alias
  ordering consumed by projection, preload/refetch, and Live Query State;
  Resource Suspense and Browser Router Link preload controllers expose
  awaitable cleanup Effects; React root exports hide commit-scope internals;
  and public Query namespace aliases plus cleanup Effects are type-test pinned.
  The active Thirty-Sweep clean counter remained 0/30; the later
  post-Review233 sweep found Review234 cleanup Effect and public-surface work.
- Review 232 Shared DB Query Stage Plan closed the Review231 DB Query Stage
  Planning candidate: Query Builder now compiles one internal Query Stage Plan
  for source roles,
  base-source ordering, join sources, grouping, filters, ordering, and window
  facts. Snapshot execution, projection, diagnostics, preload/refetch, and Live
  Query Runtime now consume those same stage facts. The active Thirty-Sweep
  clean counter remained 0/30; the later fresh post-Review232 sweep found
  Review233 Stage Plan And UI Cleanup Effects work.
- Review 231 closed the post-Review230 sweep findings: Browser Router Kernel
  and Host Controller now expose Effect-first `disposeEffect()` teardown for
  active route preload lifetimes; Resource UI Binding cleanup resets retained
  ref state so StrictMode-style same-ref rebinds retain again; React runtime,
  component, and route scopes are replay-safe under StrictMode while route
  scopes use the React commit-gated Seam instead of direct Core frames; the
  public API inventory audit now requires `sourceSurface` for local root
  re-exports and pins React DB/Solid DB `collection` and `live-query`; and
  `Collection.*` namespace values have hover-policy and type-test ownership.
  The active Thirty-Sweep clean counter remained 0/30; the later post-Review231
  DB pass found Review232 Shared DB Query Stage Plan work.
- Review 230 closed the post-Review229 sweep findings: public `Query.Builder`
  is now branded so the Type Interface matches runtime fake-builder rejection;
  `ResourceUiBindingController` exposes Effect-first `disposeEffect()` for
  preload interruption and retained-ref cleanup; React and Solid adapters run
  that Effect during hook cleanup; React component scopes are commit-gated so
  abandoned renders cannot start scoped work; Core/React/Solid source surfaces
  live in the public manifest; DB persistence/background-sync root helpers have
  LSP/type-test ownership; and DB D2 locality docs no longer overstate
  unordered grouped windows. The active Thirty-Sweep clean counter remained
  0/30; a later post-Review230 sweep found Review231 work.
- Review 229 closed the post-Review228 sweep findings: Start action request,
  form, and client helpers now have root-export, hover-policy, inventory, and
  type-test ownership; the Effect command runner owns stdout/stderr collectors
  with Effect v4 `Effect.forkChild(...)` and verifies noisy interruption;
  public DB Collection Stores are diagnostics/events-only, public live queries
  no longer expose their internal builder, and `Query.Builder` is a fluent DSL
  Interface without execution-plan fields; Action and StartAction sync
  `reset()` conveniences are runtime-owned while `resetEffect()` remains the
  Effect-first Interface; direct Core Resource symbols and Solid path helpers
  now have explicit LSP/type-test ownership. The active Thirty-Sweep clean
  counter remained 0/30; a later post-Review229 sweep found Review230 work.
- Review 228 closed the post-Review227 sweep findings: Core browser-router
  helper types, Stable Identity Codec errors, and Resource duration helper
  types now have public hover-policy, inventory, and type-test ownership; DB
  query factory, query plan, and collection detachment guardrails all reuse the
  shared guarded `isPromiseLikeValue(...)` probe; the concrete `QueryBuilder`
  constructor is no longer a package-root export; and public Start file-route
  resource refs now reject Promise-shaped and malformed selector results as
  typed `FileRoutePreloadError` values. The active Thirty-Sweep clean counter
  remained 0/30; a later post-Review228 sweep found Review229 work.
- Review 227 closed the post-Review226 sweep findings: Core now owns
  `isPromiseLikeValue(...)` as the shared Promise-shaped runtime probe for
  EffectInput and host seams, including throwing `then` getters; Start fetch
  headers, file-route preload helpers, Capability sync callbacks, and the Start
  diagnostics CLI loader reuse that probe; direct DB root exports now have
  hover-policy, public inventory, and type-test ownership; the Start CLI loader
  type-test seam now owns Effect-only loader returns; and current diagnostics
  Vite server lifetime docs name `Effect.acquireUseRelease(...)`. A later
  post-Review227 sweep found Review228 work, so the active Thirty-Sweep clean
  counter stayed at 0/30.
- Review 226 closed the post-Review225 sweep findings: Query entrypoint hovers
  now name Promise-shaped, Effect-shaped, and other non-builder factory-result
  rejection explicitly, public hover policy owns the full Query DSL namespace
  value surface, and injected Start diagnostics CLI loaders now reject sync
  throws, Promise-shaped returns, and plain non-Effect returns through
  `StartAppGraphDiagnosticsRunnerError`. A later post-Review226 sweep found
  Review227 work, so the active Thirty-Sweep clean counter stayed at 0/30.
- Review 225 closed the post-Review224 sweep findings: Resource hydration
  payload helper hovers now say the helpers build validated payloads from loaded
  Resource refs, public hover policy owns both helper names, and DB public type
  tests plus the manifest now own `Collection.QuerySyncKey` and
  `Collection.QuerySyncKeyPart`. A later post-Review225 sweep found Review226
  work, so the active Thirty-Sweep clean counter stayed at 0/30.
- Review 224 closed the post-Review223 sweep findings: erased
  Promise-shaped, Effect-shaped, and non-builder query factory results now fail
  immediately as `QueryEvaluationError` operation `"evaluate"` with
  `QueryFactoryResultRejected` cause details across build/execute,
  diagnostics, once, and live query entrypoints. Current Sweep Results sections
  now name Review223/Review224 evidence instead of stopping at Review222. A
  later post-Review224 sweep found Review225 work, so the active
  Thirty-Sweep clean counter stayed at 0/30.
- Review 223 closed the post-Review222 local findings: `Query.build(...).execute()`
  now validates query plans before projection and wraps plan-validation and
  factory failures in `QueryEvaluationError` operation `"evaluate"`, matching
  `Query.diagnostics(...)`, `Query.onceEffect(...)`, and `Query.live(...)`.
  Resource hydration payload constructors now validate duplicate ref snapshots
  before returning; the public type-test manifest owns the top-level hydration
  payload/input names; docs distinguish `{ resources: snapshots }` from
  ref-based payload helpers; starter transitive workspace dependency discovery
  fails as `StarterPackageError`; and public LSP policy covers Resource
  diagnostics/result/value/error helpers plus `Collection.QuerySyncKeyPart`.
  A later post-Review223 sweep found Review224 work, so the active
  Thirty-Sweep clean counter stayed at 0/30.
- Review 222 closed the post-Review221 sweep findings: top-level Resource
  hydration payload/input symbols now have public hover-policy and type-test
  ownership; sync `Resource.hydrate(...)` rejects legacy raw snapshot arrays in
  type and runtime coverage; `Query.diagnostics(...)` wraps plan-validation
  failures in the same `QueryEvaluationError` envelope used by once/live APIs;
  and DB query/index hovers and docs name valid Dates, invalid Dates, and NaN
  comparable failures explicitly. A later post-Review222 local sweep found
  Review223 work, so the active Thirty-Sweep clean counter stayed at 0/30.
- Review 221 closed the post-Review220 sweep findings: Resource hydration now
  accepts only payload objects, with raw snapshot arrays rejected at type and
  runtime; DB secondary indexes reject invalid Dates at selector and lookup
  seams as `EffectInputCallbackError`; Query ordering rejects invalid Dates and
  NaN as `QueryEvaluationError` operation `"order"` across diagnostics, once,
  and live state; and the Effect command runner force-kill fallback now uses
  Effect v4 generator sequencing with a SIGTERM-ignoring child regression. The
  active Thirty-Sweep clean counter stayed at 0/30 because a later
  post-Review221 sweep found Review222 work.
- Review 220 closed the post-Review219 sweep findings: Core Router Link
  preloading now exposes only the full preload identity Interface; read-only
  Live Query Collections reject empty `applyChangesEffect(...)` batches with
  `ReadonlyCollectionMutation`; Start removed the unused scoped response
  Promise runner; Effect command execution now has policy-owned success,
  failure, spawn-failure, and interruption coverage; package dry-runs and
  generated starter local packages share a policy-owned dist payload self-test;
  and current docs/LSP evidence names the Runtime Provider options, React/
  React DB hover coverage, Start Vite peer dependency, and generated/package
  policy facts. A later post-Review220 sweep found Review221 work, so the
  active Thirty-Sweep clean counter stayed at 0/30.
- Review 219 closed the post-Review218 sweep findings: Core Runtime Provider
  lifecycle now exposes typed provider-owned disposal while framework adapters
  keep observer cleanup; direct SQLite persistence rejects malformed
  namespace/key/value fields before table callbacks; borrowed Start diagnostics
  server loading no longer closes caller-owned servers; runtime wildcard docs
  distinguish exact Core ambient `EffectUiRuntime<any, any>` hits from named
  router/host `EffectUiRuntime<any, ER>` Adapter seams; script commands now run
  through Effect v4 `ChildProcess` plus a local Node spawner; and package
  dry-runs/generated starters share one dist payload policy Interface. A later
  post-Review219 sweep found Review220 work, so the active Thirty-Sweep clean
  counter stayed at 0/30.
- Review 218 closed the post-Review217 sweep findings: shared Runtime Provider
  lifecycle normalization now lives in Core and is consumed by React/Solid;
  project-console runtime props require `ProjectApi`; explicit Start
  diagnostics options no longer merge config-file Start plugins unless callers
  opt in; DB indexed joins, query sync keys, direct write updates, and direct
  SQLite metadata validation share stronger typed guardrails; and starter/
  package manifest checks treat example `type-tests` as verification-only
  source.
  A later post-Review218 sweep found Review219 work, so the active
  Thirty-Sweep clean counter stayed at 0/30.
- Review 217 closed the post-Review216 sweep findings: Form validation helpers
  and `ActionResult.fromValidationEffect(...)` require plain validation data,
  DB query sync keys and secondary indexes reject executable-shaped values
  before clients or buckets observe them, hostile row reads map into typed
  collection ingress errors, Devtools/runtime LSP hovers are policy-pinned, and
  project-console no longer teaches `EffectUiRuntime<any, never>` erasure at
  its app runtime seam.
- Review 212 closed the post-Review211 sweep findings: `ActionResult`
  success/failure helpers reject nested Promise-shaped payloads, Program
  command/dispatch/subscription/story message seams reject Promise-shaped
  messages, DB change-feed failed subscribe setup shuts down captured emitters,
  in-flight direct emits complete when scope release interrupts apply work,
  Core/Start LSP hovers name the Effect-first no-Promise contracts, and
  Effect-first evidence wording distinguishes runtime-test Promise rejection
  fixtures from implementation Promise choreography. A later post-Review212
  sweep found Review213 work, so the active Thirty-Sweep clean counter stayed
  at 0/30.
- Review 211 closed the post-Review210 sweep findings: `Program.next(...)`
  rejects Promise-shaped models, Program runtime rejects erased Promise-shaped
  step models before state commit, optimistic action signal patches reject
  Promise-shaped values/updater returns, change-feed unsubscribe defects are
  published and swallowed during scope release, React/Solid preload observer
  hovers name Promise rejection and failing Effect behavior, and Review210
  evidence wording now distinguishes Promise return-type allowances from
  negative fixtures. A later post-Review211 sweep found Review212 work, so the
  active Thirty-Sweep clean counter stayed at 0/30.
- Review 210 closed the post-Review209 sweep findings: EffectInput now rejects
  returned Effects that succeed with Promise-shaped or callable-`then` values,
  `verify.mjs` handles help/invalid argv before running builds, DB change-feed
  cleanup docs describe failure publication without cleanup rethrows,
  React/Solid DB option types are public type-test pinned, Start diagnostics
  CLI tests pin all three Effect CLI `graph --verbose` shared-flag placements,
  and a later post-Review210 sweep found Review211 work, so the active
  Thirty-Sweep clean counter stayed at 0/30.
- Review 209 closed the Clean Sweep 2 finding after Review208: explicit
  broad `unknown` annotations can no longer hide Promise-shaped callback
  returns at direct EffectInput, Resource, Action, or Program seams, and the
  active Thirty-Sweep clean counter reset to 0/30.
- Review 208 closed the first post-Review207 sweep findings: React and Solid
  RuntimeProvider disposal observers now expose `EffectInput<void, unknown>`
  while rejecting Promise-shaped observers, the package dry-run gate executes
  the linked `effect-ui-start` bin directly on POSIX, the Start build marks
  `dist/cli.js` executable, Solid match docs use plain callback values, and at
  the Review208 checkpoint stale current-gate ledgers were refreshed from
  Review206 to Review208.
- Clean Sweep 1 after Review208 found no actionable Core/React/Solid,
  DB/public API, Start/devtools/scripts/package, or docs/evidence findings,
  temporarily moving the counter to 1/30 before Clean Sweep 2 found Review209
  work.
- Review 207 closed the first post-Review206 sweep findings: Action hover docs
  now describe `exhaust` as joining the in-flight submission, direct Action
  root symbols are public-hover and type-test pinned, and starter/DB hydration
  docs label `hydrateFromDocument(...)` as the synchronous host facade over
  `hydrateFromDocumentEffect(...)`.
- Review 206 closed the first post-Review205 sweep findings: the Start CLI bin
  main guard now follows real filesystem paths so package-manager symlink
  entrypoints execute, the package dry-run verifier runs the built
  `effect-ui-start` bin through a temporary symlink, and hydration docs now
  teach the Effect-first `hydrateFromDocumentEffect(...)` /
  `hydrateStartPayloadEffect(...)` path before the synchronous Resource facade.
- Review 205 closed the first post-Review204 sweep findings: current evidence
  dates now match the local May 16, 2026 repo clock and the historical
  `verify:serial` row now points at the Workspace Verification Plan
  `--concurrency=1` contract.
- Review 204 closed the first post-Review203 sweep findings: React and Solid
  hook exports now participate in the public hover-doc policy, and
  `ResourceSuccessMeta` / `ResourceMatch` are manifest-required adapter-root
  imports.
- Review 203 closed the first post-Review202 sweep findings: React and Solid
  router public pins now cover `isPlainLeftClick` and
  `BrowserNavigateOptions`, fetch facade merged fallback abort cleanup stays
  tied to streamed response lifetime, package-local typechecks are no-emit
  project checks, and `verify.mjs` failure handling uses Effect v4 generator
  composition.
- Review 202 closed the first post-Review201 sweep findings: React and Solid
  focused type tests pin adapter-root Core ergonomics and runtime helpers; DB
  `hydrate: false` now skips config-driven restore-before-preload, erased
  persistence keeps `AnyCollection<E, R>` channels, and `QueryGroupKey` rejects
  Promise-shaped Map/Set entries at the type seam; package dry-runs and
  generated starter local package adapters share one dist/declaration payload
  policy; `verify:serial` reuses the Workspace Verification Plan; package
  typechecks run with `--noEmit`; and CONTEXT names the workspace script seams.
- Review 201 closed the first post-Review200 sweep findings: workspace scripts
  share an Effect v4 `ChildProcess.Command` runner behind one Node host Adapter;
  generated starter docs reject unpinned `@latest` CLI instructions; Core keeps
  the internal `ResourceCollector` out of the root export while pinning
  `Resource.collectEffect(...)` / `Resource.Collected`; React and Solid router
  type tests plus hover policy now cover links, outlets, `useRouter`, errors,
  state, and route/path helper types; DB group keys reject nested
  Promise-shaped values, bare `AnyCollection` erases to `unknown`, and
  change-feed unsubscribe cleanup preserves serviceful Effects.
- Review 200 closed the first post-Review199 sweep findings: React and Solid
  `createBrowserRouter(...)` now require preload-capable runtimes for serviceful
  routes; DB exposes computed flush/background error and requirement aliases
  under `Collection.*`; Solid DB mirrors React DB write/flush handle pins and
  both DB adapters are covered by hover-doc policy; Vite dev SSR contains
  fork/listener setup failures and rejects invalid erased handler values as
  typed `StartDevServerError`; Start CLI process writers are owned by `cli.ts`;
  and Start Vite expert host seam types are pinned in public type tests.
- Review 199 closed the first post-Review198 sweep findings: Solid browser
  router derives its public host controller Interface from the Core controller
  projection while keeping Solid accessors local; React DB public docs/type
  tests pin runtime-bound pending mutation/write/flush handles and runtime error
  propagation; Vite dev SSR handlers can preserve service requirements and run
  through `EffectUiStartOptions.devSsr.runtime`; diagnostics temporary Vite
  server close failures remain typed; and the diagnostics CLI bin catches writer
  failures inside the Effect-owned process boundary instead of leaking rejected
  Promises.
- Review 198 closed the first post-Review197 sweep findings: DB Query
  callbacks now reject erased Promise-shaped filter, join, order, projection,
  and aggregate returns as typed `QueryEvaluationError` failures with public
  projection/aggregate type pins; Start file-route discovery now owns
  generated-file exclusion, route-directory existence, extension/declaration
  filtering, discovered path normalization, and Vite hot-update eligibility
  through one shared policy; Start Vite plugin names are shared between the Vite
  Adapter and diagnostics loader.
- Review 197 closed the first post-Review196 sweep findings: Route preload,
  Action optimistic/invalidation metadata, Resource provides metadata, Resource
  custom keys, and DB flush-skip policy now reject erased Promise-shaped values
  at typed Module seams; Start action clients now distinguish fetch
  `transportRuntime` from application `runtime` / `responseRuntime` for
  hydration and invalidation metadata.
- Review 196 closed the first post-Review195 sweep findings: erased
  Promise-shaped Action/Program callbacks now become typed
  `EffectInputCallbackError` failures instead of hanging state machines, Start
  file-route manifest artifacts materialize modules once for one-shot inputs,
  Start transport headers reject Promise-shaped callbacks as typed transport
  errors, public Start/Devtools/DB Interfaces have stronger LSP/type-test pins,
  starters no longer export duplicate manual preload Effects, and remaining
  file-route docs/examples use `defineFileRoute(path).preload(...).route(...)`.
- Review 195 closed the first post-Review194 sweep findings: erased
  Promise-shaped Resource loader returns now become typed
  `EffectInputCallbackError` failures instead of pending resources, Resource
  Store module finalizers can fail with module-local errors while store
  disposal wraps them, Start diagnostics virtual modules normalize one-shot
  manifest iterables, failed SSR/render stream traces include `failureKind`,
  and file-route JSDoc/starters/type tests now show the chained
  `defineFileRoute(path).preload(...).route(...)` API with
  `FileRoutePreloadRouteOptions` LSP pins.
- Review 194 closed the first post-Review193 sweep findings: runtime and
  Resource Store disposal now expose typed errors, React/Solid disposal
  observers receive `RuntimeDisposeError`, Start request traces unwrap cleanup
  failures, `Resource.ReadError` preserves failed ref input/service types,
  Resource retry applies only to returned load Effects, and Start action/Vite
  public LSP pins cover forms, duplicate names, defaults, and virtual module ids.
- Review 193 closed the first post-Review192 sweep findings: route preload
  annotations no longer widen into Promise-accepting `unknown`, sync
  capabilities reject Promise-shaped callback values, file-route helper
  resource selectors reject Promise-shaped selected input, serviceful
  `Query.diagnostics(...)` factories typecheck, Start action/server-function
  manifest APIs have hover-doc/type-test pins, and the last Review190
  current-gate audit docs are refreshed.
- Review 191 moved Promise-member rejection into the shared `EffectInput`
  contract, so `toEffect(...)`, `invokeEffectInput(...)`, and ActionResult
  helpers reject union-shaped Promise success values while still accepting
  Effects. Start host handlers now report invalid non-Effect return shapes as
  typed `StartRequestHandlerError` causes, DB query validation rejects reserved
  source aliases consistently, and Start/Devtools/DB public LSP docs are pinned
  by source-surface, type-test, and hover-doc policy gates.
- Clean Sweep 1 after Review190 reached 1/30, but Clean Sweep 2 found Review191
  work, the first post-Review191 sweep found Review192 docs drift, and the
  first post-Review192 sweep found Review193 work, and the first post-Review193
  sweep found Review194 work, and the first post-Review194 sweep found
  Review195 work, the first post-Review195 sweep found Review196 work, the
  first post-Review196 sweep found Review197 work, and the first
  post-Review197 sweep found Review198 work, and the first post-Review198 sweep
  found Review199 work, and the first post-Review199 sweep found Review200
  work, the first post-Review200 sweep found Review201 work, the first
  post-Review201 sweep found Review202 work, the first post-Review202
  sweep found Review203 work, the first post-Review203 sweep found
  Review204 work, the first post-Review204 sweep found Review205 work, the
  first post-Review205 sweep found Review206 work, the first
  post-Review206 sweep found Review207 work, and the first post-Review207
  sweep found Review208 work. The fresh post-Review208 sweep found no
  actionable findings, creating Clean Sweep 1 after Review208, but Clean Sweep
  2 found Review209 work, a local post-Review209 pass found Review210 Core,
  DB, scripts, docs, React/Solid DB, and Start evidence work, and the first
  post-Review210 sweep found Review211 work, and the first post-Review211
  sweep found Review212 work, and the first post-Review212 sweep found
  Review213 work, the first post-Review213 sweep found Review214 work, and the
  first post-Review214 sweep found Review215 work, and the first
  post-Review215 sweep found Review216 work, the first post-Review216 sweep
  found Review217 work, the first post-Review217 sweep found Review218 work,
  the first post-Review218 sweep found Review219 work, and the fresh
  post-Review219 sweep found Review220 work, the fresh post-Review220 sweep
  found Review221 work, the fresh post-Review221 sweep found Review222 work,
  the post-Review222 local sweep found Review223 work, the post-Review223
  sweep found Review224 work, the post-Review224 sweep found Review225 work,
  the post-Review225 sweep found Review226 work, the post-Review226 sweep
  found Review227 work, the post-Review227 sweep found Review228 work, and the
  post-Review228 sweep found Review229 work, the post-Review229 sweep
  found Review230 work, the post-Review230 sweep found Review231 work, and the
  post-Review231 DB pass found Review232 Shared DB Query Stage Plan work, and
  the fresh post-Review232 sweep found Review233 Stage Plan And UI Cleanup
  Effects work, and the fresh post-Review233 sweep found Review234 cleanup
  Effect and public-surface work, and the fresh post-Review234 Solid
  route-render follow-up found Review235 cleanup sequencing work, and the
  fresh post-Review235 framework sweep found Review236 failed-render cleanup
  work, and the fresh post-Review236 framework follow-up found Review237
  initial failed-render cleanup work, and the fresh post-Review237 sweep found
  Review238 tooling, Resource UI cleanup, and LSP hover work, and the fresh
  post-Review238 sweep found Review239 main-runner, UI lifetime, framework
  cleanup, and public hover work, the fresh post-Review239 sweep found
  Review240 cleanup, framework, Start tooling, DB, and public API ownership
  work, and the fresh post-Review240 sweep found Review241 current-evidence
  docs drift work, and the fresh post-Review241 framework follow-up found
  Review242 Solid route update Suspense outcome work, and the fresh
  post-Review242 sweep found Review243 Browser Router Kernel and DB public
  Interface work, and the fresh post-Review243 sweep found Review244 Effect
  cleanup ownership, DB pins, Devtools typed failure, and current-evidence
  policy work, the fresh post-Review244 sweep found Review245 public API
  symbol reachability and router Adapter parity work, and the fresh
  post-Review245 sweep found Review246 Effect cleanup capture and Vite
  middleware lifecycle work.
  The active Thirty-Sweep clean counter is 0/30 until a fresh post-Review246
  sweep reports no actionable findings.
- Review 192 refreshed stale current-gate docs wording that still named
  Review190 or active 1/30 progress after Review191.
- Review 190 tightened `Server.fn(...)` so union-shaped Promise handler returns
  are rejected at the public type surface, preserved negative query window
  values until validator rejection, removed the accidental public query
  projection helper, and clarified raw `.catch(...)`/`async` audit evidence
  around scanner fixture strings and prose-only hits.
- Review 189 clarified Promise-method audit evidence: raw grep hits in
  `scripts/audit-effect-first.mjs` are scanner fixture strings for banned
  Promise forms, while `pnpm audit:effect-first` is the authoritative
  implementation guardrail.
- Review 188 tightened the sharp-cast source state again: DB change-feed
  dispatcher completion now carries the collection runtime error channel,
  read-only live-query restore no longer needs an inline Effect assertion,
  Runtime Collection Store names its weak-map state boundary, and React/Solid DB
  delayed-cleanup tests dropped redundant Effect assertions. The sharp-cast docs
  now name remaining package, example, and type-test seams instead of implying a
  zero-hit broad grep.
- Review 187 refreshed Effect-first, package-hygiene, and sharp-cast audit docs
  that still named Review185 as the current full gate after Review186, and
  corrected the final checklist's broad sharp-cast status so it names
  documented seams instead of claiming zero grep hits. Review185, Review179,
  and Review165 remain historical focused evidence for their slices, and the
  Thirty-Sweep clean counter remains unstarted until the next fresh sweep is
  clean.
- Review 186 closed a stale Review185 ledger sentence that still named
  Review184 as the current full gate. The post-Review185 subagents found no
  actionable code/API/script issues, but this docs drift means the
  Thirty-Sweep clean counter remains unstarted until the next fresh sweep is
  clean.
- Review 168 closed Markdown TypeScript/JavaScript snippet coverage in the
  Effect-first Source Audit and Devtools app graph repair for stale public
  Store/Bridge inputs.
- Review 169 closed the Start abort lifecycle Seam: abort signal merging,
  fallback listener cleanup, scoped abort finalizers, and host-fiber
  interruption now live in one Start Module, and Fetch host facades cancel
  outstanding streamed response bodies when inbound requests abort after
  `Response` creation.
- Review 170 closed the Starter Catalog Manifest Seam: starter identity,
  generated starter content, source-package payload policy, generated
  route/virtual artifacts, package dry-run checks, and Effect-first virtual
  template auditing now share one catalog Module. The root `verify` command now
  runs through an Effect-driven runner with `verify:serial` retained as the
  shell-chain fallback.
- Review 171 closed the declaration-level Public API Symbol Policy Seam:
  curated LSP hover declaration pins and namespace-backed source-module
  allowances now live in one script Module, and the public API inventory audit
  rejects hover policy files that are not reachable from package exports or
  re-exported public source Modules. The compiled Query Execution Plan
  candidate was re-reviewed and closed as already handled by the existing DB
  Query Execution Plan Module.
- Review 172 cleaned up stale current-facing Review167 carry-forward language.
- Review 173 closed the Start Virtual Declaration Artifact Adapter guardrail:
  `@effect-ui/start/virtual` package dry-runs now require
  `dist/virtual.d.ts`, compare it byte-for-byte against
  `src/virtual-modules.d.ts`, and reject stale `dist/virtual.d.ts.map` files.
- Review 174 closed the DB Collection Policy cleanup: stale
  `replaceCollectionRows(...)` state code was removed, and load/mutation retry
  now share one internal Collection Policy Module for `policy.retry`.
- Review 175 closed the Browser Router Link Preload Identity cleanup:
  React/Solid RouterLink adapters now consume
  `browserRouterLinkPreloadIdentity(...)` from Core instead of duplicating
  preload-owner key construction and enabled-state policy.
- Review 176 closed the public hover symbol coverage gap: Resource UI Binding,
  Browser Route Render Decision, and React/Solid Runtime Adapter expert-public
  seams are now pinned by the executable LSP hover-doc policy.
- Review 177 closed the route-owned `UiScope` lifecycle duplication:
  `makeRuntimeUiScopeFrame(...)` now gives React and Solid adapters one Core
  runtime-plus-scope frame for component and route render lifetimes.
- Review 178 closed the Browser Router Initial Matched State cleanup:
  React and Solid now consume Core `browserRouterInitialMatchedState(...)` so
  server rendering and host hydration start matched routes ready, while
  client-only browser mounts can still start pending.
- Review 179 closed verification guardrail gaps: the Effect-driven root
  verifier now derives package-level verify targets from package manifests,
  package dry-runs require concrete source-map artifacts, source packages must
  declare `verify` scripts, and public subpath `sourceSurface` manifests are
  checked.
- Review 180 classified the DB top-level creation helpers as compatibility
  aliases for the namespace-owned `Collection` and `Query` APIs, with
  deprecation JSDoc plus public type-test and manifest pins.
- Review 181 closed adapter runtime locality blockers: React `useScoped(...)`
  now runs construction inside the active Runtime Spine, and Solid browser
  routers no longer start browser preload/navigation work during non-browser
  construction.
- Review 182 closed the DB public hover-doc and expert Interface pins:
  Collection contract types, Query plan diagnostics, flush/background-sync
  results, reactive binding helpers, server collection adapters, and SQLite
  persistence helpers are now covered by LSP docs and focused public API pins.
- Review 184 closed current-status docs drift found by the fresh post-Review182
  sweep: older Review166/165/163 and Review167 evidence now reads as historical
  evidence instead of competing with the current Review182/184 readiness story.
- Review 185 closed the next fresh script/docs drift: starter catalog validation
  now fails through typed Effect seams instead of an import-time raw
  `Error`, and Effect-first, sharp-cast, and package-hygiene docs now point
  current full-gate wording at Review185 while keeping Review165/179 as
  historical focused evidence.
- Review 167 closed shared Core route render identity for React/Solid route
  `UiScope` lifetimes, same-ref Resource preload failure cleanup after manual
  prefetch/refresh retry, detached Start agent graph facts, and React/Solid DB
  adapter re-export type-test pins. Follow-up Reviews 168 through 171 closed the
  broader Review167 candidates, so no old Review167 item remains carried
  forward.
- Review 166 closed mounted Resource UI retention through `gcFor`, Solid route
  render updates keyed by state plus active renderer identity, DB no-op write
  side effects, single-tick DB hydration, observable change-feed unsubscribe
  failures, generated route output discovery/HMR exclusion, inline Start
  diagnostics plugin preservation, diagnostics/graph coherence validation,
  exact generated starter tarball app manifests, structural public type-test
  references, and host-global Promise alias guardrails.
- Review 165 closed committed Program dispatch acknowledgement races,
  React runtime/preload observer stability, payload-atomic DB hydration,
  failed live-query snapshot rejection, Start diagnostics CLI EffectInput
  writers, default fetch fallback abort-listener cleanup, dev SSR Effect-owned
  reader cancellation, source-scoped generated companion identifiers, semantic
  app-graph DTO validation, public Start adapter error pins, and
  expression-position Promise static guardrails.
- Review 164 closed Program dispatch disposal semantics via
  `Program.DispatchError` and adapter
  `clearTimeline()` handles, provider-owned runtime disposal observers, DB
  collection preload/query diagnostics and read-only collection facts, DB
  adapter preload observer EffectInput seams, Fetch host abort wiring, dev SSR
  read-abort trace classification, source-scoped file-route support modules,
  virtual route type pins, public API target/source checks, dist artifact
  dry-run validation, and destructuring-assignment Promise guardrails.
- Review 163 closed Solid action accessor adaptation, EffectInput preload
  failure observers, hydrateable live-query collection SSR collection, query
  factory error normalization, Vite 8 route hot-update create/delete support,
  cancellable dev SSR HTML body reads, exact source-package dry-run manifests,
  assignment-alias Promise scanning, and fresh public API/docs guardrails.
- Review 162 closed Resource result lifetime stability, React failed-render
  route scope disposal, package-local hook type pins, shared DB durable snapshot
  planning, DB snapshot diagnostics, Start host disconnect cancellation, dev
  route artifact refresh, and current-facing guardrails.
- Review 161 closed DB durable write interruption gaps, transitive live-query
  snapshot permits, authoritative Start transport diagnostics, typed
  stable-stringify host failures, React action value adaptation, Start/Vite
  route writer public pins, and the `self.Promise` Effect-first guardrail.
- Review 160 closed committed React Program startup, durable DB live-query
  snapshots, local unsynced row preservation, and hostile-safe Start agent graph
  fact rendering. See `docs/architecture-deepening-review.md` for the current
  review tip and full evidence.
- Review 150 closed Start fetch/Node Adapter overload hovers, public type-test
  raw-text coverage drift, `Promise.try` / `Promise.withResolvers` guardrails,
  generated starter tarball local-package inclusion, and the expanded 16-target
  package payload gate.
- Review 149 closed Resource Store implementation marker opacity, lazy runtime
  store override validation, template-literal Promise member guardrails,
  generated route artifact content-drift checks, and package dry-run gating.
- `pnpm benchmark` refreshed the SSR, route preload, Resource, live query, and
  RPC transport baselines.
- The latest `pnpm verify` includes the starter-suite packaging gate and the
  devtools extension verify gate.
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
- Review 111 deepened that Query Execution Plan seam so one-shot and live
  queries share the same deterministic row-identity tie-break when explicit
  `orderBy(...)` selectors compare equal.
- Review 121 extracted the internal DB Collection Mutation Workflow Module:
  optimistic insert/update/delete transaction construction, mutation handler DTO
  detachment, active mutation `Deferred` joining, `Schedule` retry, optimistic
  commit/rollback, mutation lifecycle events, mutation persistence, and restored
  pending flush replay now live behind one Effect v4 workflow while Collection
  Runtime keeps the public facade, direct writes, change-feed application,
  hydration, and persistence facades.
- Review 122 deepened the Core Browser Router Link Decision policy: React and
  Solid RouterLink adapters now share one Core decision for hover preloading,
  default-prevented events, modified clicks, browser-handled targets/downloads,
  outside-router routes, and replace navigation while keeping DOM event wiring
  local.
- Review 123 extracted the internal Start Diagnostics CLI Contract Module:
  graph/impact query-kind vocabulary, `CliError.InvalidValue` expected text,
  and shell-safe impact verify command planning now live in one contract while
  `cli.ts` builds real Effect v4 nested `Command` subcommands from that catalog
  and generated Effect CLI help remains the source of truth.
- Review 124 extracted the internal Core Program Runtime Timeline Module:
  Program event retention, sequence assignment, optional program name
  annotation, disabled timeline behavior, and clearing now live behind one
  timeline policy while `program.ts` keeps the public Program facade, queue,
  command fibers, subscriptions, failures, and disposal local.
- Review 125 split the rest of the Core Program Module into internal Contract,
  Primitives, Story Harness, and Runtime Coordinator Modules. The public
  `program.ts` facade still preserves the exported surface and `Program`
  namespace, while live Queue/Fiber/Scope execution and deterministic story
  execution now have separate locality.
- Review 126 hardened the Core Program Runtime Coordinator lifecycle:
  `dispatchEffect(...)` acknowledgements complete during disposal races,
  subscription restarts are owned by committed model changes rather than hidden
  signal observers, stale subscription generations cannot emit follow-up
  messages or timeline facts, and post-dispose update continuations cannot
  mutate model state or run commands.
- Review 127 split Start Agent Graph query, display, formatting, and impact
  planning out of `agent-graph.ts`: the public facade keeps diagnostics-to-graph
  projection while focused internal Modules own DTO contracts, query matching,
  shared display policy, graph/impact text, semantic impact relations, warnings,
  and verify-command injection.
- Review 128 extracted the internal DB Query Context Identity Module: Query
  Execution Plan and Live Query Runtime now share one source alias/key, merged
  context, ordered tie-break, IVM metadata, and collection-row delta identity
  policy while public Query and Collection APIs stay unchanged.
- Review 129 started from fresh post-Review128 subagent sweeps and fixed the
  Start/docs findings: graph kind vocabulary now lives in one internal Module,
  Start diagnostics DTO decoding validates resource/tag/collection registry
  diagnostics structurally, and public Start graph/diagnostics plus Core
  Program namespace hovers now explain their agent-facing purpose.
- Review 130 fixed the DB store-explicit snapshot Interface candidate from the
  same fresh sweep: Collection Persistence now consumes one internal Module for
  marked definitions, Live Query Collections register their runtime-store
  snapshot implementation through that Module, and incomplete markers fail as
  typed `CollectionSnapshotCodecError`s instead of silently using ambient
  snapshots.
- Review 131 closed the post-Review130 public hover findings: Start agent graph
  constructors, Core `Program.*` type aliases, and Start diagnostics loader
  failure aliases now describe their purpose directly in LSP hovers.
- Review 132 extracted Start app graph diagnostics policy into a focused
  internal Module, added a public hover-doc audit hook, documented the direct
  Core Program contracts, and pinned DB hydrate preflight plus Start graph query
  vocabulary regressions.
- Review 133 closed the post-Review132 docs/test findings: public Start app
  graph hovers and diagnostics policy hovers are audit-pinned, app-graph APIs
  are asserted through `@effect-ui/start` type tests, diagnostics policy
  opt-outs are covered, and every graph query kind runs through the CLI
  parser/runtime seam for graph and impact commands.
- Review 134 closed the fresh post-Review133 audit gaps: graph query-kind types
  derive from the shared catalog, static build policy validation no longer
  claims resolved runtime diagnostics, Vite/runtime diagnostics opt-outs and DB
  multi-collection store-explicit hydrate preflight are pinned, app graph
  DTO/errors/deserializer hovers are audit-pinned, and stale
  `Effect.runPromise` seam allowances were removed.
- Review 135 closed the fresh post-Review134 sweep gaps: store-explicit
  hydration now applies through a store-aware internal Interface, diagnostics
  DTO decoding rejects malformed preload/action enum strings, the Vite subpath
  type test pins diagnostics/build-policy exports and static-only
  `StartBuildPolicyError`, `StartBuildPolicyError` hovers are audit-pinned, and
  the Start fetch Promise-return allowance is exact.
- Review 136 closed fresh docs/test drift: approved Effect-first occurrences
  now require exact per-file counts, DB public inventory no longer lists
  internal store modules as root exports, and exported Start app-graph helper
  hovers are audit-pinned.
- Review 137 closed the fresh source-surface verification gap: the public API
  inventory audit now checks root barrel Source Surface docs in both directions,
  with explicit namespace-backed source-module allowances, so docs cannot list
  internal local modules unless they are part of a checked public surface.
- Review 138 closed the fresh Effect-first wording gap: exact audit allowances
  are now reported as allowed occurrence counts, and docs describe the guarantee
  as deleted-occurrence/cross-file-move detection rather than line-level seam
  anchoring.
- Review 139 closed fresh Start/DB/audit/docs gaps: RPC and action endpoints
  share the Start Transport Endpoint Runner Module, Live Query Runtime validates
  through the Query Execution Plan Module Interface, Collection projection/state
  callback policy lives in one DB Module, public type-test rows can require
  concrete references, and Effect-first allowances are anchored to named seams.
- Review 140 closed fresh Core/React/Solid runtime/router seams: React and
  Solid `RouterProvider` now forward injected Browser History Adapters, and the
  Program Runtime Scheduler makes detached Runtime Spine forks explicit while
  preserving typed Program runtime provision failures for acknowledged work.
- Review 141 closed fresh Project Console/starter seams: demo project state now
  lives in a server Runtime Spine-provided Effect `Ref` store, and starter
  packaging verifies the full generated file manifest while resolving
  workspace protocol dependencies from package manifests.
- Review 142 closed fresh runtime/test/tooling/docs gaps: uncaptured
  `StartAction.use(...)` response metadata now stays local to the caller
  runtime, React DB has runtime-ownership parity coverage, Browser History
  Adapter declarations are LSP/type pinned, the Effect-first scanner catches
  typed Promise member chains plus `Promise.allSettled`/`Promise.any`, and
  stale starter docs now describe the 27-file manifest policy.
- Review 143 closed fresh StartAction/audit/docs gaps: stale successful
  parallel StartAction submissions now still run invalidations without applying
  stale hydration, public browser-history pins cover React/Solid provider and
  option surfaces, the Effect-first scanner catches broad `PromiseLike<T>` and
  bracket/multiline Promise choreography, and starter/checklist docs are current.
- Review 144 closed fresh DB/browser-router/audit/docs gaps: synchronous
  collection pending-mutation, snapshot, and dehydration reads now honor the
  active Collection Store override; the browser-router kernel surface is
  hover-audit and type pinned; the Effect-first scanner covers package
  declaration files, optional Promise calls, and structural thenable type
  surfaces; and stale current-facing docs now use historical wording.
- Review 145 closed fresh Effect/runtime/docs/starter gaps: the Effect-first
  scanner catches parenthesized and extracted Promise choreography plus example
  Vite configs; runtime provision carries the active runtime through Effect v4
  fiber-local context for returned render Effects; Start render/fetch/node
  type-test pins now match their docs; and `pnpm starter:package` proves basic,
  React, and project-console starter payloads install outside the workspace.
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
- Review 90 extracted the DB Collection Index Materialization Module:
  secondary-index normalization, lookup-key encoding, duplicate-value dedupe,
  runtime/request-local bucket caches, index row reads, indexed join keys, and
  `UnknownCollectionIndex` now share one policy.
- Review 91 extracted the internal Start Diagnostics CLI Runner Module and
  moved `effect-ui-start` parsing onto Effect v4 `Command`, `Flag`, and
  `Argument` primitives. Diagnostics loading, agent graph/impact projection,
  JSON/text formatting, write effects, and failure reporting now live behind
  the parsed CLI command runner while `cli.ts` remains the argv/bin adapter.
- Review 92 extracted the internal Start Action Response Application Module:
  accepted action response invalidation validation, Resource Tag/Ref
  resolution, hydration payload application, hydrated-ref filtering, and
  malformed metadata transport errors now live behind one Start Module while
  the transport protocol stays focused on wire contracts.
- Review 93 extracted the internal DB Collection Change Feed Runtime Module:
  scoped feed subscription lifecycle, dispatcher consumer fibers, adapter
  subscribe/unsubscribe normalization, direct `emit(...)` completion,
  host-callback `emitChanges(...)` queueing, late-emission dropping, and
  asynchronous failure publication now live behind one Effect-first Module
  while Collection Runtime keeps store-local row mutation and persistence
  policy.
- Review 94 added the Core Browser Router Host Controller facade:
  React and Solid routers now share idempotent start/dispose, initial
  navigation, external history listener wiring, programmatic commit forwarding,
  typed route navigation helpers, and preload disposal while each framework
  keeps its own reactivity and owner cleanup.
- Review 95 extracted the internal Core Action Execution Workflow Module:
  live `Action.use(...)` callback normalization, retry, optimistic
  commit/rollback, stale-submission interruption, invalidation planning and
  execution, submission joining, and visible state updates now live behind one
  workflow while the public facade keeps runtime binding and type-level
  requirement subtraction.
- Review 96 extracted the public Devtools Contract Module: public snapshots,
  invalidation and route plans, request traces, runtime events, Store
  Interfaces, Start app graph diagnostics, summaries, causal graphs, panel
  DTOs, panel UI options, and panel boot contracts now live in
  `devtools-contract.ts`, while the Devtools root stays the behavior facade and
  public re-export point.
- Review 97 moved pure Devtools public type assertions into the focused
  `type-tests/devtools.test-d.ts` owner. The broad framework type test now keeps
  only Devtools compatibility checks that cross Core, DB, or Start boundaries,
  which makes LSP-facing Devtools docs harder to regress by accident.
- Review 98 tightened the Core Resource Store diagnostics test boundary: setup,
  Resource preload, diagnostics reads, assertions, and runtime disposal now run
  through one Effect program with `Effect.ensuring(...)`, leaving only the
  Vitest host runner as a Promise seam.
- Review 99 closed the Devtools serialization policy contract back-edge:
  `DevtoolsSerializationPolicy` now lives with the public Devtools contract,
  while `serialization.ts` re-exports it for compatibility and depends on the
  contract instead of the other way around.
- Review 100 wired the default Start global fetch adapter into Effect v4
  interruption: the `AbortSignal` from `Effect.tryPromise(...)` is merged with
  any request/init signal before calling `globalThis.fetch`, so interrupting
  browser RPC/action client fibers aborts the underlying fetch.
- Review 101 extracted Start transport body readers into an internal Effect v4
  Module: JSON request, action form, and response text reads now share typed
  body-failure mapping before transport protocol parsing continues.
- Review 102 made the Start diagnostics Vite server lifetime explicit with
  Effect acquire/use/release policy; the current loader uses
  `Effect.acquireUseRelease(...)`, so the Effect v4 CLI diagnostics runner, CI
  loader, and build gate all close temporary Vite servers through the same
  resource policy.
- Review 103 moved DB SQLite statement contract ownership back to
  `sqlite-persistence.ts`; the root `Collection.SQLiteStatement*` names now
  alias the storage Adapter contracts instead of redefining them.
- Review 104 moved `persistedCollectionOptions(...)` into the DB persistence
  module and documented `CollectionPersistedOptions` channel unioning for LSP
  hover, while preserving the public top-level and namespace helper names.
- Review 105 moved post-parse RPC/action HTTP status validation into the Start
  Client Transport module, leaving Start Transport Protocol focused on wire
  body parsing and response DTO validation.
- Review 106 made Core Resource UI Binding consume Resource Runtime functions
  directly instead of routing sibling implementation calls through the public
  `Resource` facade.
- Review 112 applied the same locality rule to Core Action Execution Workflow:
  action invalidation planning/execution now calls Resource Runtime directly
  while the public `Resource` facade remains the app-facing Interface.
- Review 113 extracted the Start Action Request Codec Module: JSON action
  request bodies, progressive form hidden fields, schema-backed input encoding,
  and server JSON/form decoding now live together while Start Transport Protocol
  keeps response/status/failure policy.
- Review 107 moved shared `effect-ui-start` diagnostics flags onto the root
  Effect v4 `Command.withSharedFlags(...)` grammar, so subcommands inherit
  parent flags instead of repeating them.
- Review 108 moved Start diagnostics CLI graph/impact query parsing into Effect
  v4 `Argument` parsers that report `CliError.InvalidValue` instead of
  throwing during command construction.
- Review 109 made `runStartDiagnosticsCliEffect(...)` execute the Effect v4
  command tree directly, including built-in `--help`, `--version`, and
  unknown-subcommand formatter handling.
- Review 110 made `parseStartDiagnosticsCliArgsEffect(...)` reuse that same
  Effect v4 command tree and interpret `CliError.ShowHelp` results instead of
  maintaining local argv sniffing for help and unknown commands.
- Review 114 explored graph/impact query-kind parsing; later sweeps settled the
  current shape on variadic Effect v4 `Argument` values under the graph/impact
  commands, with graph `--verbose` inherited through the graph command's shared
  flag context.
- Review 115 extracted the Start Vite Diagnostics Loader Module, so temporary
  Vite server acquire/release, diagnostics virtual-module loading, graph DTO
  decoding, and build-gate diagnostics execution live behind a focused
  Effect-first loader re-exported by `@effect-ui/start/vite`.
- Review 116 extracted the DB Collection Sync Load Policy Module, so
  `preloadEffect(...)` and `refetchEffect(...)` now share one Effect v4
  workflow for in-flight `Deferred` ownership/joining, forced-refetch generation
  freshness, restore-before-load, load/refetch selection, retry, row
  replacement, lifecycle events, and load persistence.
- Review 117 moved browser route outlet decisions into Core. React and Solid
  now consume `browserRouteRenderDecision(...)` and `browserRouteRenderKey(...)`
  while keeping component invocation, default fallback rendering, and `UiScope`
  lifetime local to their adapters.
- Review 118 narrowed Devtools Fact Identity. Store and Summary now consume the
  same first-match fact index helpers backed by the Devtools Serialization
  Policy fingerprint, and the unused imported-snapshot helper was removed from
  the internal Interface.
- Review 119 collapsed the internal Devtools runtime injection seams. Panels
  and Store now import their single concrete dependencies directly, while the
  public root stays a facade instead of assembling one-off runtime objects.
- Review 120 extracted the Start Action Response Codec Module. Action response
  DTOs, invalidation metadata, response metadata hydration, response-mode
  selection, Exit-to-Response encoding, client parsing, and typed result
  decoding now live in `start-action-response-codec.ts`; request and response
  codecs share Effect Schema helpers through `start-schema-codec.ts`.
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
- At that historical checkpoint, the broad sharp-cast grep reported no source
  hits after schema, EffectInput, Start preload/adapter, DB query variance, and
  core runtime service-erasure cleanup. The current broad grep is tracked as a
  named-seam inventory in `docs/sharp-cast-audit.md`.
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
- Start trace/finalizer helpers and Solid runtime provider/runtime-context
  surfaces now use opaque runtime/source types; the remaining exact
  `EffectUiRuntime<any, any>` source hits are core ambient runtime accessors
  that preserve caller error typing. React/Solid router and Start host seams
  still use named `EffectUiRuntime<any, ER>` adapter bounds where they infer or
  erase runtime services at framework boundaries.
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
- At that historical checkpoint, the broad sharp-cast grep was clean across
  package, example, script, and type-test source after replacing the last two
  test-only `as Effect.Effect` assertions. Later adapters and tests introduced
  named seams now tracked in `docs/sharp-cast-audit.md`.
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
  listener and timer helpers instead of raw `new Promise(...)`. Raw
  Promise-constructor/method grep over scripts intentionally reports
  `scripts/audit-effect-first.mjs` fixture strings; `pnpm audit:effect-first`
  is the source guardrail for distinguishing those fixtures from implementation
  Promise choreography.
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
  with host Promise conversion fixtures sequenced through
  `Effect.promise(...)`.
- The latest `pnpm verify` passed after the core ActionResult async test
  cleanup.
- Core route/server tests now return Effect programs instead of async wrappers
  or Promise matcher assertions, while keeping route/server/platform Response
  Promise fixtures under test behind `Effect.promise(...)`.
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
  collection host/storage Promise fixtures under test through
  `Effect.promise(...)`.
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
- The latest full `pnpm verify` passed after Review 240 Effect-First Cleanup,
  Suspense, And Public API Pins: best-effort cleanup, Start CLI/response
  lifetime tooling, command-runner/starter scripts, framework Suspense and
  Solid Resource preload seams, DB sync/materialization locality, and dotted
  namespace public API ownership now match the Effect-first ownership model.
  Clean Sweep 1 after Review190 remains historical 1/30 evidence, but later
  sweeps found Review191, Review192, Review193, Review194, Review195, and
  Review196, Review197, Review198, Review199, Review200, Review201, Review202, Review203, Review204, Review205, Review206, Review207, Review208, Review209, Review210, Review211, Review212, and Review213 work.
  Clean Sweep 1 after Review208 remains historical 1/30 evidence, but Clean
  Sweep 2 found Review209 work and the local post-Review209 pass found
  Review210 Core, DB, scripts, docs, React/Solid DB, and Start evidence work;
  the first post-Review210 sweep found Review211 work, the first
  post-Review211 sweep found Review212 work, the first post-Review212 sweep
  found Review213 work, the first post-Review213 sweep found Review214 work,
  the first post-Review214 sweep found Review215 work, the first
  post-Review215 sweep found Review216 work, the first post-Review216 sweep
  found Review217 work, the first post-Review217 sweep found Review218 work,
  the first post-Review218 sweep found Review219 work, and the fresh
  post-Review219 sweep found Review220 work, the fresh post-Review220 sweep
  found Review221 work, the fresh post-Review221 sweep found Review222 work,
  and the post-Review222 local sweep found Review223 work, and the
  post-Review223 sweep found Review224 work, the post-Review224 sweep found
  Review225 work, the post-Review225 sweep found Review226 work, the
  post-Review226 sweep found Review227 work, the post-Review227 sweep found
  Review228 work, the post-Review228 sweep found Review229 work, and the
  post-Review229 sweep found Review230 work, the post-Review230 sweep found
  Review231 work, and the post-Review231 DB pass found Review232 Shared DB
  Query Stage Plan work, and the fresh post-Review232 sweep found Review233
  Stage Plan And UI Cleanup Effects work, and the fresh post-Review233 sweep
  found Review234 cleanup Effect and public-surface work, and the fresh
  post-Review234 Solid route-render follow-up found Review235 cleanup
  sequencing work, and the fresh post-Review235 framework sweep found
  Review236 failed-render cleanup work, and the fresh post-Review236 framework
  follow-up found Review237 initial failed-render cleanup work, and the fresh
  post-Review237 sweep found Review238 tooling, Resource UI cleanup, and LSP
  hover work, and the fresh post-Review238 sweep found Review239 main-runner,
  UI lifetime, framework cleanup, and public hover work, and the fresh
  post-Review239 sweep found Review240 cleanup, framework, Start tooling, DB,
  and public API ownership work, and the fresh post-Review240 sweep found
  Review241 current-evidence docs drift work, and the fresh post-Review241
  framework follow-up found Review242 Solid route update Suspense outcome work,
  and the fresh post-Review242 sweep found Review243 Browser Router Kernel and
  DB public Interface work, and the fresh post-Review243 sweep found Review244
  Effect cleanup ownership, DB pins, Devtools typed failure, and
  current-evidence policy work, the fresh post-Review244 sweep found
  Review245 public API symbol reachability and router Adapter parity work, and
  the fresh post-Review245 sweep found Review246 Effect cleanup capture and
  Vite middleware lifecycle work, so
  the active counter is 0/30.
  Verification covered 11 package builds, workspace
  typecheck, public type tests, public API inventory audit,
  Effect-first audit over 415 physical/virtual files, 53 root test files / 1170
  tests, package-level verifies for the devtools/starter/example packages,
  generated starter-suite packaging/verifies for basic/react/project-console at
  20/25/31 app files,
  16-target package dry-run gate, project-console typecheck, 4 project-console
  test files / 27 tests, build, and leak scans.
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
- Generated starter payloads currently include local `.effect-ui-packages/*`
  file dependencies because packages remain private; final public npm
  repository/license decisions are still tracked separately from starter
  generation.
- Cloudflare, Vercel, Netlify, Bun, and static deployment currently use recipes
  over Node/fetch facades rather than dedicated packages.
