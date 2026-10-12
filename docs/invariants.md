# Sunfall Arc Invariants

This document names the behavior that must stay true as Sunfall Arc grows.
These are product guarantees, not implementation preferences.

## Product Contract

Sunfall Arc is only meaningfully "better" if these guarantees remain true
together:

- compile-time rules reject mistakes before runtime when TypeScript can express
  the rule;
- build-time checks reject unsafe or ambiguous route graphs and server-only
  imports before production bundles ship;
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

- Effects cross host seams through `SunfallArcRuntime`.
- Promise-shaped entrypoints are compatibility adapters for UI, browser, and
  host boundaries only.
- Framework internals keep Effect forms for async work.
- Framework callbacks, including states, resources, actions, routes, server
  functions, query callbacks, and forms, reject `Promise` return
  values at type-check time; app code uses `Effect.tryPromise` explicitly at the
  host/library seam instead.
- Request work uses a fresh Request Runtime with the app services and a
  request-local Resource Store.
- SSR preload, SSR render, server RPC, hydration payload creation, and request
  teardown run through the Request Runtime.
- Request Runtime disposal interrupts resource lifetime fibers and any tracked
  request fibers.

## States

- State is the one writable client state. Public Signals are read-only;
  writable signals are internal to the framework, so every change is a State
  message, an Action, or a framework event, and every commit is named.
- State definitions are named model/message loops (`name` is required); UI
  adapters read the public signals and send messages instead of owning hidden
  reducer state.
- State models and messages are plain values. Promise-shaped values,
  Effect-shaped values, and `undefined`/`void` messages are rejected because
  command Effects reserve `undefined`/`void` as the no-message sentinel.
- State definitions are `State.define({ name, initial, on })`: messages are a
  tagged union inferred from (or, with `State.define<Model, Message>()`,
  declared for) the `on` map keyed by each message `_tag`, and handlers are
  pure and synchronous, so `State.step(definition, model, message)` tests a
  transition with no runtime. There is no `update` callback.
- `State.emit(...)` is the one command constructor: an immediate message,
  the message an Effect produces, or nothing when the Effect completes with
  `void`. `State.commands(...)` only batches.
- Update, command, and subscription failures are reported as typed
  `State.Failure` values without replacing the current model.
- An Action's optimistic patch on a State is a layer over its model: messages
  apply to the base and the patch re-applies over it.
- Subscriptions are tied to committed model generations; stale generations
  cannot emit follow-up messages or timeline facts after a restart.
- `dispatch(message)` is an Effect that acknowledges only updates that commit. Disposal before
  commit fails the acknowledgement with `State.Disposed`; disposal after commit
  preserves the committed model.

## Resource Store

- Resource families are definitions; live state belongs to the active Resource
  Store.
- Resource cache entries, known inputs, hydration state, tag indexes, event
  streams, and lifetime fibers do not leak across runtimes or requests.
- Runtime-spine modules (Component hosts, `rows.changes` feeds) attach to the
  active Resource Store and are disposed with it.
- Resource lifetimes use Effect fibers, `Clock`, interruption, and scopes rather
  than hidden host timers.
- Hydration populates both the synchronous UI signal state and the Effect cache.
- Failures are observable state, but failed cache lookups are not retained as
  successful cache hits.
- Resource events are published through the Resource Store event stream.
- Every write of an entry's value (load, hydration, rows change, optimistic
  patch, fold, rollback) shares structure with the value it replaces: a part
  deep-equal to its previous version is the previous object, so an equal
  reload shows the previous value itself. Solid readers project the shared
  value, so a binding re-runs only when the field it reads changes.

## Resource Rows

- Rows are derived from a Resource's value, never stored separately: the value
  is the one cached, hydrated, and persisted copy.
- A reload is shared by key; a row equal to its previous version keeps its
  object identity. Lookups (key positions, index buckets) are cached per value
  and never mutate a shown array.
- Row patches are optimistic layers over the entry's synced value, owned by
  one Action submission; loads, snapshots, and persistence see only the synced
  value.
- Resource family diagnostics report declared index names and whether a
  change feed exists, without reading live rows.
- Separate runtimes and request Resource Stores never share rows, row
  patches, or change feeds.

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
- Generated route definition files expose a `routeById` map to the imported
  route definitions; routes are addressed by definition everywhere
  (`Route.href`, `router.navigate`, `router.preload`), with no path-keyed
  helpers.
- Generated route definition files must expose route-id, params-by-id,
  search-by-id, and href-options-by-id type maps derived from
  the imported route modules, so generated route metadata preserves the same
  schema/branded param checks as `Route.href`.
- Route preload resource facts distinguish `declared`, `none`, and `unknown`
  (`Route.describePreloadResources`). Static facts come from route
  `preloadResources` declarations; runtime route plans remain the proof of
  exact resource refs touched for a concrete href. Vite dev warns for every
  route whose preload has no `preloadResources` declaration.

## Server Functions

- Shared code defines server contracts and browser-safe clients.
- Server handler modules implement contracts and are excluded from browser
  graphs.
- Every server function is an `effect/rpc` `Rpc` with required input and
  output schemas; there is no schema-less wire path.
- RPC separates typed (Schema-encoded) failures, transport errors
  (`RpcClientError`), defects, and interruption, as `effect/rpc` does.
- Tests can replace server behavior through mocks and service Layers without
  importing server-only modules.

## Actions And Forms

- Action state is an `AsyncResult` (idle is `Initial`, in flight is `waiting`)
  plus the latest input; the invalidation plan is its own signal.
- Every Resource load and Action submission settles from its `Exit` with Effect
  `Clock` time: typed errors and defects become `Failure` with the full `Cause`,
  and interruption returns to the prior settled result. No outcome leaves an
  entry `waiting`.
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
- The generated route tree (`routeTree.gen.ts`) and the definitions
  themselves (`Resource.diagnostics()`, `Route.describePreloadResources`) are
  the agent entrypoints for route and resource topology.
- Error messages should say what happened, where it happened, why it matters, and
  how to fix it.
- Agents should be able to inspect routes and resources from definition facts
  without guessing from import structure alone.
