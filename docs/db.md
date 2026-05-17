# Effect UI DB

`@effect-ui/db` is the framework-native collection and live-query layer. It is
intended to cover the TanStack DB shape while keeping Effect UI's runtime spine:
runtime/request-local state, Effect-first loading and mutation handlers, typed
signals, and scoped host adapters.

The broader framework plan is in
[Best Full-Stack Framework Plan](./best-framework-plan.md). The DB package wins
when it gives applications normalized data, live queries, optimistic mutation,
persistence, and sync without leaving the Effect runtime model.

## Winning Data Layer

The data layer should replace the usual split between query cache, normalized
client store, offline queue, persistence adapter, and sync glue.

- Resources own typed async reads, Effect cache policy, semantic tags, and
  invalidation plans.
- Collections own keyed rows, secondary indexes, optimistic transactions,
  persistence snapshots, pending mutation queues, and collection events.
- Live queries own derived materialized views and query plans.
- Sync adapters connect collections to server functions, local-first engines,
  browser APIs, workers, or existing query clients.
- Start owns SSR collection preload and hydration so normalized rows resume in
  the same runtime as resources.
- Devtools consume public collection events and diagnostics rather than private
  row maps.

The winning bar is not "we have a DB package." The winning bar is that an app
can build local-first, optimistic, indexed, persisted, SSR-hydrated data flows
without choosing between correctness, inspectability, and ergonomics.

## Current Slice

- `Collection.define(...)` declares a typed keyed row collection.
- Collection state is stored per active Effect UI runtime/resource store.
- Each Resource Store owns an explicit `Collection.Store`, exposed with
  `Collection.storeEffect()` for diagnostics and event subscriptions without
  exposing private row maps.
- Collection Stores expose runtime-local diagnostics through
  `store.diagnostics.snapshot()` and `store.diagnostics.snapshotEffect`, so
  tests, adapters, and devtools can inspect collection, row, mutation, loading,
  optimistic, and failure counts without reaching into mutable store internals.
- Collections support Effect-first loading, direct sync writes, retry policy,
  and optimistic `insert`, `update`, and `delete` mutations.
- Collections can declare secondary indexes for runtime-local materialized
  keyed lookup and indexed query joins.
- Mutations apply locally before persistence, mark rows as unsynced, and roll
  back if the mutation handler fails.
- Rows expose metadata: `$key`, `$collection`, `$synced`, and `$origin`.
- Collections can snapshot, hydrate, persist, and restore runtime-local row
  state. Multi-collection dehydration validates the built payload through the
  Collection Snapshot Codec before returning it, including definition-owned
  schema/key validation and canonical pending update changes.
- Collection hydration validation and application share the same planned
  definition/store preflight, so `validateHydrationPayloadEffect(...)` proves
  the path that `hydratePayloadEffect(...)` will apply.
- Collection Row Ingress canonicalizes live rows before they enter store state:
  output schema decoding, finite key validation, `getKey` normalization, value
  cloning, and stored-row creation happen at one seam for initial data, loads,
  writes, optimistic mutations, and change-feed batches.
- In-flight optimistic transactions are tracked in a pending mutation queue and
  included in snapshots. Flushes join an active mutation attempt instead of
  replaying an in-flight handler, so restored/background flush work cannot
  duplicate a transaction already being sent.
- Collection preload and refetch coordination is store-owned: concurrent
  preloads share the active load, forced refetches advance the store generation,
  and stale earlier loads cannot overwrite newer rows or persistence.
- `Collection.serverOptions(...)` adapts server/RPC-backed loads and mutation
  handlers into the normal Collection Definition Interface.
- `Collection.syncOptions(...)` adapts generic external row sources into the
  same Collection Definition load/refetch/mutation Interface; server functions
  are one adapter over that seam. Method-style adapters keep their receiver, so
  `this`-dependent clients can expose `load`, `refetch`, and mutation methods
  without rebinding at every call site.
- `Collection.querySyncAdapter(...)` adapts TanStack Query-shaped clients into
  the same Collection Sync Adapter seam.
- `Collection.flushAllPendingMutationsEffect(...)` coordinates mutation flushes
  across collections and can skip work while offline. Its error channel includes
  each collection's full runtime error union, including snapshot codec failures.
- `Collection.backgroundSyncPendingMutationsEffect(...)` lets host adapters
  decide whether trigger-driven pending mutation flushes should run, while
  preserving the same collection runtime failures as a direct flush.
- `Collection.applyChangesEffect(...)` applies external row upsert/delete
  batches through the Collection Store for change-feed adapters.
- `Collection.subscribeChangesEffect(...)` acquires scoped change-feed
  subscriptions and routes emitted batches through the same Collection Store
  seam. Change-feed adapters can either return an Effect from `emit(...)` or
  call the host-callback `emitChanges(...)` helper when the external feed cannot
  run Effects itself.
- `Collection.sqliteStorage(...)` adapts a SQLite-shaped namespace/key/value
  driver into collection snapshot persistence without baking in IndexedDB.
- `Collection.sqlitePreparedStatementDatabase(...)` adapts prepare/run/all
  SQLite clients into the same statement-driver Interface.
- `Collection.sqliteMemoryStatementDatabase()` provides a dependency-free
  statement-driver Adapter for tests, docs, and host SQLite adapter development.
- SQLite persistence helpers are also exported at the DB package root for
  adapter packages that should not route through the `Collection` namespace:
  `makeSQLitePersistenceStorage`, `makeSQLiteStatementPersistenceDriver`,
  `makeSQLitePreparedStatementDatabase`, `makeSQLiteMemoryStatementDatabase`,
  `SQLitePersistence`, and typed errors such as
  `SQLitePersistenceInvalidRow`.
- `Collection.persistedOptions(...)` restores persisted snapshots on preload
  and writes snapshots back after loads, writes, and optimistic mutation queue
  changes.
- `Collection.liveQuery(...)` exposes a `Query.live(...)` graph as a read-only
  collection-shaped derived view.
- Read-only Live Query Collections reject `Collection.applyChangesEffect(...)`
  with `ReadonlyCollectionMutation` before mutating rows, publishing write
  events, or persisting a snapshot.
- `Query.live(...)` creates live materialized queries over one or more
  collections.
- Live query filters and joins run through `@tanstack/db-ivm`, TanStack DB's
  differential-dataflow / incremental-view-maintenance engine.
- Grouped aggregate ordering plus `limit` / `offset` windows are maintained
  inside the D2 graph.
- `@effect-ui/react-db` and `@effect-ui/solid-db` adapt collections and live
  queries to framework-local state/accessors.

## Query Engine Shape

The public query API is intentionally small:

```ts
const ActiveProjectNames = Query.live((query) =>
  query
    .from({ project: Projects })
    .where(({ project }) => project.status === "active")
    .select(({ project }) => project.name)
    .orderBy(({ project }) => project.name)
)
```

Internally, Query Builder, Query Execution Plan, Live Query State, and Live
Query Runtime read source collections through the Collection Query Source
Adapter. That keeps rows, row counts, secondary-index probes, version/state
signals, and preload/refetch Effects behind one source Interface for normal
Collections and read-only Live Query Collections. Query Execution Plan owns
validation, source preloading/refetching, snapshot execution, diagnostics, and
remaining projection stages after the live IVM graph has already applied
filters, grouping, ordering, or windows.

Use explicit keyed joins when the relationship is known:

```ts
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: Projects })
    .join("task", Tasks, ({ project }) => project.id, (task) => task.projectId)
    .select(({ project, task }) => `${project.name}: ${task.title}`)
)
```

Declare Collection Secondary Indexes when a relationship is queried repeatedly.
The active Collection Store materializes each index into runtime/request-local
lookup buckets and invalidates those buckets when the collection version
changes:

```ts
const Tasks = Collection.define<Task>({
  name: "Tasks",
  getKey: (task) => task.id,
  indexes: {
    byProject: (task) => task.projectId,
    tags: (task) => task.tags
  }
})

const atlasTasks = Tasks.index("byProject", "atlas")
```

Indexed joins use the declared index buckets instead of scanning the right-hand
collection for every left-side row:

```ts
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`)
)
```

Multi-value indexes are supported for direct lookup and indexed joins. A row
whose index selector returns multiple values can join against any matching left
key, and duplicate values from a single row are de-duplicated inside that row's
bucket. Live Query Collections expose the same index Interface. Their rows are
derived from a D2 graph rather than owned by a Collection Store, so the runtime
builds index buckets from the materialized projection and caches them per
projection revision.

Collection Store diagnostics are intentionally counts, not mutable state:

```ts
const store = yield* Collection.storeEffect()
const snapshot = store.diagnostics.snapshot()
const effectSnapshot = yield* store.diagnostics.snapshotEffect

snapshot.collectionCount
snapshot.rowCount
snapshot.pendingMutationCount
snapshot.failureCount
```

Query plans can be inspected without reaching into the builder implementation:

```ts
const plan = Query.diagnostics((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`)
)

plan.joins[0]
// {
//   strategy: "collection-index",
//   index: "byProject",
//   leftRows: 4,
//   rightRows: 24,
//   outputRows: 18,
//   estimatedComparisons: 4
// }
```

Grouped aggregates are also live:

```ts
const ProjectStatusCounts = Query.live((query) =>
  query
    .from({ project: Projects })
    .groupBy(
      ({ project }) => ({ status: project.status }),
      {
        count: Query.count(),
        avgProgress: Query.avg(({ project }) => project.progress)
      }
    )
    .orderBy((group) => group.status)
)
```

The current adapter compiles source collections, explicit keyed joins,
cross-collection fallback joins, filters, grouped aggregates, ordered windows,
and `limit` / `offset` for ordered queries into a D2 graph. The materialized D2
output is then projected by Effect UI. Unordered `offset` / `limit` still runs
after materialization until the framework has explicit insertion-order
semantics.

Public `Query.Factory<TResult>` annotations default error and requirement
channels to `never`. If a factory reads collections whose load/refetch work can
fail or needs services, spell those channels in the annotation instead of
relying on a broad alias. This keeps `Query.onceEffect(...)`, `Query.live(...)`,
and Live Query Collection hovers aligned with the actual source collections.

React DB and Solid DB share DB-owned live-query selection helpers for dependency
equality, dependency snapshots, prebuilt `LiveQuery` reuse, and runtime-bound
`Query.live(...)` creation. The adapters still own host reactivity; DB owns the
selection policy.

Derived query results can be exposed as a read-only Collection Definition:

```ts
const ActiveProjectCards = Collection.liveQuery({
  name: "ProjectCards.active",
  getKey: (project) => project.id,
  query: (query) =>
    query
      .from({ project: Projects })
      .where(({ project }) => project.status === "active")
      .select(({ project }) => ({
        id: project.id,
        name: project.name,
        progress: project.progress
      }))
})
```

The Live Query Collection does not own source rows and rejects local mutations.
It is useful when a D2/materialized view should be passed to APIs that expect a
Collection Definition, or used as a source for another live query.

Repeated `state().get()` reads are stable: `Ready.updatedAt` changes only when
the collection-shaped materialized projection changes, not because a component
or devtools panel inspected the derived collection. Duplicate source rows with
the same derived key are projected once through the same keyed materialization
used by `rows()`, `get(...)`, indexes, snapshots, state, and `version()`.
That projection now uses the shared row-ingress key policy, so invalid derived
keys and `getKey` callback throws fail through typed collection snapshot or
callback errors instead of bypassing normal validation.

Because the rows are derived, `hydrateEffect(...)` and `restoreEffect(...)` fail
with `CollectionSnapshotCodecError`; hydrate or restore the source collections
instead and let the live-query collection rebuild its materialized view.
Persisting a Live Query Collection still uses the shared snapshot persistence
helper and publishes `CollectionPersisted`, so devtools and sync observers see
the same persistence event as normal collections without gaining a writable
Collection Store.

Live Query State is runtime-local. The mutable engine, last-good data, latest
failure, and source load-state facts are keyed by the active Collection Store,
so two browser runtimes or SSR requests that use the same `Query.live(...)`
descriptor do not share derived query state.

## Effect Policies

Remote collection work uses Effect policy, not a framework retry DSL. The same
`policy.retry` schedule is applied to collection loads and mutation handlers
through the internal Collection Policy Module:

```ts
const Projects = Collection.define<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.take(3))
  },
  load: () => ProjectApi.use((api) => api.list()),
  onUpdate: (updates) => ProjectApi.use((api) => api.updateMany(updates))
})
```

Optimistic row writes stay visible while the scheduled Effect retries. If all
retries fail, the pending mutation is rolled back through the same typed failure
path as an ordinary handler failure.

## Server Collection Adapter

Server/RPC-backed collections use an options creator instead of a second
collection implementation. This keeps `Collection.define(...)` as the single
Collection Definition Interface while putting host-specific calling conventions
behind an Adapter:

```ts
const Projects = Collection.define(Collection.serverOptions<Project>({
  id: "Projects",
  getKey: (project) => project.id,
  load: listProjects,
  update: ({ updates }) =>
    ProjectApi.use((api) => api.renameMany(updates))
}))
```

The Adapter accepts Effect callbacks and Start `Server.fn` / `Server.client`
functions. Host Promise work should be wrapped with `Effect.tryPromise(...)` at
the host Adapter seam before it enters Collection handlers. The Adapter forwards
mutation payloads with the original collection transaction so sync layers can
correlate optimistic local work with durable writes later.

For host integrations that are not server functions, use the generic Collection
Sync Adapter seam directly:

```ts
const Projects = Collection.define(Collection.syncOptions<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: {
    name: "projects-sync",
    load: () => Effect.tryPromise(() => remote.listProjects()),
    refetch: () => Effect.tryPromise(() => remote.listProjects({ force: true })),
    update: ({ updates }) =>
      Effect.tryPromise(() =>
        remote.updateProjects(updates.map((update) => update.value))
      )
  }
}))
```

`Collection.serverSyncAdapter(...)` exposes the same server-function behavior as
an Adapter for code that wants to compose sync options, persistence, and future
host policies explicitly. `Collection.diagnostics()` reports the sync adapter
name when a Collection Definition was created through this seam, so app graph
and devtools views can distinguish local-only collections from externally
synced ones.

Effect Resource refs can also be the read side of a synced collection:

```ts
const ProjectRows = Resource.family<void, ReadonlyArray<Project>>({
  name: "Project.rows",
  load: () => ProjectApi.use((api) => api.list())
})

const Projects = Collection.define(Collection.syncOptions<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: Collection.resourceSyncAdapter({
    ref: ProjectRows(undefined),
    update: ({ updates }) =>
      ProjectApi.use((api) => api.updateMany(updates.map((update) => update.value)))
  })
}))
```

The Resource remains responsible for Effect cache behavior and tag facts; the
Collection Store owns row metadata, optimistic mutation queues, indexes,
persistence, and live-query participation.

TanStack Query-shaped clients can provide the read side without adding a
TanStack Query dependency to `@effect-ui/db`:

```ts
const Projects = Collection.define(Collection.syncOptions<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: Collection.querySyncAdapter({
    name: "tanstack-query:projects",
    queryKey: ["projects"],
    queryFn: () => ProjectApi.use((api) => api.list()),
    queryClient,
    update: ({ updates }) =>
      ProjectApi.use((api) => api.updateMany(updates.map((update) => update.value)))
  })
}))
```

The Adapter calls `queryClient.fetchQuery({ queryKey, queryFn })` for loads and
invalidates the same `queryKey` before refetch and after successful mutation
handlers by default. Post-mutation invalidation is `best-effort` unless the
adapter opts into `mutationInvalidation: "rollback-on-failure"`, which treats
the invalidation failure as part of the mutation boundary and rolls back the
optimistic transaction.

Change-feed hosts can apply external row batches without touching private
Collection Store maps:

```ts
yield* Collection.applyChangesEffect(Projects, [
  { _tag: "Upsert", value: { id: "atlas", name: "Atlas Prime" } },
  { _tag: "Delete", key: "lumen" }
])
```

The batch flows through normal collection writes, so secondary indexes,
persistence, store events, and live queries observe the update.
If the target is a read-only Live Query Collection, the Effect fails before any
row, event, or persistence side effect. External feeds should update the source
collections and let the live-query collection rematerialize.

Long-lived feeds should use the scoped subscription Adapter. The subscription
stays active until the surrounding Effect scope closes, and unsubscribe runs as
a finalizer:

```ts
yield* Collection.subscribeChangesEffect(Projects, {
  name: "projects-feed",
  subscribe: ({ emitChanges }) => {
    const unsubscribe = feed.onChange((changes) => {
      emitChanges(changes, { origin: "remote", synced: true })
    })

    return unsubscribe
  }
})
```

The internal Collection Change Feed Runtime owns the scoped dispatcher and
Effect execution behind `emit(...)` and `emitChanges(...)`. If queued
application of a batch fails, the active Collection Store publishes a
`CollectionChangeFeedFailure` event instead of making the host feed Adapter own
runtime plumbing.
The queue is scoped: after the subscription Scope releases, captured host
callbacks drop late `emitChanges(...)` calls deterministically instead of
enqueuing into an unconsumed dispatcher.

## Persistence And Hydration

Collections expose synchronous inspection helpers for UI/runtime-bound code and
Effect forms for durable SSR, route preload, tests, and server adapters:

```ts
const snapshot = yield* Projects.snapshotEffect()

yield* Projects.hydrateEffect(snapshot)
```

Use `snapshotEffect(...)` and `Collection.dehydrateEffect(...)` for hydration,
persistence, and server payloads. The synchronous `snapshot()` and
`Collection.dehydrate(...)` helpers are inspection views of the current runtime
store; they do not wait behind in-flight durable commit permits.

Multiple collections can travel as one hydration payload:

```ts
const payload = yield* Collection.dehydrateEffect([Projects, Tasks])

yield* Collection.hydratePayloadEffect([Projects, Tasks], payload)
```

Hydration validates every collection snapshot before applying any of them. That
preflight rejects duplicate pending transaction ids in the payload, merge-mode
collisions with pending transactions already in the target store, and read-only
live-query collection snapshots before mutating earlier collections. Any
collection `getKey(...)` callback failure is reported as
`EffectInputCallbackError` instead of being collapsed into snapshot codec
failure. `Collection.validateHydrationPayloadEffect(...)` runs the same
definition-owned and target-store preflight as hydrate without applying the
payload. The snapshot codec still owns malformed wire data such as missing row
fields or invalid pending mutation metadata. Pending update snapshots are
canonicalized from decoded `previous` and `value` rows, so optimistic replay uses
the same output-shaped changes after hydration or persistence restore that it
would use for a live mutation.

The persistence API takes a tiny string storage adapter. This keeps the core
portable across browser storage, test memory storage, and durable SQL-backed
adapters:

```ts
const storage = Collection.storage(localStorage)

yield* Projects.persistEffect(storage, { key: "projects" })
yield* Projects.restoreEffect(storage, { key: "projects" })
```

`Collection.memoryStorage()` is useful for tests and in-memory examples. Both
snapshot and restore preserve row metadata, so pending local rows can stay
`$synced: false` across a refresh.

For durable local state, prefer the SQLite-shaped storage seam over an
IndexedDB-specific core adapter. The driver is a namespace/key/value table shape,
so OPFS SQLite, Node SQLite, React Native SQLite, Durable Objects, and tests can
share the same Collection Durable Storage Adapter Interface:

```ts
const storage = Collection.sqliteStorage(sqliteDriver, {
  namespace: `workspace:${workspaceId}`,
  schemaVersion: 1
})

yield* Projects.restoreEffect(storage, { key: "projects" })
yield* Projects.persistEffect(storage, { key: "projects" })
```

Schema versions are checked at the storage Adapter. A mismatch reads as no
snapshot, letting synced collections resync from the server while leaving room
for explicit migrations in local-only adapters.

SQL statement clients can be adapted without adding a SQLite runtime dependency
to `@effect-ui/db`:

```ts
const sqliteDriver = Collection.sqliteStatementDriver({
  execute: (sql, params) => Effect.tryPromise(() => db.execute(sql, params)),
  select: (sql, params) => Effect.tryPromise(() => db.select(sql, params))
})
```

The generated table stores `namespace`, `key`, `schema_version`, `value`, and
`updated_at`, with a primary key over `namespace` and `key`.

SQLite table-name validation and statement-driver callback failures are
reported through the storage Effect error channel. Constructing the storage
Adapter stays pure; invalid table names fail at `getItem`, `setItem`, or
`removeItem` with typed persistence errors rather than throwing during setup.
Method-style SQLite clock callbacks keep their receiver when persistence rows
need an `updated_at` value.

Statement result rows are validated at the Adapter boundary. The statement
driver requires exact string values for `namespace`, `key`, and `value`, and
finite numbers for `schema_version`/`schemaVersion` and
`updated_at`/`updatedAt`. Malformed rows fail as `SQLitePersistenceInvalidRow`
instead of being coerced with JavaScript `String(...)` or `Number(...)`.

The statement, prepared-statement, and in-memory helpers intentionally live
together as one dependency-free SQLite persistence helper family. The in-memory
adapter is a reference implementation of the SQL generated by the statement
driver, and public access stays through both package-root helpers and the
`Collection.sqlite*` convenience aliases.

Prepared-statement clients can be adapted before they enter the statement
driver Interface:

```ts
const sqliteDatabase = Collection.sqlitePreparedStatementDatabase({
  prepare: (sql) => {
    const statement = db.prepare(sql)
    return {
      run: (...params) => statement.run(...params),
      all: (...params) => statement.all(...params)
    }
  }
}, { cache: true })

const storage = Collection.sqliteStorage(
  Collection.sqliteStatementDriver(sqliteDatabase)
)
```

For tests, docs, and host adapter development, use the in-memory statement
database. It supports the SQL generated by `Collection.sqliteStatementDriver`;
it is not intended to be a general SQLite engine:

```ts
const memoryDb = Collection.sqliteMemoryStatementDatabase()
const storage = Collection.sqliteStorage(
  Collection.sqliteStatementDriver(memoryDb),
  {
    namespace: "test",
    schemaVersion: 1
  }
)
```

Use a Collection Persistence Policy when a collection should own its durable
restore/writeback loop:

```ts
const Projects = Collection.define(Collection.persistedOptions<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  load: () => ProjectApi.use((api) => api.list()),
  persistence: {
    storage,
    key: "projects",
    loadAfterRestore: true
  }
}))
```

Preload restores the persisted snapshot first. By default, a restored snapshot
is enough to satisfy preload; set `loadAfterRestore: true` when preload should
also refresh from the remote loader. Refetch always forces the loader. The
internal Collection Sync Load Policy runs this as one Effect v4 workflow, so
concurrent preloads join the same in-flight `Deferred` and a slower old preload
cannot overwrite a newer forced refetch. The same policy persists fresh
snapshots after loads, while the internal Collection Mutation Workflow owns
optimistic transaction persistence, active mutation `Deferred` joiners,
commit/rollback, and restored pending flush replay.

Pending optimistic transactions can be inspected separately:

```ts
const pending = yield* Projects.pendingMutationsEffect()

pending.map((entry) => ({
  id: entry.transaction.id,
  mutations: entry.transaction.mutations.length,
  attempts: entry.attempts
}))
```

Restored or current pending transactions can be flushed back through the
collection's mutation handlers without re-applying local row changes:

```ts
const flushed = yield* Projects.flushPendingMutationsEffect()

flushed.map((transaction) => transaction.id)
```

Flush uses the pending transaction facts already in collection state. On
success, touched rows are marked `$synced: true` and the transaction is removed
from the queue. If a handler fails, the saved rollback rows are restored, the
transaction is removed from the queue, rollback events are published, and the
Effect fails with the handler error unless rollback persistence fails; in that
case the rollback persistence error is returned so storage repair remains
visible to callers.
Mutation handlers receive cloned/frozen transaction facts, not the store-owned
pending queue records, so adapters cannot mutate rollback rows or persisted
mutation facts by changing handler context objects.

Use a Collection Flush Policy when the app needs to coordinate multiple
collections or skip flushing while offline:

```ts
const results = yield* Collection.flushAllPendingMutationsEffect(
  [Projects, Tasks],
  { skip: () => Network.use((network) => !network.online) }
)

results.map((result) => [result.collection, result._tag])
```

Use a Collection Background Sync Adapter when a host trigger should decide
whether a pending flush is allowed to run:

```ts
const sync = yield* Collection.backgroundSyncPendingMutationsEffect(
  [Projects, Tasks],
  {
    trigger: "online",
    adapter: {
      name: "browser-online",
      shouldFlush: ({ pending }) =>
        Network.use((network) =>
          network.online && pending.some((entry) => entry.transactions.length > 0)
        )
    }
  }
)

sync._tag
// "Idle" | "Deferred" | "Flushed"
```

The DB Module does not listen to browser events directly. Browser, native,
worker, or server hosts own those triggers and call the Background Sync
Interface with adapters that match their scheduling and connectivity rules.

When a mutation handler is still in flight, `persistEffect` stores both the
optimistic rows and the rollback rows for the pending transaction. A later
`restoreEffect` can hydrate the same local state and expose the same pending
transaction facts to devtools or sync adapters.

Collection lifecycle events flow through the active Resource Store's collection
store:

```ts
const store = yield* Collection.storeEffect()
const subscription = yield* store.subscribeEventsEffect()
```

The public store surface is intentionally narrow: callers can subscribe to
events and participate in lifecycle disposal, but collection state maps remain
owned by `@effect-ui/db`. Devtools can record those events through its
collection event runtime pipeline without importing private DB implementation
details.

## Start SSR

Start can include DB collection snapshots in the normal hydration script. Route
preloads that call `Collection.preloadEffect(...)` or
`Collection.refetchEffect(...)` are collected automatically and dehydrated from
the request runtime:

```ts
const ProjectRoute = route("/projects/:id", {
  preload: () => Projects.preloadEffect()
})
```

Explicit `collections` are still supported as a hydration registry and override.
They are always dehydrated, even when a route preload does not touch them.
Live query preload and refetch validate the query plan before source collection
loads run. Invalid aliases, indexes, or unsupported plan shapes fail with
`QueryEvaluationError`, and React DB / Solid DB automatic preload records that
failure without causing source side effects.
Matched routes can also declare concrete Collection Definitions with
`preloadCollections`; concrete definitions need no lookup. String declarations
must resolve through the request/app-local `collections`, `collectionRegistry`,
or `resolveCollection` inputs. If a string declaration cannot be resolved, Start
fails request preload with `StartPreloadError` instead of falling back to the
process-global DB registry. Resolved route declarations are preloaded when the
route did not already touch them and are included in the request-runtime
hydration payload:

```ts
export const handleRequest = createRequestHandler(app, {
  collections: [Projects, Tasks],
  render: ({ collectionPreload, legacyHydrationScript }) => {
    collectionPreload.routeTouchedCollections
    collectionPreload.routeDeclaredCollections
    collectionPreload.registeredCollections
    collectionPreload.dehydratedCollections
    return `<html><body><div id="root"></div>${legacyHydrationScript}</body></html>`
  }
})
```

The browser entrypoint hydrates both resources and collections from the same
script. Prefer the Effect form and run it through the browser Runtime Spine so
hydration lands in the same runtime that the UI will use:

```ts
const runtime = createEffectRuntime(AppLive)

runtime.runSync(hydrateFromDocumentEffect(document, "__EFFECT_UI_HYDRATION__", {
  collections: [Projects, Tasks]
}))
```

Minimal browser entrypoints can use the synchronous host facade
`hydrateFromDocument(document, id, { runtime, collections })`; it runs
`hydrateFromDocumentEffect(...)` before the UI mounts.

For streamed SSR responses, Start emits incremental JSON scripts with
`data-effect-ui-hydration-chunk`. Browser code can ingest only those chunks with
`hydrateStartHydrationChunksFromDocument` or run
`hydrateStartHydrationChunksFromDocumentEffect` inside the browser runtime. The
same collection definitions are passed, and consumed chunk scripts are marked so
later scans do not apply the same collection snapshot twice.

Collection state is still request-local on the server. Use the Effect forms
inside SSR work so the request runtime is honored.

## Next Slices

- Concrete host packages that wrap `Collection.sqliteStatementDriver(...)` for
  OPFS/browser, Node, React Native, and Durable Objects.
- Sync adapters for Electric and PowerSync once real host integrations need
  them.
