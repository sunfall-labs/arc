import { Resource } from "@sunfall/arc-core";
import { Layer, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import type { SqlClient } from "effect/sql";
import { Project, ProjectApi, ProjectApiLive } from "./model.js";

// #region persist
const OfflineProjectList = Resource.define({
  name: "Projects.offline",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  rows: { key: (project) => project.id },
  // Bump `version` when `output` changes shape: older values are never read.
  policy: { persist: { key: "projects", version: 1 } },
  load: () => ProjectApi.use((api) => api.list()),
});
// #endregion

// #region client-layer
const ClientLive = Layer.mergeAll(
  ProjectApiLive,
  KeyValueStore.layerStorage(() => localStorage),
);
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

export { ClientLive, OfflineProjectList, PersistenceLive };
