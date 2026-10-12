# Changelog

Sunfall Arc is pre-release. Framework packages publish under the `@sunfall`
npm scope with the `alpha` dist-tag (see [CONTRIBUTING.md](CONTRIBUTING.md)).
Entries are newest first.

## Unreleased (since 0.1.0-alpha.1)

### Validation Results Are Answers, Not Transport Errors

- The action endpoint answers a JSON submission whose Action returned
  `ActionResult.validation(...)` with status 200 and the `ValidationFailure`
  body; the action transport reads it like any 2xx answer and rejects a
  validation body with another status as `BadStatus`. Browsers log every 4xx
  fetch as a console error, so ordinary form validation no longer does.

### Served Resources And Actions: Declared Once, Implemented On The Server

Found by `examples/tracker`, where every write took four definitions (a
`Server.contract`, its `Server.client`, its `Server.implement`, and an
`Action` whose `run` called the client) and every read three.

- `Action.define` without `run` declares a served Action: `input` (required),
  `output` (default `Schema.Void`), and `error` are its wire contract, and
  `optimistic`, `invalidates`, `durable`, and `policy` work as before.
  `Action.implement(definition, run)` in a `*.server.ts` module is its server
  body, typed against the schemas: `run` may succeed only with `output` and
  fail only with `error`. `ActionDefinition.run` is optional; a served Action
  submitted without a transport fails with `ActionNotFound`.
- `Resource.define` with `input` and `output` schemas and no `load` declares
  a served Resource. `Resource.implement(definition, load)` in a `*.server.ts`
  module is its load: a server function over the family's schemas (Rpc tag =
  the family name) that SSR calls in-process and the browser over RPC.
- A served load's failures that the `error` schema does not declare
  (`RpcClientError`, a wire `SchemaError`, `ServerFunctionNotFound`) are
  defects, so a Resource's type says exactly what can render and no load
  needs to strip `Server.ClientError` by hand.
- `ActionResult.Redirect` and `ActionResult.ValidationFailure` are Schemas for
  a served Action's `output` (a form-backed Action answers
  `Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure])`).
- `App.define` no longer takes `actions`: `App.launch`'s action transport
  submits exactly the served (run-less) Actions, and an Action with `run` runs
  where it is submitted. `createRequestHandler(app, { implementations })`
  replaces `serverFunctions` and takes `Action.implement`, `Resource.implement`,
  and `Server.implement` values (`StartImplementation`); the server Layer must
  provide their services, or the call does not compile.
- `Server.mockLayer` accepts implementations as well as `Server.mock` values,
  so a test answers a served Resource's load with
  `Server.mockLayer(Resource.implement(Board, () => Effect.succeed(rows)))`.
- `Server.contract`, `Server.client`, and `Server.implement` remain for server
  calls that are neither a load nor an Action (the tracker's change-feed poll).
- The tracker, project console, docs site, and compare benchmark use served
  definitions; `src/contracts.ts`, `domain.contract.ts`, `content.contract.ts`,
  and every `domainOnly`-style helper are gone.

### Hydration Payloads Are Copied Once

- Validating a Resource hydration payload checks its shape and no longer
  deep-copies every snapshot's input and value. A server render copied a
  1,000-row Resource four times on its way to JSON (schema encode, a clone,
  and two validations), and the browser validated the parsed payload twice
  (once discarded) before decoding it. Now the server's only copy is the
  schema encode (or a clone for a family without schemas, so a payload never
  aliases Resource state), and the browser validates once and decodes once.
- Server CPU per render of the `benchmarks/compare` list (1,000 rows, in
  process, 60 batches): p25 6.2 ms to 5.3 ms.

### Lower Fixed Cost Per Request

- A Resource Store creates its event `PubSub` for its first subscriber
  instead of on creation. A store nobody watches, like each SSR request's,
  no longer allocates a 1,024-slot buffer per request; publishing to it is
  free, as before nothing received it.
- The Node adapter copies a Web `Response` body to the `ServerResponse`
  chunk by chunk (waiting for `drain`) instead of `stream.pipeline` over
  `Readable.fromWeb`, which built a Node stream and an abort signal (and a
  `DOMException` on every finish) per request. A client that disconnects
  mid-body still cancels the body.
- Route matching orders a route list once (by specificity) instead of on
  every match.
- Server CPU per request for the `benchmarks/compare` detail page (in
  process, 60 batches): p25 0.76 ms to 0.61 ms, median 0.93 ms to 0.78 ms.

### Production Server Build

- `vite build` with `sunfallArcStart` now builds a server-rendered app for
  production (any app that does not `prerender`): the client into
  `dist/client` with Vite's manifest, then the server into `dist/server`,
  where Start generates `index.js`. `node dist/server/index.js` serves the
  app on `PORT` (default 3000) and `HOST`, and closes gracefully on
  `SIGINT`/`SIGTERM`. Previously Start only served in dev or prerendered, and
  every app wrote its own server and asset wiring.
- Documents rendered by the production server reference the built entry and
  its stylesheets, and `modulepreload` the entry, its imports, and the matched
  route's lazy `*.component.tsx` chunk, so the route's code downloads with the
  entry instead of after it runs. Dev stylesheet links (`/src/...`) are
  dropped there.
- `@sunfall/arc-start/node` gains `serve(handler, { clientDir, assets })`, the
  production server as a scoped Effect (static files plus the handler), and
  `serveMain`, which runs it as the process main (what `index.js` calls).
  `sunfallArcStart` takes `clientEntry` (default `/src/main.tsx`) for the
  client build's input when the app sets none.
- The client build moves from `dist` to `dist/client`; the examples' leak
  scans read `dist/client`. `examples/tracker` runs in production with
  `pnpm build && pnpm start`, and its `verify` smoke-tests the production
  server (`scripts/production-smoke.mjs`). `benchmarks/compare/arc` drops its
  hand-written `server.mjs` for the built server.

### Live Queries Move To `@sunfall/arc-solid/live-query` (Breaking)

- `Component.liveQuery(query, options?)` is now
  `LiveQuery.bind(query, options?)` from the new
  `@sunfall/arc-solid/live-query` entry, and `Component.LiveQueryHandle`,
  `LiveQueryInput`, and `LiveQueryOptions` are `LiveQuery.Handle`,
  `LiveQuery.Input`, and `LiveQuery.Options`. Behavior is unchanged.
- The `Component` namespace cannot be tree-shaken, so the binding used to pull
  `@sunfall/arc-db`, `@tanstack/db-ivm`, and `fractional-indexing` into every
  app's browser bundle. Apps that do not import the new entry no longer ship
  them: the `benchmarks/compare` app's JS drops from 153.3 KB to 140.5 KB gzip
  (133.8 KB to 123.0 KB brotli).

### Cheaper RouterLink

- `RouterLink` renders a plain anchor on the server (no memos, effects, or
  preloader) and, in the browser, holds no preloader, effect, or cleanup until
  the first hover or focus. A link is one statically created anchor with its
  attribute bindings, not a `<Dynamic>`. Route patterns are parsed once and
  cached, so building an href no longer re-parses the pattern.
- A rendered link holds one state object, its `href` getter, and three
  event handlers (its behavior is on a shared prototype), down from thirteen
  closures: the 1,000-link list's JS heap after load drops a further
  8.43 MB to 8.25 MB.
- `RouterLink` now also preloads on focus (keyboard navigation), and an
  `onFocus` handler passed to it runs first, like `onMouseEnter`.
- Measured on the 1,000-link list of `benchmarks/compare` (5 interleaved
  rounds): server CPU per render of `/` 18.2 ms to 10.3 ms, JS heap after load
  12.0 MB to 8.6 MB, first click handled (4x CPU throttle) 528 ms to 455 ms.

### App States: One State Shared Across Pages

Found by building `examples/tracker`, whose undo toast is shown by the board
and the issue page but rendered by the shell.

- `State.define({ scope: "app", ... })` declares an app State: every
  `Component.state(Definition)` binding returns a handle on the runtime's one
  instance instead of starting its own. The first binding starts it with its
  services (minus its own Scope, so commands such as an expiry timer outlive
  it); unmounting a binder never stops it; disposing the runtime does. A
  Start request runtime owns its own, so a server render gets one per request
  and never shares one across requests. Every handle is the same `State.Ref`
  (one optimistic patch target) and its commits are Timeline entries under
  its `name`. The default, `scope: "component"`, is unchanged. `State.Scope`
  names the two. Previously sharing a State took a Solid context around a
  parent's handle, or a module-level `State.start` shared by every SSR
  request. `State.start` always starts a new instance its caller owns.

### Server Renders Never Start Change Feeds

- A Start request runtime's Resource Store renders one response and never
  starts a `rows.changes` feed, whether the entry was preloaded, read by the
  render, or hydrated. The browser runtime starts the feed when it hydrates
  the entry, as before. Previously every server-loaded board started its
  poller in the request runtime until the response ended: wasted work, and a
  feed with side effects ran on the server.

### Route Preload Verdicts: Not Found And Redirect

Found by building `examples/tracker`, a real issue tracker on SQLite.

- `Route.notFound()` ends a route preload with the verdict that the URL names
  nothing (`/issues/TRK-999`). It is not a failure: `Route.planNavigation`
  plans `NotFound`, Start answers 404 with `notFound: true` in the payload
  and starts the server's routers `NotFound` (the outlet's `notFound` view),
  and client navigation settles `NotFound`. The Resources the preload loaded
  before its verdict (the signed-in user, the navigation) still hydrate, so
  the 404 page renders inside the app's shell. Previously a missing record
  could only be a route failure, answered with 500.
- `Route.redirect(href, { status?, replace? })` ends a preload by sending the
  navigation elsewhere (a sign-in page for a request without a session).
  Start answers `status` (default 302) with `Location: href` and renders
  nothing; the browser router navigates to `href`, replacing the entry unless
  `replace: false`, and fails a chain of more than 20 redirects as a loop.
  `Route.NavigationPlan` gains a `Redirect` variant.
- Neither verdict is part of a route's typed failure or its `error` schema.
  `Route.PreloadVerdict<R>` is the verdicts a preload can end with, tracked by
  `Route.define` like its failure, and `Route.preload` fails with
  `RoutePreloadError<...> | Route.PreloadVerdict<R>`, so routes that use
  neither keep their types. `RouteNotFound` and `RouteRedirect` are exported.

### Server Renders Hydrate Everything They Rendered

- Fibers the server render forks (a Resource read no route preloaded,
  a `Component.callback`) run with the request's services: the request,
  response context, and in-process server-function client. Such a read used
  to fail as a `ServerFunctionNotFound` defect during SSR.
- Resources the render itself loaded hydrate with the page in one more
  streamed chunk, beside the preload's, so the client does not re-render them
  over different markup.

### Same-Page Navigation Keeps The Route Instance

- A navigation to the page already on screen (same route and params, new
  search) keeps its route component instance, its States, and its DOM: the
  outlet keeps showing the page while the preload runs, then updates the
  component's `search` (and mapped) props in place. Previously every href
  change remounted the route component, so a search box lost focus on each
  URL update and per-page UI State (an open filter drawer) reset. A change of
  route or params still mounts a fresh instance.

### The Server Layer Must Provide What Served Code Needs (Breaking)

- `createRequestHandler(app, { server, serverFunctions })` checks the server
  Layer against the services of the served server functions and Actions, as
  it already did for the root: a missing database client is a compile error
  at the call, not a requirement left on the handler (where the Vite plugin,
  which runs the handler untyped, never saw it).
- `Server.Client` is nominal. Requirement checks compare services
  structurally, and every function has a `call` method, so a callable service
  (an Effect `SqlClient`) looked like a `Server.Client` and was silently
  treated as provided. Build clients with the new `Server.makeClient(call)`.

### Smaller Fixes

- `rows.changes(input, rows)` receives the synced rows its feed starts from,
  so a feed can resume from a cursor they hold (the newest version). A
  hydrated entry now starts its feed from the hydrated rows, as documented;
  it used to start only after a load, so a server-rendered page never
  followed its feed.
- A rejected `ActionResult` (`ValidationFailure`, `Failure`) no longer runs
  the definition's `invalidates`: the change did not happen. Invalidations the
  result itself carries still run.
- A failed Vite dev SSR request names its failure: `StartDevServerError` and
  `StartRequestHandlerError` messages describe the operation and the wrapped
  failure (through tagged errors without messages). Vite used to print
  `Internal server error:` followed by a stack and nothing else.
- `StartAction.decodeFormData` decodes a form like the server decodes its
  no-JavaScript post: visible fields merged over the default input
  `StartAction.form(action, { input })` encoded. It used to drop the
  defaults, so an enhanced form missed fields (an `id`) its no-JS post had.
  ||||||| parent of 50ba169 (Make RouterLink cheap on the server and before first intent)

### Rejected Path Params Are Not Found (Breaking)

- A URL whose path params fail the route's `params` schema does not match that
  route: `Route.match` moves on to the next route (a later route may accept
  the params) and returns `undefined` when none does, where it used to throw.
  So `Route.planNavigation` plans `NotFound`, Start answers 404 with
  `notFound: true` in the payload, and the browser router, static navigation,
  and devtools route plans report `NotFound`, the same as for an unmatched
  URL. Previously such a URL was a `RouteNavigationError`, and an SSR request
  for it failed.
- Search values still decode after the path matched and never change which
  route matched: a `search` schema failure stays a typed
  `RouteNavigationError`. Give a search field a default in its schema when a
  bad or missing value should fall back.
- The browser router publishes a navigation's target match (`Pending`) only
  after the host's `prepareHref` found the page, keeping its current state
  until then. Static navigation no longer exposes a match whose route data is
  not hydrated yet (UI keyed on `router.match()`, such as a sidebar, read
  data the static client cannot load when leaving a not-found page), nor a
  match the host then answers 404 for.
- The docs site drops its workarounds: an unknown docs slug is a plain
  `NotFound`, and the sidebar's recipe links no longer wait for the first
  route to finish loading.

### Static Prerender Writes 404.html

- Start's static prerender renders an unmatched URL through the app's handler
  and writes the not-found page to `404.html` at the output root, with asset
  URLs absolute under Vite's `base`, so GitHub Pages and other static hosts
  serve the app's own styled 404 at any depth. There is no option: the planned
  page's `source` is `"not-found"` (`filter` can drop it), and an explicit page
  writing `404.html` replaces it.
- Start answers unmatched URLs with status 404 (was 200), and the root
  hydration payload carries `notFound: true`. `hydrateFromDocument` records it
  with the new `Route.hydrateNotFound()`, so the hydrating router starts
  `NotFound` whatever URL the document is served at, and the router host does
  not preload an initial `NotFound` state.
- `BrowserHistoryAdapter.prepareHref` may succeed with `{ _tag: "NotFound" }`;
  the router then settles in `NotFound` without route preload.
  `makeStartStaticHistoryAdapter` does so when a target page answers 404
  (previously a `StartStaticNavigationHydrationError` with reason
  `HttpStatus`).
- The docs site's GitHub Pages build ships `404.html`; `pages:verify` checks it
  and `pages:smoke` serves missing URLs with it (status 404, as GitHub Pages
  does) and checks a deep missing URL.

### Server Functions Run On effect/rpc (Breaking)

- Every server function is an `effect/rpc` `Rpc`. `Server.contract(name, {
input, output, error? })` requires `input` and `output` schemas (`error`
  defaults to `Schema.Never`) and infers its types from them; the contract and
  `Server.Fn` carry the `Rpc` as `.rpc`. `Server.Fn.invoke`, the
  `input`/`output`/`error` fields, `Server.manifest`, the encode/decode and
  envelope helpers, and the internal server wire codec are gone.
- Start serves `POST /__sunfall-arc/rpc` with `RpcServer.toHttpEffect` over an
  `RpcGroup` of the handler's `serverFunctions` (JSON serialization); handlers
  still run in the request runtime (`RequestContext`, `ResponseContext`,
  server services). The browser `Server.Client` is an `RpcClient` over
  `HttpClient`, so `traceparent` propagation comes from `HttpClient`. SSR
  calls stay in-process; mocks and the local client round-trip values through
  the Rpc's JSON codecs. `Server.ClientError` is `RpcClientError` |
  `ServerFunctionNotFound` | `Schema.SchemaError` | `EffectInputCallbackError`;
  payload decode failures, unknown functions, and handler defects arrive as
  defects. RPC responses are always `200` `effect/rpc` JSON messages.
- `Server.route` / `Server.handleRoute` / `ServerRouteHandlerError` are
  removed: HTTP routes belong to `effect/http`.
- The action transport keeps its protocol (no-JS forms, redirects, durable
  submissions) but posts through the same `HttpClient`. `App.launch` uses the
  client Layer's `HttpClient`, else `FetchHttpClient` (`App.LaunchServices`
  includes `HttpClient`); `App.LaunchOptions.transport` and `StartFetch` /
  `StartFetchInit` / `StartFetchInput` are removed. The action transport's
  errors are its own: `ActionTransportError`, `ActionProtocolError`,
  `ActionNotFound`, with `Action.ClientError` replacing `Server.ClientError`
  on submissions (and Solid's `Component.ActionError`).

### Refresh Never Disturbs What Didn't Change

- The Resource Store shares every new value of an entry with the one it
  replaces: a refresh, invalidation, hydration refetch, `rows.changes` batch,
  or optimistic patch, fold, or rollback keeps each deep-equal part as the
  previous object, and an equal value as the previous value. Plain objects and
  arrays compare field by field; Dates, Maps, Sets, and Schema/Data classes
  compare with `Equal`. Rows match by `rows.key` (generalizing the previous
  row-only diff), so a changed row also reuses its unchanged parts.
- Solid: `reader(input)` returns a read-only fine-grained view of the value
  (the projection `Component.state` already uses), keyed by `rows.key` or
  `"id"`. A binding re-runs only when the field it reads changes, so
  `<input value={props.project.name} />` keeps typed text across a refresh,
  even one that changes a sibling field. `reader.get` and `reader.index`
  return the view's rows.

### State Is The One Writable Client State (Breaking)

- `Program` is renamed `State`, and it is now the only way to hold writable
  client state. `State.define({ name, initial, on })` infers the message union
  from `on` (a handler's second parameter types the message's fields);
  `State.define<Model, Message>()({ ... })` names it up front for commands
  that emit the State's own messages. `name` is required. `State.next`,
  `emit`, `commands`, `subscription`, `step`, and `start` keep Program's
  semantics; `ProgramFailure`/`ProgramDisposed` are `StateFailure`/
  `StateDisposed`, and the Type IDs are `State*TypeId` (plus `StateRefTypeId`).
- Solid: `Component.program` becomes `Component.state`, whose
  `Component.StateHandle` adds `send`: one DOM-ready sender per PascalCase tag
  (`onClick={menu.send.Toggle}`, `send.Search({ query })`). Primitive models
  skip the store projection; object models keep keyed reconciliation.
  `Component.ProgramHandle`/`ProgramOptions`/`ProgramModelView` are
  `StateHandle`/`StateOptions`/`StateView`. `Component.callback` is for
  non-state Effect work; `Component.stream` stays a read-only accessor.
- `Signal` is read-only in the public API (`Readable`, `StreamOptions`,
  `derive`, `peek`, `untracked`, `changes`, `values`). `Signal.make`,
  `batch`, `transaction`, `updateAndGet`, `fromStream`, `Signal.Writable`,
  and `SignalWriteOutsideTransition` move to `@sunfall/arc-core/internal`
  (`SignalWrites`, `WritableSignal`) for framework code and fixtures; the
  unnamed-write check is an internal assertion.
- Action `optimistic`: `transaction.set` targets a `State.Ref` (a
  `State.Instance` or `Component.state` handle) or a Resource ref. State
  messages that arrive while a patch is in flight apply to the base model and
  the patch re-applies over them; `Action.planOptimistic` reports State
  targets.
- Timeline: `Timeline.ProgramCause` is `Timeline.StateCause`
  (`{ _tag: "State", state, event, message }`), described as
  `State "Board" Relabel`; a State's model signal is named by its `name`
  (no `.model` suffix). Devtools' `programs` panel is `states`.
- See [From Program And Writable Signals](docs/migration-notes.md#from-program-and-writable-signals).

### File-Route Manifests Are Plain Validated Data (Breaking)

- File-route manifests drop their serialize/deserialize round trip and
  Schema-branded ids; one validated generator, `generateFileRouteManifest`,
  replaces the Sync/Effect and entries/artifact variants.
- The generated route tree and `virtual:sunfall-arc/routes` drop
  `fileRouteMetadata` / `FileRouteMetadata`; `layoutsById`,
  `errorBoundaryById` and `metadataById` carry a route's support modules.

### Route Code Splitting Is Explicit (Breaking)

- The Vite plugin no longer rewrites `Route.withComponent(...)` calls to split
  route components, and its `autoCodeSplitting` option is removed. A lazy
  component, `Route.lazyComponent(importer)`, is the one way to load a route
  component as its own chunk.
- File routes get it generated: a sibling `<route>.component.tsx` (for example
  `src/routes/projects/$id.component.tsx`) default-exports the route's
  component, taking `Route.Props<typeof route>`, and `routeTree.gen.ts`
  attaches it with `Route.lazyComponent`. The server preloads a matched
  route's lazy component before rendering.

### Start Prerender Reads Vite's Build Manifest (Breaking)

- Prerendering swaps the dev entry script and dev stylesheets for the built
  entry chunk and its CSS listed in Vite's build manifest, instead of copying
  tags out of the built `index.html`. The Start plugin turns
  `build.manifest` on when `prerender` is set. The temporary Vite server is a
  scoped resource, and `retryCount`/`retryDelay` run through `Effect.retry`.
- `StartPrerenderError`'s `close-server` and `create-directory` operations are
  gone: a server close failure is logged, and directory creation reports
  `write-page`.

### Requests Are Traced As Effect Spans (Breaking)

- `createRequestHandler`'s `onRequestTrace` option and the `StartRequestTrace`
  DTO are removed. The `sunfall-arc.start.request` span now carries the route
  plan (`http.route`, preloaded/hydrated Resource keys), failure kind, response
  status, stream state, and request runtime teardown as attributes, and stays
  open until a streamed body closes, errors, or is cancelled.
- Devtools reads requests from spans: `Devtools.layerTracer(store)` records
  every ended span (still forwarding to the current tracer), `Devtools.Span`
  replaces `Devtools.RequestTrace`, and the Requests panel projects request
  spans and their RPC/action child spans. `store.recordRequestTrace`,
  `requestTraceLimit`, the `RequestTrace` runtime event, and the causal graph's
  request-trace, endpoint, and server-function nodes are gone.

### Start Drops Its Diagnostics CLI, Agent Graph And App Graph (Breaking)

- The `sunfall-arc-start` binary (`diagnostics`, `graph`, `impact`), the
  `@sunfall/arc-start/diagnostics-report` and `@sunfall/arc-start/internal`
  entrypoints, the Start agent graph, and the Start app graph
  (`virtual:sunfall-arc/app-graph`, `.../runtime-diagnostics`,
  `__SUNFALL_ARC_APP_GRAPH__`) are removed. So are the
  `virtual:sunfall-arc/server-functions` and `virtual:sunfall-arc/actions`
  manifest modules and the `__SUNFALL_ARC_SERVER_FUNCTIONS__` /
  `__SUNFALL_ARC_ACTIONS__` / `__SUNFALL_ARC_FILE_ROUTES__` defines: nothing
  read them. The file-route virtual modules stay.
- The Vite plugin no longer SSR-loads the server entry through a second Vite
  server at startup, and builds no longer start a third one for the
  diagnostics gate.
- `buildPolicy` is `{ staticClient }`: `buildPolicy: true`, `wireSchemas`
  (`StartAppGraphMissingWireSchemas`) and `diagnostics` are gone. The one
  diagnostics rule, routes with a `preload` must declare `preloadResources`,
  is now a dev warning: the Vite dev SSR middleware logs it once per loaded
  server entry for each such route.
- The RPC and Action endpoints are fixed at `/__sunfall-arc/rpc` and
  `/__sunfall-arc/action`: the plugin's `rpcPath`/`actionPath`,
  `createRequestHandler`'s and `App.launch`'s `endpoints`, and
  `StartAction.form`'s `action` options are removed, with
  `StartTransportEndpointPathError`, `StartTransportEndpointConflictError` and
  `StartTransportEndpointOverrides`.
- Start encodes and decodes Action wire values with core's server wire codec
  instead of its own copy.
- Static client navigation is one module: the href preparation cache and
  target-document hydration moved into `static-client-navigation.ts`. No
  public API changed.

### Devtools Is One Namespace (Breaking)

- `@sunfall/arc-devtools` exports the `Devtools` namespace plus the error
  classes `DevtoolsActionInvalidationPlanConflict` and
  `DevtoolsPanelContractError` (root exports 106 to 3). Functions drop the
  `Devtools` infix: `makeDevtoolsStore` is `Devtools.makeStore`,
  `describeDevtoolsSummary` / `describeDevtoolsCausalGraph` /
  `describeDevtoolsPanels` are `Devtools.describeSummary` /
  `describeCausalGraph` / `describePanels`, `renderDevtoolsPanelsHtml`,
  `mountDevtoolsPanels`, and `bootDevtoolsPanels` are
  `Devtools.renderPanelsHtml` / `mountPanels` / `bootPanels`,
  `installDevtoolsBridge` is `Devtools.installBridge`,
  `sunfallArcDevtoolsBridgeGlobal` is `Devtools.bridgeGlobal`,
  `resolveSunfallArcDevtoolsBridgePayload` is `Devtools.resolveBridgePayload`,
  and `toDevtoolsSerializableValue` is `Devtools.toSerializable`. Types are
  members: `DevtoolsStore` is `Devtools.Store`, `DevtoolsPanels` is
  `Devtools.Panels`, `DevtoolsBridgePayloadContractResolution` is
  `Devtools.BridgePayloadResolution`, and so on.
- Removed exports nothing used: `describeInvalidationPlan` /
  `describeRoutePlan` (the Store's `recordInvalidation` / `recordRoutePlan`
  take live plans), `isDevtoolsSerializableValue`, `devtoolsPanelIds`,
  `devtoolsPanelSeverities`, `DevtoolsUnknownInvalidationTarget` (a defect,
  never a typed failure), and the nested DTO names (`DevtoolsPanelItem`,
  `DevtoolsPanelMetric`, `DevtoolsCausalNode*`, `DevtoolsRequestTrace*`,
  `DevtoolsStartAppGraph*`, `DevtoolsSummary*` parts). Reach nested shapes
  through their owner, e.g. `Devtools.Panel["items"][number]`.
  See [From Flat Devtools Names](docs/migration-notes.md#from-flat-devtools-names).

### App Services Are Effect Services (Breaking)

- `Capability` is removed (`Capability.define`, `.layer`, `.tag`,
  `isCapability`, `CapabilityTypeId`, and the `Capability.Any` / `Shape` /
  `Identifier` types). Define an app service with Effect's
  `Context.Service<ProjectApi>("ProjectApi")` and provide it with
  `Layer.succeed(ProjectApi, { ... })`. `ProjectApi.use((api) => ...)` is
  unchanged for Effect callbacks; a plain-value callback is
  `ProjectApi.useSync(...)`. See the migration notes' "From Capability".

### Resource Is The One Server-Data Model (Breaking)

- `Resource.define` takes `rows` when its `output` is an array:
  `rows: { key: (project) => project.id, indexes: { status: (project) => project.status } }`,
  with callbacks typed by the output's element (a non-array output does not
  compile). Rows are derived from the value: a reload is diffed by key, so
  unchanged rows keep their object identity, and lookups are cached per
  value.
- The reader of a rows Resource adds `get(input, key)` and
  `index(input, name, value)`, typed by `rows`; they suspend and follow
  reloads exactly like `reader(input)`.
- An Action's `optimistic` patches rows with
  `transaction.insert/update/delete(ref, key, ...)` on a ref of a Resource
  with `rows` (the key typed by `rows.key`), layered over the synced value
  like `transaction.set`. An update shares the value's key positions and
  moves only the index buckets the row changed. Row updates take a partial
  or a pure updater (no draft mutation). `Action.planOptimistic` reports row
  changes with `target: ref`.
- `rows.changes(input)` streams remote `Upsert`/`Update`/`Delete` batches
  into the synced rows (Timeline cause `Resource ... change`;
  `ResourceRowsChanged` / `ResourceRowsChangesFailure` store events).
- `policy.persist: { key, version }` persists any Resource's settled values
  in the runtime's `KeyValueStore` (`arc/resources/v<version>/<key>/...`); a
  never-loaded entry shows the persisted value at once and reloads in the
  background. Durable Actions re-apply their row patches on top. A persisted
  family requires `KeyValueStore.KeyValueStore` in its `R`, so a runtime
  without a store does not compile; storage failures are logged, not load
  failures.
- Start provides that store on both sides: `App.launch` uses the client
  Layer's `KeyValueStore`, else `localStorage` (memory without Web Storage),
  one store shared with the Action Outbox (which previously fell back to
  memory), and request runtimes get a store that keeps nothing unless the
  server Layer provides one. `App.LaunchServices` includes `KeyValueStore`.
- Live queries read rows Resources: `query.from({ project: ProjectsRef })`,
  `joinIndexed` names checked against `rows.indexes`. Query diagnostics
  report `resource` instead of `collection`, and join strategies are
  `"scan"` / `"index"`. `Component.liveQuery` (in `@sunfall/arc-solid`)
  binds one in a Component.
- Removed: `Collection` (`define`, `liveQuery`, sync adapters, local-only
  collections, `applyChanges`, snapshots, persistence, row metadata),
  `@sunfall/arc-solid-db` (the package), `Route` `preloadCollections` and its
  diagnostics, `App.define({ collections })`, Start's collection hydration
  channel and streamed collection chunks, Timeline's `Collection` cause, and
  the devtools collection facts. `@sunfall/arc-db` is the Query engine only.
  See [From Collection](docs/migration-notes.md#from-collection).
- The golden path's step 5 adds `rows` to `ProjectList` instead of a
  Collection, and the project console's rename patches the sidebar row and
  the project page.

### Optimistic Patches Reach Resources (Breaking)

- An Action's `optimistic` transaction patches any Resource entry with
  `transaction.set(ref, update)`, e.g.
  `transaction.set(ProjectById(id), (project) => ({ ...project, name }))`.
  The updater receives the Resource's output type. The patch layers over the
  entry's synced value for the life of the submission: readers
  (`Resource.result`, `Resource.read`, the Solid reader with its `waiting`
  and `failure`) see it with no Suspense flash, a reload in flight replaces
  the value underneath and keeps the patch on top, success folds it in until
  the `invalidates` reload, and a failure or interruption rolls it back and
  rebases other submissions' patches. Loads (`Resource.preload`, `refresh`,
  `changes`, and so a Collection following the Resource) and SSR snapshots
  see only the synced value; an entry that has not loaded is left alone.
  Durable submissions re-apply their Resource patches after hydration.
- `transaction.set` is the one verb for patching a value, Signal or Resource
  entry; `transaction.signal(signal, update)` is removed (use
  `transaction.set(signal, update)`). Row stores keep
  `transaction.insert/update/delete`.
- `Action.planOptimistic` reports value patches as
  `{ _tag: "Set", target, value }` (the Signal or Resource ref, and the value
  it would read) instead of `{ _tag: "Signal", signal, value }`; a Resource
  entry the caller's runtime has not loaded plans no change.
- The golden path's rename now patches the sidebar row and the project page
  at once, and the project console's rename and advance Actions patch the
  `ProjectById` entry.
- A run that returns a rejected `ActionResult` (`ValidationFailure` or
  `Failure`) rolls the submission's optimistic patches back exactly as a
  failure does (Timeline cause `failure`), instead of folding them in; this
  holds for local runs, remote responses, and durable replays. `Success` and
  `Redirect` results commit as before.

### One Name, One Form (Breaking)

- Every public type has one name. Package roots export namespaces plus the
  values with no namespace home (error classes, Type IDs, guards, services,
  runtime helpers); the flat duplicates of namespace members are gone
  (`ActionDefinition` is only `Action.Definition`, `ResourceRef` only
  `Resource.Ref`, `RouteMatch` / `RouteContext` only `Route.Match` /
  `Route.Context`, `ServerClient` only `Server.Client`). Prefixed types that
  had no namespace home moved in (`ActionResult.*`, `Action.Options`,
  `Form.Options`, `Resource.Family`, `Route.View`, `Signal.Options`,
  `Timeline.Entry`, `App.Definition`, `StartAction.FormOptions`,
  `SolidDb.CollectionHandle`, ...). Cross-package plumbing types moved to
  `@sunfall/arc-core/internal`. Public root exports: core 295 to 118, start
  47 to 41, solid-db 5 to 1.
- Identical types merged: `RouteErrorSchema` into `Resource.ErrorSchema`,
  `ActionSubmissionConcurrency` into `Action.Concurrency`, and
  `ProgramSubscriptionError` / `ProgramSubscriptionRequirements` into
  `EffectInputError` / `EffectInputRequirements`. `Route.PreloadError` /
  `Route.NavigationError` are renamed `Route.PreloadPlanError` /
  `Route.NavigationPlanError`, so they no longer read like the
  `RoutePreloadError` / `RouteNavigationError` classes.
- One form per call: `form.validate()` (not `Form.validate(form)`), the
  validator's `errors.field/fields/form` (not `Form.error` /
  `Form.fieldError`), `ActionResult.validation(...)` (not `fields` /
  `fieldError` / `formError`), `ActionResult.fromValidation(form.validate())`
  (not `validateForm` / `fromValidationEffect`), `query.from(...)` in the
  factory (not `Query.from`), `Route.href` / `Route.match` (not
  `route.build` / `route.match`), `Server.implement(Server.contract(...))`
  (not `Server.fn` / `Server.stub`), `Server.mockLayer` (not `mockClient` /
  `provideMocks`), `Server.functions().get` (not `Server.get`),
  `capability.layer` (not `mock` / `provide`), and `signal.update(f)` (not
  `signal.set(f)`; `set` takes a value).
- One spelling per option: `StartAction.form(action, { action })` is the only
  way to set the form URL; a prerender page sets `outputPath` and
  `prerender: false` directly (`StartPrerenderPageOptions` is gone) and the
  prerender options object has no `enabled` flag (`false` disables); cookie
  `sameSite` is lowercase only.
- `Resource.dehydrate(refs)` is removed; `Resource.hydrationPayload(refs)` is
  the one way to snapshot loaded refs (read `.resources` for the snapshots).
- No exported name ends in `Effect`
  (`generateValidatedFileRouteManifestEffect` is
  `generateValidatedFileRouteManifest`, and so on); where a throwing twin
  existed it is suffixed `Sync`.

### Every State Change Has A Name (Breaking)

- Signals change only inside named transitions, so the Timeline reads like a
  message log. `Component.callback(name, f)` takes a required name and runs
  each call as the transition `<Component>.<name>` (started immediately, so
  synchronous writes land within the DOM event); Actions, Programs, Resource
  loads, Collection syncs, Forms, and router navigation label their own
  commits, and keep doing so when started from a callback.
- A write outside every named transition (a bare DOM handler, a Solid effect,
  an unnamed `Signal.batch`) dies with `SignalWriteOutsideTransition`, which
  names the Signal and the fixes. The check is always on, in SSR and tests
  too.
- `Signal.make(initial, { name })`, `Signal.fromStream(stream, initial, { name })`,
  `Component.stream(name, stream, initial)`, and `Form.make({ name, ... })`
  require names; the `signal#N` fallback is gone. `Signal.batch` and
  `Signal.transaction` take `{ name }` (unnamed ones take the caller's
  transition) instead of `{ cause }`.
- `TimelineUserCause` is replaced by `TimelineTransitionCause`
  (`{ _tag: "Transition", name }`), `TimelineEntry.cause` (and Devtools'
  `DevtoolsTimelineCommit.cause`) is always present, and
  `Timeline.describe(cause)` takes a `TimelineCause`.
- Optimistic Action patches commit under the submission's Action cause, and
  router outlet nodes (derived from recorded router state) are no longer
  recorded.

### One Route Constructor (Breaking)

- Start's `FileRoute.define(path)(options)` is removed. A file route module
  exports `route = Route.define(path, options)` from `@sunfall/arc-core`; the
  generated route tree imports `route` and fails, as a type error and when the
  tree loads, if the declared path differs from the path implied by the
  file location. `Route.Factory<Path>` / `RouteFactory`, the generated
  `FileRoute` type, and the `routeModuleExportName` generator option are
  removed with it.
- Pure aliases are removed: `Capability.layer` / `Capability.mock` /
  `Capability.provide` (use the capability's own `layer` / `mock` /
  `provide` methods) and `Server.definitions()` (use `Server.functions()`).

### Pure Testing (Breaking)

- Program handlers are the one way to write a transition: `Program.define`
  takes `on` only (the `update` callback and `Program.update(...)` are gone),
  messages are always tagged, and handlers are pure and synchronous (an
  Effect returned from a handler is a type error; Effect work goes in
  `Program.emit(effect)` commands).
- `Program.step(program, model, message)` is a pure synchronous function
  returning `{ model, commands }` with the commands unrun; run a command's
  `effect` to get the message it emits. It replaces `Program.story(...)` and
  its `Program.Story`/`StoryEntry`/`StoryOptions` types, and the runtime
  applies messages through the same function.
- `Action.planOptimistic(definition, input)` returns the changes an Action's
  `optimistic` patch would make (`Action.OptimisticChange`) without applying
  any, so patches are tested with no runtime, store, or backend.
- The golden path gains a Testing section whose snippets run as tests.

### Durable Submissions And Tracing Papercuts

- Start's action request and response wire bodies are Effect Schemas (a
  `Schema.Struct` request and a `Schema.TaggedUnion` response) instead of
  hand-written guards, and response metadata application lives in the
  response codec. The wire format is unchanged.
- `Action.restoreOutbox` is a function: `Action.restoreOutbox(options?)` takes
  `ActionOutboxRestoreOptions` (`settled`: ids the hydrated state already
  reflects, restored without re-applying their optimistic patch). Start's
  `App.launch` passes the ids its server reports in the hydration payload
  (`settledSubmissions`), read from the `sunfall-arc-outbox` cookie it keeps,
  so a submission whose response was lost no longer shows its patch twice
  after a reload.
- Durable submissions are scoped to their submitter. Start mints an
  HttpOnly `sunfall-arc-submitter` cookie (on the first document of an app
  with durable Actions, or the first durable submission) and keys each
  execution by the token's digest plus the submission id: only the
  submitting browser can replay an id and read its recorded response, and
  `settledSubmissions` reports only that browser's own executions. Another
  request reusing an id runs as a new submission.
- Start's default in-memory `WorkflowEngine` rotates per Action and forgets
  records once no client can replay them (`durable.maxAge` after they
  settle), instead of growing for the life of the server. A submission id
  sent for a non-durable Action runs directly.
- Start's RPC and action clients send the current span as `traceparent`/`b3`
  (`HttpTraceContext.toHeaders`, honoring
  `HttpClient.TracerPropagationEnabled`), so the server's request span joins
  the client's trace. Start transport responses no longer echo
  `traceparent`/`baggage`.
- `ResourceFamilyOptions.load` stores a `CheckedEffectInput` and `provides` is
  a method, so a Resource whose load never succeeds (`A = never`) is always an
  `AnyResourceRef`.

### Collection Persistence On KeyValueStore

- Collection persistence uses the runtime's `effect/persistence`
  `KeyValueStore`, shared with the Action Outbox: snapshots live at
  `arc/collections/v<version>/<key>` (key defaults to the collection name,
  version to `1`), rows encoded through the `output` schema's JSON codec.
  `persistence: { key?, version?, ... }` replaces `persistence: { storage }`,
  and `persist(options?)` / `restore(options?)` no longer take a storage.
- Removed `Collection.storage`, `Collection.memoryStorage`, the
  `PersistenceStorage`/`StorageLike`/`MemoryStorage` types,
  `CollectionStorageError`, and the `SQLitePersistence` namespace with its
  errors; use `KeyValueStore.layerStorage`, `layerMemory`, or `layerSql`.
  Snapshots under the old keys or SQLite table are not read (see migration
  notes).

### Durable Action Submissions

- `Action.define({ input, durable: { maxAge } })` makes an Action's
  submissions durable (an input schema is required by the types). Each
  submission is persisted in the runtime's Action Outbox before it is sent,
  keeps its optimistic patch while pending (re-applied after reloads), and
  replays in global FIFO order on launch, on `online`, and with backoff.
  `submit` settles as usual, or fails with the new `ActionQueued` when a
  retryable transport failure leaves the submission pending.
- The outbox persists to the client Layer's `effect/persistence`
  `KeyValueStore` (prefix `arc/actions/v1/`). `Action.outboxLayer({ retry? })`
  provides it; `App.launch` provides it automatically (over the client Layer's
  `KeyValueStore`, in-memory when there is none) and runs
  `Action.restoreOutbox` after hydrating. `Action.outbox` exposes `pending`,
  `failures`, and `dismiss`; expired and unrestorable entries fail with
  `ActionSubmissionExpired` / `ActionSubmissionUnrestorable`.
- `ActionTransport.submit` takes an optional `ActionTransportSubmission`
  (`{ id }`), and Start sends it as the action request's `id`. Start's action
  endpoint runs submissions with an id as `effect/workflow` Workflows keyed by
  that id, on the server Layer's `WorkflowEngine` or an in-memory one, so a
  replayed POST returns the original response without running `run` again.
- New Timeline `Action` events: `queue`, `restore`, `replay`, `dismiss`.

### Mutations Are Actions; One Failure Rule (Breaking)

- Actions are the one way to change server data. `Action.define({ optimistic })`
  receives a transaction that patches Signals (`transaction.signal`) and
  Collection rows (`transaction.insert/update/delete(collection, ...)`) and
  returns an `Effect<void>`; the transaction commits or rolls back every patch
  (the rollback-Effect return and `Action.Rollback` are removed).
- Collection write paths are removed: `insert`/`update`/`delete`,
  `sync.insert/update/delete`, `pendingMutations()`, `flushPendingMutations()`,
  `Collection.flushAllPendingMutations`, `Collection.backgroundSyncPendingMutations`,
  the persisted pending-mutation queue (`pendingMutations` in snapshots,
  `persistOnMutation`), the collection `input` schema, and the
  `CollectionMutation*` store events. A `sync: ResourceRef` collection takes
  optimistic writes from Actions with no hand-written `load`/`refresh`/`follow`.
  `applyChanges` remains for remote feeds and local-only collections.
- A failure that can reach rendering joins a Component's `E`:
  `SolidDb.collection` and `SolidDb.liveQuery` now add their declared load
  errors (a never-loaded collection whose load failed throws to `<Errored>`),
  like `Component.resource`. Work you start returns its failures to you.
- Action callbacks that break their contract (`run`, `optimistic`,
  `invalidates` throwing or returning a Promise; an optimistic row the schema
  rejects) are defects: submissions fail with `E | Server.ClientError` only.
- One status vocabulary: Action, collection, and live-query handles expose
  `waiting()` and `failure()` (the Resource reader's names). Collection and
  live-query handles drop `result()`, `preloadFailure()`, and the
  `onPreloadFailure` option; `Component.Instance.fail(cause)` throws a typed
  render-time failure for custom bindings.

### Routing And Resource Preload (Breaking)

- Resource loads fail only with the declared error `E`: a `load` or
  `provides` callback that throws (or returns a Promise or invalid tags) is a
  defect carrying `EffectInputCallbackError`. `Resource.LoadError<E>` is
  removed, and route preloads no longer need
  `Effect.catchTag("EffectInputCallbackError", Effect.die)`.
- `Resource.preload` and `Resource.refresh` take one ref or an array of refs
  (loaded concurrently, values in order), matching `Resource.invalidate`.
- `Route.define` infers `preload` from its own body, then checks its failure
  against `error`; a mismatch is reported on `error` as
  `RoutePreloadFailureNotInErrorSchema<Undeclared>`. `CheckedRouteOptions`,
  `RouteOptionsInput`, and `RouteDefinitionFromOptions` are replaced by
  `RouteDefineOptions` and `RouteFactory<Path>` (`Route.Factory<Path>`, also
  `FileRoute.Factory<Path>`). Route components attach only through
  `Route.withComponent`.
- A route without an `error` schema fails with `RoutePreloadUntypedFailure`
  (only the failure's `tag`) on server, client, and after hydration, instead
  of `unknown`; a preload that cannot fail has `never`.
- `Route.withComponent(route, component, props)` maps route props to a
  feature component's props, replacing per-route adapter Components.
- `RouterOutlet` takes the `router` it renders, typing its fallbacks without
  type arguments; `RouterProvider` takes only `router` and `children`. Router
  options accept `undefined` as "absent".

### One Name Per Operation (Breaking)

- Definition constructors are `define`, namespaced: `Resource.define` (which
  also takes `request` + `resolver` in place of `load`, replacing
  `Resource.requestFamily`), `Route.define` (replacing flat `route`),
  `App.define` (replacing `defineApp`), `FileRoute.define(path)(options)`
  (replacing `defineFileRoute`), and `Component.define` (replacing
  `Component.make`).
- No Arc operation carries an `Effect` suffix, and each has one form: the
  Effect takes the plain name and every synchronous twin is removed
  (`Resource.preload` / `refresh` / `read` / `hydrate` / ..., `Resource.evict`
  for the old `deleteEffect`, `Route.preload` / `planNavigation` / ...,
  Collection `preload` / `refresh` / `insert` / `update` / `delete` /
  `applyChanges` / `snapshot` / ..., `Query.once`, `runtime.dispose`,
  `createStartStreamedHtmlResponse`, `hydrateFromDocument`, the devtools store
  methods, `installDevtoolsBridge`, `mountDevtoolsPanels`, and the rest; see
  the migration notes for the full table). `Capability.use` is the one service
  accessor (`useEffect` / `useSync` are gone), and the trivial
  `ActionResult.*Effect` constructors and the `fail` alias are removed.
- Handles share one vocabulary: `submit`, `dispatch`, `reset`, `preload`, and
  `refresh` return Effects, and UI event handlers run them through
  `Component.callback`. `result()` names every `AsyncResult` accessor
  (Collection `state()` and `Query.Live.state` are now `result`), and row
  accessors are `rows` (`Query.Live.data` and `LiveQueryHandle.data` are now
  `rows`). Collection sync adapters provide `refresh` instead of `refetch`.
- `Program.emit(...)` is the one command constructor (a message, the message an
  Effect produces, or nothing for a `void` Effect); `Program.command`,
  `Program.effect`, and `Program.dispatch` are removed. `Program.commands`
  batches.
- Routes are addressed by definition only: the router's `hrefByPath`,
  `navigateByPath`, `matchByPath`, and `preloadByPathEffect`, the
  `BrowserRouterPath` / `BrowserRouterRouteForPath` types, and the generated
  route tree's path-keyed maps, helpers, and types (plus `hrefById` and
  `isRoutePathMatch`) are removed. `navigateHref(href)` stays for raw hrefs,
  and `Route.isMatch(route, match)` narrows a match.
- Fixed: a Component whose first render read a pending Resource re-ran its
  setup (and rebound its readers) once the read settled, because the render ran
  in its caller's computation. Render now runs in a computation of the
  instance's own, so only the render retries.

### Components Are The Single Solid App Model (Breaking)

- Solid UI is built from typed `Component`s only. `Component.make(name,
function* (props) { ...; return () => <View /> })` setup now runs **once per
  instance** (with that instance's props, under its Solid owner, with an
  instance Scope) instead of once per runtime; render is the returned
  zero-argument function. Per-runtime sharing is by construction: Resources and
  Collections live in runtime stores, and `Component.provide` builds its Layer
  once per runtime.
- Setup-time bindings replace hooks, each adding its services to the
  component's `R`: `Component.resource` (a suspending `ResourceReader` with
  value-free `waiting` / `failure` status), `Component.action`,
  `Component.program`, `Component.stream`, `Component.callback`,
  `Component.router`, and `SolidDb.collection` / `SolidDb.liveQuery` from
  `@sunfall/arc-solid-db`. `Component.instance` is the seam for writing more.
  `Component.catchAll` joins `catchTags`.
- The Resource reader is the only way to render Resource content. It keeps the
  current or stale value across refreshes, so content stays mounted; status
  chrome reads `waiting(input)` / `failure(input)`.
- `Component.router(routes, options?)` creates the instance's router; the
  routes' preload services and route Components' services and failures join the
  component type, so `Component.launch` checks them again. `RouterProvider`
  now takes `router`. Route components may be typed `Component`s
  (`Route.withComponent` keeps the component type; core adds `RouteView`,
  `RouteViewTypeId`, `RouteWithComponent`, and `Route.ComponentOf`).
- `Component.embed(component, runtime)` takes its runtime explicitly and checks
  it; the server renders with `embed`, the client hydrates with
  `launch(..., { hydrate: true })`.
- Removed: `RuntimeProvider`, `RuntimeProviderProps`, `RuntimeContext`,
  `RuntimeContextMissing`, `useRuntime`, `createComponentScope`,
  `useResource`, `useResourceResult`, `useResourceSuspense`, `useAction`,
  `useProgram`, `useStream`, `useRuntimeEffect`, their handle/option types
  (`ResourceHandle`, `UseResourceOptions`, `ActionHandle`, `ProgramHandle`,
  `ProgramModelView`, `UseProgramOptions`, `RuntimeEffectRunner`),
  `Component.Render<P>`/`Component.PropsOf` (render is now `Component.Render`,
  children are `Component.Solid<P>`), and Solid DB's `useCollection`,
  `useLiveQuery`, `UseCollectionOptions`, `UseLiveQueryOptions`. Core's internal
  runtime-provider lifecycle helpers are removed with them.

### One Action Binding And An Action Transport (Breaking)

- Core adds `ActionTransport` (with `ActionTransportResponse`), the Action
  counterpart of `ServerClient`: every Action instance looks it up on submit.
  Served Actions run remotely and their response applies to the submitting
  runtime; every other Action runs locally. Action submissions now report
  `Server.ClientError` beside their own failures.
- Start adds `makeActionTransportLayer({ actions, ... })`; a client runtime
  that provides it routes served Actions over the network, so UI code submits
  every Action through `Component.action(...)`. A superseded `parallel`
  submission applies only its invalidations.
- Removed: `StartAction.use`, `StartAction.Instance`, `StartAction.Result`,
  `StartAction.State`, `submitStartActionEffect`, and the public
  `StartActionClientOptions`. `StartAction.form`,
  `StartAction.decodeFormDataEffect`, and `StartAction.Form` remain for
  progressive no-JS forms. Devtools drops the Start-shaped action tracking
  (`recordStartAction`, `recordStartActionEffect`, `trackStartActionEffect`,
  `DevtoolsStartActionInstance`); every Action instance is tracked with
  `recordAction` / `trackActionEffect`.
- `Action.use(definition, { runtime })` and `Program.start(definition,
{ runtime })` require an explicit runtime; the default-runtime fallbacks are
  gone.

### Whole-App Timeline Replaces Program Timelines (Breaking)

- `Timeline.record(options?)` records every committed signal change set (user
  Signals, Resource entries, Action state, Program models and failures, router
  state, collection versions and load state) until its Scope closes, with
  bounded retention (default 1000). Entries carry a `TimelineCause` and
  `{ signal, name, previous, next }` changes.
- `recording.travel(sequence)` renders the app at a past commit while committed
  state, and every Effect computing from it, stays live; `recording.resume()`
  renders the head again.
- `Signal.make(initial, { name })` names a signal for entries;
  `Signal.transaction(effect, { cause })` and `Signal.batch(f, { cause })`
  label a commit.
- Removed: Program `timeline` definition option, `ProgramTimelineOptions`,
  `ProgramEvent` and its event variants (`Program.Event`, `Program.*Event`,
  `Program.TimelineOptions`), `program.timeline`, `program.clearTimeline()`,
  and the Solid `useProgram` handle's `timeline()` / `clearTimeline()`. A
  Program's history is the Timeline filtered to `program.model`.
- Devtools: `recordProgramEvent(...)`, `recordProgramEventEffect(...)`,
  `trackProgramEffect(...)`, `DevtoolsProgramEvent`, and the `ProgramEvent`
  runtime event are replaced by `recordTimelineEntry(...)`,
  `recordTimelineEntryEffect(...)`, `trackTimelineEffect(recording)`,
  `DevtoolsTimelineCommit`, and the `TimelineCommit` runtime event.

### Async State Is AsyncResult (Breaking)

Arc's async state now uses Effect's `AsyncResult`
(`import { AsyncResult } from "effect/reactivity"`) everywhere, held in Arc
signals and rendered by Solid:

- `Resource.result(ref)` is `AsyncResult<A, E>`. Pending is
  `waiting` on the current tag (`Initial`, `Success`, or `Failure`);
  `previous` became `previousSuccess`, `updatedAt` became `timestamp`, and
  `error: E` became `cause: Cause<E>`. `ResourceState`, `Resource.State`,
  `Resource.value`, and `Resource.error` are removed.
- `Resource.status(ref)` is `{ ref, name, key, input, result, isStale,
isGcExpired, staleAt, gcAt, ageMillis, staleInMillis, gcInMillis }`; the
  derived flags (`isPending`, `isRefreshing`, `hasValue`, `hasPrevious`, ...)
  and `updatedAt` are removed.
- `ResourceFailure` carries `result: AsyncResult.Failure` (typed error via
  `AsyncResult.error(failure.result)`); `ResourcePending` carries `reason` and
  `result`. `Component.catchTags` matches the typed error's `_tag`.
- Action state is `{ result: AsyncResult<A, E>, input: Option<I> }` (idle is
  `Initial`); the duplicated invalidation plan inside state is removed.
- `collection.state()` is `AsyncResult<void, E>` (`Ready` became `Success`);
  `liveQuery.state` is `AsyncResult<ReadonlyArray<T>, E>`. `CollectionLoadState`,
  `Collection.State`, `LiveQueryState`, `Query.LiveState`,
  `collectionStateError`, and `liveQueryStateError` are removed.
- Solid and Solid DB handles expose one `result()` accessor instead of
  `state/value/error/waiting/refreshing/hasValue/match`; `useAction` exposes
  `result()` and `input()`. `useResourceValue`, `useResourceError`,
  `ResourceMatch`, `ResourceSuccessMeta`, and the Core `ResourceUi*` match/meta
  helpers are removed.
- Resource hydration snapshots keep the `name`/`key`/`input` envelope; `state`
  is the `AsyncResult` Success JSON `{ _tag, value, waiting: false, timestamp }`.
  Hydration stays Success-only.
- `ResourceStoreEvent` `ResourceFailure` carries `cause` instead of `error`, and
  the new `ResourceInterrupted` event marks cancelled loads. Devtools action and
  request-trace collection facts report the `AsyncResult` tag plus `waiting`.

Fixed: a defect or interruption during a Resource load or Action submission no
longer leaves the entry stuck `waiting`. Every load and submission settles from
its `Exit` with Effect `Clock` time: defects become `Failure` with the `Cause`,
and interruption returns to the prior settled state.

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
