# Changelog

Sunfall Arc is pre-release. Framework packages publish under the `@sunfall`
npm scope with the `alpha` dist-tag (see [CONTRIBUTING.md](CONTRIBUTING.md)).
Entries are newest first.

## Unreleased (since 0.1.0-alpha.1)

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
