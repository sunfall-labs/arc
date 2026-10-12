import { Resource } from "@sunfall/arc-core";
import { Schema } from "effect";
import { Project, ProjectApi, ProjectsTag, ProjectsUnavailable, Task } from "./model.js";

// #region define
export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  error: ProjectsUnavailable,
  rows: {
    key: (project) => project.id,
    indexes: { status: (project) => project.status },
  },
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");
// #endregion

// #region indexes
export const TaskList = Resource.define({
  name: "Tasks.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Task),
  rows: {
    key: (task) => task.id,
    indexes: {
      byProject: (task) => task.projectId,
      // Several values put the row in several buckets.
      tag: (task) => task.tags,
    },
  },
  load: () => ProjectApi.use((api) => api.tasks()),
});
export const TasksRef = TaskList("all");
// #endregion
