import {
  Effect,
  PubSub,
  Scope
} from "effect";
import type { EffectInput, EffectInputCallbackError } from "@effect-ui/core";
import {
  Collection,
  Query,
  SQLitePersistence,
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
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  defaultCollectionDefinitionRegistry,
  eq,
  flushCollectionsPendingMutationsEffect,
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
  type AnyCollection,
  type CollectionBackgroundSyncResult,
  type CollectionError,
  type CollectionRequirements,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type CollectionReactivePreloadController,
  type CollectionReactivePreloadControllerOptions,
  type FlushCollectionPendingMutationsResult,
  type QueryGroupKey,
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
  type SQLiteStatementDatabase
} from "@effect-ui/db";
// @ts-expect-error QueryBuilder construction is internal; use Query.from(...) and Query.Builder.
import { QueryBuilder } from "@effect-ui/db";
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
declare const dbProjectsCollection: Collection.Definition<Project, string, "load", DbRuntimeService>;
const dbStaticProjectsCollection = Collection.define<Project>({
  name: "type-tests/static-projects",
  getKey: (project) => project.id,
  initialData: []
});
declare const erasedCollection: AnyCollection;
declare const erasedCollectionError: CollectionError<typeof erasedCollection>;
declare const erasedCollectionRequirements: CollectionRequirements<typeof erasedCollection>;
declare const servicefulErasedCollection: AnyCollection<"persist", DbAdapterService>;
declare const servicefulErasedPersistence:
  NonNullable<typeof servicefulErasedCollection.options.persistence>;
declare const bareErasedPersistence:
  NonNullable<typeof erasedCollection.options.persistence>;
declare const dbAdapterCleanupEffect: Effect.Effect<void, "unsubscribe", DbAdapterService>;
const sqliteStorage = makeSQLitePersistenceStorage(
  makeSQLiteStatementPersistenceDriver(sqliteStatementDatabase)
);
const sqlitePreparedAdapter = makeSQLitePreparedStatementDatabase(sqlitePreparedStatementDatabase);
const sqliteMemoryStatementDatabase = makeSQLiteMemoryStatementDatabase();
const sqliteNamespaceMemoryDatabase: SQLitePersistence.MemoryStatementDatabase = sqliteMemoryStatementDatabase;
const sqliteNamespaceStorage = SQLitePersistence.storage(
  SQLitePersistence.statementDriver(sqliteNamespaceMemoryDatabase)
);
const sqliteRow: SQLitePersistenceRow = {
  namespace: "workspace",
  key: "projects",
  schemaVersion: 1,
  value: "{}",
  updatedAt: 1
};
const collectionAlias: typeof Collection.define = createCollection;
const liveQueryAlias: typeof Query.live = createLiveQuery;
const liveQueryCollectionAlias: typeof Collection.liveQuery = createLiveQueryCollection;
const directLiveQueryCollection = makeLiveQueryCollection<Project, string, unknown>({
  name: "type-tests/direct-live-query-projects",
  getKey: (project) => project.id,
  query: (query) => query.from({ project: dbStaticProjectsCollection }).select(({ project }) => project)
}, makeCollectionDefinitionRegistry());
const isolatedCollectionRegistry = makeCollectionDefinitionRegistry();
const defaultCollectionRegistry = defaultCollectionDefinitionRegistry;
const collectionTypeId: typeof CollectionTypeId = CollectionTypeId;
const collectionStoreTypeId: typeof CollectionStoreTypeId = CollectionStoreTypeId;
const directCollectionCheck: boolean = isCollection(dbProjectsCollection);
const unknownCollectionIndex = new UnknownCollectionIndex({
  collection: "projects",
  index: "byStatus"
});
const collectionRowKeyChanged = new CollectionRowKeyChanged({
  collection: "projects",
  key: "atlas",
  nextKey: "zephyr",
  guidance: "keep keys stable"
});
const collectionRowNotFound = new CollectionRowNotFound({
  collection: "projects",
  key: "missing"
});
const readonlyCollectionMutation = new ReadonlyCollectionMutation({
  collection: "derived-projects",
  operation: "insert"
});
const collectionSnapshotCodecError = new CollectionSnapshotCodecError({
  operation: "decode",
  path: "$.collections",
  reason: "invalid"
});
const serverOptions = serverCollectionOptions<Project>({
  name: "projects",
  getKey: (project) => project.id
});
const serverSync = serverCollectionSyncAdapter<Project>({
  name: "projects",
  getKey: (project) => project.id
});
const collectionCurrentStore: Collection.Store = Collection.currentStore();
const collectionStoreEffect: Effect.Effect<Collection.Store> = Collection.storeEffect();
const collectionEventsEffect: Effect.Effect<PubSub.Subscription<Collection.StoreEvent>, never, Scope.Scope> =
  Collection.subscribeEventsEffect();

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
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  defaultCollectionDefinitionRegistry,
  eq,
  flushCollectionsPendingMutationsEffect,
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
  sqliteRow,
  collectionAlias,
  liveQueryAlias,
  liveQueryCollectionAlias,
  directLiveQueryCollection,
  isolatedCollectionRegistry,
  defaultCollectionRegistry,
  collectionTypeId,
  collectionStoreTypeId,
  directCollectionCheck,
  unknownCollectionIndex,
  collectionRowKeyChanged,
  collectionRowNotFound,
  readonlyCollectionMutation,
  collectionSnapshotCodecError,
  serverOptions,
  serverSync,
  collectionCurrentStore,
  collectionStoreEffect,
  collectionEventsEffect
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
  flags: [true, null]
};
const collectionQuerySyncKey: Collection.QuerySyncKey = [
  "projects",
  collectionQuerySyncKeyPart
];
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
  | Collection.FlushAllPendingMutationsRequirements<readonly [typeof dbProjectsCollection], DbSkipService>
  | Collection.BackgroundSyncError<readonly [typeof dbProjectsCollection], "adapter-error", "skip-error">
  | Collection.BackgroundSyncRequirements<readonly [typeof dbProjectsCollection], DbAdapterService, DbSkipService>;
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
const collectionFlushErrorPin: Collection.RuntimeError<"load"> | "skip-error" | EffectInputCallbackError =
  collectionFlushError;
const collectionFlushRequirementsPin: DbRuntimeService | DbSkipService =
  collectionFlushRequirements;
const collectionBackgroundSyncErrorPin:
  | Collection.RuntimeError<"load">
  | "adapter-error"
  | "skip-error"
  | EffectInputCallbackError = collectionBackgroundSyncError;
const collectionBackgroundSyncRequirementsPin: DbRuntimeService | DbAdapterService | DbSkipService =
  collectionBackgroundSyncRequirements;
const concreteCollectionErrorPin: "load" = null as never as CollectionError<typeof dbProjectsCollection>;
const concreteCollectionRequirementsPin: DbRuntimeService =
  null as never as CollectionRequirements<typeof dbProjectsCollection>;
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
const changeFeedUnsubscribeWithServices: Collection.ChangeFeedUnsubscribe<"unsubscribe", DbAdapterService> = () =>
  dbAdapterCleanupEffect;
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
    unsubscribe: changeFeedUnsubscribeWithServices
  })
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
