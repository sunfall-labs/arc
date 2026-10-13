# Changelog

Sunfall Arc is pre-release. Framework packages publish under the `@sunfall`
npm scope with the `alpha` dist-tag (see [CONTRIBUTING.md](CONTRIBUTING.md)).
Entries are newest first.

## Unreleased (since 0.1.0-alpha.1)

Nearly every public API changed since 0.1.0-alpha.1. This section describes
the net change: what an app written against alpha.1 finds now, grouped by
area. [Migration notes](docs/migration-notes.md) map each alpha.1 pattern to
its replacement.

### Platform And Packages (Breaking)

- Arc moves from Solid 1.9 to Solid 2.0 (release candidate) and from the
  Effect 4 beta to Effect 4 stable (imports move from `effect/unstable/*` to
  `effect/*`). Arc's async state is Effect's `AsyncResult`
  (`effect/reactivity`) everywhere.
- The packages are `@sunfall/arc-core` (plus `./internal` for adapter
  plumbing), `@sunfall/arc-db` (the Query engine), `@sunfall/arc-solid` (plus
  `./live-query`), `@sunfall/arc-start` (plus `./vite`, `./node`, `./fetch`,
  `./virtual`, `./testing`), `@sunfall/arc-devtools`, and `@sunfall/arc-tsrx`.
- Package roots export namespaces plus the values with no namespace home
  (error classes, Type IDs, guards, services, runtime helpers). Every public
  type has one name (`Action.Definition`, `Resource.Ref`, `Route.Match`,
  `Server.Client`, ...); cross-package plumbing types live in
  `@sunfall/arc-core/internal`.
- Naming rules applied everywhere: definition constructors are `define`
  (`Resource.define`, `Route.define`, `App.define`, `Component.define`,
  `Action.define`, `State.define`); an operation that returns an Effect takes
  the plain name and has no synchronous twin (`Resource.preload`,
  `Route.planNavigation`, `hydrateFromDocument`, `runtime.dispose`, ...); and
  each call has one form (`form.validate()`, `ActionResult.validation(...)`,
  `ActionResult.fromValidation(form.validate())`, `Route.href` /
  `Route.match`, `query.from(...)` inside the query factory).

### App Model And State (Breaking)

- Solid UI is built from typed Components only.
  `Component.define(name, function* (props) { ...; return () => <View /> })`
  runs its setup once per instance under the instance's Solid owner and
  Scope; render is the returned function. Setup-time bindings add their
  services to the Component's `R` and their render failures to its `E`:
  `Component.resource`, `action`, `state`, `stream`, `callback`, `router`,
  and `LiveQuery.bind` from `@sunfall/arc-solid/live-query`, with
  `Component.catchTags` / `catchAll` / `loading` / `provide`, and
  `Component.instance` as the seam for writing more. `Component.launch`,
  `mount`, and `embed` check `R` against their runtime. There are no hooks
  and no runtime context.
- `State` is the one writable client state: a named
  [effect-machine](https://github.com/cevr/effect-machine) machine.
  `State.define({ name, machine })` takes a `Machine.make({ state, event,
initial })` built from schema-first `Model({...})` variants and
  `Message({...})` messages (`Model`, `Message`, and `Machine` are exported
  from `@sunfall/arc-core`). Transitions are typed by (variant, message), and
  a message the current variant does not handle is ignored and recorded.
  Async work is state-owned (`task`, `spawn`): it starts on entering a
  variant, is interrupted on leaving it, and reports outcomes as messages.
  `Machine.replay(definition.machine, messages)` tests transitions without a
  runtime, and `State.history(entries)` reads an instance's messages back out
  of a Timeline. `Component.state(State)` returns a handle with `model()`,
  `dispatch`, one DOM-ready sender per tag (`onClick={menu.send.ClickedMenu}`),
  and `can.<Tag>(...)`. `scope: "app"` gives the runtime one shared instance
  (each Start request runtime gets its own, and the browser starts from the
  server's model); the default `scope: "component"` starts one per binding.
  `persist` restores a model from the runtime's `KeyValueStore`.
  `State.start(definition, { runtime })` starts an instance its caller owns.
- `Signal` is read-only in the public API (`Signal.Readable`, `derive`,
  `peek`, `untracked`, `changes`, `values`). Every state change commits under
  a name: a State message, an Action, a Resource or router event, or
  `Component.callback(name, f)` (committing as `<Component>.<name>`).
  `Component.stream(name, stream, initial)` and `Form.make({ name, ... })`
  take names too.
- `Timeline.record(options?)` records every committed change across the app
  (States, Resource entries, Action state, router state) with bounded
  retention; entries carry a cause (`Transition`, `State`, `Action`,
  `Resource`, `Router`) and `{ signal, name, previous, next }` changes, and
  `recording.travel(sequence)` / `resume()` render a past commit while live
  state keeps running.
- App services are Effect services: define one with
  `Context.Service<ProjectApi>("ProjectApi")` and provide it with a `Layer`;
  `ProjectApi.use(...)` joins the caller's `R` as before.
- `App.define({ root, routes, client?, head? })` is the one app definition,
  and `Effect.runFork(App.launch(app))` is the browser entry: it builds the
  client runtime (the client Layer, the action transport, the Action Outbox,
  an `HttpClient`, a `KeyValueStore`), restores the server's hydration
  payload, and hydrates the root.

### Resources And Rows (Breaking)

- `Resource.define` declares a family with a `load`, with `request` and
  `resolver` (batched loads), or, with `input` and `output` schemas and no
  `load`, as a served Resource (see Actions And Served Definitions). Its
  `error` is a schema (`Resource.ErrorSchema<E>`): a load fails only with the
  declared error, and a throwing or Promise-returning callback is a defect. A
  family without `error` fails renders with `ResourceUntypedFailure` (its tag
  only).
- `Resource.result(ref)` is an `AsyncResult`, and `Resource.status(ref)`
  reports it with staleness and GC timing. `Resource.preload` and
  `Resource.refresh` take one ref or an array; `Resource.evict` removes an
  entry; `Resource.hydrationPayload(refs)` snapshots loaded refs.
- The Solid reader is the one way to render Resource content: `reader(input)`
  suspends, keeps the current value across refreshes, and returns a
  fine-grained read-only view, so a binding re-runs only when the field it
  reads changes. Status chrome reads `reader.waiting(input)` and
  `reader.failure(input)`.
- Every new value of an entry shares its unchanged parts with the previous
  one (deep-equal parts keep their identity), whether it came from a refresh,
  invalidation, change feed, or optimistic patch.
- `rows: { key, indexes, changes }` on a Resource whose `output` is an array
  makes its value addressable rows: `reader.get(input, key)` and
  `reader.index(input, name, value)`, reloads diffed by key, and
  `rows.changes(input, rows)` streaming `Upsert` / `Update` / `Delete`
  batches into the synced rows. The browser starts a feed when it loads or
  hydrates the entry; server renders never start feeds.
- `policy.persist: { key, version }` persists settled values in the runtime's
  `effect/persistence` `KeyValueStore`; a never-loaded entry shows the
  persisted value at once and reloads in the background. Start provides a
  store on both sides (`localStorage` in the browser unless the client Layer
  provides one).
- Live queries read rows Resources: `query.from({ project: ProjectsRef })`,
  `Query.once`, `Query.live`, and `LiveQuery.bind(query)` in a Component. Apps
  that do not import `@sunfall/arc-solid/live-query` do not ship the Query
  engine.

### Actions And Served Definitions (Breaking)

- Actions are the one way to change data. `Action.define({ optimistic })`
  receives a transaction: `transaction.set(target, update)` patches a
  `State.Ref` or any Resource entry, and `transaction.insert` / `update` /
  `delete(ref, key, ...)` patch the rows of a rows Resource. Patches layer
  over the synced value for the life of the submission, fold in on success,
  and roll back on a failure, an interruption, or a rejected `ActionResult`
  (`ValidationFailure`, `Failure`), which also skips `invalidates`.
  `Action.planOptimistic(definition, input)` returns the changes a patch
  would make without a runtime.
- Served definitions: `Action.define` without `run` declares a served Action
  (`input` required, `output` defaulting to `Schema.Void`, `error`) and
  `Resource.define` with `input` and `output` and no `load` a served
  Resource. `Action.implement(definition, run)` and
  `Resource.implement(definition, load)` in `*.server.ts` modules are their
  server bodies, typed against the schemas. SSR calls a served load
  in-process and the browser over RPC; failures the `error` schema does not
  declare are defects. `ActionResult.Redirect` and
  `ActionResult.ValidationFailure` are Schemas for a served Action's
  `output`.
- Server functions (calls that are neither a load nor an Action) are
  `effect/rpc` Rpcs: `Server.contract(name, { input, output, error? })`
  requires its schemas and infers its types, `Server.client(contract)` calls
  it, and `Server.implement(contract, handler)` implements it.
  `Server.mockLayer(...)` takes `Server.mock(...)` handlers and
  implementations (`Resource.implement(Board, () => Effect.succeed(rows))`).
  `Server.Client` is nominal; build one with `Server.makeClient(call)`.
- `App.launch` provides the action transport: it submits exactly the served
  Actions over `POST /__sunfall-arc/action` (JSON only) through the client
  Layer's `HttpClient` (else `FetchHttpClient`), and an Action with `run`
  runs where it is submitted. Submissions fail with their own error or
  `Action.ClientError` (`ActionTransportError`, `ActionProtocolError`,
  `ActionNotFound`). The endpoint answers a validation failure with status
  200 and the `ValidationFailure` body.
- Durable Actions: `durable: { maxAge }` persists each submission in the
  Action Outbox (`KeyValueStore`) before it is sent, keeps its optimistic
  patch across reloads, and replays in order on launch, on `online`, and
  with backoff; `submit` fails with `ActionQueued` while a retryable failure
  leaves it pending, and `Action.outbox` exposes `pending`, `failures`, and
  `dismiss`. Start runs submissions with an id as `effect/workflow`
  Workflows scoped to the submitting browser (an HttpOnly submitter cookie),
  so a replayed POST returns the original response, and reports the ones it
  already settled in the hydration payload.
- Forms: `StartAction.form(action, { input })` returns `{ method,
hiddenFields }`, so the `<form method="post">` posts to the page it is on.
  Start runs a form-encoded or multipart POST to a page as the Action's
  submission: a redirect or success answers 303, and a validation failure
  renders the page again with status 422 (a failure with 400), where the
  Action's `Component.action` binding starts from the outcome and its
  `formValues()` returns the posted fields. Form decoding reads posted
  strings as the schema's encoded shape (checkboxes, repeated names, empty
  fields, numbers), so an Action's domain input schema decodes its form.
  `StartAction.decodeFormData(action, formData)` decodes exactly what the
  server decodes for the same form, defaults included.

### Routing And Head (Breaking)

- `Route.define(path, options)` is the one route constructor; a file route
  module exports `route = Route.define(...)`, and the generated route tree
  fails (as a type error and when it loads) if the declared path differs from
  the file's. Routes are addressed by definition only (`router.href(route)`,
  `Route.isMatch(route, match)`; `navigateHref(href)` stays for raw hrefs).
- A route's `preload` is the only declaration of what it loads: Start
  hydrates exactly the Resources the preload touched (`Route.planNavigation`
  reports them). A preload's failure is checked against the route's `error`
  schema; a route without one fails with `RoutePreloadUntypedFailure`.
- `Route.notFound()` and `Route.redirect(href, { status?, replace? })` end a
  preload with a verdict: Start answers 404 (rendering the app's not-found
  view inside its shell, with what the preload loaded) or a redirect, and
  client navigation settles `NotFound` or navigates. A URL whose path params
  fail the route's `params` schema is not found, not an error.
- `Route.define(path, { head })` derives the page's `title`, `description`,
  and `meta` from the match and the Resources the preload loaded, and
  `App.define({ head })` shapes every page's head (suffix, fallback,
  not-found and failure titles, shared tags). The server renders it, and
  `App.launch` keeps `document.title` and the head's `<meta>` tags in step
  after each navigation and when a Resource the head reads changes.
- Route components attach with `Route.withComponent(route, component,
props?)` or load as their own chunk with `Route.lazyComponent(importer)`;
  a file route's sibling `<route>.component.tsx` is attached lazily by the
  generated tree, and the server preloads a matched route's lazy component
  before rendering.
- `Component.router(routes)` creates an instance's router; `RouterOutlet`
  takes the `router` it renders. A navigation to the page already on screen
  (same route and params) keeps its component instance, States, and DOM and
  updates its props in place.
- `RouterLink` renders a plain anchor on the server, holds no preloader until
  the first hover or focus, and preloads on focus as well as hover.

### Start And Production Server (Breaking)

- `createRequestHandler(app, { server, implementations, document? })` is the
  server entry: `implementations` are the `Action.implement`,
  `Resource.implement`, and `Server.implement` values it serves, and the
  `server` Layer must provide their services and the root's, or the call
  does not compile. The handler is platform-neutral;
  `@sunfall/arc-start/fetch` and `@sunfall/arc-start/node` adapt it
  (`trustForwardedHeaders` defaults to `false`).
- Start renders its own document: the doctype, the page head, the
  `document`'s `lang`, `links`, `clientEntry`, and `headers`, the rendered
  root, the hydration payloads, and the entry script. A rendered page is one
  complete body, written with a `content-length` by the Node adapter; the
  request runtime is disposed as soon as the response exists.
- The RPC and action endpoints are fixed at `/__sunfall-arc/rpc` (an
  `effect/rpc` `RpcServer`, always `200` JSON messages) and
  `/__sunfall-arc/action`. RPC and action clients send the current span as
  `traceparent`/`b3`, so the server's request span joins the client's trace.
- Fibers the server render forks run with the request's services, and
  Resources the render itself loaded hydrate with the page beside the
  preload's.
- `vite build` with `sunfallArcStart` builds a server-rendered app for
  production: the client into `dist/client` with Vite's manifest, the server
  into `dist/server`, where `node dist/server/index.js` serves it on `PORT`
  and `HOST` and closes gracefully. `@sunfall/arc-start/node`'s
  `serve(handler, { clientDir, assets })` and `serveMain` are that server.
  Documents `modulepreload` the entry, its imports, and the matched route's
  lazy chunk, and the entry's modules are grouped into `vendor-*.js` and
  `app-*.js` chunks.
- The server build imports the server entry's handler by name (its
  `handlerExport`, else `default`, else `handleRequest`) and fails the build
  when the entry exports none of them. A server that cannot start fails with
  `StartNodeServeError`, whose message names the client build directory or
  the host and port (for example, that the port is already in use);
  `serveMain` prints it and exits with status 1.
- Static prerender runs through the app's handler, swaps in the built entry
  from Vite's build manifest, and writes the app's not-found page to
  `404.html`; unmatched URLs answer 404 everywhere.
  `buildPolicy.staticClient: { target: "static" }` compiles the RPC client
  out of the browser build (`forbidBrowserRpc`), and
  `makeStartStaticHistoryAdapter` hydrates client navigations from the target
  page's prerendered payload.
- Each request is a `sunfall-arc.start.request` Effect span whose attributes
  carry the route plan, failure kind, status, and runtime teardown.
- Server defects stay on the server. A served Resource load, server
  function, or Action that throws, dies, fails outside its declared `error`
  schema, or returns an output its schema cannot encode answers with an
  opaque defect (`StartServerDefect`, "The server failed to handle the
  request."), never the message, stack, or `Cause`; the full cause is logged
  at Error level with the request's `sunfall-arc.request.id`, which the
  response's `x-sunfall-arc-request-id` header carries. Action protocol
  errors no longer include stacks. The Node adapter's default error handler
  logs the cause behind its opaque `500 Internal Server Error`.
- File-route manifests are plain validated data from one generator,
  `generateFileRouteManifest`. Failed Vite dev SSR requests name the
  operation and the wrapped failure.

### Devtools (Breaking)

- `@sunfall/arc-devtools` exports the `Devtools` namespace plus
  `DevtoolsActionInvalidationPlanConflict` and `DevtoolsPanelContractError`:
  `Devtools.makeStore`, `describeSummary`, `describeCausalGraph`,
  `describePanels`, `renderPanelsHtml`, `mountPanels`, `bootPanels`,
  `installBridge`, `bridgeGlobal`, `resolveBridgePayload`, and
  `toSerializable`, with types as members (`Devtools.Store`,
  `Devtools.Panels`, ...).
- `Devtools.layerTracer(store)` records every ended span; the Requests panel
  projects request spans and their RPC and action children
  (`Devtools.Span`). The store records Timeline commits
  (`store.trackTimeline(recording)`), Action instances
  (`store.trackAction`), invalidation and route plans, and Resource events;
  the `states` panel shows States.

### Performance

- A Resource Store creates its event `PubSub` for its first subscriber, the
  Node adapter writes a complete body in one `end` (and copies a streamed
  body chunk by chunk with backpressure), and route matching sorts a route
  list once. Server CPU per request for the `benchmarks/compare` detail page
  (in process, 60 batches): p25 0.76 ms to 0.61 ms, median 0.93 ms to
  0.78 ms; sending the page as one complete body then took the production
  server's median from 0.66 ms to 0.54 ms (interleaved A/B, 12 rounds).
- Hydration payloads are copied once: the server's only copy is the schema
  encode, and the browser validates and decodes once. Server CPU per render
  of the 1,000-row compare list: p25 6.2 ms to 5.3 ms.
- `RouterLink` holds one state object and its handlers per link instead of
  thirteen closures and a `<Dynamic>`, and caches parsed route patterns.
  Measured on the 1,000-link compare list: server CPU per render of `/`
  18.2 ms to 10.3 ms, JS heap after load 12.0 MB to 8.25 MB, first click
  handled (4x CPU throttle) 528 ms to 455 ms.
- Moving `LiveQuery.bind` to its own entry dropped the compare app's JS from
  153.3 KB to 140.5 KB gzip (133.8 KB to 123.0 KB brotli).

### Removed

- Packages: `@sunfall/arc-react`, `@sunfall/arc-react-db`,
  `@sunfall/arc-solid-db`, and `@sunfall/arc-start-node` /
  `@sunfall/arc-start-fetch` (now `@sunfall/arc-start/node` and
  `/fetch`).
- Solid hooks and runtime context: `RuntimeProvider`, `useRuntime`,
  `useResource*`, `useAction`, `useProgram`, `useStream`,
  `useRuntimeEffect`, `useCollection`, `useLiveQuery`, and their handle
  types.
- `Program` (now `State`), with `Program.update`, `Program.story`,
  `Program.command` / `effect` / `dispatch`, and Program timelines (the
  Timeline replaces them); the public writable Signal API (`Signal.make`,
  `batch`, `transaction`, `fromStream`, `updateAndGet`, `Signal.Writable`).
- `Capability` (`define`, `layer`, `mock`, `provide`, `use`, `tag`).
- `Collection` and everything around it: sync adapters, local-only
  collections, pending-mutation queues, collection persistence and storage
  adapters, `Route` `preloadCollections`, `App.define({ collections })`,
  Start's collection hydration, and the devtools collection facts.
- Server APIs replaced by `effect/rpc` and served definitions:
  `Server.fn` / `stub`, `Server.manifest` and its codecs, `Server.route` /
  `handleRoute`, `App.define({ actions })`, `createRequestHandler`'s
  `serverFunctions`, `App.LaunchOptions.transport`, `StartFetch*`, and
  `StartAction.use` / `Instance` / `Result` / `State`.
- Start tooling: the `sunfall-arc-start` CLI (`diagnostics`, `graph`,
  `impact`), the agent graph and app graph, the `./diagnostics-report`,
  `./internal`, `./cli`, and adapter subpaths, the server-function and
  action manifest virtual modules and defines, `buildPolicy` options other
  than `staticClient`, and the endpoint options (`rpcPath`, `actionPath`,
  `endpoints`, `StartAction.form`'s `action`).
- Start rendering helpers: hand-written HTML shells,
  `createStartStreamedHtmlResponse`, `StartStreamError`, and
  `StartDocument`'s `title` and `meta`.
- Request trace callbacks: `onRequestTrace`, `StartRequestTrace`,
  `Devtools.RequestTrace`, and `store.recordRequestTrace`.
- `FileRoute.define`, the Vite plugin's `autoCodeSplitting`, path-keyed
  router helpers (`hrefByPath`, `navigateByPath`, ...) and generated maps.
- Every `*Effect`-suffixed export and its synchronous twin, and the flat
  type aliases of namespace members.

## 0.1.0-alpha.1

### Stable For The First External App

- Core runtime primitives: Signals, Programs, Resources, Actions, Forms, Routes,
  Capabilities, server contracts, scoped UI work, and request-local runtimes.
- Programs now have a compact tagged-handler front door:
  `Program.define({ initial, on })`, `Program.update(...)`, and
  `Program.emit(...)` turn exhaustive `_tag` handlers plus immediate or
  Effect-produced follow-up messages into the same Effect-owned model/message
  loop used by stories, timelines, subscriptions, and UI adapters.
  `Program.emit(...)` is the emits-on-success helper; no-message background
  work stays in `Program.effect(...)` or lower-level `Program.command(...)`.
- Public async library APIs return Effect v4 values; Promise-shaped entrypoints
  are reserved for explicit runtime, Suspense, stream, CLI, Vite, or host
  compatibility boundaries.
- LSP-facing JSDoc describes the purpose and composition model for the core,
  DB, Solid, Solid DB, Start, Node, and Fetch concepts.
- Start request handling: SSR, RPC, Start actions, hydration payloads, streamed
  HTML responses, request traces, and build diagnostics.
- Start agent graph and impact inspection: `sunfall-arc-start graph`,
  `sunfall-arc-start impact`, `createStartAgentGraph(...)`, and
  `createStartAgentGraphImpact(...)` expose the resolved app topology as typed,
  queryable route/action/resource/collection/module/finding facts plus concise
  edit briefs. Text output is concise by default, with raw graph ids/facts/edges
  behind `--verbose` and full machine payloads behind `--json`.
- Node and Fetch host facades: `@sunfall/arc-start-node` and
  `@sunfall/arc-start-fetch`.
- Devtools data contracts: snapshots, summaries, causal graphs, request traces,
  panel models, deterministic HTML rendering, the checked panel app shell, and
  the checked browser-extension shell with an inspected-window bridge.
- Local-first DB surface: Collections, live queries, persistence, sync adapter
  seams, mutation queues, and flush policies.
- Solid 2 adapter: runtime provider, router, Program hooks, Resource hooks,
  Action hooks, stream hooks, and collection hooks.
- Starter paths: `examples/basic-starter` for the smallest full-stack shell,
  `examples/project-console` for the golden-path app, and
  `pnpm starter:package` for generated standalone starter payloads.

### Experimental Or Expert-Public

- Start Vite helpers, virtual module helpers, diagnostics loaders, and generated
  app graph artifacts are public for CI, starter tooling, and agent workflows,
  but remain expert-facing.
- DB query builder internals intentionally keep a small cast boundary around
  joined context variance and the default projector.
- DB incremental live queries use a named `IOperator` bridge for the custom IVM
  flatMap operator instead of an inline bottom-type cast.
- DB query joins now carry selected projectors with a narrower direct function
  assertion; the remaining broad query casts are limited to predicate/order
  variance and the unprojected identity branch.
- Core and DB type-id declarations preserve `unique symbol` types with
  self-type assertions instead of `as never` bottom casts.
- Core runtime integration with Effect `ManagedRuntime` keeps a documented
  service-erasure boundary centralized behind `provideManagedServices(...)` and
  `provideRuntimeServices(...)`; `SunfallArcRuntime.provide(...)` exposes a scoped
  Effect for UI-scope forking.
- Core Capability helpers now use overloads for pure vs Effect-returning
  `useEffect(...)` callbacks and rely on `Effect.provideService(...)` return
  typing directly.
- Browser extension packaging is checked as an example shell, including a live
  inspected-app bridge that reads `globalThis.__SUNFALL_ARC_DEVTOOLS__`.
- Platform-specific packages beyond Node/fetch should wait for hosts that need
  real behavior beyond the generic facades and documented recipes.

### Notable Limits

- Framework packages are publishable public scoped packages versioned
  `0.1.0-alpha.1`.
- Package manifests include pre-release descriptions, MIT license metadata,
  author metadata, public scoped-package access, package keywords, and build
  metadata plus GitHub repository/homepage/bugs links. Final npm publication
  credentials are still open.
- The browser extension live bridge expects the inspected app to expose
  `globalThis.__SUNFALL_ARC_DEVTOOLS__`; automatic injection is not part of the
  checked shell.
- Generated starter payloads currently include local `.sunfall-arc-packages/*`
  file dependencies until the framework packages are actually published.
- Cloudflare, Vercel, Netlify, Bun, and static deployment currently use recipes
  over Node/fetch facades rather than dedicated packages.
