# Effect UI Devtools

The devtools package is a typed, JSON-safe observability substrate for
framework facts. UI panels, browser extensions, tests, and agents should consume
these values instead of reaching into live refs, fibers, stores, or modules.

The strategic role of devtools is described in
[Best Full-Stack Framework Plan](./best-framework-plan.md). Devtools are not a
decorative addon; they are the runtime half of the framework's correctness
story.

## Model

- `DevtoolsSnapshot` captures runtime facts: resource states, action states,
  invalidation plans, route plans, request traces, app graph diagnostics, and
  runtime events.
- `DevtoolsSummary` normalizes those facts into stable panel data, counts, route
  inspectors, request inspectors, invalidation inspectors, resource indexes, and
  a causal graph.
- `DevtoolsCausalGraph` turns facts into deterministic nodes and edges for
  request traces, routes, route plans, resources, resource families, DB
  collections, actions, invalidations, schema coverage, missing schemas,
  runtime events, endpoints, and modules.

All values are JSON-safe. Non-JSON inputs such as dates, bigints, functions,
symbols, undefined values, circular references, and non-finite numbers are
encoded as tagged data.

## Effect API

Every store read/write has an Effect form:

```ts
const store = makeDevtoolsStore()

yield* store.recordResourceEventEffect(event)
yield* store.recordRequestTraceEffect(trace)
const snapshot = yield* store.getSnapshotEffect()
const summary = yield* store.getSummaryEffect()
const graph = yield* store.getCausalGraphEffect()
```

Actions can be observed directly from their public instance. The observer is
scoped, records action state transitions as runtime events, and links successful
states to the action's invalidation plan when one exists:

```ts
yield* store.trackActionEffect(renameAction)
```

Full-stack Start actions expose the same causal shape as serialized JSON
metadata. Adapters can record that metadata without importing Start into
devtools:

```ts
yield* store.recordActionStateEffect("Project.rename", "Success", {
  input: { id: "atlas" },
  serializedInvalidationPlan: startAction.invalidation.get()
})
```

For the common case, Start-shaped action instances are observable directly. The
type is structural, so devtools stays independent of the full-stack package:

```ts
yield* store.trackStartActionEffect(renameStartAction)
```

Start request handlers can emit a structurally compatible request trace without
making `@effect-ui/start` depend on `@effect-ui/devtools`:

```ts
const handler = createRequestHandler(app, {
  onRequestTrace: (trace) => store.recordRequestTraceEffect(trace)
})
```

The plain methods remain for host adapters, but framework internals and tests
should prefer the Effect methods so observation composes with services, scopes,
and interruption.

## Causality

The causal graph answers questions like:

- Which route plan matched a route and preloaded a resource?
- Which action emitted an invalidation plan?
- Which request handled an endpoint, route plan, resource, collection, action,
  or server function?
- Which tag or ref caused a resource to be invalidated?
- Which runtime event observed a resource, action, route plan, or invalidation?
- Which app graph schema coverage bucket reported a missing schema?

Graph IDs are deterministic and stable enough for tests, agent inspection, and
incremental UI rendering.

When `StartBuildPolicy.diagnostics` is configured, the generated
`virtual:effect-ui/app-graph` module also exports `diagnosticsPolicyViolations`
and throws if resolved route-module diagnostics violate the policy. This lets a
devtools/CI import turn missing `preloadResources` or `preloadCollections`
declarations into a hard gate. Use `loadStartAppGraphDiagnostics(...)` from
`@effect-ui/start/vite` when a CI script wants to run the same resolved
diagnostics gate through Vite and consume the resulting `diagnostics` object.
The same path is available as `effect-ui-start diagnostics --root .`; pass
`--json` when the caller wants the resolved graph payload. The default CLI
output is an agent-readable repair report grouped by source owner, with concrete
edits for missing wire schemas, unknown action behavior metadata, and route
preload resource/collection declarations.

## Golden Path

The full-stack golden path should be explainable from public diagnostics and
Effect-native event streams:

- Start app graph diagnostics expose the static facts: matched route modules,
  server function modules and RPC endpoint, action modules and action endpoint,
  schema coverage, action invalidation/optimistic/retry/concurrency metadata,
  route preload resource and collection declarations, resource families,
  resource tags, and DB collection definitions.
- `Route.planNavigationEffect(...)` exposes the route facts: matched href,
  params, search, preloaded resource refs, and the resource hydration count.
- `Resource.subscribeEventsEffect()` exposes runtime resource lifecycle facts
  without reading cache internals, including `ResourceInvalidated` events emitted
  before invalidated refs refresh.
- Collection store subscriptions expose DB collection lifecycle and mutation
  facts without reading private row maps.
- `store.trackActionEffect(action)` exposes action state and invalidation plan
  facts without reading private action internals.
- `store.recordActionStateEffect(..., { serializedInvalidationPlan })` exposes
  Start action causality from transport metadata without coupling devtools to the
  full-stack package.
- `store.trackStartActionEffect(startAction)` observes Start-shaped action
  instances directly and records serialized invalidation metadata on successful
  states.
- `store.recordRequestTraceEffect(trace)` exposes the request-level join across
  request context, response context, services, route plans, resources,
  collections, server functions, actions, streams, fibers, and teardown.
- `createRequestHandler(..., { onRequestTrace })` emits that shape for SSR,
  server RPC, Start action, response stream-close, stream-cancel, and
  request-failure paths. Teardown records reason, duration, and before/after
  Resource Store snapshots.
- `Resource.planInvalidationEffect(...)` and action invalidation plans expose
  the semantic invalidation facts: targeted tags/refs, matched live resources,
  and the exact causes for each invalidated resource.

Adapters should record those facts into `makeDevtoolsStore()` through the Effect
methods. `getSummaryEffect()` then provides route, invalidation, runtime, and
request/resource inspectors, while `getCausalGraphEffect()` links the golden
path with deterministic edges such as request trace `UsesEndpoint`, request
trace `Records` resources/collections/actions/server functions, route plan
`Matches` route, route plan `Preloads` and `Hydrates` resource, action `Emits`
invalidation, invalidation `Targets` tags, tag `Causes` resource invalidation,
and runtime events `Observes` resources, collections, actions, and request
traces.

## Target Panels

The devtools product should grow in this order:

- App Graph: routes, route modules, server functions, actions, resources,
  collections, schemas, endpoints, and module ownership.
- Route Inspector: matched route, params, search, declared preload ownership,
  concrete preloaded refs, collection preload, and hydration payloads.
- Resource Timeline: pending, success, failure, hydration, invalidation,
  deletion, GC scheduling, and stale/refresh state.
- Action Timeline: idle, pending, success, failure, input, concurrency,
  optimistic work, invalidation plan, Start transport metadata, and hydration
  payload.
- Collection Inspector: row counts, indexes, live query plans, pending
  mutations, persistence, sync adapter, and rollback facts.
- Request Trace: request context, response context, server functions, actions,
  resources, collections, streams, fibers, interruption, and teardown.
- Diagnostics Repair: missing schemas, unknown preload ownership, unknown
  action behavior, unsafe modules, and exact owner/edit guidance.

Each panel should be backed by serializable data that can also be used by tests,
CI, browser extensions, and agents.
