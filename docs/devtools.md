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
  runtime events, endpoints, and modules. Route preload ResourceFamily nodes
  prefer app graph definitions when present, so schema, tag, and policy depth
  is not lost when preload facts arrive before app graph facts.
- `DevtoolsPanels` is the shared UI-facing contract for app shells, browser
  extensions, agents, tests, and HTML renderers. Runtime guards and bridge
  payload normalization live in `@effect-ui/devtools` so hosts do not need to
  duplicate panel validation logic.
- `DevtoolsStore` is an explicit public Interface for recording snapshots,
  app graph diagnostics, route plans, invalidations, runtime events, summaries,
  Program timeline events, panels, and causal graphs. Store record methods
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
const store = makeDevtoolsStore();

yield * store.recordResourceEventEffect(event);
yield * store.recordRequestTraceEffect(trace);
const snapshot = yield * store.getSnapshotEffect();
const summary = yield * store.getSummaryEffect();
const graph = yield * store.getCausalGraphEffect();
const panels = yield * store.getPanelsEffect();
```

Actions can be observed directly from their public instance. The observer is
scoped, records action state transitions as runtime events, and links successful
states to the action's invalidation plan when one exists:

```ts
yield * store.trackActionEffect(renameAction);
```

Full-stack Start actions expose the same causal shape as serialized JSON
metadata. Adapters can record that metadata without importing Start into
devtools:

```ts
yield *
  store.recordActionStateEffect("Project.rename", "Success", {
    input: { id: "atlas" },
    serializedInvalidationPlan: startAction.invalidation.get(),
  });
```

For the common case, Start-shaped action instances are observable directly. The
type is structural, so devtools stays independent of the full-stack package:

```ts
yield * store.trackStartActionEffect(renameStartAction);
```

Programs are observed from the public Program instance, not from private queues
or fibers. The raw Program keeps its typed timeline signal, while devtools copies
each event through the bounded serialization and redaction policy before
summaries, panels, bridges, or causal graphs inspect it:

```ts
yield * store.trackProgramEffect(projectProgram);
```

The default policy redacts common secret-shaped keys such as passwords, tokens,
API keys, credentials, cookies, and authorization fields. Hosts can add
application-specific keys at the store boundary:

```ts
const store = makeDevtoolsStore({
  serializationPolicy: {
    redactKeys: ["tenantSecret", /private/i],
  },
});
```

Start request handlers can emit a structurally compatible request trace without
making `@effect-ui/start` depend on `@effect-ui/devtools`:

```ts
const handler = createRequestHandler(app, {
  onRequestTrace: (trace) => store.recordRequestTraceEffect(trace),
});
```

The plain methods remain for host adapters, but framework internals and tests
should prefer the Effect methods so observation composes with services, scopes,
and interruption. Those plain methods intentionally live on the store object as
host-boundary facades over the same Effect implementation; only split them out
if a future host package needs a separate boundary.

Start request handling also emits Effect-native observability alongside the
plain trace payload. `@effect-ui/start` exports `startRequestCountMetric`,
`startRequestDurationMetric`, and `startRequestStatusMetric`; the handler wraps
requests in an `effect-ui.start.request` span, and server RPC/action calls in
child spans. Effect loggers receive request annotations such as request id,
transport, method, and path.

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
`virtual:effect-ui/app-graph`. The static `virtual:effect-ui/app-graph` module
is topology-only; route-module/resource/collection diagnostics live behind the
explicit `virtual:effect-ui/app-graph/runtime-diagnostics` import, which also
exports typed `diagnosticsPolicyViolations` for devtools and agent consumers.
Use
`loadStartAppGraphDiagnostics(...)` from `@effect-ui/start/vite` when a CI
script wants to run the same resolved diagnostics gate through Vite and consume
the resulting `diagnostics` object. The same path is available as
`effect-ui-start diagnostics --root .`; pass `--json` when the caller wants the
resolved graph payload. The default CLI output is an agent-readable repair
report grouped by source owner, with concrete edits for missing wire schemas,
unknown action behavior metadata, and route preload resource/collection
declarations.
For edit planning, use `effect-ui-start impact`; for topology questions rather
than repair lists, use `effect-ui-start graph`.
It projects the resolved diagnostics into a typed agent graph with Route,
Action, ServerFunction, ResourceFamily, ResourceTag, Collection, Endpoint,
Module, and Finding nodes plus self-review facts for policy cleanliness, wire
schema completeness, known action behavior, and route preload declarations.
Queries are positional and stay JSON-safe:

```sh
effect-ui-start impact route /projects/:id
effect-ui-start impact action Project.rename --json
effect-ui-start graph route /projects/:id
effect-ui-start graph route /projects/:id --verbose
effect-ui-start graph action Project.rename --json
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
  route preload resource and collection declarations, resource families,
  resource tags, and DB collection definitions.
- `Route.planNavigationEffect(...)` exposes the route facts: matched href,
  params, search, preloaded resource refs, and the resource hydration count.
  Start request traces also carry route-plan hydration resource keys so the
  graph can link exact `Hydrates` edges for streamed request payloads.
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
- `store.trackProgramEffect(program)` exposes Program message, command,
  subscription, failure, and disposal timelines without reading private runtime
  queues. Anonymous tracked Program instances receive stable per-store fallback
  identities such as `Program#1` so multiple unnamed Programs do not collapse
  into one panel or graph target.
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
and runtime events `Observes` resources, collections, programs, actions, and
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

`describeDevtoolsPanels(...)` and `store.getPanelsEffect()` provide the first
UI-facing panel contract. The result is JSON-safe and ordered for direct
rendering:

- App Graph
- Routes
- Resources
- Actions
- Programs
- Collections
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

`renderDevtoolsPanelsHtml(...)` turns the panel contract into deterministic HTML
for a browser-embedded panel, documentation preview, or app shell:

```ts
const html = renderDevtoolsPanelsHtml({
  panels: yield * store.getPanelsEffect(),
  selectedPanelId: "requests",
  maxItemsPerPanel: 12,
});
```

The renderer is dependency-light and escapes all panel text/data before writing
HTML. Each rendered item carries `data-effect-ui-devtools-item-id`, and the
panel contract rejects duplicate item ids within a panel so extension rows,
tests, and agent tools can rely on stable row identity. Browser hosts that want
lifecycle ownership can mount the same contract through Effect:

```ts
yield *
  mountDevtoolsPanelsEffect({
    root: document.getElementById("effect-ui-devtools")!,
    panels: yield * store.getPanelsEffect(),
  });
```

The scoped mount clears the root and removes tab listeners when the Effect scope
closes. Use `mount.update(...)` when a host shell wants to refresh the panel
after recording new devtools facts.

Apps that want browser extensions to read the same panel payload can expose an
inspected-window bridge through the devtools package:

```ts
yield *
  installDevtoolsBridgeEffect(() => ({
    panels: store.getPanels(),
    selectedPanelId: "requests",
    title: "Effect UI Devtools",
  }));
```

The scoped bridge restores any previous `globalThis.__EFFECT_UI_DEVTOOLS__`
value when the Effect scope closes. The plain `installDevtoolsBridge(...)`
helper is available for non-Effect host setup. Extension transports should
resolve inspected-window values with
`resolveEffectUiDevtoolsBridgePayload(...)` before rendering so invalid bridge
payloads can be reported as typed diagnostics instead of collapsing to
`undefined`. This applies the same panel id, severity, metric, item,
finite-number, plain-record, bounded string, and JSON-safe data checks used by
the package tests. Oversized display strings are truncated at the bridge seam,
oversized item lists are windowed with a deterministic overflow row, and
oversized item data object keys are rejected so richer renderers do not silently
rename structured data. Use `normalizeEffectUiDevtoolsBridgePayload(...)` only
when a host deliberately wants the weaker optional payload facade and does not
need contract error details.

The checked app-shell integration lives at
[`examples/devtools-panel`](../examples/devtools-panel). It mounts sample
public facts through `mountDevtoolsPanelsEffect(...)` and verifies typecheck,
render output, and production build.

The checked browser-extension shell lives at
[`examples/devtools-extension`](../examples/devtools-extension). It emits a
Manifest V3 devtools page, registers `panel.html` through the browser devtools
panel host, mounts the same public panel contract through
`mountDevtoolsPanelsEffect(...)`, and reads live inspected-page panel payloads
from `globalThis.__EFFECT_UI_DEVTOOLS__` through
`chrome.devtools.inspectedWindow.eval`. The bridge accepts either a
`DevtoolsPanels` payload wrapper or a provider function returning that wrapper,
uses the shared `effectUiDevtoolsBridgeGlobal` key from `@effect-ui/devtools`,
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
  collections, schemas, endpoints, and module ownership.
- Route Inspector: matched route, params, search, declared preload ownership,
  concrete preloaded refs, collection preload, and hydration payloads.
- Resource Timeline: pending, success, failure, hydration, invalidation,
  deletion, GC scheduling, and stale/refresh state.
- Action Timeline: idle, pending, success, failure, input, concurrency,
  optimistic work, invalidation plan, Start transport metadata, and hydration
  payload.
- Program Timeline: messages, before/after model snapshots, command
  starts/completions/failures, emitted follow-up messages, subscription events,
  typed failures, and disposal.
- Collection Inspector: row counts, indexes, live query plans, pending
  mutations, persistence, sync adapter, and rollback facts.
- Request Trace: request context, response context, server functions, actions,
  resources, collections, streams, fibers, interruption, and teardown.
- Diagnostics Repair: missing schemas, unknown preload ownership, unknown
  action behavior, unsafe modules, and exact owner/edit guidance.

Each panel should be backed by serializable data that can also be used by tests,
CI, browser extensions, and agents.
