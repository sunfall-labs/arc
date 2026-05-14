import type { EffectInput } from "@effect-ui/core";
import { toEffect } from "@effect-ui/core";
import { Effect } from "effect";
import type { CollectionPersistenceStorage } from "./index.js";

export const SQLITE_PERSISTENCE_DEFAULT_TABLE = "effect_ui_collection_persistence";
export const SQLITE_PERSISTENCE_DEFAULT_NAMESPACE = "effect-ui:collections";
export const SQLITE_PERSISTENCE_DEFAULT_SCHEMA_VERSION = 1;

export interface SQLitePersistenceKey {
  readonly namespace: string;
  readonly key: string;
}

export interface SQLitePersistenceRow extends SQLitePersistenceKey {
  readonly schemaVersion: number;
  readonly value: string;
  readonly updatedAt: number;
}

export interface SQLitePersistenceTable<E = unknown, R = never> {
  readonly ensure?: () => EffectInput<void, E, R>;
  readonly get: (key: SQLitePersistenceKey) => EffectInput<SQLitePersistenceRow | null, E, R>;
  readonly upsert: (row: SQLitePersistenceRow) => EffectInput<void, E, R>;
  readonly delete?: (key: SQLitePersistenceKey) => EffectInput<void, E, R>;
}

export interface SQLitePersistenceDriver<E = unknown, R = never> {
  readonly table: (name: string) => SQLitePersistenceTable<E, R>;
}

export type SQLiteStatementValue = string | number | null;

export type SQLiteStatementParams = ReadonlyArray<SQLiteStatementValue>;

export interface SQLiteStatementRow {
  readonly namespace?: unknown;
  readonly key?: unknown;
  readonly schema_version?: unknown;
  readonly schemaVersion?: unknown;
  readonly value?: unknown;
  readonly updated_at?: unknown;
  readonly updatedAt?: unknown;
}

export interface SQLiteStatementDatabase<E = unknown, R = never> {
  readonly execute: (sql: string, params?: SQLiteStatementParams) => EffectInput<void, E, R>;
  readonly select: (sql: string, params?: SQLiteStatementParams) => EffectInput<ReadonlyArray<SQLiteStatementRow>, E, R>;
}

export interface SQLitePreparedStatement<
  Row extends SQLiteStatementRow = SQLiteStatementRow,
  E = unknown,
  R = never
> {
  readonly run: (...params: Array<SQLiteStatementValue>) => EffectInput<unknown, E, R>;
  readonly all: (...params: Array<SQLiteStatementValue>) => EffectInput<ReadonlyArray<Row>, E, R>;
}

export interface SQLitePreparedStatementDatabase<
  Row extends SQLiteStatementRow = SQLiteStatementRow,
  E = unknown,
  R = never
> {
  readonly prepare: (sql: string) => EffectInput<SQLitePreparedStatement<Row, E, R>, E, R>;
}

export interface SQLitePreparedStatementDatabaseOptions {
  readonly cache?: boolean;
}

export interface SQLiteMemoryStatement {
  readonly sql: string;
  readonly params?: SQLiteStatementParams;
}

export interface SQLiteMemoryStatementDatabase extends SQLiteStatementDatabase<never, never> {
  readonly statements: ReadonlyArray<SQLiteMemoryStatement>;
  row(table: string, namespace: string, key: string): SQLitePersistenceRow | undefined;
  tableRows(table: string): ReadonlyArray<SQLitePersistenceRow>;
  clear(): void;
}

export interface SQLitePersistenceOptions {
  readonly namespace?: string;
  readonly tableName?: string;
  readonly schemaVersion?: number;
  readonly now?: () => number;
}

const runInput = <A, E, R>(input: EffectInput<A, E, R>): Effect.Effect<A, E, R> =>
  toEffect(input) as Effect.Effect<A, E, R>;

const quoteIdentifier = (identifier: string): string => {
  if (identifier.length === 0 || identifier.includes("\0")) {
    throw new TypeError("SQLite persistence table names must be non-empty strings without NUL bytes");
  }

  return `"${identifier.replaceAll("\"", "\"\"")}"`;
};

const unquoteIdentifier = (identifier: string): string =>
  identifier.startsWith("\"") && identifier.endsWith("\"")
    ? identifier.slice(1, -1).replaceAll("\"\"", "\"")
    : identifier;

const sqlTableName = (sql: string): string => {
  const match =
    sql.match(/\bINTO\s+("[^"]*(?:""[^"]*)*")/i) ??
    sql.match(/\bFROM\s+("[^"]*(?:""[^"]*)*")/i) ??
    sql.match(/\bEXISTS\s+("[^"]*(?:""[^"]*)*")/i);
  if (!match?.[1]) {
    throw new TypeError(`Unsupported SQLite persistence statement: ${sql}`);
  }
  return unquoteIdentifier(match[1]);
};

const rowNumber = (value: unknown): number =>
  typeof value === "number" ? value : Number(value);

const rowString = (value: unknown): string =>
  typeof value === "string" ? value : String(value);

const statementParamList = (params?: SQLiteStatementParams): Array<SQLiteStatementValue> =>
  params === undefined ? [] : [...params];

const memoryRowId = (table: string, key: SQLitePersistenceKey): string =>
  `${table}\0${key.namespace}\0${key.key}`;

export const makeSQLiteMemoryStatementDatabase = (): SQLiteMemoryStatementDatabase => {
  const rows = new Map<string, SQLitePersistenceRow>();
  const statements: Array<SQLiteMemoryStatement> = [];

  const row = (table: string, namespace: string, key: string): SQLitePersistenceRow | undefined =>
    rows.get(memoryRowId(table, { namespace, key }));

  const tableRows = (table: string): ReadonlyArray<SQLitePersistenceRow> =>
    Array.from(rows.entries())
      .filter(([id]) => id.startsWith(`${table}\0`))
      .map(([, value]) => ({ ...value }));

  return {
    statements,
    execute: (sql, params) => {
      statements.push(params === undefined ? { sql } : { sql, params });
      const table = sqlTableName(sql);
      if (/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(sql)) {
        return;
      }

      if (/^\s*INSERT\s+INTO\b/i.test(sql)) {
        const [namespace, key, schemaVersion, value, updatedAt] = params ?? [];
        rows.set(memoryRowId(table, {
          namespace: rowString(namespace),
          key: rowString(key)
        }), {
          namespace: rowString(namespace),
          key: rowString(key),
          schemaVersion: rowNumber(schemaVersion),
          value: rowString(value),
          updatedAt: rowNumber(updatedAt)
        });
        return;
      }

      if (/^\s*DELETE\s+FROM\b/i.test(sql)) {
        const [namespace, key] = params ?? [];
        rows.delete(memoryRowId(table, {
          namespace: rowString(namespace),
          key: rowString(key)
        }));
        return;
      }

      throw new TypeError(`Unsupported SQLite persistence statement: ${sql}`);
    },
    select: (sql, params) => {
      statements.push(params === undefined ? { sql } : { sql, params });
      if (!/^\s*SELECT\b/i.test(sql)) {
        throw new TypeError(`Unsupported SQLite persistence statement: ${sql}`);
      }

      const table = sqlTableName(sql);
      const [namespace, key] = params ?? [];
      const current = row(table, rowString(namespace), rowString(key));
      return current
        ? [{
            namespace: current.namespace,
            key: current.key,
            schema_version: current.schemaVersion,
            value: current.value,
            updated_at: current.updatedAt
          }]
        : [];
    },
    row,
    tableRows,
    clear: () => {
      rows.clear();
      statements.length = 0;
    }
  };
};

export const makeSQLitePreparedStatementDatabase = <
  Row extends SQLiteStatementRow = SQLiteStatementRow,
  E = unknown,
  R = never
>(
  database: SQLitePreparedStatementDatabase<Row, E, R>,
  options: SQLitePreparedStatementDatabaseOptions = {}
): SQLiteStatementDatabase<E, R> => {
  const cache = options.cache === true
    ? new Map<string, SQLitePreparedStatement<Row, E, R>>()
    : undefined;

  const prepare = (sql: string): Effect.Effect<SQLitePreparedStatement<Row, E, R>, E, R> =>
    Effect.gen(function* () {
      const cached = cache?.get(sql);
      if (cached) {
        return cached;
      }

      const statement = yield* runInput(database.prepare(sql));
      cache?.set(sql, statement);
      return statement;
    });

  return {
    execute: (sql, params) =>
      Effect.gen(function* () {
        const statement = yield* prepare(sql);
        yield* runInput(statement.run(...statementParamList(params)));
      }) as Effect.Effect<void, E, R>,
    select: (sql, params) =>
      Effect.gen(function* () {
        const statement = yield* prepare(sql);
        return yield* runInput(statement.all(...statementParamList(params)));
      }) as Effect.Effect<ReadonlyArray<SQLiteStatementRow>, E, R>
  };
};

export const makeSQLiteStatementPersistenceDriver = <E = unknown, R = never>(
  database: SQLiteStatementDatabase<E, R>
): SQLitePersistenceDriver<E, R> => ({
  table: (name) => {
    const table = quoteIdentifier(name);
    return {
      ensure: () =>
        database.execute(
          `CREATE TABLE IF NOT EXISTS ${table} (` +
            "\"namespace\" TEXT NOT NULL, " +
            "\"key\" TEXT NOT NULL, " +
            "\"schema_version\" INTEGER NOT NULL, " +
            "\"value\" TEXT NOT NULL, " +
            "\"updated_at\" INTEGER NOT NULL, " +
            "PRIMARY KEY (\"namespace\", \"key\")" +
          ")"
        ),
      get: (key) =>
        Effect.gen(function* () {
          const rows = yield* runInput(database.select(
            `SELECT "namespace", "key", "schema_version", "value", "updated_at" FROM ${table} ` +
              "WHERE \"namespace\" = ? AND \"key\" = ? LIMIT 1",
            [key.namespace, key.key]
          ));
          const row = rows[0];
          if (!row) {
            return null;
          }

          return {
            namespace: rowString(row.namespace),
            key: rowString(row.key),
            schemaVersion: rowNumber(row.schemaVersion ?? row.schema_version),
            value: rowString(row.value),
            updatedAt: rowNumber(row.updatedAt ?? row.updated_at)
          } satisfies SQLitePersistenceRow;
        }),
      upsert: (row) =>
        database.execute(
          `INSERT INTO ${table} ("namespace", "key", "schema_version", "value", "updated_at") ` +
            "VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(\"namespace\", \"key\") DO UPDATE SET " +
            "\"schema_version\" = excluded.\"schema_version\", " +
            "\"value\" = excluded.\"value\", " +
            "\"updated_at\" = excluded.\"updated_at\"",
          [row.namespace, row.key, row.schemaVersion, row.value, row.updatedAt]
        ),
      delete: (key) =>
        database.execute(
          `DELETE FROM ${table} WHERE "namespace" = ? AND "key" = ?`,
          [key.namespace, key.key]
        )
    };
  }
});

export const makeSQLitePersistenceStorage = <E = unknown, R = never>(
  driver: SQLitePersistenceDriver<E, R>,
  options: SQLitePersistenceOptions = {}
): CollectionPersistenceStorage<E, R> => {
  const namespace = options.namespace ?? SQLITE_PERSISTENCE_DEFAULT_NAMESPACE;
  const tableName = options.tableName ?? SQLITE_PERSISTENCE_DEFAULT_TABLE;
  const schemaVersion = options.schemaVersion ?? SQLITE_PERSISTENCE_DEFAULT_SCHEMA_VERSION;
  const now = options.now ?? Date.now;
  const table = driver.table(tableName);
  const ensure = table.ensure;
  const deleteRow = table.delete;

  const ensureTable = (): Effect.Effect<void, E, R> =>
    ensure ? runInput(ensure()) : Effect.void as Effect.Effect<void, E, R>;

  const rowKey = (key: string): SQLitePersistenceKey => ({ namespace, key });

  const storage = {
    getItem: (key: string) =>
      Effect.gen(function* () {
        yield* ensureTable();
        const row = yield* runInput(table.get(rowKey(key)));
        return row?.schemaVersion === schemaVersion ? row.value : null;
      }),
    setItem: (key: string, value: string) =>
      Effect.gen(function* () {
        yield* ensureTable();
        yield* runInput(table.upsert({
          ...rowKey(key),
          schemaVersion,
          value,
          updatedAt: now()
        }));
      })
  } satisfies Omit<CollectionPersistenceStorage<E, R>, "removeItem">;

  return deleteRow
    ? {
        ...storage,
        removeItem: (key: string) =>
          Effect.gen(function* () {
            yield* ensureTable();
            yield* runInput(deleteRow(rowKey(key)));
          })
      }
    : storage;
};

export namespace SQLitePersistence {
  export type Key = SQLitePersistenceKey;
  export type Row = SQLitePersistenceRow;
  export type Table<E = unknown, R = never> = SQLitePersistenceTable<E, R>;
  export type Driver<E = unknown, R = never> = SQLitePersistenceDriver<E, R>;
  export type MemoryStatement = SQLiteMemoryStatement;
  export type MemoryStatementDatabase = SQLiteMemoryStatementDatabase;
  export type PreparedStatement<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = unknown,
    R = never
  > = SQLitePreparedStatement<Row, E, R>;
  export type PreparedStatementDatabase<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = unknown,
    R = never
  > = SQLitePreparedStatementDatabase<Row, E, R>;
  export type PreparedStatementDatabaseOptions = SQLitePreparedStatementDatabaseOptions;
  export type StatementValue = SQLiteStatementValue;
  export type StatementParams = SQLiteStatementParams;
  export type StatementRow = SQLiteStatementRow;
  export type StatementDatabase<E = unknown, R = never> = SQLiteStatementDatabase<E, R>;
  export type Options = SQLitePersistenceOptions;

  export const storage = makeSQLitePersistenceStorage;
  export const preparedStatementDatabase = makeSQLitePreparedStatementDatabase;
  export const statementDriver = makeSQLiteStatementPersistenceDriver;
  export const memoryStatementDatabase = makeSQLiteMemoryStatementDatabase;
}
