import { makeRuntime, runWithRuntime, toEffect } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  SQLITE_PERSISTENCE_DEFAULT_TABLE,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidStatementParams,
  SQLitePersistenceInvalidTableName,
  SQLitePersistenceUnsupportedStatement,
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePreparedStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  type SQLitePreparedStatementDatabase,
  type SQLitePersistenceDriver,
  type SQLitePersistenceKey,
  type SQLitePersistenceRow,
  type SQLitePersistenceTable,
  type SQLiteStatementDatabase,
  type SQLiteStatementParams,
  type SQLiteStatementRow
} from "../src/sqlite-persistence.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked";
  readonly progress: number;
}

interface FakeSQLitePersistenceTable extends SQLitePersistenceTable<never, never> {
  readonly rows: ReadonlyMap<string, SQLitePersistenceRow>;
  row(namespace: string, key: string): SQLitePersistenceRow | undefined;
}

interface FakeSQLitePersistenceDriver {
  readonly driver: SQLitePersistenceDriver<never, never>;
  table(name?: string): FakeSQLitePersistenceTable;
}

const fakeRowId = (key: SQLitePersistenceKey): string =>
  `${key.namespace}\u0000${key.key}`;

const makeFakeTable = (): FakeSQLitePersistenceTable => {
  const rows = new Map<string, SQLitePersistenceRow>();
  return {
    rows,
    get: (key) => {
      const row = rows.get(fakeRowId(key));
      return row ? { ...row } : null;
    },
    upsert: (row) => {
      rows.set(fakeRowId(row), { ...row });
    },
    delete: (key) => {
      rows.delete(fakeRowId(key));
    },
    row: (namespace, key) => rows.get(fakeRowId({ namespace, key }))
  };
};

const makeFakeDriver = (): FakeSQLitePersistenceDriver => {
  const tables = new Map<string, FakeSQLitePersistenceTable>();
  const table = (name = SQLITE_PERSISTENCE_DEFAULT_TABLE): FakeSQLitePersistenceTable => {
    const existing = tables.get(name);
    if (existing) {
      return existing;
    }

    const next = makeFakeTable();
    tables.set(name, next);
    return next;
  };

  return {
    driver: { table },
    table
  };
};

interface FakeStatementDatabase extends SQLiteStatementDatabase<never, never> {
  readonly executed: ReadonlyArray<readonly [string, SQLiteStatementParams | undefined]>;
  row(namespace: string, key: string): SQLitePersistenceRow | undefined;
}

const makeFakeStatementDatabase = (): FakeStatementDatabase => {
  const rows = new Map<string, SQLitePersistenceRow>();
  const executed: Array<readonly [string, SQLiteStatementParams | undefined]> = [];
  return {
    executed,
    execute: (sql, params) => {
      executed.push([sql, params]);
      if (sql.startsWith("INSERT INTO")) {
        const [namespace, key, schemaVersion, value, updatedAt] = params ?? [];
        rows.set(fakeRowId({
          namespace: String(namespace),
          key: String(key)
        }), {
          namespace: String(namespace),
          key: String(key),
          schemaVersion: Number(schemaVersion),
          value: String(value),
          updatedAt: Number(updatedAt)
        });
      }
      if (sql.startsWith("DELETE FROM")) {
        const [namespace, key] = params ?? [];
        rows.delete(fakeRowId({
          namespace: String(namespace),
          key: String(key)
        }));
      }
    },
    select: (_sql, params) => {
      const [namespace, key] = params ?? [];
      const row = rows.get(fakeRowId({
        namespace: String(namespace),
        key: String(key)
      }));
      return row
        ? [{
            namespace: row.namespace,
            key: row.key,
            schema_version: row.schemaVersion,
            value: row.value,
            updated_at: row.updatedAt
          } satisfies SQLiteStatementRow]
        : [];
    },
    row: (namespace, key) => rows.get(fakeRowId({ namespace, key }))
  };
};

interface FakePreparedStatementDatabase extends SQLitePreparedStatementDatabase<SQLiteStatementRow, never, never> {
  readonly memory: ReturnType<typeof makeSQLiteMemoryStatementDatabase>;
  readonly prepared: ReadonlyArray<string>;
}

const makeFakePreparedStatementDatabase = (): FakePreparedStatementDatabase => {
  const memory = makeSQLiteMemoryStatementDatabase();
  const prepared: Array<string> = [];

  return {
    memory,
    prepared,
    prepare: (sql) => {
      prepared.push(sql);
      return {
        run: (...params) => memory.execute(sql, params),
        all: (...params) => memory.select(sql, params)
      };
    }
  };
};

describe("SQLite persistence storage", () => {
  it("persists collection snapshots into namespace/key rows", () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const fake = makeFakeDriver();
    const storage = makeSQLitePersistenceStorage(fake.driver, {
      namespace: "workspace:a",
      tableName: "collection_snapshots",
      schemaVersion: 4,
      now: () => 12_345
    });
    const Projects = Collection.define<Project>({
      name: "Projects.sqlite-persistence",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.scoped(
          first.provide(Projects.writeInsertEffect([
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
          ]))
        );
        yield* Effect.scoped(first.provide(Projects.persistEffect(storage, { key: "projects-cache" })));

        yield* Effect.sync(() => {
          const row = fake.table("collection_snapshots").row("workspace:a", "projects-cache");
          expect(row).toMatchObject({
            namespace: "workspace:a",
            key: "projects-cache",
            schemaVersion: 4,
            updatedAt: 12_345
          });
          expect(JSON.parse(row?.value ?? "{}")).toMatchObject({
            name: "Projects.sqlite-persistence",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                synced: true,
                origin: "remote"
              },
              {
                key: "lumen",
                value: { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
                synced: true,
                origin: "remote"
              }
            ],
            pendingMutations: []
          });
        });

        yield* Effect.scoped(second.provide(Projects.restoreEffect(storage, { key: "projects-cache" })));

        yield* Effect.sync(() =>
          expect(runWithRuntime(second, () => Projects.rows().map((project) => project.name).sort())).toEqual([
            "Atlas",
            "Lumen"
          ])
        );
      }).pipe(
        Effect.ensuring(Effect.andThen(first.disposeEffect, second.disposeEffect))
      )
    );
  });

  it("returns null when the stored row schema version does not match", () => {
    const fake = makeFakeDriver();
    const versionOne = makeSQLitePersistenceStorage(fake.driver, {
      namespace: "workspace:a",
      schemaVersion: 1,
      now: () => 1
    });
    const versionTwo = makeSQLitePersistenceStorage(fake.driver, {
      namespace: "workspace:a",
      schemaVersion: 2,
      now: () => 2
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(versionOne.setItem("projects-cache", "{\"collections\":[]}"));

        yield* Effect.sync(() =>
          expect(fake.table().row("workspace:a", "projects-cache")).toMatchObject({
            schemaVersion: 1,
            value: "{\"collections\":[]}"
          })
        );

        const versionOneValue = yield* toEffect(versionOne.getItem("projects-cache"));
        const versionTwoValue = yield* toEffect(versionTwo.getItem("projects-cache"));

        yield* Effect.sync(() => {
          expect(versionOneValue).toBe("{\"collections\":[]}");
          expect(versionTwoValue).toBeNull();
        });
      })
    );
  });

  it("removes namespace/key rows when the table supports deletes", () => {
    const fake = makeFakeDriver();
    const storage = makeSQLitePersistenceStorage(fake.driver, {
      namespace: "workspace:a",
      now: () => 1
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(storage.setItem("projects-cache", "{\"rows\":[]}"));
        yield* Effect.sync(() => expect(fake.table().row("workspace:a", "projects-cache")).toBeDefined());

        yield* toEffect(storage.removeItem!("projects-cache"));

        yield* Effect.sync(() => expect(fake.table().row("workspace:a", "projects-cache")).toBeUndefined());
      })
    );
  });

  it("preserves SQLite table receivers for method-style ensure callbacks", () => {
    interface MethodStyleTable extends SQLitePersistenceTable<never, never> {
      ensured: number;
    }

    const table: MethodStyleTable = {
      ensured: 0,
      ensure(this: MethodStyleTable) {
        this.ensured++;
      },
      get: () => null,
      upsert: () => undefined
    };
    const storage = makeSQLitePersistenceStorage({
      table: () => table
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* toEffect(storage.getItem("projects-cache"));

        expect(value).toBeNull();
        expect(table.ensured).toBe(1);
      })
    );
  });

  it("preserves SQLite storage receivers for method-style now callbacks", () => {
    interface MethodOptions {
      readonly namespace: string;
      readonly clock: number;
      now(this: MethodOptions): number;
    }

    const fake = makeFakeDriver();
    const options: MethodOptions = {
      namespace: "workspace:a",
      clock: 12_345,
      now(this: MethodOptions) {
        return this.clock;
      }
    };
    const storage = makeSQLitePersistenceStorage(fake.driver, options);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(storage.setItem("projects-cache", "{\"rows\":[]}"));

        expect(fake.table().row("workspace:a", "projects-cache")).toMatchObject({
          updatedAt: 12_345
        });
      })
    );
  });

  it("adapts SQL statement databases into the persistence driver interface", () => {
    const fake = makeFakeStatementDatabase();
    const storage = makeSQLitePersistenceStorage(
      makeSQLiteStatementPersistenceDriver(fake),
      {
        namespace: "workspace:a",
        tableName: "collection-snapshots",
        schemaVersion: 3,
        now: () => 42
      }
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(storage.setItem("projects-cache", "{\"rows\":[]}"));

        yield* Effect.sync(() => {
          expect(fake.executed[0]?.[0]).toContain("CREATE TABLE IF NOT EXISTS \"collection-snapshots\"");
          expect(fake.row("workspace:a", "projects-cache")).toMatchObject({
            namespace: "workspace:a",
            key: "projects-cache",
            schemaVersion: 3,
            value: "{\"rows\":[]}",
            updatedAt: 42
          });
        });

        const value = yield* toEffect(storage.getItem("projects-cache"));
        yield* Effect.sync(() => expect(value).toBe("{\"rows\":[]}"));

        yield* toEffect(storage.removeItem!("projects-cache"));

        yield* Effect.sync(() => expect(fake.row("workspace:a", "projects-cache")).toBeUndefined());
      })
    );
  });

  it("adapts prepare/run/all SQLite clients into statement databases", () => {
    const fake = makeFakePreparedStatementDatabase();
    const storage = makeSQLitePersistenceStorage(
      makeSQLiteStatementPersistenceDriver(makeSQLitePreparedStatementDatabase(fake, { cache: true })),
      {
        namespace: "workspace:a",
        tableName: "collection-snapshots",
        schemaVersion: 5,
        now: () => 99
      }
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(storage.setItem("projects-cache", "{\"rows\":[1]}"));

        yield* Effect.sync(() =>
          expect(fake.memory.row("collection-snapshots", "workspace:a", "projects-cache")).toMatchObject({
            namespace: "workspace:a",
            key: "projects-cache",
            schemaVersion: 5,
            value: "{\"rows\":[1]}",
            updatedAt: 99
          })
        );

        const value = yield* toEffect(storage.getItem("projects-cache"));
        yield* Effect.sync(() => expect(value).toBe("{\"rows\":[1]}"));
        yield* toEffect(storage.removeItem!("projects-cache"));

        yield* Effect.sync(() => {
          expect(fake.memory.row("collection-snapshots", "workspace:a", "projects-cache")).toBeUndefined();
          expect(fake.prepared).toEqual([
            expect.stringContaining("CREATE TABLE IF NOT EXISTS \"collection-snapshots\""),
            expect.stringContaining("INSERT INTO \"collection-snapshots\""),
            expect.stringContaining("SELECT \"namespace\""),
            expect.stringContaining("DELETE FROM \"collection-snapshots\"")
          ]);
        });
      })
    );
  });

  it("reports SQLite persistence callback throws in the Effect error channel", async () => {
    const getFailure = new Error("get failed");
    const prepareFailure = new Error("prepare failed");
    const nowFailure = new Error("now failed");
    const storage = makeSQLitePersistenceStorage({
      table: () => ({
        get: () => {
          throw getFailure;
        },
        upsert: () => undefined
      })
    });
    const prepared = makeSQLitePreparedStatementDatabase({
      prepare: () => {
        throw prepareFailure;
      }
    });
    const clockStorage = makeSQLitePersistenceStorage(makeSQLiteStatementPersistenceDriver(makeSQLiteMemoryStatementDatabase()), {
      now: () => {
        throw nowFailure;
      }
    });

    await expect(Effect.runPromise(toEffect(storage.getItem("projects-cache")))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "SQLitePersistence.get"
    });
    await expect(Effect.runPromise(toEffect(clockStorage.setItem("projects-cache", "{}")))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "SQLitePersistence.now"
    });
    await expect(Effect.runPromise(prepared.execute("SELECT 1"))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "SQLitePersistence.prepare"
    });
    void getFailure;
    void prepareFailure;
    void nowFailure;
  });

  it("provides an in-memory statement database for the generated SQLite persistence SQL", () => {
    const memory = makeSQLiteMemoryStatementDatabase();
    const storage = makeSQLitePersistenceStorage(
      makeSQLiteStatementPersistenceDriver(memory),
      {
        namespace: "workspace:a",
        tableName: "collection-snapshots",
        schemaVersion: 7,
        now: () => 123
      }
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* toEffect(storage.setItem("projects-cache", "{\"rows\":[]}"));

        yield* Effect.sync(() => {
          expect(memory.row("collection-snapshots", "workspace:a", "projects-cache")).toMatchObject({
            namespace: "workspace:a",
            key: "projects-cache",
            schemaVersion: 7,
            value: "{\"rows\":[]}",
            updatedAt: 123
          });
          expect(memory.tableRows("collection-snapshots")).toHaveLength(1);
          expect(memory.statements.map((statement) => statement.sql)).toEqual([
            expect.stringContaining("CREATE TABLE IF NOT EXISTS \"collection-snapshots\""),
            expect.stringContaining("INSERT INTO \"collection-snapshots\"")
          ]);
        });

        const value = yield* toEffect(storage.getItem("projects-cache"));
        yield* Effect.sync(() => expect(value).toBe("{\"rows\":[]}"));
        yield* toEffect(storage.removeItem!("projects-cache"));

        yield* Effect.sync(() => {
          expect(memory.row("collection-snapshots", "workspace:a", "projects-cache")).toBeUndefined();

          memory.clear();

          expect(memory.tableRows("collection-snapshots")).toEqual([]);
          expect(memory.statements).toEqual([]);
        });
      })
    );
  });

  it("rejects malformed memory INSERT params before mutating rows", () => {
    const memory = makeSQLiteMemoryStatementDatabase();
    const insertSql =
      "INSERT INTO \"collection-snapshots\" (\"namespace\", \"key\", \"schema_version\", \"value\", \"updated_at\") " +
      "VALUES (?, ?, ?, ?, ?)";

    try {
      memory.execute(insertSql, [
        "workspace:a",
        "projects-cache",
        "7" as never,
        "{\"rows\":[]}",
        123
      ]);
      expect.fail("Expected malformed INSERT params to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SQLitePersistenceInvalidStatementParams);
      expect(error).toMatchObject({
        _tag: "SQLitePersistenceInvalidStatementParams",
        operation: "insert",
        field: "schema_version",
        expected: "finite-number"
      });
    }

    expect(memory.row("collection-snapshots", "workspace:a", "projects-cache")).toBeUndefined();
  });

  it("rejects malformed memory SELECT params before reading rows", () => {
    const memory = makeSQLiteMemoryStatementDatabase();
    const insertSql =
      "INSERT INTO \"collection-snapshots\" (\"namespace\", \"key\", \"schema_version\", \"value\", \"updated_at\") " +
      "VALUES (?, ?, ?, ?, ?)";
    const selectSql =
      "SELECT \"namespace\", \"key\", \"schema_version\", \"value\", \"updated_at\" FROM \"collection-snapshots\" " +
      "WHERE \"namespace\" = ? AND \"key\" = ? LIMIT 1";
    memory.execute(insertSql, ["workspace:a", "123", 7, "{\"rows\":[]}", 123]);

    try {
      memory.select(selectSql, ["workspace:a"]);
      expect.fail("Expected wrong SELECT param count to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SQLitePersistenceInvalidStatementParams);
      expect(error).toMatchObject({
        _tag: "SQLitePersistenceInvalidStatementParams",
        operation: "select",
        field: "params",
        expected: "exact-param-count",
        expectedCount: 2,
        actualCount: 1
      });
    }

    try {
      memory.select(selectSql, ["workspace:a", 123 as never]);
      expect.fail("Expected malformed SELECT key param to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SQLitePersistenceInvalidStatementParams);
      expect(error).toMatchObject({
        _tag: "SQLitePersistenceInvalidStatementParams",
        operation: "select",
        field: "key",
        expected: "string"
      });
    }
  });

  it("rejects malformed memory DELETE params before mutating rows", () => {
    const memory = makeSQLiteMemoryStatementDatabase();
    const insertSql =
      "INSERT INTO \"collection-snapshots\" (\"namespace\", \"key\", \"schema_version\", \"value\", \"updated_at\") " +
      "VALUES (?, ?, ?, ?, ?)";
    const deleteSql =
      "DELETE FROM \"collection-snapshots\" WHERE \"namespace\" = ? AND \"key\" = ?";
    memory.execute(insertSql, ["workspace:a", "123", 7, "{\"rows\":[]}", 123]);

    try {
      memory.execute(deleteSql, ["workspace:a", 123 as never]);
      expect.fail("Expected malformed DELETE params to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SQLitePersistenceInvalidStatementParams);
      expect(error).toMatchObject({
        _tag: "SQLitePersistenceInvalidStatementParams",
        operation: "delete",
        field: "key",
        expected: "string"
      });
    }

    expect(memory.row("collection-snapshots", "workspace:a", "123")).toBeDefined();
  });

  it("reports typed SQLite persistence errors for invalid adapter input", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const storage = makeSQLitePersistenceStorage(makeSQLiteStatementPersistenceDriver(makeSQLiteMemoryStatementDatabase()), {
          tableName: ""
        });
        const tableNameFailure = yield* Effect.flip(storage.getItem("projects-cache"));

        expect(tableNameFailure).toBeInstanceOf(SQLitePersistenceInvalidTableName);
        expect(tableNameFailure).toMatchObject({
          _tag: "SQLitePersistenceInvalidTableName",
          reason: "Empty"
        });

        expect(() =>
          makeSQLitePersistenceStorage(makeSQLiteStatementPersistenceDriver(makeSQLiteMemoryStatementDatabase()), {
            tableName: ""
          })
        ).not.toThrow();

        const memory = makeSQLiteMemoryStatementDatabase();
        expect(() => memory.execute("DROP TABLE \"collection-snapshots\"")).toThrow(
          SQLitePersistenceUnsupportedStatement
        );

        try {
          memory.select("DELETE FROM \"collection-snapshots\"");
          expect.fail("Expected memory select to reject non-SELECT SQL");
        } catch (error) {
          expect(error).toBeInstanceOf(SQLitePersistenceUnsupportedStatement);
          expect(error).toMatchObject({
            _tag: "SQLitePersistenceUnsupportedStatement",
            operation: "select"
          });
        }
      })
    ));

  it("rejects malformed statement rows instead of coercing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const storage = makeSQLitePersistenceStorage(
          makeSQLiteStatementPersistenceDriver({
            execute: () => undefined,
            select: () => [{
              namespace: "workspace:a",
              key: "projects-cache",
              schema_version: "1",
              value: "{\"collections\":[]}",
              updated_at: 1
            }]
          }),
          {
            namespace: "workspace:a",
            schemaVersion: 1
          }
        );

        const failure = yield* Effect.flip(toEffect(storage.getItem("projects-cache")));

        expect(failure).toBeInstanceOf(SQLitePersistenceInvalidRow);
        expect(failure).toMatchObject({
          _tag: "SQLitePersistenceInvalidRow",
          field: "schema_version",
          expected: "finite-number"
        });
      })
    ));
});
