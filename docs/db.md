# Rows and Queries

A Resource is the one server-data model. When its output is a list, give it
`rows`: a key, the indexes to look rows up by, and optionally a remote change
feed. Readers then look rows up by key or index, Actions patch single rows by
key, and live queries (`@sunfall/arc-db`) join and aggregate the rows of
several Resources. The data is stored, cached, hydrated, and persisted once:
as the Resource's value.

Every snippet here is compiled from
[`type-tests/docs/db/`](../type-tests/docs/db); the shared model (`Project`,
`Task`, `ProjectApi`, tags) is in `model.ts`.

## Rows On A Resource

<!-- snippet: type-tests/docs/db/rows.ts#define -->

```ts
export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  error: ProjectsUnavailable,
  rows: {
    key: (project) => project.id,
    indexes: { status: (project) => project.status },
  },
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");
```

- `rows` is allowed only when `output` is an array; `key` and the index
  selectors are typed by its element, with no annotations. A family with a
  non-array output fails to compile.
- Rows are derived from the loaded value, never copied: the cache, tags,
  `staleFor`/`gcFor`, typed `error`, hydration, and `Resource.preload` /
  `refresh` / `invalidate` all work exactly as for any Resource.
- A reload replaces the rows. It is diffed by key against the previous value:
  a row equal to its previous version keeps its object identity (and when
  nothing changed, the whole array does), so keyed `<For>` lists keep their
  DOM and live queries skip unchanged rows.
- Lookups are built lazily per value and cached: the key positions on the
  first `get`, an index's buckets on its first `index` read.

An index maps a row to one bucket value, or to several:

<!-- snippet: type-tests/docs/db/rows.ts#indexes -->

```ts
export const TaskList = Resource.define({
  name: "Tasks.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Task),
  rows: {
    key: (task) => task.id,
    indexes: {
      byProject: (task) => task.projectId,
      // Several values put the row in several buckets.
      tag: (task) => task.tags,
    },
  },
  load: () => ProjectApi.use((api) => api.tasks()),
});
export const TasksRef = TaskList("all");
```

Index values are scalars: strings, numbers, booleans, valid Dates, `null`, or
`undefined`. A selector that throws or returns anything else is a defect.

## Reading Rows

The reader `Component.resource` returns for a family with `rows` adds
`get(input, key)` and `index(input, name, value)`. Both read the current value
of `input` exactly like `reader(input)`: they suspend the nearest `<Loading>`
on the first load only, then follow reloads, change feeds, and optimistic
patches. Keys, index names, and index values are typed by `rows`.

<!-- snippet: type-tests/docs/db/component.tsx#component -->

```tsx
const ActiveProjects = Component.define("ActiveProjects", function* () {
  const projects = yield* Component.resource(ProjectList); // E += ProjectsUnavailable
  const archive = yield* Component.action(ArchiveProject);
  const onArchive = yield* Component.callback("archive", (id: ProjectId) =>
    archive.submit({ id }).pipe(Effect.ignore),
  );

  // `index` reads like `projects("all")`: it suspends `<Loading>` on the first
  // load only, then follows reloads and optimistic row patches.
  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <ul class={{ refreshing: projects.waiting("all") }}>
        <For each={projects.index("all", "status", "active")} keyed={(project) => project.id}>
          {(project) => (
            <ProjectRow project={project()} onArchive={() => onArchive(project().id)} />
          )}
        </For>
      </ul>
      <Show when={projects.failure("all")}>{(cause) => <ProjectError cause={cause()} />}</Show>
    </Loading>
  );
}).pipe(Component.catchTags({ ProjectsUnavailable: () => <p>Projects are unavailable.</p> }));
```

`waiting` and `failure` are the reader's, keyed by input; the family's
declared `error` joins the Component's `E` as for any reader.

## Writes Are Actions

An Action is the one mutation path: its `optimistic` patches rows before
`run`, `run` writes the backend, and `invalidates` reloads the Resource.

<!-- snippet: type-tests/docs/db/writes.ts#archive -->

```ts
export const ArchiveProject = Action.define({
  name: "Projects.archive",
  input: Schema.Struct({ id: ProjectId }),
  output: Project,
  // The key is typed by `rows.key`; the patch by the row type.
  optimistic: ({ id }, transaction) => transaction.update(ProjectsRef, id, { status: "archived" }),
  run: ({ id }) => ProjectApi.use((api) => api.archive(id)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
```

<!-- snippet: type-tests/docs/db/writes.ts#create -->

```ts
export const CreateProject = Action.define({
  name: "Projects.create",
  input: Schema.Struct({ draftId: Schema.String, name: Schema.String }),
  output: Project,
  // A placeholder row until the reload brings the server's row.
  optimistic: ({ draftId, name }, transaction) =>
    transaction.insert(ProjectsRef, { id: draftId, name, status: "active", progress: 0 }),
  run: ({ name }) => ProjectApi.use((api) => api.create(name)),
  invalidates: () => [ProjectsTag],
});
```

- `transaction.insert(ref, row | rows)`, `transaction.update(ref, key,
patch)` (a partial row or a pure `row => next` updater), and
  `transaction.delete(ref, key)` take a ref of a Resource with `rows`; the key
  and row types come from its `rows`. A Resource without `rows` does not
  compile there; `transaction.set(ref, value => next)` patches any entry's
  whole value, rows or not.
- An insert replaces a row with the same key or appends; an update keeps the
  row's position. An update or delete of a key the value does not hold is a
  no-op, and an update that changes the key is a defect. An entry that has not
  loaded is left alone.
- Row patches are layers over the synced value, like `transaction.set`: a
  reload replaces the value underneath and the layers stay on top, and
  concurrent submissions stack in order. Success folds the layer into the
  synced value until the next reload; a typed failure, defect, interruption,
  or a rejected `ActionResult` rolls it back and rebases the other layers.
- An update shares the value's key positions and moves only the index buckets
  the row left or joined, so a patch does not rebuild the lookups.
- `durable: { maxAge }` keeps the layer applied while the submission waits in
  the Action Outbox and re-applies it on top of the hydrated or restored rows
  after a reload. See [Durable Submissions](architecture.md#durable-submissions).

Rows that never leave the client (a draft list, a selection) are not a
Resource: keep them in a Signal.

## Remote Change Feeds

`rows.changes(input)` streams batches of `Upsert` / `Update` / `Delete`
changes for one entry:

<!-- snippet: type-tests/docs/db/changes.ts#changes -->

```ts
const LiveProjectList = Resource.define({
  name: "Projects.live",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  rows: {
    key: (project) => project.id,
    // Starts with the entry's first load; each batch applies to the synced rows.
    changes: () =>
      Stream.callback<ReadonlyArray<Resource.RowChange<Project, string>>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => feed.onChange((changes) => Queue.offerUnsafe(queue, changes))),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
  },
  load: () => ProjectApi.use((api) => api.list()),
});
```

- The feed starts with the entry's first load in a runtime (or its first read
  after hydration) and runs on the runtime's Resource Store; disposing the
  runtime or evicting the entry stops it.
- Each batch applies to the synced rows and commits as a Timeline `change`
  under the Resource's name; optimistic layers stay on top. The services the
  stream needs join the family's `R`.
- A failed feed stops and publishes `ResourceRowsChangesFailure`; the rows
  keep their last value, and the next reload still works.

## Live Queries

`Query` (from `@sunfall/arc-db`) composes the rows of one or more Resources:
filters, joins, ordering, windows, and grouped aggregates, evaluated
incrementally by `@tanstack/db-ivm`. Sources are refs of Resources with
`rows`.

<!-- snippet: type-tests/docs/db/queries.ts#active-names -->

```ts
const ActiveProjectNames = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .where(({ project }) => project.status === "active")
    .orderBy(({ project }) => project.name)
    .select(({ project }) => project.name),
);
```

<!-- snippet: type-tests/docs/db/queries.ts#join -->

```ts
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .join(
      "task",
      TasksRef,
      ({ project }) => project.id,
      (task) => task.projectId,
    )
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
```

An indexed join reads only the bucket of the joined Resource's index:

<!-- snippet: type-tests/docs/db/queries.ts#indexed-join -->

```ts
const IndexedProjectTasks = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    // "byProject" is checked against TaskList's `rows.indexes`.
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
```

<!-- snippet: type-tests/docs/db/queries.ts#diagnostics -->

```ts
const plan = Query.diagnostics((query) =>
  query
    .from({ project: ProjectsRef })
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);

plan.joins[0];
// {
//   alias: "task",
//   resource: "Tasks.list",
//   strategy: "index",
//   index: "byProject",
//   leftRows: 4,
//   rightRows: 24,
//   outputRows: 18,
//   estimatedComparisons: 4
// }
```

<!-- snippet: type-tests/docs/db/queries.ts#group-by -->

```ts
const ProjectStatusCounts = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .groupBy(({ project }) => ({ status: project.status }), {
      count: Query.count(),
      avgProgress: Query.avg(({ project }) => project.progress),
    })
    .orderBy((group) => group.status),
);
```

<!-- snippet: type-tests/docs/db/queries.ts#once -->

```ts
// Preloads the sources, then evaluates once. E is the sources' load errors.
const archivedCount = Query.once((query) =>
  query
    .from({ project: ProjectsRef })
    .where(({ project }) => project.status === "archived")
    .select(({ project }) => project.id),
);
```

- `Query.live(factory)` returns `rows` (always the last good rows) and
  `state`, an `AsyncResult` that folds the sources' load results and
  evaluation failures: `Initial` until every source has loaded, `Success`
  with the rows, `Failure` with the source or evaluation `Cause` (last good
  rows as `previousSuccess`), and `waiting` while any source loads.
- A query's `E` and `R` are its sources' declared load errors and services. A
  query callback that throws or returns a Promise or Effect fails as
  `QueryEvaluationError`; Components treat it as a defect.
- A query reads the sources' visible rows, so optimistic row patches show in
  live queries at once and roll back with their submission.

In a Component, `Component.liveQuery(factory)` binds a live query to the
instance. The factory runs tracked, so a signal or prop it reads rebuilds the
query, and the sources preload on mount (in the browser only; a hydrating
client waits for hydration to settle):

<!-- snippet: type-tests/docs/db/component.tsx#live-query -->

```tsx
const ProjectTaskTitles = Component.define(
  "ProjectTaskTitles",
  function* (props: { readonly projectId: ProjectId }) {
    // The factory runs tracked: reading `props.projectId` rebuilds the query.
    const titles = yield* Component.liveQuery((query) =>
      query
        .from({ project: ProjectsRef })
        .where(({ project }) => project.id === props.projectId)
        .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
        .orderBy(({ task }) => task.title)
        .select(({ task }) => task.title),
    );

    return () => (
      <ul class={{ refreshing: titles.waiting() }}>
        <For each={titles.rows()}>{(title) => <li>{title}</li>}</For>
      </ul>
    );
  },
).pipe(Component.catchTags({ ProjectsUnavailable: () => <p>Tasks are unavailable.</p> }));
```

## Persistence

`policy.persist` stores a family's settled values in the runtime's
`KeyValueStore` (`effect/persistence`), encoded through `output`, so a reload
shows the last value before the network answers:

<!-- snippet: type-tests/docs/db/persistence.ts#persist -->

```ts
const OfflineProjectList = Resource.define({
  name: "Projects.offline",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  rows: { key: (project) => project.id },
  // Bump `version` when `output` changes shape: older values are never read.
  policy: { persist: { key: "projects", version: 1 } },
  load: () => ProjectApi.use((api) => api.list()),
});
```

- Values live under `arc/resources/v<version>/<key>/<ref key>`. Bump `version`
  when `output` changes shape; a value that no longer decodes is logged and
  ignored.
- A never-loaded entry shows its persisted value at once and reloads in the
  background. Loads, hydration, and change-feed batches persist; optimistic
  patches never do (durable Actions re-apply theirs from the Action Outbox).
- It works for any Resource, rows or not. `policy.persist` adds
  `KeyValueStore.KeyValueStore` to the family's services, so a runtime that
  lacks one fails to compile, like any missing service. Storage failures are
  logged, never load failures.
- Start provides the store on both sides. `App.launch` uses the client
  Layer's `KeyValueStore`, else `localStorage`, and the Action Outbox shares
  it. A request runtime gets a store that keeps nothing, so SSR never
  persists one request's values for another (a `KeyValueStore` in the server
  Layer replaces it).

To pick the browser store yourself (it is the one the Action Outbox uses),
provide it in the client Layer:

<!-- snippet: type-tests/docs/db/persistence.ts#client-layer -->

```ts
const ClientLive = Layer.mergeAll(
  ProjectApiLive,
  KeyValueStore.layerStorage(() => localStorage),
);
```

<!-- snippet: type-tests/docs/db/persistence.ts#sql -->

```ts
const PersistenceLive = KeyValueStore.layerSql({ table: "arc_kv" }).pipe(
  Layer.provide(SqliteClient.layer({ filename: "app.db" })),
);
```

## Server Rendering

Rows hydrate as their Resource does. Preload it in the route, and SSR,
hydration, and navigation render the rows without a fallback:

<!-- snippet: type-tests/docs/db/start.tsx#route-preload -->

```ts
// Rows hydrate as their Resource does: preload it, and SSR, hydration, and
// navigation render the rows without a fallback.
const ProjectRoute = Route.define("/projects/:id", {
  preloadResources: [ProjectList, TaskList],
  preload: () => Resource.preload([ProjectsRef, TasksRef]),
});
```

## Next Slices

- An OPFS/IndexedDB `KeyValueStore` layer for large browser values.
- Change-feed recipes for Electric and PowerSync once real host integrations
  need them.
