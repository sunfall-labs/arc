import {
  Collection,
  Query,
  SQLitePersistence,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidTableName,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  type CollectionStorageError,
  type QueryEvaluationError,
  type SQLitePersistenceRow,
  type SQLiteStatementDatabase
} from "@effect-ui/db";

declare const sqliteStatementDatabase: SQLiteStatementDatabase<SQLitePersistenceInvalidRow>;
const sqliteStorage = makeSQLitePersistenceStorage(
  makeSQLiteStatementPersistenceDriver(sqliteStatementDatabase)
);
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

const dbExports: Array<unknown> = [
  Collection,
  Query,
  SQLitePersistence,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidTableName,
  createCollection,
  createLiveQuery,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  sqliteStorage,
  sqliteNamespaceStorage,
  sqliteRow,
  collectionAlias,
  liveQueryAlias,
  liveQueryCollectionAlias
];
type DbErrors =
  | CollectionStorageError
  | QueryEvaluationError
  | SQLitePersistenceInvalidRow
  | SQLitePersistenceInvalidTableName;
void dbExports;
type _DbErrors = DbErrors;
