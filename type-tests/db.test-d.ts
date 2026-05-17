import {
  Effect,
  PubSub,
  Scope
} from "effect";
import type { EffectInputCallbackError } from "@effect-ui/core";
import {
  Collection,
  Query,
  SQLitePersistence,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidStatementParams,
  SQLitePersistenceInvalidTableName,
  SQLitePersistenceUnsupportedStatement,
  ServerCollectionMissingIdentity,
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  liveQueryStateError,
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
declare const erasedCollection: AnyCollection;
declare const erasedCollectionError: CollectionError<typeof erasedCollection>;
declare const erasedCollectionRequirements: CollectionRequirements<typeof erasedCollection>;
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
  bindCollectionRuntimeEffect,
  collectionReactiveDepsValue,
  collectionStateError,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  liveQueryStateError,
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
  | QueryGroupKey<{ readonly status: string; readonly meta: { readonly active: boolean } }>;
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
void servicefulChangeFeedEffect;
type _DbErrors = DbErrors;
type _DbReactivePins = DbReactivePins;
type _DbErasedCollectionPins = DbErasedCollectionPins;
type _DbServerPins = DbServerPins;
type _DbFlushPins = DbFlushPins;
