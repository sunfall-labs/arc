import { Effect, Schema, Stream } from "effect";
import type { KeyValueStore } from "effect/persistence";
import type { AsyncResult } from "effect/reactivity";
import { Resource, Server, type EffectInputCallbackError } from "@sunfall/arc-core";
import {
  Collection,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  CollectionSnapshotCodecError,
  Query,
  QueryEvaluationError,
  ReadonlyCollectionMutation,
  UnknownCollectionIndex,
  UnsupportedLiveQuery,
} from "@sunfall/arc-db";
// @ts-expect-error QueryBuilder construction is internal; use query.from(...) and Query.Builder.
import { QueryBuilder } from "@sunfall/arc-db";
void QueryBuilder;

interface Project {
  readonly id: string;
  readonly name: string;
}

const ProjectSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

interface DbRuntimeService {
  readonly _tag: "DbRuntimeService";
}

interface DbSkipService {
  readonly _tag: "DbSkipService";
}

interface DbAdapterService {
  readonly _tag: "DbAdapterService";
}

declare const dbProjectsCollection: Collection.Definition<
  Project,
  string,
  "load",
  DbRuntimeService
>;
const dbStaticProjectsCollection = Collection.define<Project>({
  name: "type-tests/static-projects",
  getKey: (project) => project.id,
  initialData: [],
});

// --- Collection.define infers row, key, error, and requirement channels ---

const InferredProjects = Collection.define({
  name: "type-tests/inferred-projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  indexes: { byName: (project) => project.name },
});
const inferredProjects: Collection.Definition<Project, string> = InferredProjects;

declare const loadProjects: Effect.Effect<ReadonlyArray<Project>, "load", DbRuntimeService>;
const AdapterProjects = Collection.define({
  name: "type-tests/adapter-projects",
  output: Schema.Array(ProjectSchema),
  getKey: (project) => project.id,
  sync: {
    load: () => loadProjects,
    changes: () => Stream.empty as Stream.Stream<ReadonlyArray<Collection.Change<Project, string>>>,
  },
});
const adapterProjects: Collection.Definition<Project, string, "load", DbRuntimeService> =
  AdapterProjects;

// Server functions are sync operations directly; their client errors join E.
const listProjects = Server.fn<void, ReadonlyArray<Project>>("type-tests/list-projects", {
  handler: () => Effect.succeed([]),
});
const ServerProjects = Collection.define({
  name: "type-tests/server-projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: { load: listProjects },
});
const writableSyncAdapter: Collection.SyncAdapter<Project, string> = {
  load: () => Effect.succeed([]),
  // @ts-expect-error writes are Actions: a sync adapter only reads.
  update: () => Effect.void,
};
const serverProjects: Collection.Definition<
  Project,
  string,
  EffectInputCallbackError | Server.ClientError
> = ServerProjects;

// A Resource ref backs a collection directly.
const ProjectRows = Resource.define<void, ReadonlyArray<Project>, "resource-load">({
  name: "type-tests/project-rows",
  load: () => Effect.fail("resource-load" as const),
});
const ResourceProjects = Collection.define({
  name: "type-tests/resource-projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: ProjectRows(undefined),
});
const resourceProjects: Collection.Definition<Project, string, "resource-load"> = ResourceProjects;

// Persistence adds the runtime KeyValueStore channels without a helper.
const PersistedProjects = Collection.define({
  name: "type-tests/persisted-projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  persistence: { key: "projects", version: 2 },
});
type PersistedProjectsError = Collection.Error<typeof PersistedProjects>;
const persistedProjectsError: KeyValueStore.KeyValueStoreError =
  null as never as PersistedProjectsError;
const persistedProjectsRequirements: KeyValueStore.KeyValueStore =
  null as never as Collection.Requirements<typeof PersistedProjects>;

declare const promiseRows: Promise<ReadonlyArray<Project>>;
Collection.define({
  name: "type-tests/promise-projects",
  output: ProjectSchema,
  getKey: (project: Project) => project.id,
  // @ts-expect-error sync operations return a value or Effect, not a Promise
  sync: { load: () => promiseRows },
});

// --- Definition methods are the single read/write path ---

const projectState: AsyncResult.AsyncResult<void, never> = dbStaticProjectsCollection
  .result()
  .get();
const projectRows: ReadonlyArray<Collection.Row<Project, string>> =
  dbStaticProjectsCollection.rows();
const applyChanges: Effect.Effect<
  void,
  "load" | CollectionRowNotFound | CollectionRowKeyChanged,
  DbRuntimeService
> = dbProjectsCollection.applyChanges(
  [
    { _tag: "Upsert", value: { id: "atlas", name: "Atlas" } },
    { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
    { _tag: "Delete", key: "atlas" },
  ],
  { origin: "remote", synced: true },
);
// @ts-expect-error fire-and-forget writes were removed; run applyChanges instead.
dbProjectsCollection.writeInsert;
// @ts-expect-error direct write Effects were folded into applyChanges.
dbProjectsCollection.writeInsertEffect;
// @ts-expect-error optimistic patches belong to Action submissions, not the collection.
dbProjectsCollection.pendingMutationsEffect;
// @ts-expect-error free functions that forwarded to definition methods were removed.
Collection.rows;
// @ts-expect-error remote changes stream through sync.changes instead.
Collection.subscribeChangesEffect;
// @ts-expect-error the sync adapter is passed to Collection.define directly.
Collection.syncOptions;
// @ts-expect-error persistence goes through the runtime KeyValueStore, not storage adapters.
Collection.memoryStorage;
// @ts-expect-error persistence goes through the runtime KeyValueStore, not storage adapters.
Collection.storage;

// --- Collection namespace types ---

declare const erasedCollection: Collection.Any;
declare const erasedCollectionError: Collection.Error<typeof erasedCollection>;
declare const erasedCollectionRequirements: Collection.Requirements<typeof erasedCollection>;
declare const servicefulErasedCollection: Collection.Any<"persist", DbAdapterService>;
declare const servicefulErasedPersistence: NonNullable<
  typeof servicefulErasedCollection.options.persistence
>;
declare const bareErasedPersistence: NonNullable<typeof erasedCollection.options.persistence>;
declare const liveQueryOptions: Collection.LiveQueryOptions<Project, string, never, never>;
const projectValue: Collection.Value<typeof dbProjectsCollection> = { id: "atlas", name: "Atlas" };
const projectRowValue: Collection.RowValue<typeof dbProjectsCollection> = projectRows[0]!;
const syncAdapter: Collection.SyncAdapter<Project, string, "load", DbRuntimeService> = {
  name: "projects-api",
  load: () => loadProjects,
};
const syncSource: Collection.Sync<Project, string, "load", DbRuntimeService> = syncAdapter;
const options: Collection.Options<Project, string, "load", DbRuntimeService> = {
  name: "type-tests/options",
  getKey: (project) => project.id,
  sync: syncSource,
};
const writeOptions: Collection.WriteOptions = { origin: "remote" };
const persistOptions: Collection.PersistOptions = { key: "projects", version: 1 };
const liveQueryCollection = Collection.liveQuery<Project, string, unknown>({
  name: "type-tests/live-query-projects",
  getKey: (project) => project.id,
  query: (query) =>
    query.from({ project: dbStaticProjectsCollection }).select(({ project }) => project),
});
const liveQueryCollectionWrite: Effect.Effect<void, unknown> = liveQueryCollection.applyChanges([]);

const concreteCollectionErrorPin: "load" = null as never as Collection.Error<
  typeof dbProjectsCollection
>;
const concreteCollectionRequirementsPin: DbRuntimeService =
  null as never as Collection.Requirements<typeof dbProjectsCollection>;
const servicefulErasedPersistencePin: Collection.PersistenceConfig = servicefulErasedPersistence;
const bareErasedPersistencePin: Collection.PersistenceConfig = bareErasedPersistence;
// @ts-expect-error erased collection errors default to unknown, not an arbitrary string.
const erasedCollectionErrorString: string = erasedCollectionError;
// @ts-expect-error erased collection requirements default to unknown, not an arbitrary service.
const erasedCollectionRequirementsService: DbRuntimeService = erasedCollectionRequirements;

// --- Query ---

declare const publicQueryRoot: Query.Root;
// @ts-expect-error Query.from was removed; start queries from the factory root with query.from(...).
Query.from;
const publicQueryFactory: Query.Factory<Project, any, any> = (query) =>
  query
    .from({ project: dbStaticProjectsCollection })
    .where(({ project }) => project.name !== "" && project.id.length > 0)
    .select(({ project }) => project);
const publicQueryBuilder: Query.Builder<any, Project, any, any> = publicQueryRoot
  .from({
    project: dbStaticProjectsCollection,
  })
  .select(({ project }) => project);
const publicQueryRows: ReadonlyArray<Project> = publicQueryBuilder.execute();
// @ts-expect-error public Query.Builder does not expose execution-plan internals.
publicQueryBuilder.sources;
// @ts-expect-error join aliases were removed; use join(...).
publicQueryBuilder.innerJoin;
// @ts-expect-error predicate helpers were removed; use plain operators in where(...).
Query.eq;
// @ts-expect-error Query.build is internal; use Query.once or Query.live.
Query.build;
declare const neverQueryBuilder: Query.Builder<any, never, any, any>;
// @ts-expect-error public Query.Builder is branded; use query.from(...) instead of structural fakes.
const structuralQueryBuilder: Query.Builder<any, Project, any, any> = {
  where: () => neverQueryBuilder,
  select: () => neverQueryBuilder,
  join: () => neverQueryBuilder,
  joinIndexed: () => neverQueryBuilder,
  groupBy: () => neverQueryBuilder,
  orderBy: () => neverQueryBuilder,
  offset: () => neverQueryBuilder,
  limit: () => neverQueryBuilder,
  execute: () => [],
};
const publicLiveQuery = Query.live((query) =>
  query.from({ project: dbStaticProjectsCollection }).select(({ project }) => project),
);
const publicQueryLive: Query.Live<Project, any, any> = publicLiveQuery;
const liveQueryState: AsyncResult.AsyncResult<
  ReadonlyArray<Project>,
  any
> = publicLiveQuery.state.get();
// @ts-expect-error public live query handles do not expose their internal builder.
publicLiveQuery.builder;
const onceRows: Effect.Effect<ReadonlyArray<Project>, unknown, unknown> = Query.once(
  publicQueryFactory,
);
const queryEvaluationError = new QueryEvaluationError({
  operation: "evaluate",
  message: "invalid query",
  cause: "invalid query",
});
const queryEvaluationOperation: Query.EvaluationOperation = queryEvaluationError.operation;
const unsupportedLiveQuery = new UnsupportedLiveQuery({
  reason: "Live queries with joins require at least one non-join source collection.",
});
const publicQueryPlanDiagnostics: Query.PlanDiagnostics = Query.diagnostics(publicQueryFactory);
const publicQueryPlanSource: Query.PlanSourceDiagnostics = publicQueryPlanDiagnostics.sources[0]!;
declare const publicQueryPlanJoin: Query.PlanJoinDiagnostics;
const publicQueryJoinStrategy: Query.JoinStrategy = publicQueryPlanJoin.strategy;
const publicQueryJoinKey: Query.JoinKey = "project-id";
const publicQuerySortDirection: Query.SortDirection = "asc";
const publicQuerySortValue: Query.SortValue = new Date(0);
const publicQueryGroupKey: Query.GroupKey<{ readonly status: string }> = { status: "active" };
const publicQueryAggregate: Query.Aggregate<{ readonly project: Project }, number, number> =
  Query.sum(({ project }) => project.id.length);
const publicQueryAggregates = {
  count: Query.count(({ project }: { readonly project: Project }) => project.id),
} satisfies Query.Aggregates<{ readonly project: Project }>;
declare const publicQueryAggregateResult: Query.AggregateResult<
  typeof publicQueryGroupKey,
  typeof publicQueryAggregates
>;
const publicQueryAggregateCount: number = publicQueryAggregateResult.count;
publicQueryRoot.from({ project: dbStaticProjectsCollection });

// --- Root error classes ---

const unknownCollectionIndex = new UnknownCollectionIndex({
  collection: "projects",
  index: "byStatus",
});
const collectionRowKeyChanged = new CollectionRowKeyChanged({
  collection: "projects",
  key: "atlas",
  nextKey: "zephyr",
  guidance: "keep keys stable",
});
const collectionRowNotFound = new CollectionRowNotFound({
  collection: "projects",
  key: "missing",
});
const readonlyCollectionMutation = new ReadonlyCollectionMutation({
  collection: "derived-projects",
  operation: "insert",
});
const collectionSnapshotCodecError = new CollectionSnapshotCodecError({
  operation: "decode",
  path: "$.collections",
  reason: "invalid",
});
// @ts-expect-error error classes have one name each, at the package root.
Collection.RowNotFound;
type DbErrors = QueryEvaluationError;

const dbExports: Array<unknown> = [
  inferredProjects,
  adapterProjects,
  serverProjects,
  writableSyncAdapter,
  resourceProjects,
  persistedProjectsError,
  persistedProjectsRequirements,
  projectState,
  applyChanges,
  liveQueryOptions,
  projectValue,
  projectRowValue,
  options,
  writeOptions,
  persistOptions,
  liveQueryCollectionWrite,
  concreteCollectionErrorPin,
  concreteCollectionRequirementsPin,
  servicefulErasedPersistencePin,
  bareErasedPersistencePin,
  publicQueryRows,
  publicQueryLive,
  liveQueryState,
  onceRows,
  queryEvaluationOperation,
  unsupportedLiveQuery,
  publicQueryPlanSource,
  publicQueryJoinStrategy,
  publicQueryJoinKey,
  publicQuerySortDirection,
  publicQuerySortValue,
  publicQueryAggregate,
  publicQueryAggregateCount,
  unknownCollectionIndex,
  collectionRowKeyChanged,
  collectionRowNotFound,
  readonlyCollectionMutation,
  collectionSnapshotCodecError,
];
void dbExports;
type _DbErrors = DbErrors;
