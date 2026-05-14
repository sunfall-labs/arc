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
- Collections support Effect-first loading, direct sync writes, retry policy,
  and optimistic `insert`, `update`, and `delete` mutations.
- Collections can declare secondary indexes for runtime-local materialized
  keyed lookup and indexed query joins.
- Mutations apply locally before persistence, mark rows as unsynced, and roll
  back if the mutation handler fails.
- Rows expose metadata: `$key`, `$collection`, `$synced`, and `$origin`.
- Collections can snapshot, hydrate, persist, and restore runtime-local row
  state.
- In-flight optimistic transactions are tracked in a pending mutation queue and
  included in snapshots.
- `Collection.serverOptions(...)` adapts server/RPC-backed loads and mutation
  handlers into the normal Collection Definition Interface.
- `Collection.syncOptions(...)` adapts generic external row sources into the
  same Collection Definition load/refetch/mutation Interface; server functions
  are one adapter over that seam.
- `Collection.querySyncAdapter(...)` adapts TanStack Query-shaped clients into
  the same Collection Sync Adapter seam.
- `Collection.flushAllPendingMutationsEffect(...)` coordinates mutation flushes
  across collections and can skip work while offline.
- `Collection.backgroundSyncPendingMutationsEffect(...)` lets host adapters
  decide whether trigger-driven pending mutation flushes should run.
- `Collection.applyChangesEffect(...)` applies external row upsert/delete
  batches through the Collection Store for change-feed adapters.
- `Collection.subscribeChangesEffect(...)` acquires scoped change-feed
  subscriptions and routes emitted batches through the same Collection Store
  seam.
- `Collection.sqliteStorage(...)` adapts a SQLite-shaped namespace/key/value
  driver into collection snapshot persistence without baking in IndexedDB.
- `Collection.sqlitePreparedStatementDatabase(...)` adapts prepare/run/all
  SQLite clients into the same statement-driver Interface.
- `Collection.sqliteMemoryStatementDatabase()` provides a dependency-free
  statement-driver Adapter for tests, docs, and host SQLite adapter development.
- `Collection.persistedOptions(...)` restores persisted snapshots on preload
  and writes snapshots back after loads, writes, and optimistic mutation queue
  changes.
- `Collection.liveQuery(...)` exposes a `Query.live(...)` graph as a read-only
  collection-shaped derived view.
- `Query.live(...)` creates live materialized queries over one or more
  collections.
- Live query filters and joins run through `@tanstack/db-ivm`, TanStack DB's
  differential-dataflow / incremental-view-maintenance engine.
- Grouped aggregate ordering plus `limit` / `offset` windows are maintained
  inside the D2 graph.
- `@effect-ui/solid-db` adapts collections and live queries to Solid accessors.

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
bucket. Live Query Collections expose the same index Interface, but because
their rows are derived from a D2 graph rather than owned by a Collection Store,
their lookup currently scans the materialized derived rows.

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

## Effect Policies

Remote collection work uses Effect policy, not a framework retry DSL. The same
`policy.retry` schedule is applied to collection loads and mutation handlers:

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

The Adapter accepts Effect callbacks, Start `Server.fn` / `Server.client`
functions, and promise-returning host calls. It forwards mutation payloads with
the original collection transaction so sync layers can correlate optimistic
local work with durable writes later.

For host integrations that are not server functions, use the generic Collection
Sync Adapter seam directly:

```ts
const Projects = Collection.define(Collection.syncOptions<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: {
    name: "projects-sync",
    load: () => remote.listProjects(),
    refetch: () => remote.listProjects({ force: true }),
    update: ({ updates }) =>
      remote.updateProjects(updates.map((update) => update.value))
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
handlers by default.

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

Long-lived feeds should use the scoped subscription Adapter. The subscription
stays active until the surrounding Effect scope closes, and unsubscribe runs as
a finalizer:

```ts
yield* Collection.subscribeChangesEffect(Projects, {
  name: "projects-feed",
  subscribe: ({ emit }) => {
    const unsubscribe = feed.onChange((changes) => {
      runtime.runFork(emit(changes, { origin: "remote", synced: true }))
    })

    return unsubscribe
  }
})
```

## Persistence And Hydration

Collections expose synchronous helpers for UI/runtime-bound code and Effect
forms for SSR, route preload, tests, and server adapters:

```ts
const snapshot = yield* Projects.snapshotEffect()

yield* Projects.hydrateEffect(snapshot)
```

Multiple collections can travel as one hydration payload:

```ts
const payload = yield* Collection.dehydrateEffect([Projects, Tasks])

yield* Collection.hydratePayloadEffect([Projects, Tasks], payload)
```

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
  execute: (sql, params) => db.execute(sql, params),
  select: (sql, params) => db.select(sql, params)
})
```

The generated table stores `namespace`, `key`, `schema_version`, `value`, and
`updated_at`, with a primary key over `namespace` and `key`.

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
also refresh from the remote loader. Refetch always forces the loader. The same
policy persists fresh snapshots after loads, direct writes, and optimistic
mutation queue changes, including in-flight pending mutations.

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
Effect fails with the handler error.

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
Matched routes can also declare concrete Collection Definitions with
`preloadCollections`; Start resolves those declarations from the DB registry,
preloads any that the route did not already touch, and includes them in the
request-runtime hydration payload:

```ts
export const handleRequest = createRequestHandler(app, {
  collections: [Projects, Tasks],
  render: ({ collectionPreload, hydrationScript }) => {
    collectionPreload.routeTouchedCollections
    collectionPreload.routeDeclaredCollections
    collectionPreload.registeredCollections
    collectionPreload.dehydratedCollections
    return `<html><body><div id="root"></div>${hydrationScript}</body></html>`
  }
})
```

The browser entrypoint hydrates both resources and collections from the same
script. Pass the collection definitions that can appear in the payload, plus the
browser runtime when one is created explicitly, so hydration lands in the same
Runtime Spine that the UI will use:

```ts
const runtime = createEffectRuntime(AppLive)

hydrateFromDocument(document, "__EFFECT_UI_HYDRATION__", {
  runtime,
  collections: [Projects, Tasks]
})
```

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
- Sync adapters for Electric, PowerSync, and TanStack Query-shaped collections.
