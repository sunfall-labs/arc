import { Resource } from "@sunfall/arc-core";
import { Effect, Queue, Schema, Stream } from "effect";
import { feed, Project, ProjectApi } from "./model.js";

// #region changes
const LiveProjectList = Resource.define({
  name: "Projects.live",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  rows: {
    key: (project) => project.id,
    // Starts with the entry's first load; each batch applies to the synced rows.
    changes: () =>
      Stream.callback<ReadonlyArray<Resource.RowChange<Project, string>>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => feed.onChange((changes) => Queue.offerUnsafe(queue, changes))),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
  },
  load: () => ProjectApi.use((api) => api.list()),
});
// #endregion

export { LiveProjectList };
