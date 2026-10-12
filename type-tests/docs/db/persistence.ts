import { Collection } from "@sunfall/arc-db";
import { Effect, Layer } from "effect";
import { KeyValueStore } from "effect/persistence";
import type { SqlClient } from "effect/sql";
import { ProjectApi, Projects, ProjectSchema, type Project } from "./model.js";

// #region snapshot
const roundTrip = Effect.gen(function* () {
  const snapshot = yield* Projects.snapshot();

  yield* Projects.hydrate(snapshot);
});
// #endregion

// #region persist
const persistence = Effect.gen(function* () {
  yield* Projects.persist();
  yield* Projects.restore();
  yield* Projects.persist({ key: "projects", version: 2 });
}).pipe(Effect.provide(KeyValueStore.layerMemory));
// #endregion

// #region policy
const PersistedProjects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: { load: () => ProjectApi.use((api) => api.list()) },
  persistence: {
    // key?: string (default "Projects"), version?: number (default 1)
    loadAfterRestore: true,
  },
});
// #endregion

// #region explicit-types
const LocalProjects = Collection.define<
  Project,
  string,
  KeyValueStore.KeyValueStoreError,
  KeyValueStore.KeyValueStore
>({
  name: "LocalProjects",
  getKey: (project) => project.id,
  persistence: { key: "local-projects" },
});
// #endregion

// `@effect/sql-sqlite-node`'s client Layer, as the snippet uses it.
declare const SqliteClient: {
  readonly layer: (options: { readonly filename: string }) => Layer.Layer<SqlClient.SqlClient>;
};

// #region sql
const PersistenceLive = KeyValueStore.layerSql({ table: "arc_kv" }).pipe(
  Layer.provide(SqliteClient.layer({ filename: "app.db" })),
);
// #endregion

export { LocalProjects, PersistedProjects, PersistenceLive, persistence, roundTrip };
