# Effect UI Invariants

This document names the behavior that must stay true as Effect UI grows toward
the winning spec. These are product guarantees, not implementation preferences.
The strategic destination is
[Best Full-Stack Framework Plan](./best-framework-plan.md); this document is the
non-negotiable contract that keeps the implementation worthy of that plan.

## Product Contract

Effect UI is only meaningfully "better" if these guarantees remain true
together:

- compile-time rules reject mistakes before runtime when TypeScript can express
  the rule;
- build-time diagnostics reject unsafe or ambiguous app graphs before
  production bundles ship;
- runtime state is scoped to the active UI, route, request, or runtime owner;
- app code can mock dependencies with services, layers, and contracts;
- devtools can explain behavior from public facts;
- docs and examples show the same idioms the tests enforce.

Any feature that weakens one of those guarantees needs an explicit design note
and a test plan before it becomes part of the golden path.

## Verification Gate

`pnpm verify` is the release gate. It must prove:

- all packages build;
- TypeScript project references typecheck;
- framework type tests reject invalid API usage;
- runtime tests pass;
- the reference example typechecks;
- the reference example tests pass;
- the reference example builds for production.

Any new framework surface should either be covered by this gate or intentionally
documented as outside the current release bar.

## Runtime Spine

- Effects cross host seams through `EffectUiRuntime`.
- Promise APIs are adapters for UI, browser, and host boundaries.
- Framework internals keep Effect forms for async work.
- Framework callbacks, including resources, actions, routes, server functions,
  collections, capabilities, and forms, reject `Promise` return values at
  type-check time; app code uses `Effect.tryPromise` explicitly at the
  host/library seam instead.
- Request work uses a fresh Request Runtime with the app services and a
  request-local Resource Store.
- SSR preload, SSR render, server RPC, hydration payload creation, and request
  teardown run through the Request Runtime.
- Request Runtime disposal interrupts resource lifetime fibers and any tracked
  request fibers.

## Resource Store

- Resource families are definitions; live state belongs to the active Resource
  Store.
- Resource cache entries, known inputs, hydration state, tag indexes, event
  streams, and lifetime fibers do not leak across runtimes or requests.
- Runtime-spine modules, such as the DB collection store, attach to the active
  Resource Store and are disposed with it.
- Resource lifetimes use Effect fibers, `Clock`, interruption, and scopes rather
  than hidden host timers.
- Hydration populates both the synchronous UI signal state and the Effect cache.
- Failures are observable state, but failed cache lookups are not retained as
  successful cache hits.
- Resource events are published through the Resource Store event stream.

## DB Collections

- Collection definitions are stable declarations; row state, pending mutation
  queues, load state, and collection event streams belong to the active
  Resource Store's `Collection.Store`.
- `Collection.diagnostics()` exposes collection names, schema presence, load
  presence, mutation handlers, retry policy, and persistence policy without
  reading live rows or pending mutation queues.
- Collection diagnostics and adapters can subscribe to events through the public
  collection store without reading private row maps.
- Separate runtimes and request Resource Stores never share collection rows,
  pending mutation queues, or collection event subscriptions.

## Invalidation Graph

- Mutations invalidate semantic domain facts through `Resource.tag` values or
  direct resource refs.
- Actions do not invalidate route names, component trees, or ad hoc cache-key
  strings.
- Invalidation plans are inspectable before execution.
- Devtools and diagnostics consume invalidation plans and resource events instead
  of reading private maps.
- Running an invalidation plan publishes `ResourceInvalidated` events before the
  affected refs refresh, preserving mutation causality in the Effect event
  stream.
- Resource diagnostics expose declared families, semantic tags, schema presence,
  tag-providing behavior, and stale/GC/retry policy without reading live cache
  entries.

## Routing And Hydration

- Routes are schema-typed for params and search values.
- Route href generation rejects missing params, invalid search literals, and
  unknown search keys at compile time.
- Route preload is Effect-typed and interruptible.
- Navigation planning records the matched route, touched resource refs, and
  hydration payload.
- SSR uses the same route plan shape as client navigation diagnostics.
- Start file-route discovery is deterministic and emits a validated manifest
  from the Vite root before route modules reach runtime.
- Generated file-route definition modules import each route file's named
  `Route` and assert its literal `path` against the validated manifest, so typed
  routes and source files cannot silently diverge.
- The default generated route definition file lives in the project at
  `src/routeTree.gen.ts` so editor, agent, and non-Vite tooling can inspect the
  same generated route surface as the bundler.
- Generated route definition files must expose both `routeById` and
  `routeByPath` maps to the same imported route definitions, keeping id and path
  lookup as discovery surfaces over the single canonical `Route.href` API.
- Generated route definition files must expose route-id, route-path,
  params-by-id, search-by-path, and href-options-by-id type maps derived from
  the imported route modules, so generated route metadata preserves the same
  schema/branded param checks as `Route.href`.
- App graph diagnostics must expose route ownership by id, source file, path,
  and path params. When the Vite virtual app-graph module can import route
  modules, it must resolve params/search schema, preload, and component presence
  to `present` or `absent` instead of leaving those facts implicit.
- Route preload resource diagnostics distinguish `declared`, `none`, and
  `unknown`. Static graph facts come from route `preloadResources` declarations;
  runtime route plans remain the proof of exact resource refs touched for a
  concrete href.
- Route preload collection diagnostics distinguish `declared`, `none`, and
  `unknown`. Static graph facts come from route `preloadCollections`
  declarations; Start's collection preload collector remains the proof of exact
  DB collections touched for a concrete request.
- Resolved app graph diagnostics must list routes whose preload is present but
  whose preload resources or collections are still `unknown`, and
  `validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect` can turn those
  into a typed failure for CI/devtools policy. The collection equivalent is
  `validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect`.
- App graph diagnostics must expose server-function and action ownership by
  stable id, server export, client reference, module kind, endpoint, and
  wire-schema completeness so agents can route edits without guessing across
  the client/server boundary.
- App graph diagnostics must expose action behavior metadata for invalidation,
  optimistic updates, retry policy, and concurrency. When a manifest is
  hand-written and cannot prove a behavior fact, diagnostics must report
  `unknown` rather than guessing.
- Start build policy can opt into rejecting unknown action behavior metadata, so
  teams can make invalidation/retry/concurrency provenance a CI-enforced
  contract once their manifests are ready.
- Start build policy can opt into resolved diagnostics checks for route preload
  resource and collection declarations. The check runs from the generated
  `virtual:effect-ui/app-graph` module, where route modules have been imported
  and route feature facts are no longer static placeholders.

## Server Functions

- Shared code defines server contracts and browser-safe clients.
- Server handler modules implement contracts and are excluded from browser
  graphs.
- Production manifests are deterministic and validate duplicate names, duplicate
  ids, duplicate exports, schema flags, and unsafe client references.
- RPC separates domain failures, protocol errors, transport errors, defects, and
  interruption.
- Tests can replace server behavior through mocks and capabilities without
  importing server-only modules.

## Actions And Forms

- Action state models idle, pending, success, failure, and invalidation plan
  facts explicitly.
- Action concurrency modes have stable semantics for latest, parallel, and
  exhaust submissions.
- Optimistic updates commit on success and roll back on failure or interruption.
- Progressive action results model success, validation failure, redirect, and
  domain failure as typed data.
- Forms derive field names and field values from schemas.

## Compile-Time Correctness

- Type tests are product tests.
- Any rule that can be rejected by the compiler should have a negative type test.
- Runtime tests are still required for lifecycle, interruption, streaming,
  request isolation, hydration, invalidation, and adapter behavior.
- Build-time manifests should fail fast for ambiguous or unsafe application
  graphs.

## Agent Surface

- Domain vocabulary stays stable and centralized in `CONTEXT.md`.
- Generated artifacts should be deterministic, machine-readable, and source
  attributable.
- The generated app graph is the preferred agent entrypoint for route, server
  function, action, resource, and collection vocabulary topology.
- Error messages should say what happened, where it happened, why it matters, and
  how to fix it.
- Agents should be able to inspect the app graph without guessing from import
  structure alone.
