# Best Full-Stack Framework Plan

Effect UI should become the framework where TypeScript, Effect, the compiler,
the runtime, devtools, tests, and agents all agree on one application model.

The goal is not to clone React, Solid, Next, Remix, TanStack Start, TanStack
Query, TanStack DB, Jotai, or Relay. The goal is to absorb the useful work they
do and replace the missing guarantees with a system that is more explicit, more
typed, more inspectable, and more honest about where effects run.

## North Star

Effect UI is the full-stack framework for apps whose correctness matters.

An app developer should be able to define domain facts once and have the whole
stack understand them:

- schemas define the wire format and nominal domain meaning;
- routes define typed navigation and preload ownership;
- resources define cached async reads and semantic tags;
- collections define normalized local data, indexes, persistence, and sync;
- actions define user-triggered mutations, optimistic work, retries, typed
  results, and invalidation;
- server contracts define browser-safe clients and server-only handlers;
- capabilities define app services and test seams;
- the generated app graph makes all of those facts inspectable.

The result should feel direct in component code, like a modern fine-grained UI
framework, but the hard parts should be owned by Effect:

- dependency injection through `Layer` and services;
- typed errors and recovery through tagged errors and `Effect.catchTag`;
- retries through `Schedule`;
- cancellation through fiber interruption;
- cleanup through `Scope`;
- request isolation through request-local runtimes and stores;
- streaming through `Stream`;
- observability through event streams and causal graphs.

## What Winning Means

Effect UI is competitive when it can ship a serious CRUD/product application
with routing, SSR, mutations, forms, optimistic updates, server functions,
deployment adapters, tests, and devtools.

Effect UI is winning when the same app is safer and easier to change than it
would be in the mainstream stack:

- invalid links fail at compile time;
- missing wire schemas fail in CI;
- server-only modules cannot enter the browser graph;
- async framework callbacks cannot accidentally return bare promises;
- server functions cannot drift from shared contracts;
- action invalidation is semantic and inspectable before refresh;
- hydration writes both visible UI state and Effect caches;
- request state cannot leak across users;
- tests replace services through layers and mocks instead of module tricks;
- devtools can explain the causal chain from route to preload to resource to
  action to invalidation to refreshed UI.

The product should make the correct path the ergonomic path.

## Strategic Pillars

### 1. One Typed App Graph

The app graph is the center of the framework. It should contain the static facts
about routes, resources, collections, actions, forms, server functions,
capabilities, schemas, preload ownership, invalidation vocabulary, endpoints,
and module ownership.

The graph must serve many callers:

- the compiler and Vite plugin use it to fail unsafe builds;
- type tests use it to prove public API rejection behavior;
- devtools use it to render topology;
- diagnostics use it to write repair reports;
- agents use it to find owners before editing code;
- docs use it as the shared vocabulary for examples.

The graph should never guess silently. Facts are `present`, `absent`, or
`unknown`; policy can turn `unknown` into a build failure when a team is ready.

### 2. Effect-Native Runtime Spine

Every meaningful async API returns an Effect. Promise boundaries exist only at
host and platform edges.

The Runtime Spine is responsible for:

- running app work inside an `EffectUiRuntime`;
- providing request services, app services, and resource stores;
- owning request-local `ResourceStore` and `Collection.Store` instances;
- interrupting scoped fibers on component, route, request, or stream disposal;
- preserving retries, cancellation, clocks, scopes, tracing, and services
  across client, SSR, server RPC, tests, and adapters.

This is how the framework stays smaller than a pile of ad hoc abstractions.
Effect already gives us the primitives; Effect UI should compose them into app
semantics rather than hide them.

### 3. Data As Domain Facts, Not Cache Keys

Effect UI should replace the TanStack Query mental model with a stronger graph:

- `Resource.family` is a typed async read definition;
- successful resource values publish semantic `Resource.tag` facts;
- `Action.define` invalidates domain facts, not strings;
- `ActionResult` can carry invalidations with success, validation, redirect, or
  domain failure results;
- `Resource.planInvalidationEffect` explains which live refs will refresh and
  why;
- runtime events publish invalidation before refresh, then pending/success or
  failure after refresh.

Collections and live queries cover normalized data:

- keyed rows live in a runtime/request-local collection store;
- secondary indexes make common joins and lookups explicit;
- optimistic mutations are durable facts with rollback rows;
- persistence and hydration preserve pending local work;
- sync adapters connect server functions, host APIs, local-first engines, and
  external query clients without changing app definitions.

### 4. Full Stack And Client Only, Same Core

The framework must work as a client-only UI system and as a full-stack app
framework.

Client-only apps get:

- fine-grained signals;
- resources, collections, actions, forms, and router scopes;
- Effect runtime services and test layers;
- devtools event streams and causal summaries.

Full-stack apps add:

- SSR request runtimes;
- server contracts, clients, and handlers;
- action and server function manifests;
- progressive form/action endpoints;
- streamed hydration chunks;
- server response services for status, headers, and cookies;
- deployment adapters.

The full-stack layer should not fork the programming model. A resource should
look like a resource, whether its load path uses a browser RPC client, a local
server handler during SSR, a mock layer in tests, or a client-only service.

### 5. Compiler Wall Before Runtime Surprise

The framework should push every possible mistake left:

- route params and search are schema-inferred and compile-time checked;
- generated route files assert source route literals against manifests;
- duplicate routes and malformed dynamic segments fail before runtime;
- server functions require schemas for wire types;
- browser graphs cannot import server handler modules;
- async framework callbacks reject promise returns;
- action behavior metadata can be required by build policy;
- route preload resource and collection declarations can be required by policy;
- branded ids prevent random strings from crossing domain seams.

Runtime tests still matter, but compile-time rejection is a product feature.
Every new rejection rule gets a type test.

### 6. Progressive Enhancement Without A Second App

Actions and forms should not split into "JS app" and "HTML fallback" versions.

One `Action.define` should support:

- component event handlers through `action.submitEffect`;
- event helpers that fork or run `action.submitEffect` at the host boundary;
- JSON Start action clients through `submitStartActionEffect`;
- Action-like full-stack state through `StartAction.use`;
- plain form posts through `startActionForm`;
- validation, redirects, domain failures, success data, invalidation metadata,
  and hydration payloads.

The no-JS path should run the same schemas, services, retries, errors,
capabilities, and invalidation rules as the rich client path.

### 7. Devtools As Causal Truth

Devtools should not inspect private maps and should not present vague timelines.
They should consume public Effect facts:

- app graph diagnostics for static topology;
- route plans for concrete navigation;
- resource event streams for load, failure, hydration, deletion, GC, and
  invalidation events;
- collection event streams for load, mutation, persistence, and sync facts;
- action state and invalidation plans;
- Start action serialized metadata;
- server RPC traces and request runtime traces.

The output is a deterministic causal graph:

- route matches route plan;
- route plan preloads and hydrates resources;
- action emits invalidation;
- invalidation targets tags and refs;
- tag causes resource invalidation;
- resource event observes pending/success/failure;
- server function and action use endpoints and modules;
- schema diagnostics point to missing contracts.

When something breaks, the framework should explain what happened, where, why it
matters, and how to fix it.

### 8. Testing And Mocking As First-Class Design

The best framework cannot require brittle module mocking.

App code should depend on capabilities and contracts:

- shared contract modules define schemas and clients;
- server handler modules implement contracts;
- tests provide `Server.mock`, `Server.mockLayer`, and capability layers;
- resources and actions depend on capabilities, not global clients;
- route preloads and actions can run inside test runtimes with fake services.

Every release should preserve:

- one verification command;
- runtime lifecycle tests;
- integration tests over the reference app;
- type tests for compile-time rejection rules;
- manifest tests for deterministic generated artifacts;
- leak scans for server-only code in client bundles.

### 9. Agent-Native Development

AI agents are not an afterthought. They are a forcing function for explicit
architecture.

The framework should provide:

- deterministic generated route/app graph files;
- diagnostics grouped by source owner;
- repair reports with concrete edit guidance;
- stable domain vocabulary in docs;
- golden examples that show the preferred pattern;
- small, typed APIs that let agents change one feature without inferring hidden
  runtime behavior.

If an agent can safely add a full-stack feature, a human team can too.

## Ergonomic Target

The end-state API should feel like this:

```ts
export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  output: Project,
  error: ProjectError,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
  policy: {
    staleFor: "30 seconds",
    gcFor: "5 minutes",
    retry: Schedule.exponential("100 millis").pipe(Schedule.take(3)),
  },
});

export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: Project,
  error: ProjectError,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectTag({ id: project.id })],
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
});
```

Component code should stay compact:

```tsx
const project = useResource(() => ProjectById(props.id));
const rename = StartAction.use(RenameProject, { runtime });

return project.match({
  initial: () => <ProjectSkeleton />,
  pending: (previous) =>
    previous ? <ProjectView project={previous} refreshing /> : <ProjectSkeleton />,
  success: (value) => <ProjectForm project={value} action={rename} />,
  failure: (error, previous) =>
    previous ? <ProjectView project={previous} error={error} /> : <ProjectError error={error} />,
});
```

The power is not in ceremony. The power is that the compiler, runtime, server,
cache, form, router, action transport, hydration, tests, and devtools all know
what `ProjectId`, `ProjectById`, `ProjectTag`, and `RenameProject` mean.

## Roadmap

### Phase A: Alpha Foundation

The alpha proves the model works end to end.

- Keep `pnpm verify` green as the release gate.
- Stabilize core `Signal`, `Resource`, `Action`, `Route`, `Server`,
  `Capability`, and `Form` APIs.
- Keep TSRX support through the Solid target and `tsrx-tsc`.
- Keep resource/action APIs Effect-native, with UI code running or forking
  Effects explicitly.
- Finish the reference project console as the proof app.
- Ensure every alpha API has runtime tests, type tests, or an explicit reason it
  is outside the current bar.

### Phase B: Data And Mutation Leadership

This phase makes Effect UI clearly better than query/mutation libraries.

- Complete resource lifecycle status: stale, refreshing, previous value, GC,
  failure retention, retry, hydration, events, and invalidation.
- Complete action lifecycle: concurrency, interruption, optimistic commit,
  rollback, typed failures, result-carried invalidation, and Start transport
  metadata.
- Complete collection ergonomics: secondary indexes, live queries, optimistic
  queues, persistence, sync adapters, background flush policy, and hydration.
- Add devtools panels for resource status, action status, collection rows,
  pending mutations, and invalidation plans.
- Add examples for search, optimistic edit, validation, redirect, local
  persistence, background sync, and server-posted invalidation.

### Phase C: Compiler And Build Leadership

This phase makes the build graph feel inevitable.

- Harden generated route trees and type maps.
- Expand route manifest validation and diagnostics.
- Enforce server-only module isolation in production and dev.
- Enforce required schemas through build policy.
- Enforce route preload resource and collection declarations through build
  policy.
- Generate app graph artifacts that are stable enough for CI, devtools, and
  agent workflows.
- Add actionable diagnostics for every build failure.

### Phase D: Full-Stack Production Readiness

This phase makes outside users able to ship.

- Stabilize package exports and naming.
- Provide a starter template and full-stack reference app.
- Ship Node, serverless, edge/fetch, SPA-only, custom-server, and static-host
  deployment guides.
- Add authentication, cookies, redirects, file uploads, streaming, and API route
  examples.
- Add benchmark suites for SSR, hydration, resource cache behavior, action
  latency, live query updates, and dev build graph generation.
- Add migration docs from React Query/TanStack Start/Remix-style stacks.

### Phase E: Groundbreaking Runtime Intelligence

This is where the framework becomes more than a safer clone.

- Build request runtime traces: services, fibers, resource stores, server
  functions, actions, response context, streamed chunks, and teardown.
- Build a unified app graph/devtools explorer that overlays static ownership and
  runtime facts.
- Record causal traces for server RPC and action calls, separating domain
  failures, validation failures, redirects, protocol errors, transport errors,
  defects, and interruption.
- Let diagnostics compare static declarations with runtime observations and
  report drift.
- Give agents stable machine-readable plans for common edits: add route, add
  resource, add action, add form, add server contract, add collection.

### Phase F: Local-First And Distributed Apps

Once the core is proven, Effect UI can use the same model for harder apps:

- offline-first collections and durable mutation queues;
- sync adapters for Electric, PowerSync, Replicache-shaped protocols, custom
  WebSocket feeds, and server-sent events;
- edge/request-scoped caching with semantic invalidation;
- actor/workflow integration through Effect services;
- multi-tab and worker runtimes;
- trace propagation across browser, server, worker, and database boundaries.

## Competitive Replacement Map

Effect UI replaces multiple libraries with one coherent model:

- React state libraries become `Signal`, `Signal.derive`, scoped `watch`, and
  Effect `Stream` adapters.
- React Query becomes `Resource`, `Action`, semantic tags, invalidation plans,
  retry schedules, and hydration.
- TanStack Router/Start become schema routes, file-route generation, SSR request
  runtimes, server contracts, Start actions, and typed hydration.
- TanStack DB becomes `Collection`, secondary indexes, live queries, optimistic
  queues, persistence, sync adapters, and Start collection hydration.
- Form libraries become `Form` plus schema-derived fields and `ActionResult`.
- RPC layers become `Server.contract`, browser-safe clients, server-only
  handlers, manifests, and typed transport errors.
- Module mocking becomes `Capability` layers and `Server.mockLayer`.
- Ad hoc devtools become deterministic app graph diagnostics and runtime causal
  graphs.

The replacement only wins if each piece is better in isolation and far better in
combination.

## Non-Negotiables

- Effect forms are the native API.
- Promise boundaries are adapters.
- Schemas define every wire boundary.
- Branded types protect domain ids.
- Tagged errors model recoverable failures.
- Runtime state is scoped to the active runtime or request.
- Server-only code cannot leak into browser bundles.
- Invalidation uses semantic tags or refs, never route names or cache-key
  strings.
- Generated artifacts are deterministic and source-attributed.
- Every compile-time rule has a type test.
- Every lifecycle promise has a runtime test.
- Devtools and diagnostics use public facts, not private maps.
- The reference app must prove the happy path and the failure paths.

## Decision Principles

When a design is unclear, choose the path that:

1. preserves Effect semantics instead of hiding them;
2. makes invalid states unrepresentable or at least test-rejected;
3. keeps runtime state scoped and disposable;
4. names domain facts explicitly;
5. gives agents and humans an inspectable artifact;
6. improves the golden path without weakening escape hatches;
7. avoids framework-specific mini languages when Effect already has the
   primitive.

The framework should feel magical only after inspection. Underneath, it should
be plain, typed, generated, scoped, and explainable.
