# Sunfall Arc Devtools

The devtools package is a typed, JSON-safe observability substrate for
framework facts. UI panels, browser extensions, tests, and agents should consume
these values instead of reaching into live refs, fibers, stores, or modules.

Devtools are not a decorative addon; they are the runtime half of the framework's correctness
story.

## Model

- `Devtools.Snapshot` captures runtime facts: resource states, action states,
  invalidation plans, route plans, request traces, app graph diagnostics, and
  runtime events.
- `Devtools.Summary` normalizes those facts into stable panel data, counts, route
  inspectors, request inspectors, invalidation inspectors, resource indexes, and
  a causal graph.
- `Devtools.CausalGraph` turns facts into deterministic nodes and edges for
  request traces, routes, route plans, resources, resource families, actions,
  invalidations, schema coverage, missing schemas,
  runtime events, endpoints, and modules. Route preload ResourceFamily nodes
  prefer app graph definitions when present, so schema, tag, and policy depth
  is not lost when preload facts arrive before app graph facts.
- `Devtools.Panels` is the shared UI-facing contract for app shells, browser
  extensions, agents, tests, and HTML renderers. Runtime guards and bridge
  payload normalization live in `@sunfall/arc-devtools` so hosts do not need to
  duplicate panel validation logic.
- `Devtools.Store` is an explicit public Interface for recording snapshots,
  app graph diagnostics, route plans, invalidations, runtime events, summaries,
  Timeline commits, panels, and causal graphs. Store record methods
  return retained fact indexes when callers need precise runtime-event links.

Summaries, panels, causal graphs, and bridge payloads are JSON-safe projections.
Raw snapshots may still accept detached `unknown` inspection facts from Core,
Start, or application code; those facts are encoded as tagged data before they
reach the summary and panel contracts.

Request traces can be recorded either through the request-trace API or as
runtime `RequestTrace` events. Devtools canonicalizes both paths into the same
request rows, resource sources, and causal `Records` edges, de-duplicating by
request id when the same trace is observed twice.

## Effect API

Every store read/write has an Effect form:

```ts
const store = Devtools.makeStore();

yield * store.recordResourceEvent(event);
yield * store.recordRequestTrace(trace);
const snapshot = yield * store.getSnapshot();
const summary = yield * store.getSummary();
const graph = yield * store.getCausalGraph();
const panels = yield * store.getPanels();
```

Actions can be observed directly from their public instance. The observer is
scoped, records action state transitions as runtime events, and links successful
states to the action's invalidation plan when one exists. Action facts mirror the
submission `AsyncResult`: `state` is its tag (`Initial`, `Success`, or `Failure`)
and `waiting` is true while a submission is in flight.
Resource events publish `ResourceFailure` with the full `cause` (typed errors
and defects) and `ResourceInterrupted` when a load was cancelled and the entry
returned to its prior settled result:

```ts
yield * store.trackAction(renameAction);
```

Full-stack Start actions expose the same causal shape as serialized JSON
metadata. Adapters can record that metadata without importing Start into
devtools:

```ts
yield *
  store.recordActionState("Project.rename", "Success", {
    input: { id: "atlas" },
    serializedInvalidationPlan: startAction.invalidation.get(),
  });
```

For the common case, Action instances are observable directly:

```ts
yield * store.trackAction(renameAction);
```

State history comes from the app `Timeline`, not from private queues or fibers.
Devtools copies each Timeline entry through the bounded serialization and
redaction policy before summaries, panels, bridges, or causal graphs inspect it.
Every commit carries a cause, because Signals change only inside named
transitions, so each `TimelineCommit` is labelled like a message log
(`ProjectPage.rename`, `Action "Project.rename" submit`). Program message and
failure commits land on the Programs panel:

```ts
const recording = yield * Timeline.record();
yield * store.trackTimeline(recording);
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

Start request handlers can emit a structurally compatible request trace without
making `@sunfall/arc-start` depend on `@sunfall/arc-devtools`:

```ts
const handler = createRequestHandler(app, {
  onRequestTrace: (trace) => store.recordRequestTrace(trace),
});
```

Every store method returns an Effect (there are no synchronous twins), so
observation composes with services, scopes, and interruption; the request trace
hook above accepts that Effect directly, and a non-Effect host runs it with
`Effect.runSync(...)`.

Start request handling also emits Effect-native observability alongside the
plain trace payload. `@sunfall/arc-start` exports `startRequestCountMetric`,
`startRequestDurationMetric`, and `startRequestStatusMetric`; the handler wraps
requests in an `sunfall-arc.start.request` span, and server RPC/action calls in
child spans. Effect loggers receive request annotations such as request id,
transport, method, and path.

## Causality

The causal graph answers questions like:

- Which route plan matched a route and preloaded a resource?
- Which action emitted an invalidation plan?
- Which request handled an endpoint, route plan, resource, action, or server
  function?
- Which tag or ref caused a resource to be invalidated?
- Which runtime event observed a resource, action, route plan, or invalidation?
- Which app graph schema coverage bucket reported a missing schema?

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

Bounded invalidation history also rebases request-trace action invalidation
indexes in both snapshot traces and runtime `RequestTrace` events, so request
summaries and event data do not point at stale invalidation slots after older
facts are trimmed. Caller-supplied `trace:N` request ids seed the fallback
trace-id allocator before id-less traces are recorded. Request-embedded route
plans link to matching recorded route-plan facts when one exists instead of
using the request trace's array index as a synthetic route-plan identity.
Route-plan hydration facts carry the concrete hydrated resource keys, so
`Hydrates` edges attach only to resources that were actually serialized for the
route instead of every resource the route touched.

When `StartBuildPolicy.diagnostics` is configured, the Start Vite Diagnostics
Gate runs during Vite builds and fails if resolved route-module diagnostics
violate the policy, even when the app does not import
`virtual:sunfall-arc/app-graph`. The static `virtual:sunfall-arc/app-graph` module
is topology-only; route-module/resource diagnostics live behind the
explicit `virtual:sunfall-arc/app-graph/runtime-diagnostics` import, which also
exports typed `diagnosticsPolicyViolations` for devtools and agent consumers.
Use
`sunfall-arc-start diagnostics --root .` when a CI script wants to run the same
resolved diagnostics gate through Vite; pass `--json` when the caller wants the
resolved graph payload. The default CLI output is an agent-readable repair
report grouped by source owner, with concrete edits for missing wire schemas
and route preload resource declarations.
For edit planning, use `sunfall-arc-start impact`; for topology questions rather
than repair lists, use `sunfall-arc-start graph`.
It projects the resolved diagnostics into a typed agent graph with Route,
Action, ServerFunction, ResourceFamily, ResourceTag, Endpoint, Module, and
Finding nodes plus self-review facts for policy cleanliness, wire
schema completeness, and route preload declarations.
Queries are positional and stay JSON-safe:

```sh
sunfall-arc-start impact route /projects/:id
sunfall-arc-start impact action Project.rename --json
sunfall-arc-start graph route /projects/:id
sunfall-arc-start graph route /projects/:id --verbose
sunfall-arc-start graph action Project.rename --json
```

The same projection is available in code through
`createStartAgentGraph(...)`, `queryStartAgentGraph(...)`, and
`formatStartAgentGraph(...)`. `createStartAgentGraphImpact(...)` and
`formatStartAgentGraphImpact(...)` collapse that map into the high-signal edit
brief agents usually need: edit target, contracts to preserve, dependencies,
possible blast radius, warnings, and verification commands. The default graph
text formatter is a concise agent/human briefing; `--verbose` keeps the raw node
ids, facts, and edges for debugging, while `--json` remains the machine payload.

App graph diagnostics are copied through a structured App Graph Summary seam.
Typed arrays such as route modules are preserved even when they exceed generic
serialization entry limits; bounded serialization applies only to unknown leaf
payloads.

## Golden Path

The full-stack golden path should be explainable from public diagnostics and
Effect-native event streams:

- Start app graph diagnostics expose the static facts: matched route modules,
  server function modules and RPC endpoint, action modules and action endpoint,
  schema coverage, action invalidation/optimistic/retry/concurrency metadata,
  route preload resource declarations, resource families (with their `rows`
  indexes and change feeds), and resource tags.
- `Route.planNavigation(...)` exposes the route facts: matched href,
  params, search, preloaded resource refs, and the resource hydration count.
  Start request traces also carry route-plan hydration resource keys so the
  graph can link exact `Hydrates` edges for streamed request payloads.
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
  is always present. Its target is the Program, Action, or Resource its cause
  names; a `Transition` cause (a named `Component.callback`, stream,
  or `Signal.batch`/`Signal.transaction`) has no fact target and is read by its
  label. Unnamed Programs share the `Program` target, so name Programs that
  should appear separately.
- `store.recordRequestTrace(trace)` exposes the request-level join across
  request context, response context, services, route plans, resources, server
  functions, actions, streams, fibers, and teardown.
- `createRequestHandler(..., { onRequestTrace })` emits that shape for SSR,
  server RPC, Start action, response stream-close, stream-cancel, and
  request-failure paths. Teardown records reason, duration, and before/after
  Resource Store snapshots.
- `Resource.planInvalidation(...)` and action invalidation plans expose
  the semantic invalidation facts: targeted tags/refs, matched live resources,
  and the exact causes for each invalidated resource.

Adapters record those facts into `Devtools.makeStore()` through its Effect
methods. `getSummary()` then provides route, invalidation, runtime, and
request/resource inspectors, while `getCausalGraph()` links the golden
path with deterministic edges such as request trace `UsesEndpoint`, request
trace `Records` resources/actions/server functions, route plan
`Matches` route, route plan `Preloads` and `Hydrates` resource, action `Emits`
invalidation, invalidation `Targets` tags, tag `Causes` resource invalidation,
and runtime events `Observes` resources, programs, actions, and
request traces.

Runtime event ids are unique per sequence/tag pair. When a host supplies a
duplicate sequence for the same event tag, the Store rebases the later event to
the next available sequence before summary or graph projection. Invalidation and
route-plan event links use the shared Devtools Serialization Policy fingerprint,
so equivalent fact objects still match when object keys arrive in a different
insertion order. Causal graph edge ids use framed identity parts rather than
delimiter concatenation, and imported request traces normalize before Store
limits decide which trace facts remain attached.

## Panel Model

`Devtools.describePanels(...)` and `store.getPanels()` provide the first
UI-facing panel contract. The result is JSON-safe and ordered for direct
rendering:

- App Graph
- Routes
- Resources
- Actions
- Programs
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
Program items include event-level rows for messages, before/after snapshots,
command lifecycle events, emitted follow-up messages, subscription events,
failures, and disposal, plus per-program summary rows.

## Browser Panel Renderer

`Devtools.renderPanelsHtml(...)` turns the panel contract into deterministic HTML
for a browser-embedded panel, documentation preview, or app shell:

```ts
const html = Devtools.renderPanelsHtml({
  panels: yield * store.getPanels(),
  selectedPanelId: "requests",
  maxItemsPerPanel: 12,
});
```

The renderer is dependency-light and escapes all panel text/data before writing
HTML. Each rendered item carries `data-sunfall-arc-devtools-item-id`, and the
panel contract rejects duplicate item ids within a panel so extension rows,
tests, and agent tools can rely on stable row identity. Browser hosts that want
lifecycle ownership can mount the same contract through Effect:

```ts
yield *
  Devtools.mountPanels({
    root: document.getElementById("sunfall-arc-devtools")!,
    panels: yield * store.getPanels(),
  });
```

The scoped mount clears the root and removes tab listeners when the Effect scope
closes. Use `mount.update(...)` when a host shell wants to refresh the panel
after recording new devtools facts.

Apps that want browser extensions to read the same panel payload can expose an
inspected-window bridge through the devtools package:

```ts
yield *
  Devtools.installBridge(() => ({
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

- App Graph: routes, route modules, server functions, actions, resources,
  schemas, endpoints, and module ownership.
- Route Inspector: matched route, params, search, declared preload ownership,
  concrete preloaded refs, and hydration payloads.
- Resource Timeline: pending, success, failure, interruption, hydration,
  invalidation, deletion, GC scheduling, and stale/refresh state.
- Action Timeline: `AsyncResult` tag plus `waiting`, input, concurrency,
  optimistic work, invalidation plan, Start transport metadata, and hydration
  payload.
- Program Timeline: messages, before/after model snapshots, command
  starts/completions/failures, emitted follow-up messages, subscription events,
  typed failures, and disposal.
- Request Trace: request context, response context, server functions, actions,
  resources, streams, fibers, interruption, and teardown.
- Diagnostics Repair: missing schemas, unknown preload ownership, unsafe
  modules, and exact owner/edit guidance.

Each panel should be backed by serializable data that can also be used by tests,
CI, browser extensions, and agents.
