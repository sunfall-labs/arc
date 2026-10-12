import { Collection } from "@sunfall/arc-db";
import { Effect, Queue, Stream } from "effect";
import { feed, ProjectApi, ProjectSchema, type Project } from "./model.js";

// #region changes
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: {
    load: () => ProjectApi.use((api) => api.list()),
    changes: () =>
      Stream.callback<ReadonlyArray<Collection.Change<Project, string>>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => feed.onChange((changes) => Queue.offerUnsafe(queue, changes))),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
  },
});
// #endregion

// #region apply-changes
const renameRemotely = Projects.applyChanges([
  { _tag: "Upsert", value: { id: "atlas", name: "Atlas Prime", status: "active", progress: 40 } },
  { _tag: "Update", key: "orion", changes: { name: "Orion Prime" } },
  { _tag: "Delete", key: "lumen" },
]);
// #endregion

export { renameRemotely };
