# Migration Notes

These notes map common full-stack app patterns onto
[the Sunfall Arc golden path](golden-path.md).
They are intentionally conservative: migrate one vertical slice at a time and
keep the old path beside the new path until tests prove the behavior.

## From The Streamed Document Body

A server-rendered page is one complete body now, so the HTML stream that built
it is gone.

| Before                                              | After                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `StartStreamError` (a document stream phase failed) | removed: the document is built before the response; a failure is the request's own error |
| `sunfall-arc.stream.failure_phase` on request spans | removed; `sunfall-arc.stream.state` still records a custom streamed body's end           |
| reading a page's body in several chunks             | one chunk; the Node adapter sends it with `content-length`                               |

## From `document({ title, meta })`

The page's head is the matched route's `head`, through the app's `head`. The
server renders it and `App.launch` keeps it current on navigation.

| Before                                                                                                 | After                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `document: ({ match }) => ({ title: Route.isMatch(IssueRoute, match) ? match.params.id : "Tracker" })` | `Route.define("/issues/:id", { preload, head: ({ params, read }) => ({ title: read(IssueById(params.id))?.title }) })`   |
| a title suffix or fallback in `document`                                                               | `App.define({ head: (page, status) => ({ ...page, title: page.title === undefined ? "App" : `${page.title} · App` }) })` |
| `document: () => ({ meta: [{ name: "color-scheme", content: "light dark" }] })`                        | the app's `head` returns the `meta` every page carries                                                                   |
| `document: () => ({ meta: [{ name: "description", content }] })` per route                             | the route's `head` returns `description`                                                                                 |
| a `createEffect` that writes `document.title` on navigation                                            | nothing: `App.launch` writes `document.title` and the head's `<meta>` tags                                               |
| `StartDocument.title`, `StartDocument.meta`                                                            | removed; `document` returns `lang`, `links`, `clientEntry`, and `headers`                                                |

## From `preloadResources`

A route's `preload` is the only place it says what it loads; Start hydrates
the Resources the preload touched, as it always did.

| Before                                                                              | After                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Route.define(path, { preloadResources: [ProjectById], preload })`                  | `Route.define(path, { preload })`                      |
| `Route.describePreloadResources(route)`, `Route.preloadResourceFamilies(route)`     | `Route.planNavigation(routes, href)`: the touched refs |
| `Route.PreloadResourceInput`, `PreloadResourceDiagnostics`, `PreloadResourceStatus` | removed                                                |
| the Vite dev warning for a `preload` without `preloadResources`                     | removed                                                |

## From Server-Function Resources And Listed Actions

Server reads and writes are now declared once. A Resource with `input` and
`output` schemas and no `load` is a served Resource, and an Action with an
`input` schema and no `run` is a served Action: their schemas are the wire
contract, and `Resource.implement` / `Action.implement` in a `*.server.ts`
module are their server bodies. Start's action transport submits exactly the
served Actions; an Action with `run` runs where it is submitted.

| Before                                                                                                                                                                         | After                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a write as four definitions: `Server.contract`, `Server.client`, `Server.implement`, and `Action.define({ run: (input) => client.effect(input) })`                             | one served Action, `Action.define({ name, input, output?, error?, optimistic?, invalidates? })`, plus `Action.implement(Action, run)` in a `*.server.ts` module |
| a read as `Server.contract` + `Server.client` + `Server.implement` + `Resource.define({ load: (input) => client.effect(input) })`                                              | one served Resource, `Resource.define({ name, input, output, error? })`, plus `Resource.implement(Resource, load)` in a `*.server.ts` module                    |
| `run` mapping a server result to `ActionResult.redirect(...)` / `ActionResult.validation(...)` in the browser                                                                  | `output: Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure])`, and the server body returns the `ActionResult`                                 |
| `App.define({ root, routes, actions: [RenameProject], client })`                                                                                                               | `App.define({ root, routes, client? })`: an Action without `run` is served                                                                                      |
| `createRequestHandler(app, { server, serverFunctions: [getProject] })`                                                                                                         | `createRequestHandler(app, { server, implementations: [projectById, renameProject] })` (`StartImplementation`); `server` must provide their services            |
| a client Layer whose service calls server functions (`ProjectApiLive = Layer.succeed(ProjectApi, { get: (id) => getProject.effect({ id }) })`)                                 | no client Layer for server data: the browser loads served Resources over RPC and submits served Actions over the action transport                               |
| a `domainOnly(...)` helper that turned `Server.ClientError` (`RpcClientError`, `ServerFunctionNotFound`, `SchemaError`, `EffectInputCallbackError`) into defects inside `load` | nothing: a served Resource's failures outside its `error` schema are already defects                                                                            |
| `Server.mockLayer(Server.mock(GetProjectContract, handler))` to test a Resource                                                                                                | `Server.mockLayer(Resource.implement(ProjectById, handler))`                                                                                                    |
| `makeActionTransportLayer({ actions })`                                                                                                                                        | `actionTransportLayer` (internal, no options: `App.launch` provides it, serving the Actions defined without `run`)                                              |
| a string-only form schema (`CreateIssueForm`) plus a function mapping it to the domain input                                                                                   | the domain input schema itself: form decoding reads checkboxes, repeated names, and empty fields as the schema's encoded shape                                  |
| `StartAction.decodeFormData(schema, formData)`                                                                                                                                 | `StartAction.decodeFormData(action, formData)`: decodes into the Action's input, defaults included                                                              |

`Server.contract` / `Server.client` / `Server.implement` remain for a server
call that is neither a Resource load nor an Action, such as a change-feed
poll; its `Server.implement` value goes in `implementations` too.

## From No-JavaScript Posts To The Action Endpoint

A form without JavaScript posts to the page it is on. Start runs the Action
there: a redirect or success answers 303, and a validation failure or failure
renders the page again with the outcome and the posted fields.

| Before                                                                            | After                                                                                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<form method={form.method} action={form.action}>`                                | `<form method={form.method}>`: `StartAction.form` has no `action`                                                                                    |
| a no-JS form post to `POST /__sunfall-arc/action` (the endpoint took form bodies) | a form-encoded or multipart `POST` to the page; the action endpoint takes JSON only                                                                  |
| a no-JS validation failure answered by a 422 JSON page                            | the page rendered again (422): `result()` holds the `ValidationFailure`, and the handle's `formValues()` the posted fields to render as input values |

## From Shared State Through Contexts

A State the shell and the pages share is an app State: one instance per
runtime, bound with the same `Component.state`.

| Before                                                                         | After                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| a parent's `Component.state(Toast)` handle passed down through a Solid context | `State.define({ name, scope: "app", ... })`; each component binds `Component.state(Toast)` |
| a module-level `State.start(Toast, { runtime })` (shared by every SSR request) | `scope: "app"`: the runtime owns it, so each request runtime gets its own                  |
| a `rows.changes` feed that checks it is on the server before subscribing       | nothing: server renders never start feeds; the browser starts them on hydration            |

## From Not-Found Failures And Remounting Search Pages

A preload that finds no record ends with `Route.notFound()`, and one that
sends the visitor elsewhere with `Route.redirect(href)`; both are verdicts,
not failures. A navigation that only changes the search keeps the page's
component instance and updates its props.

| Before                                                                                 | After                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| a typed `ProjectNotFound` route failure (a 500) rendered as a 404-looking failure view | `Effect.catchTag("ProjectNotFound", () => Route.notFound())`: a real 404           |
| redirecting in a host wrapper or after render (`navigate` in an effect)                | `Route.redirect(href)` in the preload: a server redirect and a client navigation   |
| `switch (plan._tag)` over `"Matched"` and `"NotFound"`                                 | handle `"Redirect"` too                                                            |
| `invalidates: (result) => (result._tag === "ValidationFailure" ? [] : tags)`           | `invalidates: () => tags`: a rejected `ActionResult` does not run `invalidates`    |
| `<Show when={props.search.q} keyed>` to reset a page per search                        | nothing: same-page navigations keep the instance; key a child if it must reset     |
| `changes: (input) => feed(input)`                                                      | `changes: (input, rows) => feed(input, cursorOf(rows))` when a feed needs a cursor |

## From Route Params Decode Failures

A URL whose path params the route's `params` schema rejects is now not found:
`Route.match` skips that route (trying the next one) instead of throwing, so
Start answers 404 and the router settles in `NotFound`. Search values still
decode after the match, and a `search` schema failure is still a
`RouteNavigationError`.

| Before                                                                                | After                                                                       |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `expect(() => Route.match(routes, badParamsUrl)).toThrow()`                           | `expect(Route.match(routes, badParamsUrl)).toBeUndefined()`                 |
| a not-found view for a router `Failure` whose `RouteNavigationError` has no `match`   | the router's `NotFound` state (keep the `Failure` view for search failures) |
| UI keyed on `router.match()` that waits for a `Ready` state before reading route data | read it directly: the target match is published once the host prepared it   |

## From Optional Server-Function Schemas

Server functions now run on `effect/rpc`: every contract is an `Rpc`, so its
`input` and `output` schemas are required (`error` defaults to
`Schema.Never`), and the contract's types come from the schemas instead of
explicit type arguments. Start serves them with `RpcServer` and calls them
with `RpcClient` over `HttpClient`; there is no hand-written envelope and no
schema-less wire path.

| Before                                                                                                                                                             | After                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `Server.contract<I, A, E>(name, { input?, output?, error? })`                                                                                                      | `Server.contract(name, { input, output, error? })`: types inferred from the schemas                                              |
| `Server.contract(name)` with no schemas                                                                                                                            | declare the schemas (`input: Schema.Void` for no input, `Schema.Unknown` only where the value is genuinely untyped)              |
| output typed as a mutable array or as `ActionResult` without a matching schema                                                                                     | the schema's type (`ReadonlyArray<A>`; rebuild domain values such as `ActionResult` from the decoded wire shape)                 |
| `fn.input` / `fn.output` / `fn.error`, `fn.invoke(raw)`                                                                                                            | `fn.rpc` (`payloadSchema`, `successSchema`, `errorSchema`); `fn.local(input)` runs the implementation                            |
| `Server.manifest`, `Server.encodeInput` / `decodeInput` / `encodeOutput` / `decodeOutput` / `encodeError` / `decodeError`                                          | removed: the Rpc's schemas are the wire schemas                                                                                  |
| `Server.decodeRpcRequest` / `decodeRpcResponse`, `Server.RpcRequest` / `RpcResponse`, `Server.serializeDefect` / `serializeServerError` / `deserializeServerError` | removed: `effect/rpc` owns the protocol (`RpcSerialization.json`)                                                                |
| `Server.route(method, path, handler)`, `Server.handleRoute`, `Server.Route`, `ServerRouteHandlerError`                                                             | removed: mount HTTP routes with `effect/http` (`HttpRouter`) beside the Start handler                                            |
| `ServerRpcProtocolError` / `ServerTransportError` from a server-function call                                                                                      | `RpcClientError` (transport); payload decode failures, unknown functions, and handler defects arrive as defects                  |
| RPC response `{ _tag: "Success" \| "Failure" \| "ServerError" \| "Defect" }` with 400/404/500                                                                      | `effect/rpc` JSON messages, always `200` (`[{ _tag: "Exit", requestId, exit }]`)                                                 |
| request failure kind `validation` for an RPC payload that fails its input schema                                                                                   | `protocol` (`RpcServer` rejects it before the handler runs)                                                                      |
| `App.launch(app, { transport: { fetch, headers } })`, `StartFetch` / `StartFetchInit` / `StartFetchInput`                                                          | provide an `HttpClient` in the client Layer (`HttpClient.mapRequest(HttpClientRequest.setHeader(...))`, `FetchHttpClient.Fetch`) |
| `makeActionTransportLayer({ fetch, headers, endpoint, transportRuntime, actions })`                                                                                | `App.launch`'s internal `actionTransportLayer`, which requires `HttpClient`                                                      |
| `Server.ClientError` on Action submissions                                                                                                                         | `Action.ClientError`                                                                                                             |
| `ServerTransportError` / `ServerRpcProtocolError` / `ServerFunctionNotFound` from the action transport                                                             | `ActionTransportError` / `ActionProtocolError` / `ActionNotFound` (body `{ _tag: "ActionNotFound", actionName }`)                |

Mocks keep their shape: `Server.mock(contract, handler)` provided through
`Server.mockLayer(...)` still validates through the contract schemas (now the
Rpc's JSON codecs, the wire's). SSR keeps calling implementations in-process.

## From Program And Writable Signals

State is now the one way to hold writable client state. `Program` is renamed
`State` (same loop and `step` semantics), and the public `Signal` API is
read-only, so client state that was a writable Signal becomes a State.

| Before                                                                            | After                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Program.define<Model, Message>({ initial, on })`                                 | `State.define<Model, Message>()({ name, initial, on })`, or `State.define({ name, initial, on })` to infer messages |
| `Program.next` / `emit` / `commands` / `subscription` / `step` / `start`          | `State.next` / `emit` / `commands` / `subscription` / `step` / `start`                                              |
| `Program.Definition`, `Instance`, `Failure`, `Disposed`, ...                      | `State.Definition`, `State.Instance`, `State.Failure`, `State.Disposed`, ...                                        |
| `ProgramFailure` / `ProgramDisposed` tags                                         | `StateFailure` / `StateDisposed`                                                                                    |
| `ProgramStepTypeId`, `ProgramCommandTypeId`, `ProgramSubscriptionTypeId`          | `StateStepTypeId`, `StateCommandTypeId`, `StateSubscriptionTypeId` (plus `StateRefTypeId`)                          |
| an unnamed Program                                                                | `name` is required                                                                                                  |
| `Component.program(Definition, options?)`                                         | `Component.state(Definition, options?)`                                                                             |
| `Component.ProgramHandle` / `ProgramOptions` / `ProgramModelView`                 | `Component.StateHandle` / `StateOptions` / `StateView`                                                              |
| `Component.callback("send", (m) => program.dispatch(m).pipe(Effect.ignore))`      | `state.send.Tag()` / `state.send.Tag({ ...fields })`, DOM-ready                                                     |
| `Signal.make(initial, { name })` written in a named `Component.callback`          | a State: `State.define({ name, initial, on: { Set: (_, message: { readonly value: A }) => message.value } })`       |
| `Signal.batch` / `transaction` / `fromStream` / `updateAndGet`, `Signal.Writable` | no public form; client changes are State messages (internal: `SignalWrites` in `@sunfall/arc-core/internal`)        |
| `SignalWriteOutsideTransition`                                                    | an internal assertion: application code cannot make an unnamed write                                                |
| `transaction.set(writableSignal, update)` in an Action's `optimistic`             | `transaction.set(state, update)` on a `State.Ref` (a `State.Instance` or `Component.state` handle)                  |
| `Timeline.ProgramCause` `{ _tag: "Program", program, event, message }`            | `Timeline.StateCause` `{ _tag: "State", state, event, message }`                                                    |
| label `Program "Board" message Relabel`                                           | `State "Board" Relabel`                                                                                             |
| model signal `Board.model`                                                        | `Board` (the State's `name`); failures stay `Board.failures`                                                        |
| devtools `programs` panel, `program:<name>` nodes                                 | `states` panel, `state:<name>` nodes                                                                                |

Tags stay PascalCase (`send.Toggle`): one spelling in `on`, `send`,
`dispatch({ _tag })`, `State.step`, and the Timeline, matching Effect's
`_tag` convention. A message without fields binds straight to an event
(`onClick={menu.send.Toggle}`); a message with fields takes them
(`search.send.Search({ query })`). Inferred-form commands may only emit
nothing; a State whose commands emit its own messages names the union with
`State.define<Model, Message>()`. A prop-sync message (`ProjectChanged`) is
usually better replaced by keying the Component on the entity, so each entity
gets a fresh State. `Component.callback` stays for Effect work that is not a
State change (submitting Actions, invalidating Resources), and
`Component.stream` stays as a read-only view of a Stream's latest value.
Tests that wrote Signals directly dispatch State messages instead, or, in
framework fixtures, use `SignalWrites` from `@sunfall/arc-core/internal`.

## From Capability

`Capability` is gone: Arc's wrapper added nothing over Effect's own services.
Define an app service with `Context.Service` and provide it with `Layer`.
Resources, Actions, route preload, and Components keep calling
`ProjectApi.use(...)`; the service still joins their `R`.

| Before                                                                        | After                                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Capability.define<ProjectApi>("ProjectApi")`                                 | `Context.Service<ProjectApi>("ProjectApi")` (from `effect`)       |
| `ProjectApi.layer({ ... })`                                                   | `Layer.succeed(ProjectApi, { ... })`                              |
| `ProjectApi.use((api) => api.get(id))` (Effect callback)                      | unchanged                                                         |
| `ProjectApi.use((api) => api.cached)` (plain-value callback)                  | `ProjectApi.useSync((api) => api.cached)`                         |
| `ProjectApi.tag`                                                              | `ProjectApi` (the service is its own key)                         |
| `isCapability`, `CapabilityTypeId`, `Capability.Any` / `Shape` / `Identifier` | removed; the shape is the interface the service was declared with |

## From Collection

Collections are gone: a Resource is the one server-data model. Every
Collection was a second copy of a Resource (`sync: ref` loaded through it,
and Start stored and hydrated both), so the rows now live on the Resource
itself. Move `getKey` and `indexes` into a `rows` option on the Resource the
collection followed (or the one its `sync.load` called), read rows from the
Resource reader, and patch them on the Resource ref.

| Before                                                                         | After                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Collection.define({ name, output: Row, getKey, indexes, sync: ProjectsRef })` | `rows: { key, indexes }` on the Resource behind `ProjectsRef` (`output: Schema.Array(Row)`) |
| `sync: { load, refresh }`                                                      | the Resource's `load` (a forced reload is `Resource.refresh`)                               |
| `sync: { follow }`                                                             | `Resource.invalidate` / tags; a remote feed is `rows.changes`                               |
| `sync: { changes }`, `applyChanges([...])` from a remote feed                  | `rows: { changes: (input) => Stream<ReadonlyArray<Resource.RowChange<Row, Key>>> }`         |
| local-only collection (no `sync`), `applyChanges` for client rows              | a State whose model is the rows (`State.define`), changed by its messages                   |
| `SolidDb.collection(Projects)`                                                 | `Component.resource(ProjectList)`                                                           |
| `projects.rows()`, `projects.get(key)`, `projects.index(name, value)`          | `projects("all")`, `projects.get("all", key)`, `projects.index("all", name, value)`         |
| `projects.waiting()` / `projects.failure()`                                    | `projects.waiting("all")` / `projects.failure("all")`                                       |
| `transaction.update(Projects, key, patch)` (and `insert`, `delete`)            | `transaction.update(ProjectsRef, key, patch)`; the key is typed by `rows.key`               |
| draft updater `(draft) => { draft.name = n }`                                  | pure updater `(row) => ({ ...row, name: n })`                                               |
| row metadata `$key`, `$synced`, `$origin`, `$collection`                       | removed: rows are the output's elements; `waiting` and `Action.outbox` report pending work  |
| `Collection.liveQuery({ query, getKey })`                                      | `Query.live(query)`, or `LiveQuery.bind(query)` in a Component                              |
| `query.from({ project: Projects })`                                            | `query.from({ project: ProjectsRef })`                                                      |
| `SolidDb.liveQuery(query)` from `@sunfall/arc-solid-db`                        | `LiveQuery.bind(query)` from `@sunfall/arc-solid/live-query`; the package is deleted        |
| `persistence: { key, version }`, `persist()`, `restore()`                      | `policy: { persist: { key, version } }` on the Resource (restore is automatic)              |
| `snapshot()` / `hydrate()` / `Collection.HydrationPayload`                     | Resource hydration: rows hydrate as their Resource                                          |
| `preloadCollections: [Projects]`, `Projects.preload()` in a route              | `Resource.preload(ProjectsRef)` in the route's `preload`                                    |
| `App.define({ collections: [Projects] })`                                      | removed: preloaded Resources hydrate on their own                                           |
| `Timeline` cause `Collection`                                                  | `Resource` causes (`change` for a `rows.changes` batch)                                     |
| `QueryPlanSourceDiagnostics.collection`, join strategy `"collection-index"`    | `.resource`, `"index"` (and `"scan"`)                                                       |

- Rows hydrate, cache, and persist once, as the Resource value. A reload is
  diffed by key, so unchanged rows keep their object identity.
- Persisted values move from `arc/collections/v<n>/<name>` to
  `arc/resources/v<n>/<key>/<ref key>`; old snapshots are not read, and the
  Resource simply reloads.
- `ReadonlyCollectionMutation`, `CollectionRowNotFound`,
  `CollectionRowKeyChanged`, `CollectionSnapshotCodecError`, and
  `UnknownCollectionIndex` are removed: an update of a missing key is a no-op,
  and a key change or an unknown index is a defect.

## From Flat Devtools Names

`@sunfall/arc-devtools` exports one `Devtools` namespace plus its two error
classes (`DevtoolsActionInvalidationPlanConflict`,
`DevtoolsPanelContractError`). Drop the `Devtools` prefix or infix and read the
name off the namespace:

| Before                                                                       | After                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `makeDevtoolsStore(options)`                                                 | `Devtools.makeStore(options)`                                      |
| `describeDevtoolsSummary` / `describeDevtoolsCausalGraph`                    | `Devtools.describeSummary` / `Devtools.describeCausalGraph`        |
| `describeDevtoolsPanels` / `renderDevtoolsPanelsHtml`                        | `Devtools.describePanels` / `Devtools.renderPanelsHtml`            |
| `mountDevtoolsPanels` / `bootDevtoolsPanels`                                 | `Devtools.mountPanels` / `Devtools.bootPanels`                     |
| `installDevtoolsBridge` / `sunfallArcDevtoolsBridgeGlobal`                   | `Devtools.installBridge` / `Devtools.bridgeGlobal`                 |
| `resolveSunfallArcDevtoolsBridgePayload`                                     | `Devtools.resolveBridgePayload`                                    |
| `toDevtoolsSerializableValue`                                                | `Devtools.toSerializable`                                          |
| `DevtoolsStore`, `DevtoolsSnapshot`, `DevtoolsPanels`, `DevtoolsSummary`     | `Devtools.Store`, `Devtools.Snapshot`, `Devtools.Panels`, ...      |
| `DevtoolsStartAppGraphDiagnostics`                                           | `Devtools.AppGraphDiagnostics`                                     |
| `DevtoolsBridgePayloadContractResolution`                                    | `Devtools.BridgePayloadResolution`                                 |
| `DevtoolsPanelItem`, `DevtoolsPanelMetric`, `DevtoolsPanelId`                | `Devtools.Panel["items"][number]`, `["metrics"][number]`, `["id"]` |
| `DevtoolsCausalNodeKind` / `DevtoolsCausalEdgeKind`                          | `Devtools.CausalGraph["nodes"][number]["kind"]` / `["edges"]...`   |
| `describeInvalidationPlan(plan)` / `describeRoutePlan(plan)`                 | `store.recordInvalidation(plan)` / `store.recordRoutePlan(plan)`   |
| `isDevtoolsSerializableValue`, `devtoolsPanelIds`, `devtoolsPanelSeverities` | removed; validate payloads with `Devtools.resolveBridgePayload`    |

## From Duplicate Names And Forms

Every public thing now has one name and one form. Types a namespace owns are
reachable only as namespace members; the flat aliases are gone from the
package roots. Pick the namespaced name your editor already offers:
`ActionDefinition` is `Action.Definition`, `ResourceRef` is `Resource.Ref`,
`RouteMatch` / `RouteContext` are `Route.Match` / `Route.Context`,
`ReadableSignal` is `Signal.Readable`, `TimelineEntry` is `Timeline.Entry`,
and so on for every `Action*`, `ActionResult*`, `Form*`, `Program*`,
`Resource*`, `Route*`, `Server*`, `Signal*`, and `Timeline*` type. Error
classes, Type IDs, guards (`isActionDefinition`, `isResourceRef`, ...),
services (`ActionTransport`, `ActionOutbox`, `ResourceStore`,
`RequestContext`), and runtime helpers keep their root names.

| Before                                                                                                | After                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ServerClient` (service and type)                                                                     | `Server.Client` (service and type)                                                                                  |
| `ActionResultSuccess`, `AnyActionResult`, `ActionRedirectStatus`, ...                                 | `ActionResult.Success`, `ActionResult.Any`, `ActionResult.RedirectStatus`                                           |
| `FormValidationError`, `ProgramDisposed`, `ResourceSnapshotCodecError`, `ResourceHydrationApplyError` | `Form.ValidationError`, `Program.Disposed`, `Resource.SnapshotCodecError`, `Resource.HydrationApplyError` (classes) |
| `ActionSubmissionConcurrency`                                                                         | `Action.Concurrency`                                                                                                |
| `ProgramSubscriptionError<Out>` / `ProgramSubscriptionRequirements<Out>`                              | `EffectInputError<Out>` / `EffectInputRequirements<Out>`                                                            |
| `RouteErrorSchema<E>`                                                                                 | `Resource.ErrorSchema<E>` (routes and Resource families share it)                                                   |
| `Route.PreloadError<R>` / `Route.NavigationError<R>`                                                  | `Route.PreloadPlanError<R>` / `Route.NavigationPlanError<R>`                                                        |
| `RouteWithComponent<C>`                                                                               | `Route.WithComponent<R, C>`                                                                                         |
| `AppDefinition`, `AnyAppDefinition`, `AppLaunchError`, `AppLaunchServices`                            | `App.Definition`, `App.Any`, `App.LaunchError`, `App.LaunchServices`                                                |
| `StartActionFormOptions`, `StartActionInvalidationPlan`                                               | `StartAction.FormOptions`, `StartAction.InvalidationPlan`                                                           |
| Solid DB `CollectionHandle`, `LiveQueryHandle`, `*BindingOptions`                                     | `SolidDb.CollectionHandle`, `SolidDb.LiveQueryHandle`, ...                                                          |
| `Form.validate(form)`                                                                                 | `form.validate()`                                                                                                   |
| `Form.error(...)` / `Form.fieldError(...)`                                                            | the validator's `errors.fields(...)` / `errors.field(...)` / `errors.form(...)`                                     |
| `ActionResult.fields` / `fieldError` / `formError`                                                    | `ActionResult.validation({ fieldErrors, formErrors })`                                                              |
| `ActionResult.validateForm(form)` / `ActionResult.fromValidationEffect(effect)`                       | `ActionResult.fromValidation(form.validate())`                                                                      |
| `Query.from(sources)`                                                                                 | `query.from(sources)` inside the query factory                                                                      |
| `route.build(params, search)` / `route.match(url)`                                                    | `Route.href(route, { params, search })` / `Route.match([route], url)`                                               |
| `Server.fn(name, { input, output, error, handler })`                                                  | `Server.implement(Server.contract(name, { input, output, error }), handler)`                                        |
| `Server.stub(name, schemas)`                                                                          | `Server.client(Server.contract(name, schemas))`                                                                     |
| `Server.provideMocks(effect, ...mocks)` / `Server.mockClient(...mocks)`                               | `Effect.provide(effect, Server.mockLayer(...mocks))`                                                                |
| `Server.get(name)`                                                                                    | `Server.functions().get(name)`                                                                                      |
| `capability.mock(service)` / `capability.provide(effect, service)`                                    | `Layer.succeed(Service, service)` / `Effect.provide(effect, Layer.succeed(Service, service))`                       |
| `signal.set((current) => next)`                                                                       | `signal.update((current) => next)`; `set` takes a value                                                             |
| `StartAction.form(action, { actionPath / endpoints / actionManifest / appGraph })`                    | `StartAction.form(action)` (posts to the page it is on)                                                             |
| prerender `{ enabled: true, ... }` / `{ enabled: false }`                                             | prerender `{ ... }` / `false`                                                                                       |
| prerender page `{ path, prerender: { enabled, outputPath } }`                                         | `{ path, outputPath, prerender: false }`                                                                            |
| `StartPrerenderError` operation `"close-server"` / `"create-directory"`                               | a logged warning / `"write-page"`                                                                                   |
| cookie `sameSite: "Strict"` / `"Lax"` / `"None"`                                                      | `sameSite: "strict"` / `"lax"` / `"none"`                                                                           |
| `generateValidatedFileRouteManifestEffect` and other `*Effect` exports                                | `generateFileRouteManifest`                                                                                         |

Adapter packages that implemented the row-store seam or read the app
registry types (`ActionOptimisticRows*`, `AppDefinitionRegistry*`,
`ResourceStoreModule*`, `ResourceFamily`, `AnySchema`) import them from
`@sunfall/arc-core/internal`; they are not application API.

## From Anonymous Signal Writes

Superseded by [From Program And Writable Signals](#from-program-and-writable-signals):
writable Signals are no longer public. Historically, every state change gained a name, so the Timeline reads like a message log.
A Signal changes only inside a named transition; a write anywhere else dies
with `SignalWriteOutsideTransition`, naming the Signal.

| Before                                                    | After                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Signal.make(initial)` / `Signal.make(initial, { name })` | `Signal.make(initial, { name })`: the name is required                                           |
| `onInput={(event) => draft.set(event.target.value)}`      | `const edit = yield* Component.callback("edit", (v: string) => Effect.sync(() => draft.set(v)))` |
| `Component.callback(f)`                                   | `Component.callback("name", f)`: commits as `<Component>.<name>`                                 |
| `Component.stream(stream, initial)`                       | `Component.stream("name", stream, initial)`                                                      |
| `Signal.fromStream(stream, initial)`                      | `Signal.fromStream(stream, initial, { name })`                                                   |
| `Signal.batch(f, { cause: { _tag: "User", label } })`     | `Signal.batch(f, { name })` (likewise `Signal.transaction`)                                      |
| `TimelineUserCause` (`{ _tag: "User", label }`)           | `Timeline.TransitionCause` (`{ _tag: "Transition", name }`)                                      |
| `TimelineEntry.cause: TimelineCause \| undefined`         | `Timeline.Entry.cause: Timeline.Cause`                                                           |
| `Form.make({ schema, initial })`                          | `Form.make({ name, schema, initial })`                                                           |

Solid effects that wrote Signals call a named callback (or become a
`Signal.derive`); tests that wrote Signals directly wrap the write in
`Signal.batch(() => signal.set(value), { name: "test" })`.

## From FileRoute

`FileRoute.define(path)(options)` is removed: a Start route module now exports
`route` built with core `Route.define(path, options)`. The options were already
identical; only the export name and the call shape change. The generated route
tree imports `route` from each module and rejects a declared path that differs
from the path the file location implies (a type error, and an error when the
tree loads).

```ts
// before
import { FileRoute } from "@sunfall/arc-start";
export const Route = FileRoute.define("/projects/:id")({ params: ProjectRouteParams });

// after
import { Route } from "@sunfall/arc-core";
export const route = Route.define("/projects/:id", { params: ProjectRouteParams });
```

Code that imported a route module's `Route` export imports `route` instead.
`Route.Factory<Path>` and the generated `FileRoute` type (`RouteTree[number]`)
are removed with it.

## From Offline Mutation Queues

There is no pending-mutation queue to manage. A change that must survive
going offline is a durable Action: give it an input schema and
`durable: { maxAge }`, provide a `KeyValueStore` in the client Layer
(`KeyValueStore.layerStorage(() => localStorage)`), and make it a served
Action (no `run`, with its `Action.implement` in the Start server's
`implementations`) so the server deduplicates replays. Treat `ActionQueued` from
`submit` as "saved, waiting to sync", and render `Action.outbox` pending and
failures for the global status.

## From Effect-Suffixed Names And Path Addressing

(Collection rows in the table below predate the move to Resource rows; see
[From Collection](#from-collection) for where each now lives.)

This alpha applies three naming rules across every package:

1. Definition constructors are `define`, namespaced: `Resource.define`,
   `Route.define`, `App.define`, `Component.define`,
   beside `Action.define` and `Program.define`.
2. Operations that return Effects carry no `Effect` suffix, and each has one
   form: where a synchronous twin existed it is gone. Hosts without an Effect
   context run the Effect (`Effect.runFork(...)` from a cleanup hook starts
   synchronously; `Effect.runSync(...)` reads a value).
3. Routes are addressed by definition only; the path-keyed helpers are gone.

Handles follow the same rule: members that run work (`submit`, `dispatch`,
`reset`, `preload`, `refresh`) return Effects, and UI event handlers run them
through `Component.callback`, which requires failures to be handled:

<!-- prettier-ignore -->
```tsx
const rename = yield* Component.action(RenameProject);
const save =
  yield* Component.callback("save", (name: string) =>
  rename.submit({ id: props.id, name }).pipe(Effect.ignore),
  );
return () => <RenameForm onRename={save} />;
```

A Start client entry is one Effect: it restores the server's payload and
hydrates the root from the app definition:

```ts
Effect.runFork(App.launch(app));
```

| Old                                                                                                                                       | New                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Resource.family(options)`                                                                                                                | `Resource.define(options)`                                                                                                                    |
| `Resource.requestFamily({ request, resolver, ... })`                                                                                      | `Resource.define({ request, resolver, ... })`                                                                                                 |
| `route(path, options)`                                                                                                                    | `Route.define(path, options)`                                                                                                                 |
| `defineApp(config)`                                                                                                                       | `App.define({ root, routes, ... })` from `@sunfall/arc-start`                                                                                 |
| `defineFileRoute(path)(options)`, `FileRoute.define(path)(options)`                                                                       | `export const route = Route.define(path, options)`                                                                                            |
| `Component.make(name, setup)`                                                                                                             | `Component.define(name, setup)`                                                                                                               |
| `Resource.prefetchEffect` / `refreshEffect` / `statusEffect` / `readEffect`                                                               | `Resource.preload` / `refresh` / `status` / `read`                                                                                            |
| `Resource.deleteEffect(ref)`                                                                                                              | `Resource.evict(ref)`                                                                                                                         |
| `Resource.collectEffect` / `invalidateEffect` / `planInvalidationEffect` / `runInvalidationPlanEffect`                                    | `Resource.collect` / `invalidate` / `planInvalidation` / `runInvalidationPlan`                                                                |
| `Resource.subscribeEventsEffect` / `dehydrateEffect` / `hydrationPayloadEffect` / `hydrateEffect`                                         | `Resource.subscribeEvents` / `dehydrate` / `hydrationPayload` / `hydrate`                                                                     |
| `Resource.encodeHydrationPayloadEffect` / `decodeHydrationPayloadEffect`                                                                  | `Resource.encodeHydrationPayload` / `decodeHydrationPayload`                                                                                  |
| `Route.preloadEffect` / `preloadComponentEffect` / `planPreloadEffect` / `planNavigationEffect`                                           | `Route.preload` / `preloadComponent` / `planPreload` / `planNavigation`                                                                       |
| `Route.preloadFailureSnapshotEffect` / `hydratePreloadFailureEffect` / `lazyComponentPendingEffect`                                       | `Route.preloadFailureSnapshot` / `hydratePreloadFailure` / `lazyComponentPending`                                                             |
| lazy route component `preloadEffect()`, `RouteLazyComponentPending.preloadEffect`                                                         | `preload()`, `.preload`                                                                                                                       |
| `isRoutePathMatch(path, match)` (generated)                                                                                               | `Route.isMatch(route, match)`                                                                                                                 |
| `Action.planInvalidationEffect`                                                                                                           | `Action.planInvalidation`                                                                                                                     |
| `ActionInstance.submitEffect` / `resetEffect` + sync `reset()`                                                                            | `submit` / `reset` (Effects)                                                                                                                  |
| `ActionResult.successEffect` / `failureEffect` / `failEffect` / `redirectEffect` / `validationEffect`                                     | return `ActionResult.success(...)` etc. (or `Effect.succeed(...)` of it)                                                                      |
| `ActionResult.fail`                                                                                                                       | `ActionResult.failure`                                                                                                                        |
| `ActionResult.validateFormEffect` / `requireSuccessEffect`                                                                                | `ActionResult.validateForm` / `requireSuccess`                                                                                                |
| `Capability.useEffect(f)` / `Capability.useSync(f)` / `use(f)`                                                                            | Effect service `use(f)` / `useSync(f)` (see [From Capability](#from-capability))                                                              |
| `form.validateEffect()`, `Form.validateEffect`, `Form.decodeFormDataEffect`                                                               | `form.validate()`, `Form.validate`, `Form.decodeFormData`                                                                                     |
| root `decodeFormDataEffect`, `formDataToObject`                                                                                           | `Form.decodeFormData`, `Form.data`                                                                                                            |
| `Server.handleRouteEffect`, `Signal.fromStreamEffect`                                                                                     | `effect/http` routes (see [From Optional Server-Function Schemas](#from-optional-server-function-schemas)), `Signal.fromStream`               |
| `makeRequestContextEffect` / `applyResponseContextEffect` / `serializeResponseCookieEffect`                                               | `makeRequestContext` / `applyResponseContext` / `serializeResponseCookie`                                                                     |
| `runtime.disposeEffect`, `disposeResourceStoreEffect`, `ResourceStoreModule.disposeEffect`                                                | `runtime.dispose`, `disposeResourceStore`, `ResourceStoreModule.dispose`                                                                      |
| `ResourceStore` `eventBus.publishEffect` / `subscribeEffect` / `shutdownEffect` / `isShutdownEffect` + `isShutdownUnsafe()`               | `publish` / `subscribe` / `shutdown` / `isShutdown`                                                                                           |
| `ResourceStore` registries `size()` + `sizeEffect`, diagnostics `*CountEffect` / `snapshotEffect` + `snapshotUnsafe()`                    | `size`, `*Count`, `snapshot` (Effects)                                                                                                        |
| `Program.command(effect)` / `Program.effect(effect)` / `Program.dispatch(message)`                                                        | `Program.emit(effect)` / `Program.emit(effect)` / `Program.emit(message)`                                                                     |
| Program instance and Solid handle `dispatch(message)` (sync) + `dispatchEffect(message)`                                                  | `dispatch(message)` (Effect)                                                                                                                  |
| Program instance `disposeEffect`                                                                                                          | `dispose`                                                                                                                                     |
| Solid `ActionHandle` `submit(input)` (sync) + `submitEffect(input)`, sync `reset()`                                                       | `submit(input)`, `reset()` (Effects)                                                                                                          |
| router `hrefByPath` / `navigateByPath` / `matchByPath` / `preloadByPathEffect`                                                            | `href(route)` / `navigate(route)` / `Route.isMatch(route, router.match())` / `preload(route)`                                                 |
| router and host controller `preloadEffect`, `disposeEffect` + sync `dispose()`                                                            | `preload`, `dispose` (Effect; host cleanup forks it)                                                                                          |
| `BrowserHistoryAdapter.prepareHrefEffect`                                                                                                 | `prepareHref`                                                                                                                                 |
| `BrowserRouterPath`, `BrowserRouterRouteForPath`                                                                                          | route definitions (`typeof ProjectRoute`)                                                                                                     |
| generated `routeByPath`, `routeIdByPath`, `hrefById`, `hrefByPath`, `layoutsByPath`, `errorBoundaryByPath`, `metadataByPath`              | `routeById`, `Route.href(routeById.<id>)`, `layoutsById`, `errorBoundaryById`, `metadataById`                                                 |
| generated `RouteByPath`, `RouteIdByPath`, `FileRoutePath`, `FileRoute*ByPath`, `FileRouteMatch`                                           | the id-keyed types (`RouteById`, `FileRouteParamsById`, ...)                                                                                  |
| Collection `preloadEffect` / `refetchEffect`                                                                                              | `preload` / `refresh`                                                                                                                         |
| Collection `insert` / `update` / `delete`, `sync.insert` / `update` / `delete`, `flushPendingMutations`                                   | an Action: `optimistic: (input, tx) => tx.update(Collection, key, patch)`, `run`, `invalidates`                                               |
| Collection `applyChangesEffect`                                                                                                           | `applyChanges` (remote feeds and local-only collections)                                                                                      |
| Collection `snapshotEffect` + sync `snapshot()`, `hydrateEffect`, `persistEffect`, `restoreEffect`                                        | `snapshot`, `hydrate`, `persist`, `restore`                                                                                                   |
| Collection `state()`, `Query.Live` `state` / `data`                                                                                       | `result()`, `result` / `rows`                                                                                                                 |
| Collection sync adapter `refetch`                                                                                                         | `refresh`                                                                                                                                     |
| `Collection.flushAllPendingMutationsEffect` / `backgroundSyncPendingMutationsEffect`                                                      | removed: Actions own writes                                                                                                                   |
| Solid DB handle `result()` / `preloadFailure()`, `onPreloadFailure`, `pendingMutations()`                                                 | `waiting()` / `failure()`; a never-loaded failure throws to `<Errored>` (`catchTags`)                                                         |
| `Route.define(path, { component })`                                                                                                       | `Route.withComponent(route, Component, props?)`                                                                                               |
| `Collection.RuntimeError<E>`, `collection.preload().pipe(Effect.orDie)` in a route preload                                                | `E`: collection loads fail only with their declared error; contract breaks are defects                                                        |
| Vite plugin `serverFunctionManifest` / `actionManifest` options                                                                           | removed                                                                                                                                       |
| `serializeFileRouteManifest` / `deserializeFileRouteManifest`, `FileRouteManifestParseError`, branded `FileRouteId` / `FileRouteSourceId` | removed: manifests are plain validated data; ids are strings                                                                                  |
| `describeFileRouteManifest`, generated `fileRouteMetadata` / `FileRouteMetadata`                                                          | `layoutsById` / `errorBoundaryById` / `metadataById`                                                                                          |
| `generateFileRouteManifestArtifact`, `generateValidatedFileRouteManifest(Artifact)`, `filePathToFileRouteModuleSync`                      | `generateFileRouteManifest` (an Effect), `filePathToFileRouteModule`                                                                          |
| Vite plugin `autoCodeSplitting` (route components split by rewriting source)                                                              | `Route.lazyComponent(importer)`; in file routes, a sibling `<route>.component.tsx` default export the generated tree attaches lazily          |
| `catchTags({ LoadErrorTag })` on a reader of a Resource without `error` (render failure was the raw load error)                           | declare `error: LoadErrorSchema` on the Resource, or handle `ResourceUntypedFailure` (its `tag` only)                                         |
| Resource `error: unknown` (diagnostics only)                                                                                              | `error` is a `Schema.Codec<E>` (`Resource.ErrorSchema<E>`): `load` must fail within it and it defines the declared error                      |
| raw typed failure serialized by `<Errored>` during SSR                                                                                    | the Solid adapter throws only a safe wire value: schema-encoded Resource failure, `_tag` without a schema, nothing for setup failures/defects |
| app graph route diagnostics `component` presence                                                                                          | removed: components attach with `Route.withComponent` in app modules                                                                          |
| `validateStartAppGraphActionBehaviorEffect`, `StartBuildPolicy.actionBehavior`, `diagnostics.unknownActionBehavior`                       | removed                                                                                                                                       |
| `Option.getOrUndefined(AsyncResult.error(action.result()))`, `action.result().waiting`                                                    | `action.failure()` (a `Cause`), `action.waiting()`                                                                                            |
| `optimistic: (input, tx) => ... return Effect.void` (rollback Effect)                                                                     | `optimistic: (input, tx) => tx.set(...)` (the transaction owns rollback)                                                                      |
| `Query.onceEffect`, `Query.Live` `preloadEffect` / `refetchEffect`                                                                        | `Query.once`, `preload` / `refresh`                                                                                                           |
| Solid DB `LiveQueryHandle` `data` / `preloadEffect` / `refetchEffect`                                                                     | `rows` / `preload` / `refresh`                                                                                                                |
| `createHtmlResponseEffect`, `createStartStreamedHtmlResponseEffect`, hand-written shells                                                  | Start's document: `createRequestHandler(app, { document })`                                                                                   |
| `hydrateFromDocument` (sync) + `hydrateFromDocumentEffect`, `HydrateFromDocumentEffectOptions`                                            | `hydrateFromDocument` (Effect), `HydrateFromDocumentOptions`                                                                                  |
| `StartAction.decodeFormDataEffect`                                                                                                        | `StartAction.decodeFormData`                                                                                                                  |
| Devtools store `getSnapshotEffect`, `recordActionStateEffect`, ... + their sync twins                                                     | `getSnapshot`, `recordActionState`, ... (Effects)                                                                                             |
| Devtools `trackActionEffect` / `trackTimelineEffect`                                                                                      | `trackAction` / `trackTimeline`                                                                                                               |
| `installDevtoolsBridge` (sync) + `installDevtoolsBridgeEffect`, `mountDevtoolsPanelsEffect`                                               | `installDevtoolsBridge` (scoped Effect), `mountDevtoolsPanels`                                                                                |
| `DevtoolsPanelBoot.interruptEffect`                                                                                                       | `boot.interrupt()` (the host facade's one stop)                                                                                               |
| `import { stableStringify, StableStringify* } from "@sunfall/arc-core"`                                                                   | internal plumbing (`@sunfall/arc-core/internal`); app keys come from Resource key codecs                                                      |
| `RequestContext.cookies` duplicate names kept the last value; malformed `%` escapes failed the request                                    | Effect `Cookies.parseHeader`: the first value wins (RFC 6265 order); undecodable values stay raw                                              |
| `setCookie` encoded invalid cookie names with `encodeURIComponent`                                                                        | names must be RFC 6265 tokens, else `ResponseCookieSerializationError` (`attribute: "Name"`); new `partitioned` / `priority` options          |
| `ResourceStore.fiberRegistry` `track` / `untrack` / `drain`, `ResourceStoreFiber`                                                         | `fiberRegistry.run(effect)` (an Effect `FiberSet` in the store's Scope; disposal interrupts it)                                               |

The migration is done when no `*Effect`-suffixed Arc name remains in app code,
event handlers reach Effects only through `Component.callback`, and routes are
addressed by their definitions.

## From The Start Diagnostics CLI And App Graph

Start no longer builds an app graph, so the tooling that read it is gone:

| Before                                                                                                                            | Now                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `sunfall-arc-start diagnostics` / `graph` / `impact` (the package `bin`)                                                          | removed; read `routeTree.gen.ts`, `Resource.diagnostics()`, and `Route.planNavigation` |
| `@sunfall/arc-start/diagnostics-report`, `createStartAgentGraph(...)`                                                             | removed                                                                                |
| `virtual:sunfall-arc/app-graph`, `virtual:sunfall-arc/app-graph/runtime-diagnostics`                                              | removed                                                                                |
| `virtual:sunfall-arc/server-functions`, `virtual:sunfall-arc/actions`, `__SUNFALL_ARC_*__` manifest defines                       | removed (`virtual:sunfall-arc/file-routes` and `virtual:sunfall-arc/routes` remain)    |
| `buildPolicy: true`, `buildPolicy.wireSchemas`                                                                                    | removed; `buildPolicy` is `{ staticClient }`                                           |
| `buildPolicy.diagnostics.routePreloadResources.requireDeclaredForPreload`                                                         | removed: a route's `preload` is its only declaration of what it loads                  |
| `@sunfall/arc-start/internal`                                                                                                     | removed                                                                                |
| Vite plugin `rpcPath` / `actionPath`, `createRequestHandler(app, { endpoints })`, `App.launch(app, { transport: { endpoints } })` | removed: the endpoints are fixed at `/__sunfall-arc/rpc` and `/__sunfall-arc/action`   |
| `StartTransportEndpointPathError`, `StartTransportEndpointConflictError`, `StartTransportEndpointOverrides`                       | removed                                                                                |
| `StartAction.form(action, { action: url })`                                                                                       | `StartAction.form(action)`                                                             |

The plugin also no longer loads the server entry through a second Vite server
at startup to name server functions and Actions: nothing consumed those names.

## From Request Trace Callbacks

Start no longer builds a request-trace DTO. Each request is a
`sunfall-arc.start.request` Effect span whose attributes carry the route plan,
failure kind, response, stream state, and runtime teardown.

| Before                                                         | Now                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `createRequestHandler(app, { onRequestTrace })`                | removed; provide an Effect `Tracer` in the `server` Layer           |
| `onRequestTrace: (trace) => store.recordRequestTrace(trace)`   | `server: Layer.mergeAll(AppServices, Devtools.layerTracer(store))`  |
| `StartRequestTrace`, `StartRequestTraceHandler`                | removed; read the request span's attributes                         |
| `Devtools.RequestTrace`, `RuntimeEvent` `_tag: "RequestTrace"` | `Devtools.Span` (`snapshot.spans`); requests are `summary.requests` |
| `store.recordRequestTrace(trace)`, `requestTraceLimit`         | `store.recordSpan(span)`, `spanLimit`                               |
| `summary.requests.traces`, `overview.requestTraceCount`        | `summary.requests`, `overview.requestCount`                         |
| causal `RequestTrace` / `Endpoint` / `ServerFunction` nodes    | removed; follow the request span's child spans                      |

## From Reducers And Effect Queues

Reducer loops often split model transitions, async work queues, and component
effects across several files. In Sunfall Arc, move that loop into a State:

- The reducer state becomes `initial`.
- The action union becomes a State message union tagged with `_tag`
  (`"increment"` becomes `{ _tag: "Increment" }`).
- The reducer switch becomes the `on` map of `State.define({ name, initial, on })`,
  one pure handler per `_tag`. There is no `update(model, message)` callback,
  and a handler never returns an Effect.
- A handler returns the next model directly, or `State.next(model, commands)`
  when work should run after the model commits.
- Follow-up work is a command from `State.emit(...)`: `State.emit(message)`,
  `State.emit(Effect.tryPromise(...).pipe(Effect.map(...)))`, or an Effect
  that completes with `void` when the work emits no message. Commands that
  emit the State's own messages need the explicit form,
  `State.define<Model, Message>()({ ... })`.
- Long-lived external inputs become `Stream` subscriptions attached to the
  State definition.

The migration is done when models and messages are plain values, Promise work is
wrapped at the Effect edge before a follow-up message is emitted, and
`State.step(definition, model, message)` tests each transition as a pure
function call without mounting a UI.

Earlier alphas accepted an `update` callback (which could return an Effect),
`Program.update(handlers)`, and the `Program.story(...)` harness. Move every
`update` into `on`, move Effect work in handlers into `State.emit(effect)`
commands, and replace stories with `State.step(...)` plus running a
command's `effect`.

## From Solid Hooks To Components

Earlier alphas offered two Solid models: hooks under a `RuntimeProvider`
(`useResource`, `useAction`, `useProgram`, `useStream`, `useRuntimeEffect`,
`useCollection`, `useLiveQuery`) and typed `Component`s. Components are now the
only model:

- A component that called hooks becomes
  `Component.define(name, function* (props) { ...; return () => <View /> })`.
  Setup runs once per instance, like a hook-calling component body.
- `useResource` / `useResourceSuspense` become `yield* Component.resource(Family)`
  and render `reader(input)` under `<Loading>`; status UI reads
  `reader.waiting(input)` / `reader.failure(input)` instead of `result()`.
- `useAction(Definition)` and `StartAction.use(Definition)` become
  `yield* Component.action(Definition)`; in a Start app, an Action defined
  without `run` is served (its `Action.implement` runs on the server).
- `useProgram`, `useStream`, and `useRuntimeEffect` become `Component.state`,
  `Component.stream`, and `Component.callback`.
- `useCollection` becomes `Component.resource` of a Resource with `rows`, and
  `useLiveQuery` becomes `LiveQuery.bind` (see [From Collection](#from-collection)).
- `<RuntimeProvider runtime>` plus `<RouterProvider routes>` become
  `yield* Component.router(routes)` and `<RouterProvider router={router}>`, and
  a Start app's entries become `createRequestHandler(app, { server })` and
  `Effect.runFork(App.launch(app))` over one `App.define({ root, ... })`.

The migration is done when every service the tree needs is in its root
component's `R`, and `Component.launch` type-checks against the runtime.

## From TanStack Query

TanStack Query usually spreads data behavior across query keys, query functions,
mutation callbacks, and invalidation calls. In Sunfall Arc, move that behavior
behind Resource families and Actions:

- Query keys become `Resource.define({ name, input, output })` refs.
- Query functions become server loads, `Resource.implement(Resource, load)`
  over an Effect service; a Resource whose data never leaves the client keeps
  a `load` of its own.
- `invalidateQueries(...)` becomes `Resource.invalidate(...)` or an
  Action invalidation plan.
- Mutation callbacks become `Action.define(...)` definitions with retry,
  concurrency, optimistic work, and invalidation metadata attached to the
  definition. UI binds them with Solid's `Component.action(...)`; an Action
  defined without `run` is served (its `Action.implement` runs on the
  server) and submits over the network through the same handle, and
  `StartAction.form(...)` renders it as a progressive no-JS form.
- Route loaders call `Resource.preload(...)` in `preload`; file routes export
  `route = Route.define(path, options)`, the same constructor as any route.

Keep Promise-returning query functions at the host boundary only. Inside the
framework slice, prefer Effect loaders so retries, services, scopes, tracing,
and interruption stay visible.

## From TanStack Start

TanStack Start route files often combine route definitions, loaders, server
functions, and generated route typing. Sunfall Arc keeps the same copyable route
shape but makes route facts explicit:

- File routes export `route = Route.define(path, options)`; Start generates
  the route maps and fails when the declared path differs from the file's.
- Server reads and writes become served Resources and Actions, implemented
  with `Resource.implement(...)` and `Action.implement(...)` in `*.server.ts`
  modules; other server functions use `Server.contract(...)`,
  `Server.implement(...)`, and browser-safe contract imports.
- Request handling starts at `createRequestHandler(app, { server,
implementations })`; Promise handlers are host convenience boundaries.
- Start renders the app root into its own streamed document; a route sets its
  head and headers through the handler's `document` function instead of
  hand-written HTML.
- A route's loader becomes its `preload`; Start server renders and hydrates
  what it loads.

When moving a route, migrate the route path, schemas, Resource preloads, and
served definitions together. A route that compiles but hides preload ownership is
not migrated yet.

## From Remix-Style Forms

Remix-style actions commonly encode validation, redirects, and mutation side
effects in one request function. In Sunfall Arc, split the contract from the UI
transport:

- Form input schemas live on the Action definition, and its server body is
  `Action.implement(...)`.
- Validation failures return `ActionResult.validation(...)` with typed field and
  form errors; a served Action declares `ActionResult.ValidationFailure` in
  its `output`.
- Redirects return `ActionResult.redirect(...)`, declared as
  `ActionResult.Redirect`.
- Browser forms use `StartAction.form(...)` for no-JS fallback and hydration
  metadata.
- Client-side submits call the Component's action handle: `submit(input)`
  returns the submission Effect, run from a handler through
  `Component.callback` or composed inside a State command or workflow.

The migration is done when the same Action definition owns schema validation,
no-JS fallback, optimistic behavior when needed, retry/concurrency policy, and
Resource invalidation.

## From Ad Hoc Service Mocks

Ad hoc mocks usually replace imports directly, which makes SSR, client tests,
and route preloads disagree about the service graph. Sunfall Arc uses
Effect services and Layers instead:

- Define an Effect service (`Context.Service`) for each service interface the
  app owns.
- Provide production behavior through the server Layer passed to
  `createRequestHandler(app, { server })`, the client Layer in
  `App.define({ client })`, or `makeRuntime(...)`.
- Provide test behavior through `Server.mockLayer(...)` (with `Server.mock(...)`
  handlers or test implementations such as
  `Resource.implement(definition, testLoad)`), test Layers for the service, or
  a runtime created for the test.
- Keep server-only implementations in `.server.ts` modules and prove they stay
  out of browser bundles with a leak scan.

Prefer mocking the interface at the service or contract level. Avoid mocking
deep modules that callers should not know exist.
