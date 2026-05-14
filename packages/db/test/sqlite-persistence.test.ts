import { makeRuntime, runWithRuntime, toEffect } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  SQLITE_PERSISTENCE_DEFAULT_TABLE,
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

  it("throws typed SQLite persistence errors for invalid adapter input", () => {
    expect(() =>
      makeSQLitePersistenceStorage(makeSQLiteStatementPersistenceDriver(makeSQLiteMemoryStatementDatabase()), {
        tableName: ""
      })
    ).toThrow(SQLitePersistenceInvalidTableName);

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
  });
});
