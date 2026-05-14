# Effect UI Architecture

Effect UI is a client-first, server-capable framework built around Effect v4 and TSRX.

The v0 implementation deliberately uses TSRX's Solid target instead of a custom compiler
target. The public API is owned by Effect UI:

- `Signal` for fine-grained client state.
- `Resource` for typed async/cache state.
- `Collection` / `Query` for normalized client data, optimistic row mutations,
  and live materialized queries.
- `Action` for user-triggered effects and invalidation.
- `Capability` for named app services and test layers.
- `route` / `Route` for typed routes.
- `RouterProvider` / `RouterOutlet` for browser history, route preload, and route-owned scopes.
- `Server.contract` / `Server.client` / `Server.implement` for schema-described server calls.

Future versions can add a custom TSRX host profile once the runtime semantics are stable.

The full product direction is described in
[Best Full-Stack Framework Plan](./best-framework-plan.md). This architecture
document explains the concrete shape behind that plan: the runtime spine,
dependency injection, routing, resources, collections, actions, server
contracts, SSR, hydration, diagnostics, and devtools all converge on one typed
app graph.

## Target Architecture

The end-state architecture has four layers that intentionally share the same
domain vocabulary.

1. Definition layer: schemas, branded ids, capabilities, server contracts,
   resources, collections, actions, forms, and routes are stable typed
   definitions. Definitions are safe to import broadly when they do not include
   server handlers.
2. Generated graph layer: file-route manifests, server function manifests,
   action manifests, generated route definitions, and Start app graph
   diagnostics turn definitions into deterministic machine-readable artifacts.
3. Runtime layer: `EffectUiRuntime`, request runtimes, `ResourceStore`,
   `Collection.Store`, UI scopes, route scopes, action fibers, server clients,
   response context, hydration, and event streams execute the graph through
   Effect services and scopes.
4. Inspection layer: diagnostics, devtools summaries, causal graphs, repair
   reports, type tests, integration tests, and agent workflows consume public
   graph/runtime facts rather than private maps.

The architectural rule is simple: every important runtime fact should have a
definition-time owner when possible, a generated diagnostic fact when useful, an
Effect event when it changes, and a test that proves the contract.

## Design Pressures

Effect UI should stay unusually strict in these places:

- server contracts are shared, handlers are server-only;
- request work gets a fresh runtime and store;
- route preload is typed, interruptible, and declared for diagnostics;
- resources and collections live in the active runtime/store, never global
  process state;
- actions own mutation policy, optimistic work, invalidation, and result shape;
- public async APIs return Effects;
- Promise boundaries are explicit host or platform adapters;
- generated artifacts are deterministic and source-attributed;
- devtools use public Effect streams and app graph facts;
- tests mock services through layers and contracts.

This strictness is what lets the component API stay simple without losing
correctness.

TSRX needs its own TypeScript tooling in addition to the Vite transform. The
Solid Vite setup is `tsrxSolid()` before `solid()`, and command-line checks use
`tsrx-tsc` with `@tsrx/typescript-plugin` registered in `tsconfig.json`. Do not
replace this with a broad `declare module "*.tsrx"` shim; that makes imports
compile, but it erases the component prop types we want the framework to protect.

Non-TSRX packages use `tsgo` for package build and typecheck work. TSRX projects
still use `tsrx-tsc` because the TSRX command-line path wraps TypeScript through
Volar, registers `.tsrx` as an extra supported extension, and type-checks the
virtual TypeScript generated from TSRX source. Plain `tsgo` does not currently
load that TSRX virtual-file path, so `tsgo` is the right default for ordinary
framework packages and `tsrx-tsc` remains the correctness path for `.tsrx`
projects.

The default UI integration does not require TSRX `try/pending/catch`. A resource
is a typed state machine with an Effect API:

```tsx
const project = useResource(() => ProjectById(props.id));

return project.match({
  initial: () => <ProjectSkeleton />,
  pending: (previous) => previous ? <ProjectView project={previous} refreshing /> : <ProjectSkeleton />,
  success: (value) => <ProjectView project={value} />,
  failure: (error, previous) =>
    previous ? <ProjectView project={previous} error={error} /> : <ProjectError error={error} />
});
```

TSRX remains the authoring language for component templates, while Effect handles
retry, cancellation, scoped cleanup, error recovery, and server boundaries.

Framework callbacks are intentionally Effect-typed. `Resource.load`,
`Action.run`, `Server.implement` handlers, and route preload should return
`Effect` or a pure value. Promise APIs are converted with `Effect.tryPromise` at
the adapter edge, not hidden inside application definitions.

Schemas carry nominal meaning, not only runtime validation. Domain identifiers
that cross framework seams should use `Schema.brand`, so route params, resource
inputs, action payloads, server contracts, and manifests cannot accept a random
string by structural accident:

```ts
export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const makeProjectId = (id: string): ProjectId =>
  Schema.decodeUnknownSync(ProjectId)(id)
```

## Runtime Spine

Every app has an `EffectUiRuntime`, backed by Effect `ManagedRuntime`. A
client-only app gets the default empty runtime; a full-stack app gets a runtime
from `defineApp({ server })`, usually an Effect `Layer`.

The runtime also owns a `ResourceStore`. `Resource.family(...)` is only the
Resource Definition; live resource entries, Effect `Cache` instances, known
inputs, tag indexes, hydration state, and resource lifetime fibers live in the
current runtime/request store. This is the seam that keeps SSR requests,
browser sessions, and test runtimes from sharing hidden process-global async
state.

Start creates a Request Runtime for every SSR or RPC request. A Request Runtime
shares the app's Effect services but gets a fresh Resource Store. Route preload,
render, server functions, hydration payload creation, and synchronous
`Resource.read(...)` during render all run through that request runtime, then
the Resource Store is disposed at request completion to interrupt any lifetime
fibers.

Request and response facts are ordinary services. `RequestContext` exposes the
current `Request`, parsed `URL`, headers, and cookies. `ResponseContext` lets
preload, render, server functions, actions, and server routes set status,
headers, and cookies through Effect:

```ts
yield* ResponseContext.use((response) =>
  Effect.gen(function* () {
    yield* response.setHeader("x-project", "atlas")
    yield* response.setCookie("session", token, {
      httpOnly: true,
      path: "/",
      sameSite: "Lax"
    })
  })
)
```

Start applies the accumulated response context to the final `Response`, including
RPC and progressive action responses, before the host adapter writes it. This
keeps cookies and headers inside the request runtime instead of forcing app code
to thread mutable response objects through every API.

For non-streaming responses, request completion is the moment the handler has
created the `Response`. For streamed responses, Start wraps the response body and
closes the Request Runtime only after the body closes or the browser/server
adapter cancels it. This keeps server render streams, deferred hydration chunks,
resource GC fibers, and request-local services alive for the actual lifetime of
the HTTP response.

The runtime is the one place where host boundaries are allowed to run Effects:

- Server function Promise calls use the current runtime.
- `Resource.prefetch` / `refresh` use the current runtime.
- `Action.use(...).submit` can run on an explicit runtime.
- Start request handlers run SSR preload and render through `app.runtime`.
- Solid `RuntimeProvider` / `RouterProvider` pass the runtime to resources,
  actions, route preloads, and route components.

That means services, tagged errors, request context, scopes, retries, and
fibers all flow through one Effect-native execution model instead of being
hand-wired per feature.

## Capability Services

Application features should depend on capabilities, not directly on transport
details. A capability is a thin Effect UI convention over `Context.Service` plus
layer helpers:

```ts
export interface ProjectApi {
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectError>
  readonly rename: (input: RenameProjectInput) => Effect.Effect<Project, ProjectError>
}

export const ProjectApi = Capability.define<ProjectApi>("ProjectApi")

export const ProjectApiLive = ProjectApi.layer({
  get: (id) => getProject.effect({ id }),
  rename: renameProject.effect
})
```

Resources, actions, and route preload depend on `ProjectApi.use(...)`. Server
functions are one live implementation; tests can swap `ProjectApi.mock(...)`
without importing server modules or replacing app code.

## Progressive Actions

Actions can be exposed to Start as request-runtime work:

```ts
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  run: (input) => ProjectApi.use((api) => api.submitName(input))
})

export const handleRequest = createRequestHandler(app, {
  actions: [SubmitProjectName],
  render
})
```

`POST /__effect-ui/action` accepts either JSON (`{ name, input }`) or ordinary
form bodies. Start decodes the input with the Action Definition schema, runs the
action through the Request Runtime, and maps `ActionResult` values to HTTP:

- `ActionResult.redirect(...)` becomes an HTTP redirect for form posts and a
  typed redirect envelope for JSON action clients.
- `ActionResult.validation(...)` becomes a typed `422` JSON payload.
- `ActionResult.success(...)` and non-ActionResult values become typed success JSON.
- Effect failures become typed failure JSON when the action has an error schema;
  protocol and defects stay separate.

When a JSON action produces an invalidation plan, Start dehydrates the refreshed
resource refs from the request-local Resource Store and includes them in the
response metadata. `submitStartActionEffect(...)` hydrates that payload into the
client runtime, so server-posted mutations can update the same Resource cache
graph as local `Action.use(...).submitEffect(...)` calls.
`StartAction.use(...)` wraps that transport in an Action-like client instance
for components that need idle, pending, success, and failure state without
leaving the Start request path. It also exposes read-only `invalidation` and
`hydration` signals for the latest successful response, giving devtools and UI
code the same causal facts carried by the transport.

The small `startActionForm(action, { input })` helper generates the form method,
action URL, and hidden metadata fields. Visible form controls are merged over
the hidden JSON input before schema decode, so a form can carry stable values
such as `id` and `redirectTo` while the user edits fields like `name`.

This is the progressive enhancement seam: with JavaScript, the Solid handler can
intercept and call `Action.use(...).submit`; without JavaScript, the same form
posts to Start and runs the same Action Definition, Capability services,
schemas, retries, and invalidation policy.

## Resource Dependency Graph

Resource dependencies are semantic tags, not string cache keys. Families can say
which domain facts a successful value provides:

```ts
const ProjectsTag = Resource.tag("Projects")
const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id
})

const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  load: (id: ProjectId) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })]
})
```

Actions can invalidate refs directly or invalidate the tags they changed:

```ts
const RenameProject = Action.define({
  name: "Project.rename",
  run: (input: RenameProjectInput) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })]
})
```

At runtime, successful resource loads update a tag index from tag key to known
resource refs inside the active Resource Store. Invalidating a tag refreshes
every live resource ref in that store that last provided it. This gives
mutations a typed dependency graph without coupling actions to route shapes,
component trees, or hand-written cache-key strings, and without leaking a server
request's resource graph into another request.

Resource, collection, and action definitions also publish static diagnostics for
tooling.
`Resource.diagnostics()` reports declared families, tags, schema flags,
tag-providing behavior, and stale/GC/retry policy. `Collection.diagnostics()`
reports declared collection names, schema flags, load presence, mutation
handlers, retry policy, and persistence policy. Start action manifests report
whether invalidation, optimistic updates, retry policy, and concurrency are known
for each action. Generated definitions can prove action facts from
`Action.define(...)`; hand-written manifests can opt in, otherwise diagnostics
mark the behavior as `unknown`.

The graph is inspectable before it is executed:

```ts
const plan = Resource.planInvalidation([
  ProjectsTag,
  ProjectTag({ id: project.id })
])

plan.entries.map((entry) => ({
  ref: entry.ref.key,
  causes: entry.causes
}))
```

`Action.use(...)` exposes the latest `invalidationPlan` as a signal, and
`@effect-ui/devtools` can serialize the plan into plain data for a panel or
trace view. The intended debugging loop is “this mutation invalidated these
domain facts, which matched these live resource refs, for these causes.”

`DevtoolsRequestTrace` is the request-level join point for the same public
facts. A trace records request and response context, service names, route plans,
resources, collections, server functions, actions, streams, fibers, status, and
teardown in JSON-safe data. Start request handlers expose an `onRequestTrace`
hook that emits a structurally compatible payload for SSR, server RPC, Start
actions, response stream close, stream cancellation, and request failure paths.
Teardown facts include runtime disposal, reason, start/completion timestamps,
duration, and before/after Resource Store snapshots.

The same request boundary is also wrapped in Effect observability primitives.
Start adds an `effect-ui.start.request` span with request annotations, child
spans for server RPC and Start action execution, log annotations for request
identity, and exported Effect metrics for request count, request duration, and
request status. The JSON-safe `onRequestTrace` hook remains the devtools data
contract, while Effect tracers, loggers, and metric exporters can consume the
runtime-native signals.

## Component Runtime

Every mounted component gets a `UiScope` backed by Effect `Scope`. Closing the UI
scope closes the Effect scope, so finalizers run and scoped fibers are
interrupted.

```ts
const title = Signal.make("Effect UI")

watch(
  () => read(title),
  (value) => Effect.sync(() => {
    document.title = value
  })
)

forkScoped(
  Effect.gen(function* () {
    yield* Effect.sleep("1 second")
    yield* Effect.log("still mounted")
  })
)

onDispose(() => Effect.log("component disposed"))
```

Use `watch` only for imperative sinks. Use `Signal.derive`, `Resource`,
`Action`, and `Stream` for application state.

Resource families keep a synchronous signal for UI reads, but their backing
cache is Effect `Cache` stored in the current Resource Store. `prefetchEffect`
uses `Cache.get`, `refreshEffect` uses `Cache.refresh`, failures are not
retained as cache hits, and `gcFor` is applied as the Effect cache TTL.

Visible resource entry GC is also Effect-native. Successful loads fork an
immediately-started, interruptible `Effect.sleep(gcFor)` fiber; refreshes,
failures, hydration, explicit deletion, and Resource Store disposal interrupt the
old lifetime fiber before moving the entry to its next state. The Promise
methods are only host/UI adapters over the Effect forms.

The Resource Store also exposes an Effect `PubSub` event stream. Consumers can
subscribe with `Resource.subscribeEventsEffect()` to observe pending, success,
failure, hydration, deletion, and GC scheduling facts for the active runtime.
This gives devtools and tests a stable Interface for resource behavior without
reading private cache maps.

## Streaming Responses

`@effect-ui/start` exposes an Effect-native streaming Module for SSR shells and
progressive resource payloads:

```ts
const response = yield* createHtmlResponseEffect({
  shell: "<!doctype html><html><body>",
  chunks: Stream.make(
    htmlChunk("<main>ready</main>"),
    streamHydrationChunk(payload)
  ),
  tail: "</body></html>"
})
```

The core Interface is `createHtmlStreamEffect`, which returns an Effect `Stream`
of bytes. `createReadableHtmlStreamEffect` and `createHtmlResponseEffect` are
host adapters. Shell, chunk, and tail failures become typed `StartStreamError`
values, so streaming remains Effect-native until the final web platform seam.
When a Start render returns a streamed `Response`, the Request Runtime is held
open until the body is consumed or cancelled.

## Router Runtime

Routes are schema-typed values with href generation, matching, and preload:

```ts
export const ProjectRoute = route("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
  preloadResources: [ProjectById],
  preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id))
})

Route.href(ProjectRoute, {
  params: { id: makeProjectId("atlas") },
  search: { tab: "activity" }
})
```

The Solid adapter owns browser history through `RouterProvider`. On navigation it
matches the route, runs `Route.preloadEffect` in an interruptible `UiScope`, then
mounts the matched route component in a fresh route `UiScope`. Navigating away
disposes the route scope, so streams, watches, actions, and scoped fibers close
with the page they belong to.

Preload is also inspectable as a route data graph:

```ts
const plan = yield* Route.planNavigationEffect(routes, "/projects/atlas")

if (plan._tag === "Matched") {
  plan.match.route.path
  plan.refs.map((ref) => ref.key)
  plan.resources.resources
}
```

This runs route preload through `Resource.collectEffect`, so the framework can
explain which resources a navigation touched and which hydration entries it
would send before rendering the page. Start uses this same route plan for
SSR preload. When `@effect-ui/start` is present, it separately composes
`Collection.collectEffect` around the route plan so DB collection preload can be
observed without making `@effect-ui/core` depend on `@effect-ui/db`.

Routes can also declare the resource families and DB collections their preload
is expected to touch through `preloadResources` and `preloadCollections`. The app
graph treats those declarations as static facts and keeps runtime
`Route.planNavigationEffect(...)` plus Start collection collection as the
dynamic proof for a concrete href. If a route has a preload but no declaration,
graph diagnostics report the preload resources or collections as `unknown`
rather than guessing. Once route modules have been resolved,
`unknownRoutePreloadResources` and `unknownRoutePreloadCollections` name routes
that still have `preload: present` with unknown preload declarations, and the
typed diagnostics validators can enforce those as policy.

File routes are manifest-first in v0. The pure helpers
`generateFileRouteManifest(files, { routeDirectory })` and
`generateValidatedFileRouteManifestArtifactEffect` turn known route module paths
into route metadata. The Start Vite plugin is the filesystem boundary: when no
explicit `fileRoutes` or `fileRouteManifest` is supplied, it discovers route
modules from the Vite root's `src/routes` directory and feeds that deterministic
file list into the validated manifest generator. The generated artifact is
`FileRouteManifest`, a deterministic object with `version`, `routeDirectory`,
and sorted entries. Each entry carries a stable Schema-branded `routeId`, a
branded source `id`, browser/server `moduleId`, `routePath`, parsed segments,
and typed param metadata.

The supported conventions are intentionally narrow: nested directories, `index`
routes, dynamic `$id` segments, optional `$id?` segments, route groups like
`(app)` ignored in the URL, pathless layout directories beginning with `_`, and
layout leaf files named `layout`, `_layout`, `+layout`, or beginning with `_`
ignored entirely.

Production generators should use `generateValidatedFileRouteManifestEffect` or
`generateValidatedFileRouteManifestArtifactEffect`. They reject files that
collapse to the same route path after route groups and pathless segments are
removed, and malformed dynamic segments like `$123`, keeping bad route graphs
out of builds. Discovered `.d.ts` files are ignored before manifest generation.
The Start Vite plugin exposes the same artifact as
`__EFFECT_UI_FILE_ROUTES__` and as the Vite virtual module
`virtual:effect-ui/file-routes`, which exports `manifest`, `entries`, and the
default manifest. Serialized artifacts can be parsed again with
`deserializeFileRouteManifest`, which revalidates the branded ids and rejects
route-id/segment mismatches before the router sees them.

The same manifest generates a typed route definition module. On Vite startup and
build, Start writes `src/routeTree.gen.ts` by default, following the file-based
routing convention of keeping generated route types in the project for editors,
agents, and non-Vite tooling. Route files export a named `Route`, usually via
`defineFileRoute("/projects/:id")({ ... })`; the generated file imports those
route modules, checks each imported route's literal `path` against the manifest,
and then emits a `routes` tuple, a `routeTree` alias, a `routeById` map, and a
`routeByPath` map. The matching Vite virtual module `virtual:effect-ui/routes`
exposes the same route surface with Vite-root absolute imports. Because the
generated definitions keep the route module's schema-typed params/search,
downstream code gets the existing `Route.href` param checking from
`@effect-ui/core`. The generated file also exports app-specific type maps such
as `FileRouteId`, `FileRoutePath`, `FileRouteParamsById`, `FileRouteSearchByPath`, and
`FileRouteHrefOptionsById`, giving agents and editors a route-id/path indexed
view without introducing a second runtime link abstraction. Apps can disable or
move the generated file with
`effectUiStart({ fileRouteGeneration: { outputFile: false } })` or a custom
`outputFile`.

Apps that import these virtual modules should opt into their ambient types with
`"types": ["vite/client", "@effect-ui/start/virtual"]` or an equivalent
triple-slash reference.

## SSR Hydration

Route preload is also the server data graph. `@effect-ui/start` can match a
request, run the matched route preload, collect every resource touched by
`Resource.prefetchEffect`, and serialize successful resource cache entries:

```ts
const preloaded = yield* preloadRequestEffect(app, request)
preloaded.resources // { resources: [...] }
```

The payload includes the resource family name, stable key, original input, and
successful resource state. Client hydration calls `Resource.hydrate(payload)`,
which updates the visible resource signal and uses Effect `Cache.set` so the
first client `prefetchEffect` observes the SSR value instead of repeating the
load.

Preload dehydration has both sync and Effect forms. Runtime/request work should
prefer `Resource.hydrationPayloadEffect(refs)` so the payload is read from the
Resource Store provided by the Runtime Spine. The sync `Resource.hydrationPayload`
is for already-current UI contexts and tests.

DB collections join the same Start hydration script. When a route preload calls
`Collection.preloadEffect(...)` or `Collection.refetchEffect(...)`, Start records
that Collection Definition and dehydrates its request-runtime snapshot
automatically:

```ts
const ProjectRoute = route("/projects/:id", {
  preload: () => Projects.preloadEffect()
})
```

Matched routes can also declare concrete Collection Definitions with
`preloadCollections`; Start resolves those declarations from the DB registry,
preloads any that the route did not already touch, and dehydrates their
request-runtime snapshots. Handlers can still pass explicit collection
definitions as a registry or override. Registered collections are always
dehydrated, route-declared collections are included next, and route-touched
collections that are not already registered or declared are appended:

```ts
createRequestHandler(app, {
  collections: [Projects, Tasks],
  render: ({ collectionPreload, hydrationScript }) => {
    collectionPreload.routeTouchedCollections
    collectionPreload.routeDeclaredCollections
    collectionPreload.registeredCollections
    collectionPreload.dehydratedCollections
    return html(hydrationScript)
  }
})
```

The browser entrypoint passes the same definitions and browser runtime back to
`hydrateFromDocument` so resources and collection rows are restored from one
script into the same Runtime Spine that the UI will use:

```ts
const runtime = createEffectRuntime(AppLive)

hydrateFromDocument(document, "__EFFECT_UI_HYDRATION__", {
  runtime,
  collections: [Projects, Tasks]
})
```

`createRequestHandler(app, { render })` passes renderers a `hydrationScript`
string. Browser entrypoints can call `hydrateFromDocument(...)` before mounting
the app, or `hydrateFromDocumentEffect(...)` when they want the host runtime to
run the hydration Effect directly.

Streamed SSR chunks are emitted as JSON scripts with
`data-effect-ui-hydration-chunk`. Browser entries that progressively inspect the
document can run the chunk-only transport directly:

```ts
const chunks = hydrateStartHydrationChunksFromDocument(document, {
  runtime,
  collections: [Projects, Tasks]
})
```

The Effect form, `hydrateStartHydrationChunksFromDocumentEffect`, is for hosts
that already run inside the browser runtime. Both helpers delegate each parsed
Start hydration payload through the normal Start hydration transport, so
resources and DB collection snapshots hydrate together. Consumed DOM chunks are
marked with `data-effect-ui-hydration-consumed` by default, making repeated
scans skip the same script unless `markConsumed: false` is passed.
Malformed root hydration payload scripts fail with
`StartHydrationPayloadParseError`; malformed streamed chunk scripts fail with
`StartHydrationChunkParseError`; malformed Resource or Collection snapshots
fail with the corresponding snapshot codec error.

The DOM renderer still owns its own hydration bootstrap. The Solid example emits
`generateHydrationScript()` in the document head and the Effect UI resource
payload next to the root. Those scripts solve different problems: Solid maps the
existing DOM nodes back to computations, while Effect UI restores typed resource
state and Effect `Cache` entries.

`createRequestHandlerEffect(app)` is the native Effect request boundary.
`createRequestHandler(app)` is an alias for the same Effect-returning handler.
Host facades can own the final runtime seam, so ordinary Fetch hosts receive a
Promise-returning handler and ordinary Node HTTP hosts receive a `createServer`
callback without repeating `runtime.runPromise(...)` or `runFork(...)` in every
deployment file.
When `defineApp({ server })` is present, Start provides it while running SSR
preload and render work, so app services can be normal Effect `Layer`s.
Every request gets a fresh Request Runtime, so SSR behaves like TanStack Start's
isomorphic request model without sharing cache state across users.

Deployment adapter implementations live in `@effect-ui/start/adapters`.
Application imports should prefer the host-shaped facades:
`@effect-ui/start-fetch` for Fetch-style hosts and `@effect-ui/start-node` for
Node HTTP. Edge-style hosts can wrap `createRequestHandlerEffect(app)` with
`createFetchHandler(handler, { runtime })`, while Node HTTP servers use
`createNodeServerHandler(handler, { runtime })`. The Effect-first
`toFetchHandlerEffect`, `toFetchHandler`, `createNodeHandlerEffect`, and
`createNodeHandler` functions remain the lower interfaces for hosts that want
custom supervision. The Node adapter converts `IncomingMessage` to a Web
`Request`, makes forwarded-origin trust explicit with `trustForwardedHeaders`,
writes Web `Response`
headers/status back to `ServerResponse`, streams response bodies with Node
backpressure and Effect interruption through an `AbortSignal`, preserves
multiple `Set-Cookie` headers, and keeps `HEAD` responses bodyless at the host
boundary.

## Isomorphic Server Functions

Server functions are contract-first. Shared modules define wire schemas, tagged
errors, and named `Server.contract` values, then export browser-safe clients from
those contracts:

```ts
export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId
}) {}

export const GetProject = Server.contract<{ readonly id: ProjectId }, Project, ProjectNotFound>("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: Project,
  error: ProjectNotFound
})

export const getProject = Server.client(GetProject)
```

Application resources and actions import these shared clients. The same call site
works on the server and in the browser:

```ts
Resource.family({
  name: "Project.byId",
  input: ProjectId,
  load: (id: ProjectId) => getProject.effect({ id })
})
```

Real handlers live in `.server.ts` modules and register the same function names
by implementing the shared contracts:

```ts
export const getProject = Server.implement(GetProject, ({ id }) =>
  Projects.use((projects) => projects.get(id))
)
```

The contract is the source of truth for the function name and wire schemas.
`Server.client(contract)` has no local handler and is safe to import from shared
or browser modules. `Server.implement(contract, handler)` registers the real
handler in the server graph without repeating the schemas:

```ts
export const renameProject = Server.implement(RenameProject, (input) =>
  Projects.use((projects) => projects.rename(input))
)
```

`Server.fn` and `Server.stub` remain the low-level primitives behind this split,
but new isomorphic code should prefer the contract/client/implement pattern so
the browser graph never imports server handlers and handlers cannot drift from
their public schema.

```ts
export const getProjectLegacy = Server.fn("Project.get", {
  input: GetProject.input,
  output: GetProject.output,
  error: GetProject.error,
  handler: ({ id }) => Projects.use((projects) => projects.get(id))
})
```

On the server, Start provides a local `ServerClient` during request preload and
render, so shared clients dispatch to registered local handlers through the
Effect runtime. In the browser, `BrowserRpcLive` provides a fetch-backed
`ServerClient` that posts to `POST /__effect-ui/rpc`. The resource/action/router
code above does not change.

The Vite plugin treats `*.server.ts` / `*.server.tsx` as server-only modules.
Client transforms fail if one enters the browser graph. Use a shared contract
module for schemas, contracts, and clients, and import the `.server.ts` module
only from the server entry so the handlers are registered for SSR and RPC.

Start also has a production-shaped Server Function Manifest Module. It gives
each function a deterministic `sf_*` id, records the server export, emits either
RPC-only or browser-safe import client references, tracks whether input/output/
error schemas exist, and rejects duplicate names, ids, and server module exports
before bundling. The Start Vite plugin exposes the artifact as
`__EFFECT_UI_SERVER_FUNCTIONS__` and as the Vite virtual module
`virtual:effect-ui/server-functions`. Progressive action manifests mirror this
for `Action.define(...)` values through `__EFFECT_UI_ACTIONS__` and
`virtual:effect-ui/actions`, with deterministic branded `act_*` ids and
typed deserialization through `deserializeActionManifest`.

The same Vite boundary also emits a Start App Graph. The graph is versioned,
deterministic, and machine-readable: `routes`, `serverFunctions`, and `actions`
are the exact manifest artifacts that builds already validate. Agents and
devtools should prefer `virtual:effect-ui/app-graph` or
`__EFFECT_UI_APP_GRAPH__` when they need topology, because it keeps the app's
compile-time facts in one inspectable object. `deserializeStartAppGraph`
round-trips the artifact and revalidates each nested manifest before tooling
trusts it.

`describeStartAppGraph(graph)` turns that artifact into diagnostics: route
paths, route ids, owning route files, path param metadata, server function
ownership, action ownership, server-only modules, browser client modules,
RPC/action endpoints, and schema coverage for server functions and actions.
Server function and action diagnostics include stable ids, server exports,
client transport/import references, module kinds, and wire-schema completeness.
Static graph diagnostics mark route-module features like params schemas, search
schemas, preloads, declared preload resources/collections, and components as `unknown`; the
`virtual:effect-ui/app-graph` module imports the route modules and exports the
same `diagnostics` shape with those route-module facts resolved to `present` or
`absent` for devtools and agents. Declared preload resource families are exposed
as source-attributed route facts, and declared preload collections are exposed
as route-to-collection facts, while runtime route plans continue to show the
exact resource refs touched for a specific navigation. The virtual graph also
includes static `Resource.diagnostics()` and `Collection.diagnostics()` facts so
devtools can explain resource families, tags, and DB collection definitions
without executing private stores. Builds can enforce static manifest policy with
`validateStartAppGraphWireSchemasEffect(graph)`, which fails with
`StartAppGraphMissingWireSchemas` when required input/output schemas are absent;
projects can opt into requiring error schemas too. Resolved route-module policy
lives on `StartBuildPolicy.diagnostics`. During Vite builds, the Start Vite
Diagnostics Gate SSR-loads the resolved graph through Vite and fails the build
if configured resource or collection preload declarations are still unknown,
even when application code never imports `virtual:effect-ui/app-graph`. The
generated virtual module exports `diagnosticsPolicyViolations` as a readonly
`StartAppGraphDiagnosticsPolicyViolation[]` after the diagnostics policy guard
succeeds; if the guard finds unknown preload declarations, module evaluation
fails with the diagnostics-bearing policy exception instead.
CI scripts can call `loadStartAppGraphDiagnostics({ root })` from
`@effect-ui/start/vite` to run the same gate explicitly and receive the resolved
diagnostics as JSON-safe data. The package binary wraps that API as:

```sh
effect-ui-start diagnostics --root . --json
```

Without `--json`, the command prints an agent-readable repair report grouped by
owning route, action, or server module. The same report model is available from
`@effect-ui/start/diagnostics-report` via `createStartDiagnosticsReport(...)`
and `formatStartDiagnosticsReport(...)`, so CI bots can attach exact "what to
edit" guidance without reverse-engineering the raw graph payload.

Tests should mock contracts, not modules:

```ts
const value = yield* Server.provideMocks(
  getProject.effect({ id: makeProjectId("atlas") }),
  Server.mock(GetProject, ({ id }) =>
    Effect.succeed({ id, name: "Mock Project" })
  )
)
```

`Server.mock(...)` does not register a global handler and does not import
`.server.ts`. It still validates through the contract schemas, so test doubles
catch bad inputs and outputs early. `Server.mockLayer(...)` exposes the same
transport as an Effect `Layer` for apps or integration tests that build a
runtime with dependency injection.

## Signal And Stream Semantics

The render model is latest-value reactive:

```ts
const count = Signal.make(0);
const doubled = Signal.derive(() => read(count) * 2);
```

`read(count)` subscribes the current reactive computation and returns the current value
synchronously. Rendering consumes invalidations and then reads the latest value; it is
not required to replay every intermediate update.

Use `Signal.peek(signal)` or `Signal.untracked(() => ...)` for reads that should not
become render dependencies.

The temporal model is still available through Effect streams:

```ts
Signal.values(count);   // current value, then updates
Signal.changes(count);  // updates only
```

Streams can also drive signals when the stream cannot fail:

```ts
const online = yield* Signal.fromStreamEffect(presenceStream, false);
```

`Signal.fromStream(stream, initial)` is the component-boundary helper. It requires
an active `UiScope`, so stream fibers are interrupted when the component is disposed.

Fallible streams should first be turned into typed data or represented as `Resource`
state, because a plain `Signal<A>` always has a current `A` and has no error channel.

Effect-first APIs:

- `Resource.prefetchEffect(ref)` and `Resource.refreshEffect(ref)` load and
  reload resources as Effects.
- `action.submitEffect(input)` runs action workflows, optimistic state,
  concurrency, and invalidation as an Effect.
- `serverFunction.effect(input)` is the local Effect API; `serverFunction.invoke(raw)` is the schema-validated wire API.

Resource retry policy is an Effect `Schedule`, not a framework-specific retry
DSL:

```ts
Resource.family({
  name: "Project.byId",
  input: ProjectId,
  load: (id: ProjectId) => getProject.effect({ id }),
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.take(3))
  }
});
```

Action policy is applied inside `submitEffect`, so callers still get the
definition's concurrency semantics while keeping cancellation, timeout, retry,
and race strategy visible in Effect code.

Action policy is part of the definition:

```ts
const RenameProject = Action.define({
  name: "Project.rename",
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1)
  },
  run: renameProject.effect
})
```

`latest` interrupts older event submissions, `exhaust` reuses the in-flight
submission, and `parallel` lets all submissions resolve while keeping the UI
state pointed at the latest input.

## Progressive Action Results

Progressive forms and actions use typed result data rather than thrown control
flow:

```ts
const result = ActionResult.redirect("/projects/atlas", {
  status: 303,
  replace: true
})

const validation = ActionResult.fieldError("name", new ProjectNameTooShort({
  minimum: 3
}))
```

`ActionResult` can represent success, validation failure, redirect, and domain
failure. `ActionResult.validateFormEffect(form)` turns a form validation failure
into a success-channel `ValidationFailure`, and `ActionResult.withInvalidation`
lets the result carry Resource invalidation targets into existing action
workflows.
