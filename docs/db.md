# Sunfall Arc DB

`@sunfall/arc-db` is the framework-native collection and live-query layer. It is
intended to cover the TanStack DB shape while keeping Sunfall Arc's runtime spine:
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

- `Collection.define(...)` declares a typed keyed row collection. It is the one
  way to back a collection: pass `sync` as an inline `Collection.SyncAdapter`
  (`load`, `refetch`, `follow`, `changes`, `insert`, `update`, `delete`) or as a
  `Resource.Ref`. Without `sync` the collection is local-only.
- Collection vs Resource: a Resource is a cached async read; a Collection is a
  keyed, indexed, optimistic row store, and may be backed by a Resource via
  `sync: ref`.
- The definition's methods are the single read/write path: reactive reads
  (`rows()`, `get()`, `index()`, `firstByIndex()`, `state()`, `version()`,
  `pendingMutations()`) and `*Effect` methods for loads and writes
  (`preloadEffect`, `refetchEffect`, `insertEffect`, `updateEffect`,
  `deleteEffect`, `applyChangesEffect`, `flushPendingMutationsEffect`,
  `snapshotEffect`, `hydrateEffect`, `persistEffect`, `restoreEffect`).
- Collection state is stored per active Sunfall Arc runtime/resource store.
- Names key stores, snapshots, persistence, and hydration. Redefining a name
  (HMR, re-evaluated modules) replaces the earlier definition; Start rejects
  two distinct collections sharing a name within one app.
- Collections support Effect-first loading, retry policy, optimistic `insert`,
  `update`, and `delete` mutations, and direct remote writes through
  `applyChangesEffect(...)`.
- Collections can declare secondary indexes for runtime-local materialized
  keyed lookup and indexed query joins.
- Mutations apply locally before persistence, mark rows as unsynced, and roll
  back if the sync adapter fails.
- Rows expose metadata: `$key`, `$collection`, `$synced`, and `$origin`.
- Collections can snapshot, hydrate, persist, and restore runtime-local row
  state.
- Collection Row Ingress canonicalizes live rows before they enter store state:
  output schema decoding, finite key validation, `getKey` normalization, value
  cloning, and stored-row creation happen at one seam for initial data, loads,
  remote changes, and optimistic mutations.
- In-flight optimistic transactions are tracked in a pending mutation queue and
  included in snapshots. Flushes join an active mutation attempt instead of
  replaying an in-flight handler.
- Collection preload and refetch coordination is store-owned: concurrent
  preloads share the active load, forced refetches advance the store generation,
  and stale earlier loads cannot overwrite newer rows or persistence.
- `Collection.flushAllPendingMutationsEffect(...)` coordinates mutation flushes
  across collections and can skip work while offline.
- `Collection.backgroundSyncPendingMutationsEffect(...)` lets host adapters
  decide whether trigger-driven pending mutation flushes should run.
- `SQLitePersistence.*` adapts SQLite-shaped drivers into collection snapshot
  persistence without baking in IndexedDB.
- `Collection.liveQuery(...)` exposes a live query as a read-only
  collection-shaped derived view; `Query.live(...)` is the signal-based live
  query.
- Live query filters and joins run through `@tanstack/db-ivm`, TanStack DB's
  differential-dataflow / incremental-view-maintenance engine.
- `@sunfall/arc-solid-db` adapts collections and live queries to Solid
  accessors.
- Framework adapters (Solid DB, Start, devtools) share plumbing through the
  non-public `@sunfall/arc-db/internal` entry: store access and events,
  preload collection, multi-collection dehydrate/hydrate, the definition
  registry, and diagnostics.

## Load State Is AsyncResult

Collection and live-query load state uses Effect's `AsyncResult`
(`import { AsyncResult } from "effect/reactivity"`), the same vocabulary as
Resources and Actions. Rows are always their own signal, so local-first reads
never wait on load state.

- `collection.state()` is
  `ReadableSignal<AsyncResult<void, Collection.RuntimeError<E>>>`: `Initial`
  before the first load, `Success` (timestamped with the load's `Clock` time)
  once rows are loaded, and `Failure` carrying the load `Cause` with the last
  success as `previousSuccess`. A preload or refetch marks the current result
  `waiting` instead of switching tags; an interrupted load returns to the prior
  settled result.
- `liveQuery.state` is `ReadableSignal<AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError>>`
  beside `liveQuery.data` (always the last good rows). It folds source load
  results and evaluation failures: `Initial` while any source has never loaded,
  `Success` with the current rows (timestamped by the latest source load),
  `Failure` with the source or evaluation `Cause` keeping the last good rows as
  `previousSuccess`, and `waiting` while any source is loading.

Solid DB handles expose those results as one accessor:
`useCollection(...)` returns reactive reads only (`rows`, `result`, `get`,
`index`, `pendingMutations`, `preloadFailure`); writes run the definition's
Effects through the runtime runner (`runEffect(Projects.updateEffect(id, patch))`).
`useLiveQuery(...)` returns `data`, `result`, `preloadFailure`, `preloadEffect`,
and `refetchEffect`; its query factory runs tracked, so a signal or prop read in
the factory rebuilds the query.

```tsx
const projects = useCollection(Projects);
const result = () => projects.result();

// Rows are their own signal: render them once, keyed by id, and let the load
// result drive only the status chrome around them.
return (
  <Show when={result()._tag !== "Initial"} fallback={<ProjectSkeleton />}>
    <For each={projects.rows()} keyed={(project) => project.id}>
      {(project) => <ProjectRow project={project()} />}
    </For>
    <Show when={result().waiting}>
      <p class="status">Refreshing</p>
    </Show>
    <Show when={Option.getOrUndefined(AsyncResult.cause(result()))}>
      {(cause) => <ProjectError cause={cause()} />}
    </Show>
  </Show>
);
```

Rendering rows inside a builder branch would rebuild the whole list on every
load transition; keying `<For>` by id keeps rows mounted when a refetch hands
back new row objects (see
[Solid Adapter](solid-adapter.md#keep-content-mounted-across-refreshes)).

## Query Engine Shape

The public query API is intentionally small:

```ts
const ActiveProjectNames = Query.live((query) =>
  query
    .from({ project: Projects })
    .where(({ project }) => project.status === "active")
    .select(({ project }) => project.name)
    .orderBy(({ project }) => project.name),
);
```

The concrete `QueryBuilder` constructor is internal to the package source; apps
use `Query.from(...)`, `Query.onceEffect(...)`,
`Query.live(...)`, and the branded `Query.Builder` fluent Interface. The
public builder type does not expose execution-plan storage and cannot be
structurally faked, and public `LiveQuery` handles expose data/state/source
metadata and lifecycle Effects rather than the internal builder. That keeps
malformed builder construction and plan mutation behind the Query Module seam.

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
    .join(
      "task",
      Tasks,
      ({ project }) => project.id,
      (task) => task.projectId,
    )
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
```

Declare Collection Secondary Indexes when a relationship is queried repeatedly.
The active Collection Store materializes each index into runtime/request-local
lookup buckets and invalidates those buckets when the collection version
changes. Index values must be scalar plain values; Dates are supported only
when valid:

```ts
const Tasks = Collection.define<Task>({
  name: "Tasks",
  getKey: (task) => task.id,
  indexes: {
    byProject: (task) => task.projectId,
    tags: (task) => task.tags,
  },
});

const atlasTasks = Tasks.index("byProject", "atlas");
```

Indexed joins use the declared index buckets instead of scanning the right-hand
collection for every left-side row:

```ts
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
```

Multi-value indexes are supported for direct lookup and indexed joins. A row
whose index selector returns multiple values can join against any matching left
key, and duplicate values from a single row are de-duplicated inside that row's
bucket. Live Query Collections expose the same index Interface. Their rows are
derived from a D2 graph rather than owned by a Collection Store, so the runtime
builds index buckets from the materialized projection and caches them per
projection revision.

Query plans can be inspected without reaching into the builder implementation:

```ts
const plan = Query.diagnostics((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);

plan.joins[0];
// {
//   strategy: "collection-index",
//   index: "byProject",
//   leftRows: 4,
//   rightRows: 24,
//   outputRows: 18,
//   estimatedComparisons: 4
// }
```

`Query.diagnostics(...)`, `Query.onceEffect(...)`, and `Query.live(...)` use the
same typed failure
envelope. Unsupported plan shapes, invalid source aliases or indexes,
Promise-shaped, Effect-shaped, or non-builder query factory results, and invalid
`orderBy(...)` comparable values such as `NaN` or invalid Dates fail as
`QueryEvaluationError` instead of leaking raw exceptions.

Grouped aggregates are also live:

```ts
const ProjectStatusCounts = Query.live((query) =>
  query
    .from({ project: Projects })
    .groupBy(({ project }) => ({ status: project.status }), {
      count: Query.count(),
      avgProgress: Query.avg(({ project }) => project.progress),
    })
    .orderBy((group) => group.status),
);
```

The current adapter compiles source collections, explicit keyed joins,
cross-collection fallback joins, filters, grouped aggregates, ordered windows,
and `limit` / `offset` for ordered queries into a D2 graph. The materialized D2
output is then projected by Sunfall Arc. Unordered `offset` / `limit` still runs
after materialization until the framework has explicit insertion-order
semantics.

Public `Query.Factory<TResult>` annotations default error and requirement
channels to `never`. If a factory reads collections whose load/refetch work can
fail or needs services, spell those channels in the annotation instead of
relying on a broad alias. This keeps `Query.onceEffect(...)`, `Query.live(...)`,
and Live Query Collection hovers aligned with the actual source collections.

Filters use plain JavaScript operators inside `where(...)`
(`project.status === "active" && project.progress > 50`); there are no
predicate helper functions.

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
        progress: project.progress,
      })),
});
```

The Live Query Collection does not own source rows and rejects local mutations.
It is useful when a D2/materialized view should be passed to APIs that expect a
Collection Definition, or used as a source for another live query.

Repeated `state().get()` reads are stable: the `Success` result (and its
`timestamp`) changes only when
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
    retry: Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 })),
  },
  sync: {
    load: () => ProjectApi.use((api) => api.list()),
    update: ({ updates }) => ProjectApi.use((api) => api.updateMany(updates)),
  },
});
```

Optimistic row writes stay visible while the scheduled Effect retries. If all
retries fail, the pending mutation is rolled back through the same typed failure
path as an ordinary handler failure.

## Sync Adapters

`sync` is the one way to back a collection. An inline adapter's operations may
return a plain value or an Effect, and may be Server functions directly; server
client failures join the collection error channel:

```ts
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: {
    load: listProjects, // Server.fn<void, ReadonlyArray<Project>>
    update: ({ updates, transaction }) => ProjectApi.use((api) => api.renameMany(updates)),
  },
});
```

Host Promise work should be wrapped with `Effect.tryPromise(...)` before it
enters the adapter. Mutation payloads carry the original collection transaction
so sync layers can correlate optimistic local work with durable writes.
Method-style adapters keep their receiver. An adapter `name` is reported as
`sync.adapter` by collection diagnostics.

A Resource ref can back a collection directly:

```ts
const ProjectRows = Resource.family<void, ReadonlyArray<Project>>({
  name: "Project.rows",
  load: () => ProjectApi.use((api) => api.list()),
});

const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: ProjectRows(undefined),
});
```

Preload calls `Resource.prefetchEffect(ref)`, refetch calls
`Resource.refreshEffect(ref)`, and once either succeeds the collection follows
`Resource.changes(ref)` for the lifetime of its Collection Store. Every later
success of the Resource (a reload triggered by an Action's invalidation tags, a
refresh elsewhere, a hydration) reconciles the collection's synced rows, with no
second fetch. When the collection also needs to commit writes, spell the same
operations inline: `{ load: () => Resource.prefetchEffect(ref), refetch: () =>
Resource.refreshEffect(ref), follow: () => Resource.changes(ref), update }`.

`follow` is a `Stream` of authoritative row snapshots. It starts once per
Collection Store after the first successful preload or refetch, runs in the
store's scope (runtime disposal interrupts it), and each emission goes through
the same load policy as a forced refetch, so stale loads are superseded and
pending optimistic mutations stay rebased on top. A follow failure is recorded
like a load failure and restarts on the next successful preload or refetch.

`changes` is a `Stream` of incremental remote change batches. It has the same
lifecycle as `follow`; the collection owns the subscription:

```ts
const Projects = Collection.define<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: {
    load: () => ProjectApi.use((api) => api.list()),
    changes: () =>
      Stream.callback<ReadonlyArray<Collection.Change<Project, string>>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => feed.onChange((changes) => Queue.offerUnsafe(queue, changes))),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
  },
});
```

A batch that fails to apply (for example an `Update` for a missing row, or a row
that fails the output schema) is published as a `CollectionChangeFeedFailure`
store event and the stream keeps running; a stream failure is published the same
way and recorded as a load failure.

For one-off imperative writes, `applyChangesEffect(...)` applies a batch in
order without queuing mutation handlers. Rows default to `origin: "remote"` and
`synced: true`:

```ts
yield *
  Projects.applyChangesEffect([
    { _tag: "Upsert", value: { id: "atlas", name: "Atlas Prime" } },
    { _tag: "Update", key: "orion", changes: { name: "Orion Prime" } },
    { _tag: "Delete", key: "lumen" },
  ]);
```

`Update` fails with `CollectionRowNotFound` or `CollectionRowKeyChanged`; a
`Delete` for a missing row is a no-op. A read-only Live Query Collection fails
with `ReadonlyCollectionMutation` before any row, event, or persistence side
effect.

### Recipe: TanStack Query client

A query client is just another inline adapter
(`projectsQuery` is `{ queryKey: ["projects"], queryFn: listProjects }`):

```ts
const Projects = Collection.define<Project>({
  name: "Projects",
  getKey: (project) => project.id,
  sync: {
    name: "tanstack-query:projects",
    load: () => Effect.tryPromise(() => queryClient.fetchQuery(projectsQuery)),
    refetch: () =>
      Effect.tryPromise(() => queryClient.invalidateQueries({ queryKey: ["projects"] })).pipe(
        Effect.andThen(Effect.tryPromise(() => queryClient.fetchQuery(projectsQuery))),
      ),
    update: ({ updates }) =>
      Effect.tryPromise(() => updateProjects(updates.map((update) => update.value))).pipe(
        Effect.andThen(
          Effect.tryPromise(() => queryClient.invalidateQueries({ queryKey: ["projects"] })),
        ),
      ),
  },
});
```

## Persistence And Hydration

Collections expose synchronous inspection helpers for UI/runtime-bound code and
Effect forms for durable SSR, route preload, tests, and server adapters:

```ts
const snapshot = yield * Projects.snapshotEffect();

yield * Projects.hydrateEffect(snapshot);
```

Use `snapshotEffect(...)` for hydration, persistence, and server payloads. The
synchronous `snapshot()` is an inspection view of the current runtime store; it
does not wait behind in-flight durable commit permits.

Start moves multiple collections as one hydration payload (through
`@sunfall/arc-db/internal`). Hydration validates every collection snapshot before applying any of them. That
preflight rejects duplicate pending transaction ids in the payload, merge-mode
collisions with pending transactions already in the target store, and read-only
live-query collection snapshots before mutating earlier collections. Any
collection `getKey(...)` callback failure is reported as
`EffectInputCallbackError` instead of being collapsed into snapshot codec
failure. Validation runs the same definition-owned and target-store preflight as
hydrate without applying the payload. The snapshot codec still owns malformed wire data such as missing row
fields or invalid pending mutation metadata. Pending update snapshots are
canonicalized from decoded `previous` and `value` rows, so optimistic replay uses
the same output-shaped changes after hydration or persistence restore that it
would use for a live mutation.

The persistence API takes a tiny string storage adapter. This keeps the core
portable across browser storage, test memory storage, and durable SQL-backed
adapters:

```ts
const storage = Collection.storage(localStorage);

yield * Projects.persistEffect(storage, { key: "projects" });
yield * Projects.restoreEffect(storage, { key: "projects" });
```

`Collection.memoryStorage()` is useful for tests and in-memory examples. Both
snapshot and restore preserve row metadata, so pending local rows can stay
`$synced: false` across a refresh.

For durable local state, prefer the SQLite-shaped storage seam over an
IndexedDB-specific core adapter. The driver is a namespace/key/value table shape,
so OPFS SQLite, Node SQLite, React Native SQLite, Durable Objects, and tests can
share the same Collection Durable Storage Adapter Interface:

```ts
const storage = SQLitePersistence.storage(sqliteDriver, {
  namespace: `workspace:${workspaceId}`,
  schemaVersion: 1,
});

yield * Projects.restoreEffect(storage, { key: "projects" });
yield * Projects.persistEffect(storage, { key: "projects" });
```

Schema versions are checked at the storage Adapter. A mismatch reads as no
snapshot, letting synced collections resync from the server while leaving room
for explicit migrations in local-only adapters.

SQL statement clients can be adapted without adding a SQLite runtime dependency
to `@sunfall/arc-db`:

```ts
const sqliteDriver = SQLitePersistence.statementDriver({
  execute: (sql, params) => Effect.tryPromise(() => db.execute(sql, params)),
  select: (sql, params) => Effect.tryPromise(() => db.select(sql, params)),
});
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
driver; public access is through the `SQLitePersistence` namespace.

Prepared-statement clients can be adapted before they enter the statement
driver Interface:

```ts
const sqliteDatabase = SQLitePersistence.preparedStatementDatabase(
  {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params) => statement.run(...params),
        all: (...params) => statement.all(...params),
      };
    },
  },
  { cache: true },
);

const storage = SQLitePersistence.storage(SQLitePersistence.statementDriver(sqliteDatabase));
```

For tests, docs, and host adapter development, use the in-memory statement
database. It supports the SQL generated by `SQLitePersistence.statementDriver`;
it is not intended to be a general SQLite engine:

```ts
const memoryDb = SQLitePersistence.memoryStatementDatabase();
const storage = SQLitePersistence.storage(SQLitePersistence.statementDriver(memoryDb), {
  namespace: "test",
  schemaVersion: 1,
});
```

Use a Collection Persistence Policy when a collection should own its durable
restore/writeback loop:

```ts
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: { load: () => ProjectApi.use((api) => api.list()) },
  persistence: {
    storage,
    key: "projects",
    loadAfterRestore: true,
  },
});
```

`Collection.define(...)` infers the storage error and requirement channels into
the collection's `E` and `R`; with explicit type arguments, spell them in `E`:

```ts
const Projects = Collection.define<Project, string, SQLitePersistenceInvalidRow>({ ... });
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
const pending = Projects.pendingMutations();

pending.map((entry) => ({
  id: entry.transaction.id,
  mutations: entry.transaction.mutations.length,
  attempts: entry.attempts,
}));
```

Restored or current pending transactions can be flushed back through the
collection's mutation handlers without re-applying local row changes:

```ts
const flushed = yield * Projects.flushPendingMutationsEffect();

flushed.map((transaction) => transaction.id);
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
const results =
  yield *
  Collection.flushAllPendingMutationsEffect([Projects, Tasks], {
    skip: () => Network.use((network) => !network.online),
  });

results.map((result) => [result.collection, result._tag]);
```

Use a Collection Background Sync Adapter when a host trigger should decide
whether a pending flush is allowed to run:

```ts
const sync =
  yield *
  Collection.backgroundSyncPendingMutationsEffect([Projects, Tasks], {
    trigger: "online",
    adapter: {
      name: "browser-online",
      shouldFlush: ({ pending }) =>
        Network.use(
          (network) => network.online && pending.some((entry) => entry.transactions.length > 0),
        ),
    },
  });

sync._tag;
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
store. Store access and event subscription are adapter plumbing on
`@sunfall/arc-db/internal`; devtools records those events through its collection
event runtime pipeline.

## Start SSR

Start can include DB collection snapshots in the normal hydration script. Route
preloads that call `collection.preloadEffect()` or
`collection.refetchEffect()` are collected automatically and dehydrated from
the request runtime:

```ts
const ProjectRoute = route("/projects/:id", {
  preload: () => Projects.preloadEffect(),
});
```

Explicit `collections` are still supported as a hydration registry and override.
They are always dehydrated, even when a route preload does not touch them.
Live query preload and refetch validate the query plan before source collection
loads run. Invalid aliases, indexes, or unsupported plan shapes fail with
`QueryEvaluationError`, and Solid DB automatic preload records that
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
    collectionPreload.routeTouchedCollections;
    collectionPreload.routeDeclaredCollections;
    collectionPreload.registeredCollections;
    collectionPreload.dehydratedCollections;
    return `<html><body><div id="root"></div>${legacyHydrationScript}</body></html>`;
  },
});
```

The browser entrypoint hydrates both resources and collections from the same
script. Prefer the Effect form and run it through the browser Runtime Spine so
hydration lands in the same runtime that the UI will use:

```ts
const runtime = makeRuntime(AppLive);

runtime.runSync(
  hydrateFromDocumentEffect(document, "__SUNFALL_ARC_HYDRATION__", {
    collections: [Projects, Tasks],
  }),
);
```

Minimal browser entrypoints can use the synchronous host facade
`hydrateFromDocument(document, id, { runtime, collections })`; it runs
`hydrateFromDocumentEffect(...)` before the UI mounts.

For streamed SSR responses, Start emits incremental JSON scripts with
`data-sunfall-arc-hydration-chunk`. `hydrateFromDocument(...)` /
`hydrateFromDocumentEffect(...)` ingest those chunks after the root payload with
the same collection definitions, and consumed chunk scripts are marked so later
scans do not apply the same collection snapshot twice.

Collection state is still request-local on the server. Use the Effect forms
inside SSR work so the request runtime is honored.

## Next Slices

- Concrete host packages that wrap `SQLitePersistence.statementDriver(...)` for
  OPFS/browser, Node, React Native, and Durable Objects.
- Sync adapters for Electric and PowerSync once real host integrations need
  them.
