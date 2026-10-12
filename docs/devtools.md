# Sunfall Arc Devtools

The devtools package is a typed, JSON-safe observability substrate for
framework facts. UI panels, browser extensions, tests, and agents should consume
these values instead of reaching into live refs, fibers, stores, or modules.

Devtools are not a decorative addon; they are the runtime half of the framework's correctness
story.

## Model

- `Devtools.Snapshot` captures runtime facts: resource states, action states,
  invalidation plans, route plans, ended Effect spans, and runtime events.
- `Devtools.Summary` normalizes those facts into stable panel data, counts, route
  inspectors, request inspectors, invalidation inspectors, resource indexes, and
  a causal graph.
- `Devtools.CausalGraph` turns facts into deterministic nodes and edges for
  routes, route plans, resources, resource tags, actions, programs,
  invalidations, and runtime events.
- `Devtools.Panels` is the shared UI-facing contract for app shells, browser
  extensions, agents, tests, and HTML renderers. Runtime guards and bridge
  payload normalization live in `@sunfall/arc-devtools` so hosts do not need to
  duplicate panel validation logic.
- `Devtools.Store` is an explicit public Interface for recording snapshots,
  route plans, invalidations, runtime events, summaries,
  Timeline commits, panels, and causal graphs. Store record methods
  return retained fact indexes when callers need precise runtime-event links.

Summaries, panels, causal graphs, and bridge payloads are JSON-safe projections.
Raw snapshots may still accept detached `unknown` inspection facts from Core,
Start, or application code; those facts are encoded as tagged data before they
reach the summary and panel contracts.

Requests are not a separate Devtools model: the store records ended Effect
spans (`Devtools.Span`), and the Requests panel reads Start's
`sunfall-arc.start.request` spans and their RPC/action child spans.

## Effect API

Every store read/write has an Effect form:

<!-- prettier-ignore -->
```ts
const store = Devtools.makeStore();

yield* store.recordResourceEvent(event);
yield* store.recordSpan(span);
const snapshot = yield* store.getSnapshot();
const summary = yield* store.getSummary();
const graph = yield* store.getCausalGraph();
const panels = yield* store.getPanels();
```

Actions can be observed directly from their public instance. The observer is
scoped, records action state transitions as runtime events, and links successful
states to the action's invalidation plan when one exists. Action facts mirror the
submission `AsyncResult`: `state` is its tag (`Initial`, `Success`, or `Failure`)
and `waiting` is true while a submission is in flight.
Resource events publish `ResourceFailure` with the full `cause` (typed errors
and defects) and `ResourceInterrupted` when a load was cancelled and the entry
returned to its prior settled result:

<!-- prettier-ignore -->
```ts
yield* store.trackAction(renameAction);
```

Full-stack Start actions expose the same causal shape as serialized JSON
metadata. Adapters can record that metadata without importing Start into
devtools:

<!-- prettier-ignore -->
```ts
yield* store.recordActionState("Project.rename", "Success", {
  input: { id: "atlas" },
  serializedInvalidationPlan: startAction.invalidation.get(),
});
```

For the common case, Action instances are observable directly:

<!-- prettier-ignore -->
```ts
yield* store.trackAction(renameAction);
```

State history comes from the app `Timeline`, not from private queues or fibers.
Devtools copies each Timeline entry through the bounded serialization and
redaction policy before summaries, panels, bridges, or causal graphs inspect it.
Every commit carries a cause, because every change is a State message, an
Action, or a framework event, so each `TimelineCommit` is labelled like a
message log (`State "Menu.open" Toggle`, `Action "Project.rename" submit`).
State message and failure commits land on the States panel:

<!-- prettier-ignore -->
```ts
const recording = yield* Timeline.record();
yield* store.trackTimeline(recording);
```

The default policy redacts common secret-shaped keys such as passwords, tokens,
API keys, credentials, cookies, and authorization fields. Hosts can add
application-specific keys at the store boundary:

```ts
const store = Devtools.makeStore({
  serializationPolicy: {
    redactKeys: ["tenantSecret", /private/i],
  },
});
```

Start traces each request with an Effect span, so Devtools reads requests
through an Effect `Tracer`. `Devtools.layerTracer(store)` wraps the current
tracer (an OpenTelemetry exporter keeps receiving every span) and records each
ended span into the store. Add it to the server Layer, and `@sunfall/arc-start`
never depends on `@sunfall/arc-devtools`:

```ts
const handler = createRequestHandler(app, {
  server: Layer.mergeAll(AppServices, Devtools.layerTracer(store)),
});
```

The request span carries its facts as attributes: `http.route`,
`sunfall-arc.route.resources`, `sunfall-arc.failure.kind`,
`http.response.status_code`, `sunfall-arc.stream.state`, and
`sunfall-arc.teardown.*` (whether the request runtime was disposed, fibers left
behind, cleanup failure). It ends when a streamed body closes, errors, or is
cancelled. Server RPC and Start action calls are child spans. Effect loggers
receive request annotations (request id, transport, method, path), and
`@sunfall/arc-start` updates Effect metrics for request count, duration, and
status.

Every store method returns an Effect (there are no synchronous twins), so
observation composes with services, scopes, and interruption.

## Causality

The causal graph answers questions like:

- Which route plan matched a route and preloaded a resource?
- Which action emitted an invalidation plan?
- Which tag or ref caused a resource to be invalidated?
- Which runtime event observed a resource, action, route plan, or invalidation?

Graph IDs are deterministic and stable enough for tests, agent inspection, and
incremental UI rendering. Runtime events link to recorded route-plan and
invalidation facts by fact index, not by the event's position in the runtime
event list. Causal edge ids are based on the source/target relationship and
duplicate ordinal, so adding unrelated facts earlier in the graph does not
churn stable edge ids.
When adapters record repeated identical facts, the store-returned retained index
can be passed back on runtime events so the causal graph observes the intended
fact rather than the first structural match.
Fact identity now consumes the shared Devtools Serialization Policy fingerprint,
so changes to bounded strings, binary values, containers, or error copies flow
through one Module instead of a parallel serialization-shaped implementation.

Runtime-only route-plan and invalidation events project the same graph facts as
recorded snapshot facts. A route-plan event can still emit `Matches`,
`Preloads`, and `Hydrates` edges, and an invalidation event can still emit
`Targets`, `Invalidates`, and `Causes` edges. When the event matches a recorded
fact, the recorded fact stays canonical and the event only adds its `Observes`
edge. The same runtime-only facts feed the resource index used by summaries and
panels, so resources visible in the graph are visible to the UI-facing panel
contract as well.

Bounded invalidation history rebases action invalidation indexes in snapshots
and runtime events, so event data does not point at stale invalidation slots
after older facts are trimmed. Route-plan hydration facts carry the concrete
hydrated resource keys, so
`Hydrates` edges attach only to resources that were actually serialized for the
route instead of every resource the route touched.

## Golden Path

The full-stack golden path should be explainable from public diagnostics and
Effect-native event streams:

- `Route.planNavigation(...)` exposes the route facts: matched href,
  params, search, preloaded resource refs, and the resource hydration count.
  Start request spans also carry the preloaded and hydrated resource keys.
- `Resource.subscribeEvents()` exposes runtime resource lifecycle facts
  without reading cache internals, including `ResourceInvalidated` events emitted
  before invalidated refs refresh.
- Row change feeds (`rows.changes`) publish `ResourceRowsChanged` and
  `ResourceRowsChangesFailure` on the same stream; devtools records them as
  ordinary resource runtime facts.
- `store.trackAction(action)` exposes action state and invalidation plan
  facts without reading private action internals.
- `store.recordActionState(..., { serializedInvalidationPlan })` exposes
  Start action causality from transport metadata without coupling devtools to the
  full-stack package.
- `store.trackTimeline(recording)` records a running Timeline's retained
  and future entries as `TimelineCommit` runtime events until its Scope closes.
  Each commit has a `label` (`Timeline.describe(cause)`) and its `cause`, which
  is always present. Its target is the State (`state:<name>`), Action, or Resource its
  cause names; a `Transition` cause (work from a named `Component.callback`
  or a `Component.stream` element) has no fact target and is read by its
  label. Every State has a required `name`, so each appears separately.
- `Devtools.layerTracer(store)` records Start's request spans for SSR, server
  RPC, Start action, stream-close, stream-cancel, and request-failure paths,
  with route, failure kind, response, stream, and teardown attributes.
- `Resource.planInvalidation(...)` and action invalidation plans expose
  the semantic invalidation facts: targeted tags/refs, matched live resources,
  and the exact causes for each invalidated resource.

Adapters record those facts into `Devtools.makeStore()` through its Effect
methods. `getSummary()` then provides route, invalidation, runtime, and
request/resource inspectors, while `getCausalGraph()` links the golden
path with deterministic edges such as route plan `Matches` route, route plan `Preloads` and `Hydrates` resource, action `Emits`
invalidation, invalidation `Targets` tags, tag `Causes` resource invalidation,
and runtime events `Observes` resources, states, actions, route plans, and
invalidations.

Runtime event ids are unique per sequence/tag pair. When a host supplies a
duplicate sequence for the same event tag, the Store rebases the later event to
the next available sequence before summary or graph projection. Invalidation and
route-plan event links use the shared Devtools Serialization Policy fingerprint,
so equivalent fact objects still match when object keys arrive in a different
insertion order. Causal graph edge ids use framed identity parts rather than
delimiter concatenation.

## Panel Model

`Devtools.describePanels(...)` and `store.getPanels()` provide the first
UI-facing panel contract. The result is JSON-safe and ordered for direct
rendering:

- Routes
- Resources
- Actions
- States
- Requests
- Diagnostics
- Causal Graph

Bridge payloads must contain that complete panel catalog exactly once. The
shared contract rejects missing or duplicate panels and normalizes otherwise
valid payloads back to catalog order, so extensions, app shells, tests, and
renderers do not each define their own panel identity policy.

Each panel carries a stable `id`, title, short summary, severity, metrics, and
serializable items. Request items include the richer teardown facts from Start:
duration, runtime disposal, teardown reason, before/after fiber, family, module,
and tag counts, serialized teardown snapshots, and per-server-function/action
failure owners.
State items (the `states` panel) include event-level rows for messages,
before/after snapshots, command lifecycle events, emitted follow-up messages,
subscription events, failures, and disposal, plus per-State summary rows.
The Diagnostics panel reports panel-contract errors: when a bridge payload fails
validation, it carries the typed error and the other panels are suppressed.

## Browser Panel Renderer

`Devtools.renderPanelsHtml(...)` turns the panel contract into deterministic HTML
for a browser-embedded panel, documentation preview, or app shell:

<!-- prettier-ignore -->
```ts
const html = Devtools.renderPanelsHtml({
  panels: yield* store.getPanels(),
  selectedPanelId: "requests",
  maxItemsPerPanel: 12,
});
```

The renderer is dependency-light and escapes all panel text/data before writing
HTML. Each rendered item carries `data-sunfall-arc-devtools-item-id`, and the
panel contract rejects duplicate item ids within a panel so extension rows,
tests, and agent tools can rely on stable row identity. Browser hosts that want
lifecycle ownership can mount the same contract through Effect:

<!-- prettier-ignore -->
```ts
yield* Devtools.mountPanels({
  root: document.getElementById("sunfall-arc-devtools")!,
  panels: yield* store.getPanels(),
});
```

The scoped mount clears the root and removes tab listeners when the Effect scope
closes. Use `mount.update(...)` when a host shell wants to refresh the panel
after recording new devtools facts.

Apps that want browser extensions to read the same panel payload can expose an
inspected-window bridge through the devtools package:

<!-- prettier-ignore -->
```ts
yield* Devtools.installBridge(() => ({
  panels: Effect.runSync(store.getPanels()),
  selectedPanelId: "requests",
  title: "Sunfall Arc Devtools",
}));
```

The scoped bridge restores any previous `globalThis.__SUNFALL_ARC_DEVTOOLS__`
value when the Effect scope closes (or on its `uninstall()`). Extension
transports should
resolve inspected-window values with
`Devtools.resolveBridgePayload(...)` before rendering so invalid bridge
payloads can be reported as typed diagnostics instead of collapsing to
`undefined`. This applies the same panel id, severity, metric, item,
finite-number, plain-record, bounded string, and JSON-safe data checks used by
the package tests. Oversized display strings are truncated at the bridge seam,
oversized item lists are windowed with a deterministic overflow row, and
oversized item data object keys are rejected so richer renderers do not silently
rename structured data.

The checked app-shell integration lives at
[`examples/devtools-panel`](../examples/devtools-panel). It mounts sample
public facts through `Devtools.mountPanels(...)` and verifies typecheck,
render output, and production build.

The checked browser-extension shell lives at
[`examples/devtools-extension`](../examples/devtools-extension). It emits a
Manifest V3 devtools page, registers `panel.html` through the browser devtools
panel host, mounts the same public panel contract through
`Devtools.mountPanels(...)`, and reads live inspected-page panel payloads
from `globalThis.__SUNFALL_ARC_DEVTOOLS__` through
`chrome.devtools.inspectedWindow.eval`. The bridge accepts either a
`Devtools.Panels` payload wrapper or a provider function returning that wrapper,
uses the shared `Devtools.bridgeGlobal` key from `@sunfall/arc-devtools`,
structurally validates the panel ids, severities, metrics, items, and
bounded JSON-safe item data before rendering inspected-window data, bounds hung
inspected-window eval calls with a timeout, uses sample facts only as the
initial/no-extension-host fallback, renders later missing, invalid, timed-out,
or throwing inspected-window bridge reads as typed diagnostics without keeping
stale sample/live facts, and verifies the manifest, panel registration,
transport, render output, typecheck, and production build.

## Target Panels

The devtools product should grow in this order:

- Route Inspector: matched route, params, search, declared preload ownership,
  concrete preloaded refs, and hydration payloads.
- Resource Timeline: pending, success, failure, interruption, hydration,
  invalidation, deletion, GC scheduling, and stale/refresh state.
- Action Timeline: `AsyncResult` tag plus `waiting`, input, concurrency,
  optimistic work, invalidation plan, Start transport metadata, and hydration
  payload.
- State Timeline: messages, before/after model snapshots, command
  starts/completions/failures, emitted follow-up messages, subscription events,
  typed failures, and disposal.
- Requests: Start request spans with their route, failure kind, response,
  stream state, teardown, and RPC/action child spans.

Each panel should be backed by serializable data that can also be used by tests,
CI, browser extensions, and agents.
