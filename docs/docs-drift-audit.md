# Docs Drift Audit

Last updated: 2026-05-15.

This audit checks release-tracking docs for claims that no longer match the
implementation after the request trace, Effect-first, typed-error, package
hygiene, generated-artifact, public-API, example cleanup, starter packaging,
devtools extension, inspected-window bridge, release metadata, Start lifecycle,
runtime wildcard, route wildcard, `UiScope`, type-test async, DB query wildcard,
core runtime/signal wildcard, sharp test assertion, fire-and-forget cleanup,
hydration/query/optimistic rebase, atomicity/host-boundary/Solid locality,
runtime-ownership/transport/devtools import-safety, Review 57 atomic
rollback/bounded-import/transport-validation, Review 58 hydration wall,
runtime ownership, Devtools identity, and LSP coverage, Review 59
registry-local dispatch/structured identity/LSP drift, Review 60 stream
lifetimes/store-local reactivity/identity depth, Review 61 registry
requirements/invalidation typing/bounded serialization, Review 62 request
locality/snapshot preflight/LSP runtime type, Review 63 Effect snapshot
    error/atomic hydration/request fact, Review 64 store-owned load/manifest
    wall/hydration preflight/runtime fact, Review 65 runtime-clock/endpoint
    policy/snapshot canonicalization/bounded panel, Review 66 Resource
    key/action codec/row ingress/app graph depth, Review 67 snapshot
    encoding/client transport/materialization/devtools scale, Review 68
    preload resolution/runtime coordination/graph-depth, Review 69
    adapter boundary/typed runtime error/public seam, Review 70 route
    render scope/hydration laziness/reactive source/audit-depth, Review 71
    router-kernel/static-graph/public-store/reactive-lifetime, Review 72
    adapter lifetime/mutation finalization/manifest, Review 73 runtime
    locality/shared adapter policy, Review 74 read decision/hydration plan,
    Review 75 history adapter/runtime scope/transport envelope, Review 76
    runtime collection store, Review 77 collection write commit, Review 78
    live query collection materialization, and Review 79 collection query
    source adapter, Review 80 request runtime lifecycle, Review 81 resource UI
    binding controller, Review 82 start host runtime runner, Review 83 start
    node web exchange, Review 84 query execution plan, Review 85 solid route
    render scope controller, Review 86 public API type-test manifest, Review 87
    react route render scope controller, Review 88 public API source surface
    coverage gate, Review 89 collection value detachment, Review 90 collection
    index materialization, Review 91 start diagnostics CLI runner, Review
    92 start action response application, Review 93 collection change feed
    runtime, Review 94 browser router host controller, Review 95 core action
    execution workflow, Review 96 devtools public contract, Review 97 devtools
    public type-test ownership, Review 98 core resource-store test effect
    boundary, Review 99 devtools serialization policy contract edge, Review
    100 start default fetch abort signal, Review 101 start transport body
    reader, Review 102 start diagnostics vite server lifetime, and Review 103
    db sqlite statement contract ownership, Review 104 db persisted options
    ownership, Review 105 start client transport status policy, and Review 106
    core resource UI binding runtime locality sweeps.

## Current Sweep Results

- Updated request-trace docs that still described richer teardown facts as a
  future gap.
- Updated devtools panel docs after request items started carrying full
  teardown snapshots plus per-server-function/action failure owners.
- Updated Start hydration docs/error audit after root payload and streamed
  chunk parse failures became typed hydration errors.
- Updated virtual app graph docs to clarify that readonly
  `diagnosticsPolicyViolations` is available only after the diagnostics policy
  guard succeeds.
- Updated the release-candidate slice list so it no longer asks for removed
  Promise `.then(...)` internals or already-shipped teardown facts.
- Updated the cleanup backlog so the generated artifact determinism audit points
  at the completed audit artifact instead of remaining unchecked.
- Updated final handoff evidence to point at the latest full `pnpm verify`
  result after API, core, and example cleanup.
- Updated current-facing release, architecture, public API, and progress docs
  after extracting the DB Runtime Collection Store Module and rerunning full
  verification.
- Updated release-candidate tracking after richer starter packaging, checked
  devtools extension packaging, CLI Effect-runner hardening, tagged CLI usage
  errors, and Start stream/Vite diagnostics lifecycle Effect sweeps.
- Updated devtools docs, release notes, public API inventory, and extension
  README after adding the inspected-window bridge and the public
  `installDevtoolsBridgeEffect(...)` app-side helper.
- Updated package hygiene, public API inventory, release notes, and the progress
  ledger after adding private `UNLICENSED` metadata across workspace manifests.
- Updated sharp-edge audits after removing remaining `as any`, raw throw
  sentinels, and low-friction Promise-method test helpers.
- Updated release and verification tracking after tightening runtime helper
  wildcards, replacing ignored conditional-helper `any` placeholders, moving
  arbitrary route constraints to `unknown`, creating `UiScope` through
  `Scope.make(...)`, and replacing type-test `async` negative cases with
  declared Promise values.
- Updated current-status summaries after naming arbitrary Action/Server/Resource,
  DB query, runtime, signal, and collection wildcard boundaries.
- Updated sharp-cast and Effect-first summaries after removing the final
  test-only `as Effect.Effect` assertions and moving package/example
  fire-and-forget effects from floating Promises to detached fibers.
- Updated the progress ledger current-status summary so the clean-sweep gate is
  still open for the right reason: recent sweeps found actionable work beyond
  the earlier benchmark baseline and bridge/metadata slices.
- Updated the then-current verification gate evidence from stale 38/320, 40/328,
  43/365, 45/502, 45/511, 45/532, 45/554, and immediately prior package-test
  counts to the Review 56 45/571 gate.
- Updated the current-facing verification snapshots after the runtime
  ownership, transport semantics, and devtools import-safety sweep so the
  Review 56 gate points at 45 root test files / 571 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 56 and progress entry 289 evidence for the DB, Solid, Core,
  Start, Devtools, and devtools-extension fixes from the fresh subagent sweep.
- Added Review 57 and progress entry 290 evidence for the DB atomic rollback,
  Devtools bounded import, Start transport validation, Core/Solid cleanup, and
  route/docs drift fixes from the fresh subagent sweep.
- Updated the current verification gate after Review 57 full verification so
  that checkpoint pointed at 45 root test files / 585 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 58 and progress entry 291 evidence for the Start hydration and
  manifest walls, Core/Solid runtime ownership and typed route matching, DB
  contract validation, Devtools identity/import/panel fixes, and TSRX/Start
  public API docs coverage from the fresh subagent sweep.
- Updated the current verification gate after Review 58 full verification so
  that checkpoint pointed at 45 root test files / 603 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 59 and progress entry 292 evidence for registry-local Start
  dispatch, structured DB live-query identity, Devtools bridge failure
  semantics, Start manifest/file-route validation, and LSP docs/type-test drift
  fixes from the fresh subagent sweep.
- Updated the verification gate after Review 59 full verification so that
  checkpoint pointed at 45 root test files / 618 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 60 and progress entry 293 evidence for Start stream
  lifetime/preload locality, DB live-query store locality, Core/Devtools
  identity depth, and Start diagnostics type-test coverage from the fresh
  subagent sweep.
- Updated the current verification gate after Review 60 full verification so
  that checkpoint pointed at 45 root test files / 632 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 61 and progress entry 294 evidence for Start registry
  requirement preservation, Core/Solid action invalidation typing, DB
  live-query snapshot locality, Devtools bounded serialization, and LSP
  docs/type-test coverage from the fresh subagent sweep.
- Updated the current verification gate after Review 61 full verification so
  that checkpoint pointed at the 45-file / 643-test root gate plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 62 and progress entry 295 evidence for request-local Start
  server clients, Core/Solid ActionResult/router/runtime typing, DB hydration
  preflight and getKey errors, Devtools framed/bounded identity, and LSP docs
  coverage from the fresh subagent sweep.
- Updated the current verification gate after Review 62 full verification so
  that checkpoint pointed at 45 root test files / 655 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 63 and progress entry 296 evidence for typed Resource snapshot
  error propagation, serviceful RouterProvider runtime requirements, Start
  request facts, DB atomic hydration preflight, Devtools bounded structural
  identity, and LSP type-test coverage from the fresh subagent sweep.
- Updated the current verification gate after Review 63 full verification so
  that checkpoint pointed at 45 root test files / 665 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 64 and progress entry 297 evidence for store-owned Resource
  loads, Start stream serialization and manifest path walls, DB hydration
  preflight/dehydrate validation, Devtools runtime-only causal facts, panel row
  identity, and LSP type-test/docs drift from the fresh subagent sweep.
- Updated the current verification gate after Review 64 full verification so
  that checkpoint pointed at 45 root test files / 690 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 65 and progress entry 298 evidence for runtime-clock Resource
  reads, Solid route cleanup context, Start endpoint policy and stream phase
  diagnostics, DB snapshot canonicalization/dehydrate validation, Devtools
  resource panel fact projection, dead node-kind removal, and bridge string
  bounds from the fresh subagent sweep.
- Updated the current verification gate after Review 65 full verification so
  that checkpoint pointed at 45 root test files / 707 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 66 and progress entry 299 evidence for Resource key identity,
  non-mutating sync reads, signal evaluation rollback, Solid route membership,
  Start action request encoding, render hydration planning, DB row ingress,
  transaction fact isolation, live-query preload validation, Devtools app graph
  structured copying, retained fact indexes, and explicit `DevtoolsStore`
  typing from the fresh subagent sweep.
- Updated the current verification gate after Review 66 full verification so
  that checkpoint pointed at 45 root test files / 730 tests plus the checked
  extension, starter, project-console, and leak-scan gates.
- Added Review 67 and progress entry 300 evidence for Resource snapshot
  encoding, Effect-first Resource reads, invalidation DTO detachment, structured
  stable identity, Start diagnostics validation, request-handler error
  normalization, shared Start client transport, DB live-query collection
  materialization, Solid DB mutation handles, scoped change-feed dispatch,
  Devtools serialization-backed fact identity, Start/Devtools app graph type
  pins, and large panel windowing from the fresh subagent sweep.
- Updated the current verification gate after Review 67 full verification so
  the then-current gate pointed at 45 root test files / 745 tests plus the
  checked extension, starter, project-console, and leak-scan gates.
- Added Review 68 and progress entry 302 evidence for Resource read collection,
  ActionResult metadata detachment, Solid preload matching, Start collection
  resolution and named file-route declarations, DB active mutation/load
  coordination, live-query row ingress, Devtools graph/request/rendering depth,
  and the React Suspense host seam.
- Updated the then-current verification gate after Review 68 full verification
  so that checkpoint pointed at 10 package builds, 47 root test files / 765
  tests, checked devtools, starter, project-console, and leak-scan gates, plus
  the Effect-first audit's React Suspense host seam.
- Added Review 69 and progress entry 306 evidence for React ordered preload
  matching, Program runtime error typing, Resource Store public seams, Start
  streamed hydration root scripts, app graph route preservation, Vite dev SSR
  trace locality, DB live-query collection read-only and persistence events,
  Devtools inspected-window timeout/invalid-payload diagnostics, and the React
  starter root-runner gate.
- Updated the current verification gate after Review 69 full verification so
  the then-current gate points at 11 package builds, 50 root test files / 791 tests,
  checked devtools, basic starter, React starter, project-console, and leak-scan
  gates.
- Updated the current verification gate after Review 70 full verification so
  the then-current gate points at 11 package builds, 50 root test files / 804 tests,
  checked devtools-panel with 2 tests, devtools-extension with 19 tests, basic
  starter, React starter, project-console, and leak-scan gates.
- Added Review 71 and progress entry 308 evidence for the Core browser-router
  kernel, React `useAction(...)` lifetime, keyed Resource preload failures,
  public `ResourceStore` seams, static Start app graph plus explicit runtime
  diagnostics, React DB/Solid DB source identity, query-sync rollback naming,
  Devtools entrypoint cleanup, and deeper Promise return-type audit coverage.
- Updated the current verification gate after Review 71 full verification so
  the latest gate points at 11 package builds, Effect-first audit over 186
  files, 51 root test files / 816 tests, checked devtools-panel with 2 tests,
  devtools-extension with 19 tests, basic starter with 2 tests, React starter
  with 3 tests, project-console, and leak-scan gates.
- Added Review 72 and progress entry 309 evidence for React/Solid adapter
  runtime-bound lifetimes, React Program restart ownership, DB mutation
  finalization, Live Query Collection last-good projection retention,
  generation-keyed DB preload failures, direct change-feed dispatcher policy,
  Start request trace diagnostics, starter route discovery checks, manifest
  export-name boundaries, devtools extension polling locality, app-graph
  normalizer docs, and executable async/non-Effect catch audit coverage.
- Updated the current verification gate after Review 72 full verification so
  the latest gate points at 11 package builds, Effect-first audit over 186
  files, 51 root test files / 834 tests, checked devtools-panel with 2 tests,
  devtools-extension with 20 tests, basic starter with 2 tests, React starter
  with 3 tests, project-console, and leak-scan gates.
- Added Review 73 and progress entry 310 evidence for runtime-owned
  late-finalizer cleanup, shared RouterLink preload policy, React runtime-source
  ownership, Collection Store diagnostics, DB-owned reactive binding helpers,
  cached Live Query Collection indexes, typed Start fetch/file-route Promise
  rejection, shared devtools panel boot, and deeper Promise/await scanner
  coverage.
- Updated the current verification gate after Review 73 full verification so
  the latest gate points at 11 package builds, Effect-first audit over 187
  files, 51 root test files / 843 tests, checked devtools-panel with 2 tests,
  devtools-extension with 20 tests, basic starter with 2 tests, React starter
  with 3 tests, project-console, and leak-scan gates.
- Added Review 74 and progress entry 311 evidence for Core Resource read
  decisions, Collection Hydration Plan reuse, React DB/Solid DB live-query
  selection sharing, Request Runtime finalization events, Start streamed HTML
  response helper usage in starters, Devtools app-graph detachment locality, and
  Panel Contract overflow identity.
- Updated the current verification gate after Review 74 full verification. The
  latest gate still points at 11 package builds, Effect-first audit over 187
  files, 51 root test files / 843 tests, checked devtools-panel with 2 tests,
  devtools-extension with 20 tests, basic starter with 2 tests, React starter
  with 3 tests, project-console, and leak-scan gates.
- Added Review 75 and progress entry 312 evidence for Browser History Adapter
  locality, runtime-bound UI scope creation, Start Transport Endpoint Envelope
  request-id alignment, public API inventory auditing, and LSP-facing Runtime
  Spine / Erased Runtime Runner / Resource Store / host seam vocabulary.
- Updated the current verification gate after Review 75 full verification. That
  gate pointed at 11 package builds, public API inventory audit,
  Effect-first audit over 188 files, 51 root test files / 847 tests, checked
  devtools-panel with 2 tests, devtools-extension with 20 tests, basic starter
  with 2 tests, React starter with 3 tests, project-console, and leak-scan
  gates.
- Added Review 76 and progress entry 313 evidence for the Runtime Collection
  Store Module extraction, and updated current-facing verification snapshots to
  the 189-file Effect-first audit gate.
- Added Review 77 and progress entry 314 evidence for the Collection Write
  Commit Module extraction.
- Updated current-facing verification snapshots after Review 77 full
  verification so the then-current gate pointed at the 190-file Effect-first
  audit.
- Added Review 78 and progress entry 315 evidence for the Live Query Collection
  Materialization Module extraction.
- Updated current-facing verification snapshots after Review 78 full
  verification so the then-current gate pointed at the 191-file Effect-first
  audit.
- Added Review 79 and progress entry 316 evidence for the Collection Query
  Source Adapter extraction.
- Updated current-facing verification snapshots after Review 79 full
  verification so the then-current gate pointed at the 193-file Effect-first
  audit.
- Added Review 80 and progress entry 318 evidence for the Request Runtime
  Lifecycle Module extraction.
- Updated current-facing verification snapshots after Review 80 full
  verification so the then-current gate pointed at the 194-file Effect-first
  audit.
- Added Review 81 and progress entry 319 evidence for the Resource UI Binding
  Controller extraction.
- Added Review 82 and progress entry 321 evidence for the Start Host Runtime
  Runner extraction. Public host adapter docs now point at the internal runner
  for the final Promise/fork host seams while keeping adapter APIs unchanged.
- Added Review 83 and progress entry 322 evidence for the Start Node Web
  Exchange extraction. Public host adapter docs now keep Node exports stable
  while naming the internal Module that production Node and Vite dev SSR share.
- Added Review 84 and progress entry 323 evidence for the Query Execution Plan
  extraction. DB docs now name the internal Module that one-shot query,
  diagnostics, live-query state, and live-query runtime share.
- Added Review 85 and progress entry 324 evidence for the Solid Route Render
  Scope Controller extraction. Solid docs now name the internal Module that
  `RouterOutlet` uses for route `UiScope`, Solid root cleanup, transition
  disposal ordering, and stale queued-render suppression.
- Added Review 86 and progress entry 325 evidence for the Public API
  Type-Test Manifest. Public API docs now name
  `type-tests/public-api.manifest.json` as the owner of import-path type-test
  coverage.
- Added Review 87 and progress entry 326 evidence for the React Route Render
  Scope Controller extraction. React public API docs now name the internal
  Module that owns route `UiScope`, keyed route frame remounting, runtime
  provider re-entry, and route finalizer policy.
- Added Review 88 and progress entry 327 evidence for the Public API Source
  Surface Coverage Gate. Public API docs now name root-local source modules for
  every package barrel that exports them.
- Added Review 89 and progress entry 328 evidence for the Collection Value
  Detachment Module. DB docs now name the internal Module that owns collection
  value cloning, frozen copies, update-draft detachment, and row DTO detachment.
- Added Review 90 and progress entry 329 evidence for the Collection Index
  Materialization Module. DB docs now name the Module that owns secondary index
  normalization, lookup keys, bucket caches, indexed row reads, and indexed join
  keys.
- Added Review 91 and progress entry 330 evidence for the Start Diagnostics
  CLI Runner Module. Start public API docs now name the Effect v4 command
  grammar around `effect-ui-start` and the internal runner behind parsed
  command execution.
- Added Review 92 and progress entry 331 evidence for the Start Action Response
  Application Module. Start public API docs now name the internal Module that
  owns accepted action response invalidation/hydration application behind the
  transport protocol.
- Added Review 93 and progress entry 332 evidence for the Collection Change
  Feed Runtime Module. DB docs now name the internal Module that owns scoped
  feed subscription lifecycle, dispatcher fibers, adapter unsubscribe
  normalization, direct `emit(...)` completion, host `emitChanges(...)`
  queueing, and asynchronous failure publication.
- Added Review 94 and progress entry 333 evidence for the Browser Router Host
  Controller facade. Core public API docs now name the controller that owns
  idempotent start/dispose, history listener wiring, programmatic commits, and
  route preload disposal for React and Solid router adapters.
- Added Review 95 and progress entry 334 evidence for the Core Action
  Execution Workflow Module. Core public API docs now name the internal Module
  that owns live action callback normalization, optimistic commit/rollback,
  stale interruption, invalidation planning/execution, and visible submission
  state updates.
- Added Review 96 and progress entry 335 evidence for the Devtools Public
  Contract Module. Devtools public API docs now name `devtools-contract` as the
  DTO/Interface source behind public snapshots, traces, summaries, causal
  graphs, panels, store contracts, and boot contracts.
- Added Review 97 and progress entry 336 evidence for Devtools public type-test
  ownership. The public API inventory now records that pure Devtools assertions
  belong in `type-tests/devtools.test-d.ts` while the framework type test keeps
  only Core/DB/Start compatibility checks.
- Added Review 98 and progress entry 337 evidence for the Core Resource Store
  test Effect boundary cleanup. Current docs now record the diagnostics test
  moving host `async`/`finally` cleanup into `Effect.gen(...)` plus
  `Effect.ensuring(...)`.
- Added Review 99 and progress entry 338 evidence for the Devtools serialization
  policy contract edge cleanup. Public API docs now record that
  `DevtoolsSerializationPolicy` belongs to `devtools-contract.ts` and is only
  re-exported from `serialization.ts` for compatibility.
- Added Review 100 and progress entry 339 evidence for the Start default fetch
  abort signal cleanup. Current docs now record that the default global fetch
  adapter receives Effect v4's `tryPromise` AbortSignal and merges it with
  request/init signals.
- Added Review 101 and progress entry 340 evidence for the Start transport body
  reader cleanup. Current docs now record that JSON request, action form, and
  response text reads live behind a shared Effect v4 body-reader Module.
- Added Review 102 and progress entry 341 evidence for the Start diagnostics
  Vite server lifetime cleanup. Current docs now record that the Effect v4 CLI
  diagnostics path acquires temporary Vite servers through scoped
  `Effect.acquireRelease(...)`.
- Added Review 103 and progress entry 342 evidence for the DB SQLite statement
  contract ownership cleanup. Current docs now record that the SQLite
  persistence module owns statement contracts while the DB root aliases them.
- Added Review 104 and progress entry 343 evidence for the DB persisted options
  ownership cleanup. Current docs now record that persistence option
  normalization lives with `collection-persistence.ts` while public facade names
  stay stable.
- Added Review 105 and progress entry 344 evidence for the Start client
  transport status policy cleanup. Current docs now record that post-parse
  RPC/action HTTP status validation belongs to Start Client Transport.
- Added Review 106 and progress entry 345 evidence for the Core Resource UI
  Binding runtime locality cleanup. Current docs now record that the controller
  consumes Resource Runtime functions directly instead of calling back through
  the public `Resource` facade for sibling implementation work.
- Updated current-facing verification snapshots after Review 106 full
  verification so the latest gate points at the 225-file Effect-first audit and
  52 root test files / 859 tests.
- Updated DB host examples so Promise-shaped remote and SQLite clients are
  wrapped with `Effect.tryPromise(...)` at the Adapter seam.
- Clarified that `virtual:effect-ui/routes` exposes runtime helpers while the
  precise route id/params/search/href type maps live in the generated
  `src/routeTree.gen.ts` module.
- Left older checkpoint counts in place only where they explicitly describe
  historical evidence from that checkpoint; current verification counts are
  recorded in the verification gate and progress ledger.

## Verification Evidence

- Drift search:
  - `rg -n "not committed yet|not committed|future inspected|sample-data shell|browser extension.*future|live inspected app transport|remaining|Remaining|still open|future work|TODO|FIXME|Promise-first|315 tests|316 tests|319 tests" docs README.md examples -g '*.md'`
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(|non-Effect|raw Error|TypeError|runtime-disposed marker|stream close paths|response stream-close|UNLICENSED|__EFFECT_UI_DEVTOOLS__" docs README.md examples -g '*.md'`
- Updated files:
  - `README.md`
  - `docs/ultimate-goal-checklist.md`
  - `docs/perfection-progress.md`
  - `docs/framework-perfection-charter.md`
  - `docs/public-api-inventory.md`
  - `docs/devtools.md`
  - `docs/effect-first-audit.md`
  - `docs/error-message-audit.md`
  - `docs/package-hygiene-audit.md`
  - `docs/release-notes.md`
  - `docs/sharp-cast-audit.md`
  - `examples/devtools-extension/README.md`

## Follow-Up

- Re-run this audit before any release-candidate handoff.
- Add a docs-specific check script if drift patterns stabilize into repeatable
  grep rules.
