# Competitiveness Bar

Sunfall Arc is trying to compete with full-stack frameworks on product completeness
and beat them on correctness, observability, and Effect-native composition.

The product strategy is detailed in
[Best Full-Stack Framework Plan](./best-framework-plan.md). This document is the
competitive bar: what we must match, where we must surpass, and which proof
points show we are no longer merely experimental.

## Competitive Bar

- File routes generate typed route modules and server route manifests.
- Server functions have a production manifest with stable ids, duplicate
  detection, browser/server split enforcement, and typed client references.
- SSR supports request isolation, hydration payloads, streaming responses, and
  stream-lifetime request cleanup.
- Forms/actions support progressive enhancement, validation results, redirects,
  pending state, invalidation, and no-JS fallbacks through Start Action
  Requests.
- Deployment adapters cover Node, serverless, edge-compatible request handlers,
  SPA-only builds, and custom servers.

## Winning Bar

- One Resource Dependency Graph spans client, SSR, server functions, route
  preload, action invalidation, hydration, and devtools.
- Every request has an Effect-native Request Runtime with services, Resource
  Store, request context, scoped fibers, interruption, retries, and event
  streams.
- Every async public API is Effect v4 first; Promise-shaped entrypoints are
  compatibility host/UI adapters only.
- Async framework callbacks are rejected at compile time, forcing retries,
  cancellation, services, and typed errors to stay in Effect.
- Errors and redirects are typed data, not ambient thrown values.
- Devtools observe runtime facts through Effect streams instead of reading
  private framework state.
- Tests can replace app behavior with Capability layers and server mocks without
  importing server-only modules.

## How We Beat The Current Stack

| Current tool category | Why teams use it                               | Sunfall Arc winning replacement                                                                                                                |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| React state libraries | Local reactive values and derived state        | `Signal`, `Signal.derive`, scoped `watch`, and Effect `Stream` adapters with component-owned scopes                                          |
| TanStack Query        | Async reads, stale data, retries, invalidation | `Resource.family`, Effect `Cache`, `Schedule`, semantic `Resource.tag`, invalidation plans, hydration, and resource event streams            |
| Mutation helpers      | Pending state, optimistic updates, retries     | `Action.define`, typed concurrency, optimistic transactions, result-carried invalidation, typed failure state, and Effect retry/interruption |
| TanStack Router/Start | Typed routes, SSR, server functions            | Schema routes, file-route generation, request runtimes, server contracts, manifests, Start actions, and strict app graph diagnostics         |
| TanStack DB           | Normalized client data and live queries        | `Collection`, runtime-local stores, secondary indexes, optimistic queues, persistence, sync adapters, D2 live queries, and Start hydration   |
| Form libraries        | Field state and validation                     | `Form` with schema-derived field names and values, typed validation errors, and `ActionResult` progressive action results                    |
| RPC layers            | Type-safe client/server calls                  | `Server.contract`, `Server.client`, `Server.implement`, deterministic manifests, schema validation, and server-only module walls             |
| Test mocking tools    | Swap services and server behavior              | `Capability` layers, `Server.mock`, `Server.mockLayer`, request runtimes, and type-preserving schema validation                              |
| Framework devtools    | Inspect private runtime state                  | Generated app graph plus public Effect event streams and deterministic causal graphs                                                         |

The replacement must remain honest. If a category is not yet more ergonomic or
more correct than the incumbent, it stays an active win condition.

## Product Scorecard

Sunfall Arc is competitive when these are true:

- a new app can be created from a starter and deployed without framework-author
  intervention;
- the reference app proves SSR, hydration, route preload, collections, actions,
  validation, redirect, optimistic updates, and no-JS fallback;
- the docs show the golden path and the escape hatches;
- package exports are stable enough for external users;
- diagnostics make common mistakes obvious.

Sunfall Arc is winning when these are also true:

- strict mode can make route preload ownership, action behavior metadata, and
  schema completeness CI-enforced contracts;
- devtools can show the causal chain for a stale UI without reading private
  stores;
- a feature can be added by following generated graph facts instead of reading
  the whole app;
- tests can mock every external dependency through layers and contracts;
- a full-stack mutation can update the client resource graph through server
  action metadata without a duplicate fetch.

## Current Highest-Leverage Slices

- Golden-path full-stack loop: typed file routes, route preload, SSR hydration,
  progressive action validation/redirect, and branded Schema params in one
  reference flow.
- Resource/data ergonomics: Resource and Action should feel better than
  TanStack Query by making refresh state, invalidation plans, stale data,
  retries, and optimistic work explicit Effect-native values.
- Devtools causality: app graph diagnostics, route plans, invalidation plans,
  resource events, and request traces should collapse into one inspectable
  panel model.
- Production build wall: generated routes, manifests, schema coverage, server
  boundary checks, and deploy adapters should fail early with typed guidance.

## First Slices Landed

- Streaming SSR core: `createHtmlStreamEffect`, hydration chunks, typed stream
  errors, Web `Response` adapter, and request runtime cleanup on body close or
  cancellation.
- Server function manifest: deterministic `sf_*` ids, browser-safe client
  references, duplicate validation, and route manifest duplicate-path checks.
- Progressive action result model: typed success, validation failure, redirect,
  and domain failure data with invalidation ergonomics.
- Progressive Start actions: JSON/form POST endpoint, request-runtime action
  execution, HTTP redirects for typed redirects, typed validation payloads, and
  example no-JS form coverage.
- App graph artifact: a deterministic Vite virtual module/define that combines
  route, server function, and action manifests for agents and devtools.
- File-route definition module: validated manifests now import each route file's
  named `Route`, path-check it against the manifest, and write the default
  `src/routeTree.gen.ts` project file for routers, editors, and agents,
  including `routeById`, `routeByPath`, and route-id/path indexed params,
  search, and href-option type maps.
- Start app graph diagnostics: `describeStartAppGraph` and
  `validateStartAppGraphWireSchemasEffect` turn static topology into
  enforceable build/devtools facts.
- Effect-native transport hardening: RPC/action requests now validate method,
  accepted media, content type, request ids, tracing headers, and JSON response
  protocol through typed Effect errors.
- Typed streamed hydration chunks: SSR stream payloads use versioned,
  sequenced chunks that hydrate idempotently into explicit runtimes.
- File-route support metadata: generated manifests include route, layout, error
  boundary, and metadata modules with deterministic route metadata.
- Devtools causal graph substrate: summaries now include nodes and edges for
  routes, resources, actions, invalidations, schemas, modules, endpoints, and
  runtime events.
- Public deployment adapters: `@sunfall/arc-start-fetch` and
  `@sunfall/arc-start-node` expose host-shaped facades over the tested Start
  adapter implementation, with streaming Node responses, interruption,
  backpressure, and multi-cookie header handling.
- Request-scoped response services: render, preload, server functions, actions,
  and server routes can set status, headers, and cookies through Effect
  `ResponseContext`, and Start applies those facts to the final response.
- Collection retry policy: DB collection loads and optimistic mutation handlers
  use Effect `Schedule` just like Resource and Action, keeping retry semantics
  typed, scoped, and testable across all data primitives.
- Route ownership diagnostics: app graph diagnostics now expose route ids,
  source files, path params, and route-module feature presence for params/search
  schemas, preloads, and components.
- Route preload resource diagnostics: routes can declare expected preload
  resource families with `preloadResources`, and the virtual app graph resolves
  those declarations to `declared`, `none`, or `unknown`.
- Route preload resource diagnostics policy: resolved app graph diagnostics now
  expose `unknownRoutePreloadResources`, with an Effect validator that can fail
  CI/devtools policy when a route preload omits its resource-family declaration.
- Route preload collection diagnostics: routes can declare expected DB
  collections with `preloadCollections`, the virtual app graph resolves them to
  `declared`, `none`, or `unknown`, and diagnostics can fail policy when a route
  preload omits its collection declaration.
- Server/action ownership diagnostics: app graph diagnostics now expose stable
  ids, server exports, client references, module kinds, endpoints, and
  wire-schema completeness for each server function and action.
- Resource/action behavior diagnostics: resource definitions now expose family
  and tag vocabulary, and action manifests expose invalidation, optimistic,
  retry, and concurrency metadata with explicit `unknown` for hand-written
  manifests that have not opted in.
- Collection definition diagnostics: DB collection definitions now expose names,
  schema presence, load and mutation handler presence, retry policy, and
  persistence policy, and the virtual app graph publishes those facts for
  agents/devtools.
- Devtools graph consumption: summaries and causal graphs consume the richer
  Start graph, including route module ownership, server/action modules,
  resource families/tags, route-to-collection preload declarations, collection
  definitions, and action behavior counts.
- Opt-in build walls: Start build policy can reject unknown action
  invalidation/retry/concurrency metadata before Vite emits app graph defines,
  and the resolved virtual app graph can reject routes whose preload resource or
  collection declarations are still unknown.
- Scriptable resolved diagnostics: `loadStartAppGraphDiagnostics(...)` and
  `sunfall-arc-start diagnostics` let CI load the Vite-resolved app graph, execute
  the virtual diagnostics policy guard, and consume the same diagnostics object
  agents/devtools use.
- Agent-readable diagnostics reports: `sunfall-arc-start diagnostics` now defaults
  to a grouped repair report, and `@sunfall/arc-start/diagnostics-report` exposes
  the same report builder/formatter for bots that need exact owner and edit
  guidance.
- Agent-readable semantic graph: `sunfall-arc-start graph` and
  `createStartAgentGraph(...)` expose typed Route, Action, ServerFunction,
  ResourceFamily, ResourceTag, Collection, Endpoint, Module, and Finding nodes
  with deterministic edges and self-review facts. The default CLI output is a
  concise briefing, with raw graph detail reserved for `--verbose`, so agents
  can inspect app affordances before changing code without drowning in ids.

## Active Win Conditions

- A single example proves the whole full-stack story without hidden server
  imports or hand-waved progressive enhancement.
- A core resource/action API exposes enough query lifecycle information that
  app code does not reach for TanStack Query mental models.
- A devtools data model can explain what route, action, resource, server
  function, schema, and invalidation edge caused the current UI state.
- The Start build layer can turn graph diagnostics into CI failures with
  actionable, typed errors.
