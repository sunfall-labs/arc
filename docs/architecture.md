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
- public async APIs return Effect v4 values;
- Promise boundaries are compatibility adapters for host or platform contracts,
  never alternate framework APIs;
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

Core owns the Resource UI Binding Controller used by React and Solid resource
hooks. That Module keeps ref identity, runtime-bound refresh/prefetch Effects,
automatic preload fibers, keyed preload failures, stale preload interruption,
and Suspense preload-token dedupe consistent across adapters. React and Solid
still own host reactivity and host Suspense thenable throwing.

Framework callbacks are intentionally Effect-typed. `Resource.load`,
`Action.run`, `Server.implement` handlers, and route preload should return
`Effect` or a pure value. Promise-shaped host work is converted with
`Effect.tryPromise` at the adapter edge, not hidden inside application
definitions.

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
shares the app's Effect services but gets a fresh Resource Store and a
request-local `Server.localClient(...)`. Route preload, render, server
functions, hydration payload creation, and synchronous `Resource.read(...)`
during render all run through that request runtime, then the Resource Store is
disposed at request completion to interrupt any lifetime fibers. Internally,
the Request Runtime Lifecycle Module owns failure/interruption teardown,
ResponseContext application, request trace emission, runtime disposal, and
streamed response finalization after the request handler has selected the
response Effect to run.

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

The Runtime Spine is the one place where host boundaries are allowed to run Effects:

- Server function host calls run through the current runtime.
- `Resource.prefetch` / `refresh` use the current runtime.
- `Action.use(...).submitEffect` can run on an explicit runtime.
- Start request handlers run SSR preload and render through `app.runtime`.
- Solid `RuntimeProvider` / `RouterProvider` pass the runtime to resources,
  actions, route preloads, route components, and ambient Core helpers used while
  rendering those components.

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

JSON action clients and progressive form helpers share the same Start Action
Request Codec. Schema-backed input encoding happens before values cross the
wire/form seam; synchronous form helpers fail with `StartActionFormEncodeError`
when defaults cannot be encoded.
The RPC and action browser clients also share a private Start client transport
Module for request serialization, fetch invocation, status validation, and
transport error mapping; the protocol Modules still own RPC/action-specific
request and response decoding.

The small `startActionForm(action, { input })` helper generates the form method,
action URL, and hidden metadata fields. Visible form controls are merged over
the hidden JSON input before schema decode, so a form can carry stable values
such as `id` and `redirectTo` while the user edits fields like `name`.

This is the progressive enhancement seam: with JavaScript, the Solid handler can
intercept and fork or run `Action.use(...).submitEffect`; without JavaScript,
the same form posts to Start and runs the same Action Definition, Capability
services, schemas, retries, and invalidation policy.

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

Components that call `createComponentScope(...)`, `useRuntimeEffect(...)`,
`useStream(...)`, or render through `RouterOutlet` get a `UiScope` backed by
Effect `Scope`. Closing the UI scope closes the Effect scope, so finalizers run
and scoped fibers are interrupted. Plain Solid components stay unscoped until
they opt into one of those Solid Adapter seams.

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
In-flight loads are Resource Store-owned: callers join the store fiber, so
interrupting one caller detaches that caller without cancelling work for
navigation or another consumer. Resource deletion, invalidation, and Resource
Store disposal remain the cancellation seams for the underlying load.
Synchronous Resource reads and status checks still stay render-friendly, but
their lifetime decisions use the active Runtime Spine clock so custom Effect
clocks agree with `statusEffect(...)`. Missing synchronous reads use a peek-first
path and do not register absent Resource refs as live store facts. Effect code
should use `Resource.readEffect(...)` so missing, pending, collected, and failed
states stay in the typed Effect error channel.

Default Resource keys are encoded through a Resource key codec rather than raw
object stringification. JSON-compatible values plus Date, URL, Map, and Set have
tagged stable encodings; unsupported or circular inputs fail with
`ResourceKeyError` and guidance to provide an explicit `key`.
The more general `stableStringify(...)` identity helper now follows the same
structured policy for Date, URL, Map, Set, binary values, undefined, sparse
array holes, marker-shaped plain objects, and typed unsupported-value failures.

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
const response = yield* createStartStreamedHtmlResponseEffect({
  shell: "<!doctype html><html><body>",
  chunks: Stream.make(htmlChunk("<main>ready</main>")),
  hydrationPlan,
  tail: "</body></html>"
})
```

The core Interface is `createHtmlStreamEffect`, which returns an Effect `Stream`
of bytes. `createReadableHtmlStreamEffect` and `createHtmlResponseEffect` are
host adapters. `createStartStreamedHtmlResponseEffect(...)` is the Start render
helper that appends `StartRenderHydrationPlan` streamed chunks before the tail.
Shell, chunk, and tail failures become typed `StartStreamError` values, so
streaming remains Effect-native until the final web platform seam.
When a Start render returns a streamed `Response`, the Request Runtime is held
open until the body is consumed or cancelled, and finalizer/request-trace facts
preserve the stream failure phase for diagnostics.
Streaming renderers receive a `StartRenderHydrationPlan` that separates the root
payload/script from streamed resource chunks, so adapters do not need to
rediscover which Resource refs belong in the root document versus the stream.

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
runs Solid cleanup inside that route runtime/scope before disposing the route
scope, so cleanup callbacks, streams, watches, actions, and scoped fibers close
with the page they belong to.
Router navigation, link preload, and click interception share one route
membership policy: unregistered links are allowed to behave as normal anchors,
while programmatic navigation reports `RouterRouteNotRegistered`.

Links use the same typed route definitions. `RouterLink` builds the href from a
route plus `Route.HrefOptions`, preloads that route on hover in the router
runtime, lets modified clicks and external targets behave like normal anchors,
and intercepts only plain left clicks for client navigation. Route grammar
rejects invalid or duplicate parameter names at definition/match planning time
instead of allowing later segments to overwrite earlier params.

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
SSR preload. If a touched resource cannot be serialized, planning fails through
the typed `ResourceSnapshotCodecError` Effect error channel. When
`@effect-ui/start` is present, it separately composes
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
agents, and non-Vite tooling. Route files export a named `Route`, usually by
binding a builder so schemas, preload metadata, and preload work stay together:

```ts
const RouteBuilder = defineFileRoute("/projects/:id")

export const Route = RouteBuilder.preload({
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  resources: ({ resource }) => [
    resource(ProjectById, ({ params }) => params.id)
  ],
  collections: [ProjectSummaries]
}).route()
```

The generated file imports those route modules, checks each imported route's
literal `path` against the manifest, and then emits a `routes` tuple, a
`routeTree` alias, a `routeById` map, a `routeByPath` map, and direct typed href
helpers such as `hrefById(...)` and `hrefByPath(...)`. The matching Vite virtual
module `virtual:effect-ui/routes` exposes runtime helpers with Vite-root
absolute imports. Precise app-specific route id, params, search, href, and match
type maps live in the written `src/routeTree.gen.ts` module, where editors and
non-Vite tooling can index them without relying on virtual-module inference. The
generated file also exports friendly aliases such as `RouteId`, `RoutePath`,
`ParamsById`, `SearchByPath`, `Href`, `HrefById`, `HrefByPath`, and `Match`,
giving agents and editors a route-id/path indexed view without introducing a
second runtime link abstraction. Apps can disable or move the generated file with
`effectUiStart({ fileRouteGeneration: { outputFile: false } })` or a custom
`outputFile`.

Apps that import these virtual modules should opt into their ambient types with
a checked declaration file such as `src/effect-ui-start-virtual.d.ts` containing
`import "@effect-ui/start/virtual";`, alongside the usual `"types":
["vite/client"]` Vite setting.

## SSR Hydration

Route preload is also the server data graph. `@effect-ui/start` can match a
request, run the matched route preload, collect every resource touched by
`Resource.prefetchEffect`, and serialize successful resource cache entries:

```ts
const preloaded = yield* preloadRequestEffect(app, request)
preloaded.resources // { resources: [...] }
```

The payload includes the resource family name, stable key, original input, and
successful resource state. Start client hydration applies that payload with
`hydrateFromDocumentEffect(...)` or `hydrateStartPayloadEffect(...)`; those
helpers call `Resource.hydrateEffect(payload)` so the visible resource signal
and Effect `Cache` entry update in the same Runtime Spine. The synchronous
`Resource.hydrate(payload)` helper is the host/UI-context facade for callers
that are already inside the current runtime, not the path Start hydration docs
should teach first.

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

Matched routes can also declare Collection Definitions with `preloadCollections`;
concrete definitions need no lookup, while string declarations must resolve
through the request/app-local `collections`, `collectionRegistry`, or
`resolveCollection` inputs. Start fails unresolved string declarations with
`StartPreloadError` instead of consulting the process-global DB registry. It
preloads resolved route declarations that the route did not already touch and
dehydrates their request-runtime snapshots. Handlers can still pass explicit
collection definitions as a registry or override. Registered collections are
always dehydrated, route-declared collections are included next, and
route-touched collections that are not already registered or declared are
appended:

```ts
createRequestHandler(app, {
  collections: [Projects, Tasks],
  render: ({ collectionPreload, legacyHydrationScript }) => {
    collectionPreload.routeTouchedCollections
    collectionPreload.routeDeclaredCollections
    collectionPreload.registeredCollections
    collectionPreload.dehydratedCollections
    return html(legacyHydrationScript)
  }
})
```

The browser entrypoint passes the same definitions and browser runtime back to
`hydrateFromDocumentEffect` so resources and collection rows are restored from
one script into the same Runtime Spine that the UI will use:

```ts
const runtime = createEffectRuntime(AppLive)

yield* hydrateFromDocumentEffect(document, "__EFFECT_UI_HYDRATION__", {
  runtime,
  collections: [Projects, Tasks]
})
```

`createRequestHandler(app, { render })` passes renderers a
`legacyHydrationScript` string for full non-streaming payloads and a
`hydrationRootScript`/`hydrationPlan` pair for streamed HTML. Browser
entrypoints can call `hydrateFromDocument(...)` before mounting the app, or
`hydrateFromDocumentEffect(...)` when they want the host runtime to run the
hydration Effect directly. Lower-level resource-only hosts should prefer
`yield* Resource.hydrateEffect(payload)` and reserve `Resource.hydrate(payload)`
for synchronous current-runtime host facades.

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
that already run inside the browser runtime. Streamed chunk hydration is
progressive by design: each parsed Start hydration payload validates before that
payload mutates Resource or Collection state, but a later chunk failure does not
roll back chunks that already applied. Consumed DOM chunks are marked with
`data-effect-ui-hydration-consumed` only after the full chunk scan succeeds,
making repeated scans skip the same script unless `markConsumed: false` is
passed.
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
Host facades can own the final runtime seam when a platform contract requires
one, so Fetch hosts that require `(request) => Promise<Response>` and ordinary
Node HTTP hosts that require a `createServer` callback do not repeat runtime
launch policy in every deployment file. These facades are compatibility
adapters, not alternate application APIs. The internal Start Host Runtime Runner
is the shared Module for that final Effect-to-host step: Fetch/Vite host
facades and Node/Vite callback facades delegate runtime selection,
`Effect.runPromise(...)`, `runFork(...)`, and response Scope lifetime policy to
it while adapters keep request/response translation local.
When `defineApp({ server })` is present, Start provides it while running SSR
preload and render work, so app services can be normal Effect `Layer`s.
Every request gets a fresh Request Runtime, so SSR behaves like TanStack Start's
isomorphic request model without sharing cache state across users.

Deployment adapter implementations live in `@effect-ui/start/adapters`.
Application imports should prefer the host-shaped facades:
`@effect-ui/start-fetch` for Fetch-style hosts and `@effect-ui/start-node` for
Node HTTP. Effect-capable hosts should use `toFetchHandlerEffect(handler)` or
`toFetchHandler(handler)`. Edge-style hosts that require a Promise-shaped
export can wrap `createRequestHandlerEffect(app)` with
`createFetchHandler(handler, { runtime })`, while Node HTTP servers use
`createNodeServerHandler(handler, { runtime })`. The Effect-first
`toFetchHandlerEffect`, `toFetchHandler`, `createNodeHandlerEffect`, and
`createNodeHandler` functions remain the canonical interfaces for hosts that
want custom supervision. Host facades provide the per-request Scope themselves
but require a typed runtime whenever the handler still needs app services. The
Node adapter callback facades delegate the lower Node/Web exchange mechanics to
the internal Start Node Web Exchange Module. That Module converts
`IncomingMessage` to a Web `Request`, makes forwarded-origin trust explicit with
`trustForwardedHeaders`, writes Web `Response` headers/status back to
`ServerResponse`, streams response bodies with Node backpressure and Effect
interruption through an `AbortSignal`, preserves multiple `Set-Cookie` headers,
and keeps `HEAD` responses bodyless at the host boundary. Vite dev SSR consumes
the same exchange Module, so production Node and dev middleware share the same
request/response policy while keeping their own handler-selection concerns.

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

On the server, Start provides a request-local `ServerClient` during request
preload and render, so shared clients dispatch to registered local handlers
through the Effect runtime even when the app runtime also provides a remote
client service. In the browser, `BrowserRpcLive` provides a fetch-backed
`ServerClient` that posts to the configured Start RPC endpoint, defaulting to
`POST /__effect-ui/rpc`. Start action clients and progressive forms use the same
shared endpoint policy, defaulting to `POST /__effect-ui/action`, so custom
`rpcPath`/`actionPath` values can flow from manifests and handler options into
clients without a second transport rule. The resource/action/router code above
does not change.

The Vite plugin treats `*.server.ts` / `*.server.tsx` as server-only modules.
Client transforms fail if one enters the browser graph. Use a shared contract
module for schemas, contracts, and clients, and import the `.server.ts` module
only from the server entry so the handlers are registered for SSR and RPC.

Start also has a production-shaped Server Function Manifest Module. It gives
each function a deterministic `sf_*` id, records the server export, emits either
RPC-only or browser-safe import client references, tracks whether input/output/
error schemas exist, and rejects duplicate names, ids, server module exports,
and invalid import-client module/export references before bundling. The Start
Vite plugin exposes the artifact as
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

Example-local graph summaries, such as the project-console SSR header helper,
are narrow non-Vite fallbacks for tests and early server rendering. They should
not grow into a second topology Interface; build-time and tooling consumers
should use the generated Start App Graph instead.

`describeStartAppGraph(graph)` turns that artifact into diagnostics: route
paths, route ids, owning route files, path param metadata, server function
ownership, action ownership, server-only modules, browser client modules,
RPC/action endpoints, and schema coverage for server functions and actions.
Server function and action diagnostics include stable ids, server exports,
client transport/import references, module kinds, and wire-schema completeness.
Static graph diagnostics mark route-module features like params schemas, search
schemas, preloads, declared preload resources/collections, and components as
`unknown`; the `virtual:effect-ui/app-graph` module stays a pure static DTO and
does not import application route implementations. Runtime route-module facts
are available only from the explicit
`virtual:effect-ui/app-graph/runtime-diagnostics` module, which SSR-loads the
route modules and resolves those feature flags to `present` or `absent` for
devtools and agents that ask for runtime diagnostics. Declared preload resource
families are exposed as source-attributed route facts, and declared preload
collections are exposed as route-to-collection facts, while runtime route plans
continue to show the exact resource refs touched for a specific navigation.
Runtime diagnostics can also include static `Resource.diagnostics()` and
`Collection.diagnostics()` facts so devtools can explain resource families,
tags, and DB collection definitions without reading private stores. A shared
diagnostics DTO decoder is used by Vite, CLI, and virtual modules instead of
duplicate loose shape guards at each Adapter seam. Builds can enforce static
manifest policy with
`validateStartAppGraphWireSchemasEffect(graph)`, which fails with
`StartAppGraphMissingWireSchemas` when required input/output schemas are absent;
projects can opt into requiring error schemas too. Resolved route-module policy
lives on `StartBuildPolicy.diagnostics`. During Vite builds, the Start Vite
Diagnostics Gate SSR-loads the resolved graph through Vite and fails the build
if configured resource or collection preload declarations are still unknown,
even when application code never imports `virtual:effect-ui/app-graph`. The
runtime diagnostics virtual module exports `diagnosticsPolicyViolations` as a readonly
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
For semantic inspection, the same resolved diagnostics can be projected into a
Start Agent Graph:

```sh
effect-ui-start impact route /projects/:id
effect-ui-start impact action Project.rename --json
effect-ui-start graph route /projects/:id
effect-ui-start graph route /projects/:id --verbose
effect-ui-start graph action Project.rename --json
```

`createStartAgentGraph(...)` turns diagnostics into typed Route, Action,
ServerFunction, ResourceFamily, ResourceTag, Collection, Endpoint, Module, and
Finding nodes with deterministic edges and self-review facts. This is the
agent-operable map: agents can query the app by framework meaning before they
edit source files, while the underlying facts still come from the compile-time
and Vite-resolved diagnostics pipeline. The default text output is intentionally
brief and edit-oriented; `--verbose` exposes raw graph ids, facts, and edges for
debugging. For the default agent workflow, `createStartAgentGraphImpact(...)`
and `formatStartAgentGraphImpact(...)` compress a focused graph query into an
edit brief: where to work, which contracts must hold, which neighboring nodes
may be affected, and which framework checks should be rerun.

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
workflows while preserving any services required by those invalidated Resource
refs.
