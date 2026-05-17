# Type-Test Coverage Audit

Last updated: 2026-05-17.

This audit checks compile-time coverage for the public framework contracts that
are easiest to regress while refactoring internals toward Effect primitives.

## Current Sweep Results

- Review509 Route Component Attachment Hover Docs adds no new type-test pins:
  the Review508 public type tests already cover typed-error lazy descriptors
  through `Route.ComponentInput<R, E>` and `Route.withComponent(...)`; Review509
  closes the matching LSP hover docs gap.
- Clean Sweep 1 after Review508 found no actionable public type-test follow-up:
  the current lazy route, DB-family, Start trace, and package-root pins still
  cover the public Interfaces exposed to callers and LSP.
- Review508 Lazy Component WithComponent Error Generic pins
  `Route.withComponent(...)` accepting a typed-error lazy route component
  descriptor through `Route.ComponentInput<R, E>`.
- Review507 Lazy Component Namespace Error Generic pins
  `Route.LazyComponent<Component, E>` so namespace users keep importer error
  channels on lazy route components.
- Review506 Lazy Route Suspense Error Pins adds compile-time coverage for
  `Route.LazyComponentPending`, `Route.lazyComponentPendingEffect(...)`, and
  `Route.forkLazyComponentSuspense(...)` preserving typed lazy load failures.
- Review505 Lazy Route And DB Type Pins adds compile-time coverage for Core lazy
  route component typed preload failures, DB preload controller Promise observer
  rejection, and React DB/Solid DB live query handle member shapes.
- Clean Sweep 1 after Review504 found no actionable public type-test follow-up:
  the current pins for Resource preload observers, live query handles, Start
  request traces, and package-root manifests still describe the public
  Interfaces that callers see through LSP and compile-time checks.
- Review504 Resource Preload Observer Promise Pins adds negative public
  type-test coverage for Core `ResourceUiAutoPreloadOptions`, React
  `UseResourceOptions`, and Solid `UseResourceOptions`, proving preload failure
  observers cannot return Promise-shaped work.
- `type-tests/framework.test-d.ts` exercises every public package root used by
  the example path: core routes/resources/actions/forms/capabilities, Start
  request handling and hydration, DB collections and live queries, Solid DB
  hooks, generated file-route types, and devtools invalidation plans.
- Promise-returning callbacks are rejected at the type boundary for routes,
  resources, collections, actions, forms, server implementations, Start render
  callbacks, and `onRequestTrace`. Direct Promise-shaped `EffectInput` values
  are also rejected for `toEffect(...)` and ActionResult conversion helpers.
- Promise-returning negative cases use declared Promise values instead of
  `async` callback syntax, so compile-time coverage stays focused on the public
  boundary rather than embedding Promise-shaped framework callbacks.
- Generated route unions are covered for route ids, route paths, canonical
  params, branded params, href options, and search literal rejection.
- Solid router, resource, and action hooks now have public type pins for typed
  href/navigation/preload, route-specific outlet match renderers, resource
  handles, tagged router errors, and action input/output preservation.
- Core route preload type tests pin that service-backed preload requirements
  flow through `Route.preloadEffect(...)`, `Route.planPreloadEffect(...)`, and
  `Route.planNavigationEffect(...)`, and that resource snapshot serialization
  failures remain visible as `ResourceSnapshotCodecError` on planning Effects.
- Core Resource key and read-boundary type tests pin `ResourceKeyError` as the
  default-key codec failure and allow the generic `read(...)` helper to accept
  serviceful Resource refs. Review 67 adds `Resource.readEffect(...)` and
  schema-backed snapshot error pins so Effect workflows keep read failures and
  dehydrate failures in typed error channels, and Review 68 keeps the
  `Resource.readEffect(...)` public type pinned while runtime tests prove it
  participates in Resource touch collection.
- Core Resource type tests now pin `Resource.collectEffect(...)` and
  `Resource.Collected<A>` as the public preload/read collection seam, with
  negative assertions that the internal `ResourceCollector` service and flat
  `ResourceCollected` alias are not root exports.
- Core Resource Store type tests pin that the public `ResourceStore` Interface
  can be consumed for diagnostics but not structurally implemented as a fake
  root-exported store, and that mutable store constructors/unsafe accessors stay
  out of the root export. Resource read-boundary type tests also pin
  `ResourcePending.hasPrevious` and `ResourceFailure.hasPrevious` so LSP hovers
  distinguish a successful `undefined` previous value from no previous value.
- Core action/resource UI type tests now pin `withResourceStore(...)` as the
  expert-public request-runtime seam, `ActionSubmissionState.hasPrevious` for
  successful `undefined` previous values, and `ResourceUiMatch` pending/failure
  metadata for renderer adapters.
- Review207 added direct Core Action root pins for `ActionPolicy`,
  `ActionDefinition`, `ActionOptions`, `ActionInstance`, `ActionUseOptions`,
  `ActionTypeId`, `ActionState`, `ActionConcurrency`, and
  `isActionDefinition(...)`, so adapters cannot accidentally rely only on the
  `Action` namespace import.
- Review208 added React and Solid `RuntimeProvider` observer pins proving
  provider-owned disposal observers may return typed failing Effects,
  Promise-shaped observers are rejected, and host-owned runtime props cannot
  install disposal observers.
- Review209 added explicit broad-`unknown` Promise rejection pins for direct
  `toEffect(...)`, `invokeEffectInput(...)`, Resource loaders, Action runs,
  Program updates, and Program subscriptions, so callers cannot hide
  Promise-shaped callback returns behind `unknown` success annotations.
- Review210 added returned-Effect Promise rejection pins for
  `toEffect(...)`, `ActionResult`, Resource loaders, Program updates,
  Program subscriptions, and Action runs, plus callable-`then` negative
  fixtures and React/Solid DB option imports with Promise-returning observer
  rejection pins.
- Review211 added `Program.next(...)` Promise-shaped model rejection pins and
  optimistic action signal patch pins for direct values and updater returns
  hidden behind `Signal<unknown>`.
- Review212 added ActionResult success/failure Promise payload rejection pins
  and Program command, dispatch, subscription, and Promise-shaped message type
  rejection pins.
- Review213 added Promise-safe broad-value pins for `toEffect<any>(...)`,
  Program initial models and story resets, ActionResult success and validation
  values, ActionResult failure errors from Effects, and React/Solid
  ProgramHandle dispatch/dispatchEffect messages.
- Review218 added Core Runtime Provider Lifecycle export pins and a
  project-console typecheck-only runtime probe proving app runtimes must
  provide `ProjectApi`; SQLite persistence type pins now include
  `SQLitePersistenceInvalidRow` in direct storage error channels.
- Review219 added the typed Runtime Provider lifecycle disposal export pin and
  moved the then-current full verification evidence to the Review219 gate.
- Review220 added the Router Link Preloader negative export pin for the removed
  target-only compatibility method and moved the current full verification
  evidence to the Review220 gate.
- Review221 added Resource hydration payload-only negative pins for raw snapshot
  arrays and moved the current full verification evidence to the Review221
  gate.
- Review222 added direct top-level `ResourceHydrationPayload`/
  `ResourceHydrationInput` pins plus sync `Resource.hydrate(...)` raw-array
  negative coverage and moved the current full verification evidence to the
  Review222 gate.
- Review223 added public manifest ownership for the top-level
  `ResourceHydrationPayload`/`ResourceHydrationInput` type-test imports and
  recorded that checkpoint's full verification evidence at the Review223 gate.
- Review224 kept public type tests green and moved the current full verification
  evidence to the Review224 gate after DB query factory-result runtime
  coverage.
- Review225 added DB namespace pins for `Collection.QuerySyncKey` and
  `Collection.QuerySyncKeyPart`, and moved the current full verification
  evidence to the Review225 gate.
- Review226 added a Start diagnostics CLI loader negative pin proving
  `loadDiagnosticsEffect` must return an Effect, not host Promise work, and
  moved the current full verification evidence to the Review226 gate.
- Review227 added Core `isPromiseLikeValue(...)` public pins, direct DB root
  export pins for type ids, registry helpers, preload collectors, collection
  errors, snapshot codec errors, live-query collection helpers, and
  `isCollection(...)`, plus a focused Start CLI loader IO fixture and host
  Promise-return negative. It moved the current full verification evidence to
  the Review227 gate.
- Review228 added public type pins for Core browser-router helper types, Stable
  Identity Codec errors and `stableStringify(...)`, and Resource duration
  helper types; DB now has a negative type pin proving the concrete
  `QueryBuilder` constructor is no longer a package-root export. It moved the
  current full verification evidence to the Review228 gate.
- Review229 added Start action request/form/client bridge pins, direct Core
  Resource symbol pins, Solid path-helper pins, DB source-surface and direct
  query-helper pins, and negative public-surface pins proving
  `Collection.Store.disposeEffect`, `LiveQuery.builder`, and QueryBuilder plan
  fields are not public API. It moved the current full verification evidence
  to the Review229 gate.
- Review230 added a branded `Query.Builder` structural-fake negative pin, Core
  Resource UI Binding `disposeEffect()` public type ownership, DB
  `persistedCollectionOptions(...)` and
  `backgroundSyncCollectionsPendingMutationsEffect(...)` root pins, and
  Core/React/Solid source-surface manifest ownership. It moved the current full
  verification evidence to the Review230 gate.
- Review231 added Browser Router Kernel and Host Controller `disposeEffect()`
  type ownership, updated Solid's Browser Router projection for that Effect
  Interface, required React DB/Solid DB `sourceSurface` manifest entries, and
  added focused `Collection.*` namespace value pins for storage, persistence,
  flush/background-sync, and SQLite helpers. It moved the current full
  verification evidence to the Review231 gate.
- Review232 Shared DB Query Stage Plan kept public type tests green while
  moving DB query stage facts behind an internal compiled stage plan; no public
  Query type surface changed.
  It moved the current full verification evidence to the Review232 gate.
- Review233 Stage Plan And UI Cleanup Effects added public type pins for Query
  namespace aliases, Resource Suspense preload cleanup Effects, Browser Router
  Link interrupt Effects, and React commit-scope internal negative pins. It
  moved the current full verification evidence to the Review233 gate.
- Review234 Cleanup Effects And Public Surface Pins added public type pins for
  `CollectionReactivePreloadController.interruptEffect()`,
  `ResourceUiBindingController.interruptPreloadEffect()`,
  `DevtoolsPanelBoot.interruptEffect`, and the full Core browser route-render
  identity surface. It moved the current full verification evidence to the
  Review234 gate.
- Review235 Solid Route Render Scope Cleanup Sequencing added a package-local
  controller pin for `SolidRouteRenderScopeController.disposeEffect()` while
  leaving the public Solid root surface unchanged. It moved the current full
  verification evidence to the Review235 gate.
- Review236 Solid Failed Render Cleanup Sequencing changed internal Solid route
  cleanup behavior only; the existing package-local controller pins remain
  sufficient. It moved the current full verification evidence to the Review236
  gate.
- Review237 Solid Initial Failed Render Cleanup Sequencing also changed
  internal Solid route cleanup behavior only; the existing package-local
  controller pins remain sufficient. It moved the current full verification
  evidence to the Review237 gate.
- Review238 Tooling Runner, Resource UI Observer, And Hover Cleanup changed
  script/runtime cleanup behavior and hover text only. Existing public type
  pins for Resource UI Binding cleanup Effects, Route preload metadata, Start
  file-route helpers, and DB collection helpers remain sufficient. It moved
  the current full verification evidence to the Review238 gate.
- Review239 Main Runner, UI Lifetime, And Public Hover Cleanup added type-test
  pins for the root `CollectionLiveQueryOptions` export and Start streamed
  hydration option Interfaces while expanding the public hover-doc policy over
  Collection runtime facade operations. Runtime/UI lifecycle changes remain
  package-local and are covered by focused tests. It moved the current full
  verification evidence to the Review239 gate.
- Review240 Effect-First Cleanup, Suspense, And Public API Pins taught the
  public API inventory audit to require dotted namespace references in
  type-test bindings, then pinned `Collection.validateHydrationPayloadEffect`,
  `Query.diagnostics`, and `SQLitePersistence.storage` so namespace-backed
  public surfaces cannot be satisfied by shallow top-level imports alone. It
  moved the then-current full verification evidence to the Review240 gate.
- Review243 Browser Router And DB Public Interface Pins added direct public
  type-test and manifest ownership for top-level Query type mirrors
  (`QueryRoot`, `QueryFactory`, `LiveQuery`, `LiveQueryState`, plan diagnostics,
  join/sort scalar types, and aggregate types) plus SQLite default constants.
  The latest full verification evidence is now the Review492 gate.
- Review244 Effect Cleanup Ownership, DB Pins, And Evidence Policy added
  namespace Query scalar alias pins for `Query.JoinKey`, `Query.SortDirection`,
  and `Query.SortValue`, React/Solid DB handle Effect channel pins, and the
  Devtools typed invalidation conflict Effect pin.
- Review245 Public API Symbol Reachability And Router Adapter Parity added
  symbol-level public hover policy checks so type-test imports, manifest
  required imports, and public hover declarations cannot drift apart at the
  package Interface seam.
- Review246 Effect Cleanup Capture And Vite Middleware Lifecycle added
  `Query.*` predicate pins, Vite dev SSR middleware option pins, and current
  evidence policy pins so namespace ownership and middleware lifecycle
  Interfaces remain visible to type tests and LSP-facing docs.
- Review247 Scope Cleanup Capture And Namespace Public Pins added
  `RuntimeUiScopeFrame.captureDisposeEffect()` and sync `dispose()` pins,
  `Collection.*` and `Query.*` error constructor namespace pins, React DB/Solid
  DB namespace-local error-channel pins, and direct Start Vite dev SSR
  middleware/helper imports so LSP-facing public concepts cannot drift behind
  root-only symbols.
- Review492 Route Suspense Runtime And Prerender Callback Pins added Start
  prerender hover-policy pins for exported prerender option, event, result,
  error, planning, and Effect runner declarations, while keeping lazy route
  Suspense runtime ownership behind Core's public `Route` namespace.
- Review501 Start Action Trace Invalidation And Manifest Pins expands the
  `@sunfall/arc-start` root manifest-required imports for observability
  metrics, request trace/action response metadata, and transport helper
  symbols, so those public Interfaces are directly exercised in
  `type-tests/start.test-d.ts`.
- Review502 Start Action Trace Invalidation Hover changes public hover copy
  only; it adds no new type-test contract and keeps the Review501 Start root
  manifest pins current.
- Review503 React Solid DB Live Query Handle Hovers changes public adapter
  hover copy only; it adds no new type-test contract and keeps the existing
  React DB/Solid DB live-query handle type pins current.
- Review500 Devtools Trace Docs And Lint Evidence changes public hover copy and
  script lint hygiene only; it adds no new type-test contract and keeps the
  Review499 request metrics evidence current.
- Review499 Request Metrics And Evidence Policy changes runtime observability
  and docs policy only; it adds no new public type-test contract and keeps the
  Review498 React router path-helper pins current.
- Review498 Router Docs And Legacy Identity Policy adds React router path-helper
  public type pins matching the existing Solid coverage, updates the DB SQLite
  default table literal pin to the Sunfall Arc identity, and keeps the Review496
  Start Vite callback pins current.
- Review497 React Solid DB Hover Copy Policy changes only public hover copy for
  React DB and Solid DB collection hooks; it adds no new type contract and keeps
  the Review496 Start Vite callback pins current.
- Review496 Starter Artifact And Prerender Type Pin Policy adds Start Vite type
  tests for public and resolved prerender callbacks: `Effect.void` returns are
  accepted, Promise-returning callbacks are rejected, and resolved callback
  return types are pinned to `EffectInput<void, unknown, never>`.
- Review495 Resolved Callback And Payload Token Policy aligns
  `ResolvedStartPrerenderOptions` callback returns with the public
  `StartPrerenderOptions` Effect-returning callback Interface, keeping LSP
  hover docs and normalized option types from implying dropped `void` work.
- Review494 Effect Callback And Package Interface Policy widened Start prerender
  callback types to `EffectInput<void, unknown, never>` so public option types
  now describe returned Effect work as part of the Interface.
- Review493 Prerender Server Release And Current Evidence Policy did not
  change public type contracts. It tightened current evidence policy and kept
  the Review492 public type-test and full-gate evidence as the latest full
  verification checkpoint.
- Review491 Prerender Effect Interface And Lazy Route Suspense Probes removed
  the public `runStartPrerender(...)` Promise facade from Start Vite type
  pins, kept `runStartPrerenderEffect(...)` as the public runner, and added a
  generated-code type probe for Start route splitting so Effect v4
  `tryPromise(...)` output is checked by TypeScript instead of substring
  assertions alone.
- Review490 Effect-First Lazy Route Components And Formatter-Tolerant Public
  API Inventory updated Core route type tests so `Route.lazyComponent(...)`
  accepts an Effect loader and exposes `preloadEffect()` instead of a
  Promise-shaped preload Interface.
- Start route preload type tests pin that `preloadRequestEffect(...)` and
  `createRequestHandlerEffect(...)` keep preload services in the requirement
  channel when the app server runtime does not provide them, and remove them
  when it does. Review 68 also pins file-route preload helpers accepting stable
  collection names, while runtime tests cover registry/resolver-only hydration.
- Start render context coverage now pins the non-streaming
  `legacyHydrationScript`, the deprecated `hydrationScript` alias, the
  streamed `hydrationRootScript`, and the `StartRenderHydrationPlan` Interface.
  Type hovers distinguish the full payload from the root-only streamed script
  so renderers can avoid duplicating route resource hydration.
- Effect-first Start fetch and Node adapter type tests pin that route preload
  services remain visible through adapter conversion, including negative tests
  for partial generics that would otherwise collapse requirements to `unknown`;
  they also exercise the low-level request-origin, Node request conversion,
  response writer, Promise facade option, runtime-option, and handler alias
  surfaces from the root compatibility facade, the fetch/node subpaths, and the
  `@sunfall/arc-start-fetch` / `@sunfall/arc-start-node` packages.
- The root `@sunfall/arc-start/adapters` compatibility facade now has an explicit
  `createFetchHandler(...)` type pin and the same serviceful-handler
  runtime-required negative assertion as `@sunfall/arc-start/fetch-adapter`.
- The root `@sunfall/arc-start/adapters` facade also pins low-level Fetch and
  Node Effect handlers plus Node callback facades, including the runtime option
  requirement for serviceful Node server handlers.
- Promise/callback-shaped Start host facade type tests pin that non-Scope
  handler requirements require a typed runtime, while request Scope remains
  facade-owned.
- Core action type tests pin that `Action.use(definition, { runtime })`
  removes services supplied by the runtime from `submitEffect(...)` and exposes
  runtime startup/acquisition errors in the action error channel.
- Core Program type tests pin the same runtime-error rule for
  `Program.start(...)` and Solid/React `useProgram(...)`: update, command, and
  subscription failures keep the Program error channel, while Runtime Spine
  provision/startup failures flow through the optional `ER` parameter instead
  of widening to `unknown`.
- Core action invalidation type tests pin that `Action.planInvalidation*`,
  `Action.use(...)`, and `ActionResult` invalidation metadata, including
  `withInvalidation(...)` and Effect result helpers, preserve required services
  until an explicit runtime supplies them.
- Start registry type tests pin that app-local action/RPC registry
  requirements and explicit `options.actions` requirements remain visible in
  Start request handler Effects until the server runtime provides them.
- Solid action hook type tests pin the runtime-bound submit Effect and the
  optional runtime-error generic for apps with a fallible Solid Runtime
  Provider.
- React and Solid router type tests pin that serviceful route preload
  definitions require a browser router runtime carrying the preload service
  layer, and focused adapter tests directly import/use adapter-root core
  re-exports, runtime helpers, `RouterLink`, `RouterOutlet`, `useRouter`,
  `isPlainLeftClick`, `BrowserNavigateOptions`, router errors, and route/path
  helper types.
- React and Solid hook hover policy now covers the public hook handles,
  resource render aliases, options, and hook functions exported from
  `packages/react/src/hooks.ts` and `packages/solid/src/hooks.ts`; the focused
  adapter type tests require `ResourceMatch` and `ResourceSuccessMeta` as
  direct root imports.
- Solid resource and Solid DB hook type tests pin runtime-bound returned
  Effects, optional runtime-error generics, and the fact that Solid DB handles
  no longer expose service requirements already provided by the Solid runtime.
  Review 67 also pins runtime-bound Solid DB collection mutation and flush
  Effects plus reactive pending-mutation reads.
- DB live-query collection type tests pin inferred source requirements and
  Solid DB collection handles for derived live-query collections.
- Start/Devtools app graph type tests pin that Start App Graph Diagnostics are
  assignable to the Devtools app graph Interface and can feed store, summary,
  panels, and bridge surfaces without hand-authored drift.
- DB collection hydration type tests pin `Collection.dehydrateEffect(...)`,
  `Collection.hydratePayloadEffect(...)`, and
  `Collection.validateHydrationPayloadEffect(...)` error channels, including
  snapshot codec failures and synchronous callback failures.
- Query factory type tests pin that public `Query.Factory<TResult>` defaults to
  `never` error/requirement channels and rejects serviceful builders unless
  their `E/R` parameters are explicit.
- DB query and collection type tests pin `QueryGroupKey`/`Query.GroupKey`
  against nested Promise-shaped group keys in records, arrays, Maps, and Sets,
  concrete `CollectionError` and `CollectionRequirements` extraction, bare
  `AnyCollection` erasure to `unknown`, serviceful erased persistence, and
  serviceful change-feed unsubscribe cleanup.
- DB multi-collection flush and background sync type tests pin
  `CollectionSnapshotCodecError` in the coordination error channel.
- DB root type tests pin package-root SQLite helpers, the `SQLitePersistence`
  namespace, statement database contracts, persisted row shape, and
  `SQLitePersistenceInvalidRow` so adapter packages can import the SQLite seam
  without relying on `Collection.*` aliases.
- Start request traces remain structurally assignable to
  `DevtoolsRequestTrace`, including the richer teardown timestamps, duration,
  and before/after Resource Store snapshots added during the request trace
  sweep.
- Start action invalidation metadata remains structurally assignable to
  `DevtoolsInvalidationPlan` in both directions, so Start transport payloads can
  feed devtools without introducing a package dependency.
- Start endpoint type tests pin the shared transport endpoint helpers used by
  request handlers, RPC clients, action clients, and progressive action forms.
- Start hydration and Effect RPC type tests pin
  `hydrateStartHydrationChunks(...)` runtime-service generics,
  `startEffectRpcEndpointDescriptor(...)`, endpoint descriptors, and procedure
  schema-presence descriptors.
- Start action form type tests pin schema-backed form input encoding and the
  `StartActionFormEncodeError` sync facade.
- Devtools panel contract type tests pin `normalizeDevtoolsPanels(...)`, the
  sync and Effect panel mounts, panel guards, bridge payload normalization, and
  bounded serialization policy values.
- Devtools store type tests pin the explicit `DevtoolsStore` Interface and
  retained fact indexes returned from serialized route-plan recording.
- Devtools causal graph type tests reject the removed
  `InvalidationTarget` node kind; invalidation refs now stay under `Resource`
  nodes and tags under `ResourceTag`.
- Devtools runtime-event and panel contract coverage now pins runtime-only
  route/invalidation fact projection, duplicate panel item rejection, and
  rendered item identity through focused runtime tests.
- Devtools panel contract regressions now cover invalid inspected-window bridge
  payload diagnostics, transport timeouts, and shared app graph normalization
  so extension code consumes the same public `DevtoolsPanels` Interface as
  renderers, summaries, serialization, and causal graph projection.
- The public API inventory audit now verifies type-test binding usage through
  TypeScript AST identifiers outside import declarations, so comments, string
  literals, and templates cannot make a public import look covered.

## Verification Evidence

- `pnpm typecheck:types` passed after Review244 with Query scalar namespace
  aliases, DB handle Effect channel pins, and Devtools typed failure pins.
  Full `pnpm verify` passed after Review492 with
  58 root test files / 1223 tests, including dotted namespace public API
  type-test ownership for `Collection.validateHydrationPayloadEffect`,
  `Query.diagnostics`, and `SQLitePersistence.storage`, DB query-sync and live
  query materialization regressions, Solid Resource preload option reactivity,
  React/Solid route Suspense ownership, Start streaming response lifetime
  cleanup, command-runner policy coverage, Resource UI observer-defect
  cleanup coverage, Solid initial failed-render cleanup sequencing coverage,
  Solid failed-render cleanup sequencing coverage,
  Solid Route Render Scope
  Controller `disposeEffect()` package-local coverage, Collection Reactive Preload
  Controller `interruptEffect()` pins, Resource UI Binding automatic preload
  `interruptPreloadEffect()` pins, Devtools panel boot interrupt pins, Core
  route-render identity pins, Query Stage Plan source/identity coverage through
  DB collection/live-query tests, Query namespace alias pins, Resource Suspense
  preload cleanup Effect pins, Browser Router Link `interruptEffect()` pins,
  React commit-scope internal negative pins, DB adapter source-surface manifest pins, Collection
  namespace value pins, branded `Query.Builder` negative pin, Resource UI
  Binding `disposeEffect()` pin, DB persistence/background-sync root pins,
  Core/React/Solid source-surface manifest pins, Core helper ownership pins,
  Stable Identity Codec pins, Resource duration pins, Start action bridge pins,
  Core Resource direct symbol
  pins, Solid path-helper pins, DB Query/Store public-surface negative pins,
  DB `QueryBuilder` root-export negative pin,
  Core `isPromiseLikeValue(...)` pin, direct DB root export pins, Start
  diagnostics CLI loader Effect-only negative pin, Resource
  hydration top-level
  payload/input manifest ownership, query-sync key namespace pins,
  payload-only pins, Router Link Preloader identity
  pin, Runtime Provider Lifecycle typed disposal/export pins,
  project-console runtime service probe, SQLite
  persistence metadata error typing, plain-data pins for Program models/
  messages, ActionResult payloads/errors, Form validation errors, collection
  row ingress, query sync keys, secondary index values, and nested query
  projection/group/aggregate values.
- `pnpm typecheck:types` passed after the explicit request-trace teardown and
  Promise-return rejection assertions were added.
- `pnpm typecheck:types` and full `pnpm verify` passed after replacing
  type-test `async` negative cases with declared Promise values.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding the Start
  route-preload runtime requirement pins.
- `pnpm typecheck:types` passed after adding the Effect-first adapter
  requirement-preservation pins.
- `pnpm typecheck:types` passed after adding low-level Start host Adapter and
  Devtools Panel Contract coverage.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding action
  invalidation requirement pins and Start registry/`options.actions`
  requirement pins.
- `pnpm typecheck` passed after adding direct Promise `EffectInput`,
  host-facade runtime, Solid/Solid DB runtime-error, and Query Factory default
  pins.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding the Review
  67 Resource read/snapshot pins, Solid DB mutation handle pins, Start/Devtools
  app graph seam pins, and Devtools large-panel contract regressions.
- `pnpm typecheck:types` passed after adding the Review 69 Program runtime
  error pins and Resource Store public seam usage; focused React, Start, DB, and
  Devtools regressions also passed for adapter behaviors that are runtime
  rather than compile-time contracts.
- Existing type-test failure expectations cover public compile-time rejection
  rules for route params/search, server contracts, resource inputs, collection
  rows, live-query selectors, capability implementations, action invalidation,
  optimistic rollback effects, and form fields.

## Follow-Up

- Add type assertions with each new public callback to keep Promise-shaped APIs
  out of the framework boundary unless they are intentionally wrapped by
  Effect.
- Keep Start and devtools trace contracts covered together whenever request
  trace payloads grow.
- Keep Start action invalidation and devtools invalidation DTOs structurally
  covered together whenever either payload grows.
