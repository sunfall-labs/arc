import { Effect, PubSub, Scope } from "effect";
import type { AnySunfallArcRuntime, EffectInput, EffectInputCallbackError } from "@sunfall/arc-core";
import {
  Collection,
  Query,
  SQLitePersistence,
  SQLITE_PERSISTENCE_DEFAULT_NAMESPACE,
  SQLITE_PERSISTENCE_DEFAULT_SCHEMA_VERSION,
  SQLITE_PERSISTENCE_DEFAULT_TABLE,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidStatementParams,
  SQLitePersistenceInvalidTableName,
  SQLitePersistenceUnsupportedStatement,
  ServerCollectionMissingIdentity,
  CollectionPreloadCollector,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  CollectionSnapshotCodecError,
  CollectionStoreTypeId,
  CollectionTypeId,
  ReadonlyCollectionMutation,
  UnknownCollectionIndex,
  backgroundSyncCollectionsPendingMutationsEffect,
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  defaultCollectionDefinitionRegistry,
  and,
  eq,
  flushCollectionsPendingMutationsEffect,
  gt,
  gte,
  includes,
  isCollection,
  lt,
  lte,
  liveQueryStateError,
  makeCollectionDefinitionRegistry,
  makeLiveQueryCollection,
  makeCollectionReactivePreloadController,
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePreparedStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  sameCollectionReactiveDeps,
  sameCollectionReactiveSources,
  selectCollectionReactiveLiveQuery,
  serverCollectionOptions,
  serverCollectionSyncAdapter,
  snapshotCollectionReactiveDeps,
  subscribeCollectionReactiveSource,
  neq,
  not,
  or,
  persistedCollectionOptions,
  UnsupportedLiveQuery,
  type AnyCollection,
  type CollectionBackgroundSyncResult,
  type CollectionError,
  type CollectionLiveQueryOptions,
  type CollectionRequirements,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type CollectionReactivePreloadController,
  type CollectionReactivePreloadControllerOptions,
  type FlushCollectionPendingMutationsResult,
  type LiveQuery,
  type LiveQueryState,
  type QueryAggregate,
  type QueryAggregateRecord,
  type QueryAggregateResult,
  type QueryGroupKey,
  type QueryFactory,
  type QueryJoinKey,
  type QueryJoinStrategy,
  type QueryPlanDiagnostics,
  type QueryPlanJoinDiagnostics,
  type QueryPlanSourceDiagnostics,
  type QueryRoot,
  type QuerySortDirection,
  type QuerySortValue,
  type ServerCollectionDeletePayload,
  type ServerCollectionInsertPayload,
  type ServerCollectionOperation,
  type ServerCollectionOptions,
  type ServerCollectionResult,
  type ServerCollectionUpdatePayload,
  type CollectionStorageError,
  type QueryEvaluationError,
  type SQLitePreparedStatementDatabase,
  type SQLitePersistenceRow,
  type SQLiteStatementDatabase,
} from "@sunfall/arc-db";
// @ts-expect-error QueryBuilder construction is internal; use Query.from(...) and Query.Builder.
import { QueryBuilder } from "@sunfall/arc-db";
void QueryBuilder;

interface Project {
  readonly id: string;
  readonly name: string;
}

interface DbRuntimeService {
  readonly _tag: "DbRuntimeService";
}

interface DbSkipService {
  readonly _tag: "DbSkipService";
}

interface DbAdapterService {
  readonly _tag: "DbAdapterService";
}

declare const sqliteStatementDatabase: SQLiteStatementDatabase<SQLitePersistenceInvalidRow>;
declare const sqlitePreparedStatementDatabase: SQLitePreparedStatementDatabase;
declare const dbProjectsCollection: Collection.Definition<
  Project,
  string,
  "load",
  DbRuntimeService
>;
declare const dbLiveQueryCollectionOptions: CollectionLiveQueryOptions<
  Project,
  string,
  never,
  never
>;
const dbNamespaceLiveQueryOptions: Collection.LiveQueryOptions<Project, string, never, never> =
  dbLiveQueryCollectionOptions;
const dbRootLiveQueryOptions: CollectionLiveQueryOptions<Project, string, never, never> =
  dbNamespaceLiveQueryOptions;
void dbRootLiveQueryOptions;
const dbStaticProjectsCollection = Collection.define<Project>({
  name: "type-tests/static-projects",
  getKey: (project) => project.id,
  initialData: [],
});
declare const erasedCollection: AnyCollection;
declare const erasedCollectionError: CollectionError<typeof erasedCollection>;
declare const erasedCollectionRequirements: CollectionRequirements<typeof erasedCollection>;
declare const servicefulErasedCollection: AnyCollection<"persist", DbAdapterService>;
declare const servicefulErasedPersistence: NonNullable<
  typeof servicefulErasedCollection.options.persistence
>;
declare const bareErasedPersistence: NonNullable<typeof erasedCollection.options.persistence>;
declare const dbAdapterCleanupEffect: Effect.Effect<void, "unsubscribe", DbAdapterService>;
const sqliteStorage = makeSQLitePersistenceStorage(
  makeSQLiteStatementPersistenceDriver(sqliteStatementDatabase),
);
const sqlitePreparedAdapter = makeSQLitePreparedStatementDatabase(sqlitePreparedStatementDatabase);
const sqliteMemoryStatementDatabase = makeSQLiteMemoryStatementDatabase();
const sqliteNamespaceMemoryDatabase: SQLitePersistence.MemoryStatementDatabase =
  sqliteMemoryStatementDatabase;
const sqliteNamespaceStorage = SQLitePersistence.storage(
  SQLitePersistence.statementDriver(sqliteNamespaceMemoryDatabase),
);
const persistedProjectOptions = persistedCollectionOptions<
  Project,
  string,
  never,
  never,
  EffectInputCallbackError | SQLitePersistenceInvalidRow | SQLitePersistenceInvalidTableName
>({
  name: "type-tests/persisted-projects",
  getKey: (project) => project.id,
  initialData: [],
  persistence: {
    storage: sqliteNamespaceStorage,
  },
});
const backgroundSyncEffect: Effect.Effect<CollectionBackgroundSyncResult, unknown> =
  backgroundSyncCollectionsPendingMutationsEffect([dbStaticProjectsCollection]);
const collectionMemoryStorage = Collection.memoryStorage();
const collectionStorage = Collection.storage({
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});
const collectionPersistedProjectOptions = Collection.persistedOptions<
  Project,
  string,
  never,
  never,
  EffectInputCallbackError | SQLitePersistenceInvalidRow | SQLitePersistenceInvalidTableName
>({
  name: "type-tests/collection-persisted-projects",
  getKey: (project) => project.id,
  initialData: [],
  persistence: {
    storage: sqliteNamespaceStorage,
  },
});
const collectionFlushEffect: Effect.Effect<
  ReadonlyArray<Collection.FlushAllPendingMutationsResult>,
  unknown
> = Collection.flushAllPendingMutationsEffect([dbStaticProjectsCollection]);
const collectionBackgroundSyncEffect: Effect.Effect<Collection.BackgroundSyncResult, unknown> =
  Collection.backgroundSyncPendingMutationsEffect([dbStaticProjectsCollection]);
const collectionSqliteMemoryDatabase = Collection.sqliteMemoryStatementDatabase();
const collectionSqliteStorage = Collection.sqliteStorage(
  Collection.sqliteStatementDriver(collectionSqliteMemoryDatabase),
);
const sqliteDefaultTable: "effect_ui_collection_persistence" = SQLITE_PERSISTENCE_DEFAULT_TABLE;
const sqliteDefaultNamespace: "sunfall-arc:collections" = SQLITE_PERSISTENCE_DEFAULT_NAMESPACE;
const sqliteDefaultSchemaVersion: 1 = SQLITE_PERSISTENCE_DEFAULT_SCHEMA_VERSION;
const sqliteRow: SQLitePersistenceRow = {
  namespace: "workspace",
  key: "projects",
  schemaVersion: 1,
  value: "{}",
  updatedAt: 1,
};
void sqliteDefaultTable;
void sqliteDefaultNamespace;
void sqliteDefaultSchemaVersion;
const collectionAlias: typeof Collection.define = createCollection;
const liveQueryAlias: typeof Query.live = createLiveQuery;
const liveQueryCollectionAlias: typeof Collection.liveQuery = createLiveQueryCollection;
const publicQueryRoot: Query.Root = Query;
const directQueryRoot: QueryRoot = publicQueryRoot;
const publicQueryFactory: Query.Factory<Project, any, any> = (query) =>
  query.from({ project: dbStaticProjectsCollection }).select(({ project }) => project);
const directQueryFactory: QueryFactory<Project, any, any> = publicQueryFactory;
const publicQueryBuilder: Query.Builder<any, Project, any, any> = Query.from({
  project: dbStaticProjectsCollection,
}).select(({ project }) => project);
const publicQueryRows: ReadonlyArray<Project> = publicQueryBuilder.execute();
// @ts-expect-error public Query.Builder does not expose execution-plan internals.
publicQueryBuilder.sources;
declare const neverQueryBuilder: Query.Builder<any, never, any, any>;
// @ts-expect-error public Query.Builder is branded; use Query.from(...) instead of structural fakes.
const structuralQueryBuilder: Query.Builder<any, Project, any, any> = {
  where: () => neverQueryBuilder,
  select: () => neverQueryBuilder,
  join: () => neverQueryBuilder,
  joinIndexed: () => neverQueryBuilder,
  innerJoin: () => neverQueryBuilder,
  innerJoinIndexed: () => neverQueryBuilder,
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
const directLiveQuery: LiveQuery<Project, any, any> = publicQueryLive;
const publicQueryLiveState: Query.LiveState<Project, any> = publicLiveQuery.state.get();
const directLiveQueryState: LiveQueryState<Project, any> = publicQueryLiveState;
declare const publicQueryEvaluationError: Query.EvaluationError;
const directQueryEvaluationError: QueryEvaluationError = publicQueryEvaluationError;
const publicQueryEvaluationErrorInstance = new Query.EvaluationError({
  operation: "evaluate",
  message: "invalid query",
  cause: "invalid query",
});
const directQueryEvaluationErrorInstance: QueryEvaluationError = publicQueryEvaluationErrorInstance;
const publicUnsupportedLiveQuery = new Query.UnsupportedLiveQuery({
  reason: "Live queries with joins require at least one non-join source collection.",
});
const directUnsupportedLiveQuery: UnsupportedLiveQuery = publicUnsupportedLiveQuery;
const publicQueryPlanDiagnostics: Query.PlanDiagnostics = Query.diagnostics(publicQueryFactory);
const directQueryPlanDiagnostics: QueryPlanDiagnostics = publicQueryPlanDiagnostics;
const publicQueryPlanSource: Query.PlanSourceDiagnostics = publicQueryPlanDiagnostics.sources[0]!;
const directQueryPlanSource: QueryPlanSourceDiagnostics = publicQueryPlanSource;
declare const publicQueryPlanJoin: Query.PlanJoinDiagnostics;
const directQueryPlanJoin: QueryPlanJoinDiagnostics = publicQueryPlanJoin;
const publicQueryJoinStrategy: Query.JoinStrategy = publicQueryPlanJoin.strategy;
const directQueryJoinStrategy: QueryJoinStrategy = publicQueryJoinStrategy;
const publicQueryJoinKey: Query.JoinKey = "project-id";
const publicQuerySortDirection: Query.SortDirection = "asc";
const publicQuerySortValue: Query.SortValue = new Date(0);
const publicQueryGroupKey: Query.GroupKey<{ readonly status: string }> = { status: "active" };
const directQueryGroupKey: QueryGroupKey<{ readonly status: string }> = publicQueryGroupKey;
const directQueryJoinKey: QueryJoinKey = publicQueryJoinKey;
const directQuerySortDirection: QuerySortDirection = publicQuerySortDirection;
const directQuerySortValue: QuerySortValue = publicQuerySortValue;
const publicQueryAggregate: Query.Aggregate<{ readonly project: Project }, number, number> =
  Query.sum(({ project }) => project.id.length);
const directQueryAggregate: QueryAggregate<{ readonly project: Project }, number, number> =
  publicQueryAggregate;
const publicQueryAggregates = {
  count: Query.count(({ project }: { readonly project: Project }) => project.id),
} satisfies Query.Aggregates<{ readonly project: Project }>;
const directQueryAggregateRecord: QueryAggregateRecord<{ readonly project: Project }> =
  publicQueryAggregates;
declare const publicQueryAggregateResult: Query.AggregateResult<
  typeof publicQueryGroupKey,
  typeof publicQueryAggregates
>;
const directQueryAggregateResult: QueryAggregateResult<
  typeof directQueryGroupKey,
  typeof directQueryAggregateRecord
> = publicQueryAggregateResult;
const publicQueryAggregateCount: number = publicQueryAggregateResult.count;
void directQueryRoot;
void directQueryFactory;
void directLiveQuery;
void directLiveQueryState;
void directQueryEvaluationError;
void directQueryEvaluationErrorInstance;
void directUnsupportedLiveQuery;
void directQueryPlanDiagnostics;
void directQueryPlanSource;
void directQueryPlanJoin;
void directQueryJoinStrategy;
void publicQueryJoinKey;
void publicQuerySortDirection;
void publicQuerySortValue;
void directQueryGroupKey;
void directQueryJoinKey;
void directQuerySortDirection;
void directQuerySortValue;
void directQueryAggregate;
void directQueryAggregateRecord;
void directQueryAggregateResult;
publicQueryRoot.from({ project: dbStaticProjectsCollection });
const collectionReactivePreloadController = makeCollectionReactivePreloadController({
  runtime: null as unknown as AnySunfallArcRuntime<never>,
  onSuccess: () => Effect.void,
  onFailure: () => Effect.void,
});
const collectionReactivePreloadInterruptEffect: Effect.Effect<void> =
  collectionReactivePreloadController.interruptEffect();
// @ts-expect-error public LiveQuery handles do not expose their internal builder.
publicLiveQuery.builder;
const directLiveQueryCollection = makeLiveQueryCollection<Project, string, unknown>(
  {
    name: "type-tests/direct-live-query-projects",
    getKey: (project) => project.id,
    query: (query) =>
      query.from({ project: dbStaticProjectsCollection }).select(({ project }) => project),
  },
  makeCollectionDefinitionRegistry(),
);
const isolatedCollectionRegistry = makeCollectionDefinitionRegistry();
const defaultCollectionRegistry = defaultCollectionDefinitionRegistry;
const collectionTypeId: typeof CollectionTypeId = CollectionTypeId;
const collectionStoreTypeId: typeof CollectionStoreTypeId = CollectionStoreTypeId;
const directCollectionCheck: boolean = isCollection(dbProjectsCollection);
const queryPredicatePins: ReadonlyArray<boolean> = [
  eq("atlas", "atlas"),
  neq("atlas", "zephyr"),
  gt(2, 1),
  gte(2, 2),
  lt(1, 2),
  lte(2, 2),
  includes(["atlas"], "atlas"),
  and(true, true),
  or(false, true),
  not(false),
];
const publicQueryPredicatePins: ReadonlyArray<boolean> = [
  Query.eq("atlas", "atlas"),
  Query.neq("atlas", "zephyr"),
  Query.gt(2, 1),
  Query.gte(2, 2),
  Query.lt(1, 2),
  Query.lte(2, 2),
  Query.includes(["atlas"], "atlas"),
  Query.and(true, true),
  Query.or(false, true),
  Query.not(false),
];
const unknownCollectionIndex = new UnknownCollectionIndex({
  collection: "projects",
  index: "byStatus",
});
const unsupportedLiveQuery = new UnsupportedLiveQuery({
  reason: "Live queries with joins require at least one non-join source collection.",
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
const collectionUnknownIndexFromNamespace = new Collection.UnknownIndex({
  collection: "projects",
  index: "byStatus",
});
const directUnknownCollectionIndex: UnknownCollectionIndex = collectionUnknownIndexFromNamespace;
const collectionRowKeyChangedFromNamespace = new Collection.RowKeyChanged({
  collection: "projects",
  key: "atlas",
  nextKey: "zephyr",
  guidance: "keep keys stable",
});
const directCollectionRowKeyChanged: CollectionRowKeyChanged = collectionRowKeyChangedFromNamespace;
const collectionRowNotFoundFromNamespace = new Collection.RowNotFound({
  collection: "projects",
  key: "missing",
});
const directCollectionRowNotFound: CollectionRowNotFound = collectionRowNotFoundFromNamespace;
const readonlyCollectionMutationFromNamespace = new Collection.ReadonlyMutation({
  collection: "derived-projects",
  operation: "insert",
});
const directReadonlyCollectionMutation: ReadonlyCollectionMutation =
  readonlyCollectionMutationFromNamespace;
const collectionSnapshotCodecErrorFromNamespace = new Collection.SnapshotCodecError({
  operation: "decode",
  path: "$.collections",
  reason: "invalid",
});
const directCollectionSnapshotCodecError: CollectionSnapshotCodecError =
  collectionSnapshotCodecErrorFromNamespace;
declare const publicCollectionStorageError: Collection.StorageError;
const directCollectionStorageError: CollectionStorageError = publicCollectionStorageError;
const serverOptions = serverCollectionOptions<Project>({
  name: "projects",
  getKey: (project) => project.id,
});
const serverSync = serverCollectionSyncAdapter<Project>({
  name: "projects",
  getKey: (project) => project.id,
});
const collectionCurrentStore: Collection.Store = Collection.currentStore();
const collectionStoreEffect: Effect.Effect<Collection.Store> = Collection.storeEffect();
const collectionStoreDiagnosticsSnapshot: Collection.StoreDiagnosticsSnapshot =
  collectionCurrentStore.diagnostics.snapshot();
const collectionEventsEffect: Effect.Effect<
  PubSub.Subscription<Collection.StoreEvent>,
  never,
  Scope.Scope
> = Collection.subscribeEventsEffect();
const collectionHydrationValidationEffect: Effect.Effect<
  void,
  Collection.SnapshotCodecError | EffectInputCallbackError
> = Collection.validateHydrationPayloadEffect(
  [dbStaticProjectsCollection],
  Collection.dehydrate([dbStaticProjectsCollection]),
);
// @ts-expect-error public Collection.Store is diagnostics/events-only; runtime disposal is internal.
collectionCurrentStore.disposeEffect;

const dbExports: Array<unknown> = [
  Collection,
  Query,
  SQLitePersistence,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidStatementParams,
  SQLitePersistenceInvalidTableName,
  SQLitePersistenceUnsupportedStatement,
  ServerCollectionMissingIdentity,
  CollectionPreloadCollector,
  CollectionTypeId,
  CollectionStoreTypeId,
  UnknownCollectionIndex,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  ReadonlyCollectionMutation,
  CollectionSnapshotCodecError,
  backgroundSyncCollectionsPendingMutationsEffect,
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  defaultCollectionDefinitionRegistry,
  eq,
  flushCollectionsPendingMutationsEffect,
  persistedCollectionOptions,
  isCollection,
  liveQueryStateError,
  makeCollectionDefinitionRegistry,
  makeLiveQueryCollection,
  makeCollectionReactivePreloadController,
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePreparedStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  sameCollectionReactiveDeps,
  sameCollectionReactiveSources,
  selectCollectionReactiveLiveQuery,
  serverCollectionOptions,
  serverCollectionSyncAdapter,
  snapshotCollectionReactiveDeps,
  subscribeCollectionReactiveSource,
  sqliteStorage,
  sqlitePreparedAdapter,
  sqliteNamespaceStorage,
  persistedProjectOptions,
  backgroundSyncEffect,
  collectionMemoryStorage,
  collectionStorage,
  collectionPersistedProjectOptions,
  collectionFlushEffect,
  collectionBackgroundSyncEffect,
  collectionSqliteMemoryDatabase,
  collectionStoreDiagnosticsSnapshot,
  collectionHydrationValidationEffect,
  collectionSqliteStorage,
  sqliteRow,
  collectionAlias,
  liveQueryAlias,
  liveQueryCollectionAlias,
  publicQueryBuilder,
  publicQueryRows,
  publicLiveQuery,
  directLiveQueryCollection,
  isolatedCollectionRegistry,
  defaultCollectionRegistry,
  collectionTypeId,
  collectionStoreTypeId,
  directCollectionCheck,
  queryPredicatePins,
  publicQueryPredicatePins,
  publicQueryEvaluationErrorInstance,
  publicUnsupportedLiveQuery,
  unknownCollectionIndex,
  unsupportedLiveQuery,
  collectionRowKeyChanged,
  collectionRowNotFound,
  readonlyCollectionMutation,
  collectionSnapshotCodecError,
  collectionUnknownIndexFromNamespace,
  directUnknownCollectionIndex,
  collectionRowKeyChangedFromNamespace,
  directCollectionRowKeyChanged,
  collectionRowNotFoundFromNamespace,
  directCollectionRowNotFound,
  readonlyCollectionMutationFromNamespace,
  directReadonlyCollectionMutation,
  collectionSnapshotCodecErrorFromNamespace,
  directCollectionSnapshotCodecError,
  publicCollectionStorageError,
  directCollectionStorageError,
  serverOptions,
  serverSync,
  collectionCurrentStore,
  collectionStoreEffect,
  collectionEventsEffect,
];
type DbErrors =
  | CollectionStorageError
  | QueryEvaluationError
  | SQLitePersistenceInvalidRow
  | SQLitePersistenceInvalidStatementParams
  | SQLitePersistenceInvalidTableName;
type DbReactivePins =
  | CollectionReactiveLiveQueryInput<Project, never, never>
  | CollectionReactiveLiveQuerySelection<Project, never, never, unknown>
  | CollectionReactivePreloadController<never>
  | CollectionReactivePreloadControllerOptions<never>;
type DbErasedCollectionPins =
  | AnyCollection
  | CollectionError<typeof dbProjectsCollection>
  | CollectionRequirements<typeof dbProjectsCollection>
  | QueryGroupKey<{ readonly status: string; readonly meta: { readonly active: boolean } }>
  | Query.GroupKey<{ readonly status: string; readonly tags: ReadonlySet<string> }>
  | Collection.QuerySyncKey
  | Collection.QuerySyncKeyPart;
const collectionQuerySyncKeyPart: Collection.QuerySyncKeyPart = {
  cursor: "after",
  page: 2,
  staleAt: new Date(0),
  flags: [true, null],
};
const collectionQuerySyncKey: Collection.QuerySyncKey = ["projects", collectionQuerySyncKeyPart];
type DbServerPins =
  | ServerCollectionOptions<Project>
  | ServerCollectionOperation<void, ReadonlyArray<Project>>
  | ServerCollectionResult<ReadonlyArray<Project>>
  | ServerCollectionInsertPayload<Project, string>
  | ServerCollectionUpdatePayload<Project, string>
  | ServerCollectionDeletePayload<Project, string>;
type DbFlushPins =
  | FlushCollectionPendingMutationsResult
  | CollectionBackgroundSyncResult
  | Collection.FlushAllPendingMutationsError<readonly [typeof dbProjectsCollection], "skip-error">
  | Collection.FlushAllPendingMutationsRequirements<
      readonly [typeof dbProjectsCollection],
      DbSkipService
    >
  | Collection.BackgroundSyncError<
      readonly [typeof dbProjectsCollection],
      "adapter-error",
      "skip-error"
    >
  | Collection.BackgroundSyncRequirements<
      readonly [typeof dbProjectsCollection],
      DbAdapterService,
      DbSkipService
    >;
declare const collectionFlushError: Collection.FlushAllPendingMutationsError<
  readonly [typeof dbProjectsCollection],
  "skip-error"
>;
declare const collectionFlushRequirements: Collection.FlushAllPendingMutationsRequirements<
  readonly [typeof dbProjectsCollection],
  DbSkipService
>;
declare const collectionBackgroundSyncError: Collection.BackgroundSyncError<
  readonly [typeof dbProjectsCollection],
  "adapter-error",
  "skip-error"
>;
declare const collectionBackgroundSyncRequirements: Collection.BackgroundSyncRequirements<
  readonly [typeof dbProjectsCollection],
  DbAdapterService,
  DbSkipService
>;
const collectionFlushErrorPin:
  | Collection.RuntimeError<"load">
  | "skip-error"
  | EffectInputCallbackError = collectionFlushError;
const collectionFlushRequirementsPin: DbRuntimeService | DbSkipService =
  collectionFlushRequirements;
const collectionBackgroundSyncErrorPin:
  | Collection.RuntimeError<"load">
  | "adapter-error"
  | "skip-error"
  | EffectInputCallbackError = collectionBackgroundSyncError;
const collectionBackgroundSyncRequirementsPin: DbRuntimeService | DbAdapterService | DbSkipService =
  collectionBackgroundSyncRequirements;
const concreteCollectionErrorPin: "load" = null as never as CollectionError<
  typeof dbProjectsCollection
>;
const concreteCollectionRequirementsPin: DbRuntimeService = null as never as CollectionRequirements<
  typeof dbProjectsCollection
>;
const servicefulErasedPersistencePin: Collection.PersistenceConfig<"persist", DbAdapterService> =
  servicefulErasedPersistence;
const servicefulErasedPersistenceRead: EffectInput<string | null, "persist", DbAdapterService> =
  servicefulErasedPersistence.storage.getItem("projects");
const bareErasedPersistencePin: Collection.PersistenceConfig<unknown, unknown> =
  bareErasedPersistence;
// @ts-expect-error erased collection errors default to unknown, not an arbitrary string.
const erasedCollectionErrorString: string = erasedCollectionError;
// @ts-expect-error erased collection requirements default to unknown, not an arbitrary service.
const erasedCollectionRequirementsService: DbRuntimeService = erasedCollectionRequirements;
const changeFeedUnsubscribeWithServices: Collection.ChangeFeedUnsubscribe<
  "unsubscribe",
  DbAdapterService
> = () => dbAdapterCleanupEffect;
const servicefulChangeFeedAdapter: Collection.ChangeFeedAdapter<
  Project,
  string,
  "feed" | "unsubscribe",
  DbAdapterService,
  "load",
  DbRuntimeService
> = {
  name: "projects-serviceful-feed",
  subscribe: () => ({
    unsubscribe: changeFeedUnsubscribeWithServices,
  }),
};
// Adapter lifecycle channels stay visible for subscription setup; unsubscribe
// failures use the same adapter channel for failure publication but are
// swallowed during scope release after `CollectionChangeFeedFailure` is
// published.
const servicefulChangeFeedEffect: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | "feed" | "unsubscribe",
  DbRuntimeService | DbAdapterService | Scope.Scope
> = Collection.subscribeChangesEffect(dbProjectsCollection, servicefulChangeFeedAdapter);
void dbExports;
void collectionFlushErrorPin;
void collectionFlushRequirementsPin;
void collectionBackgroundSyncErrorPin;
void collectionBackgroundSyncRequirementsPin;
void concreteCollectionErrorPin;
void concreteCollectionRequirementsPin;
void collectionQuerySyncKeyPart;
void collectionQuerySyncKey;
void servicefulErasedPersistencePin;
void servicefulErasedPersistenceRead;
void bareErasedPersistencePin;
void servicefulChangeFeedEffect;
type _DbErrors = DbErrors;
type _DbReactivePins = DbReactivePins;
type _DbErasedCollectionPins = DbErasedCollectionPins;
type _DbServerPins = DbServerPins;
type _DbFlushPins = DbFlushPins;
