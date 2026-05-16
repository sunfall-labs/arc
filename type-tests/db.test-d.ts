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
  type CollectionBackgroundSyncResult,
  type CollectionReactiveLiveQueryInput,
  type CollectionReactiveLiveQuerySelection,
  type CollectionReactivePreloadController,
  type CollectionReactivePreloadControllerOptions,
  type FlushCollectionPendingMutationsResult,
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

declare const sqliteStatementDatabase: SQLiteStatementDatabase<SQLitePersistenceInvalidRow>;
declare const sqlitePreparedStatementDatabase: SQLitePreparedStatementDatabase;
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
  serverSync
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
type DbServerPins =
  | ServerCollectionOptions<Project>
  | ServerCollectionOperation<void, ReadonlyArray<Project>>
  | ServerCollectionResult<ReadonlyArray<Project>>
  | ServerCollectionInsertPayload<Project, string>
  | ServerCollectionUpdatePayload<Project, string>
  | ServerCollectionDeletePayload<Project, string>;
type DbFlushPins =
  | FlushCollectionPendingMutationsResult
  | CollectionBackgroundSyncResult;
void dbExports;
type _DbErrors = DbErrors;
type _DbReactivePins = DbReactivePins;
type _DbServerPins = DbServerPins;
type _DbFlushPins = DbFlushPins;
