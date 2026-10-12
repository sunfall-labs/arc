import { Query } from "@sunfall/arc-db";
import { ProjectsRef, TasksRef } from "./rows.js";

// #region active-names
const ActiveProjectNames = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .where(({ project }) => project.status === "active")
    .orderBy(({ project }) => project.name)
    .select(({ project }) => project.name),
);
// #endregion

// #region join
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .join(
      "task",
      TasksRef,
      ({ project }) => project.id,
      (task) => task.projectId,
    )
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
// #endregion

// #region indexed-join
const IndexedProjectTasks = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    // "byProject" is checked against TaskList's `rows.indexes`.
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
// #endregion

// #region diagnostics
const plan = Query.diagnostics((query) =>
  query
    .from({ project: ProjectsRef })
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);

plan.joins[0];
// {
//   alias: "task",
//   resource: "Tasks.list",
//   strategy: "index",
//   index: "byProject",
//   leftRows: 4,
//   rightRows: 24,
//   outputRows: 18,
//   estimatedComparisons: 4
// }
// #endregion

// #region group-by
const ProjectStatusCounts = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .groupBy(({ project }) => ({ status: project.status }), {
      count: Query.count(),
      avgProgress: Query.avg(({ project }) => project.progress),
    })
    .orderBy((group) => group.status),
);
// #endregion

// #region once
// Preloads the sources, then evaluates once. E is the sources' load errors.
const archivedCount = Query.once((query) =>
  query
    .from({ project: ProjectsRef })
    .where(({ project }) => project.status === "archived")
    .select(({ project }) => project.id),
);
// #endregion

export {
  ActiveProjectNames,
  archivedCount,
  IndexedProjectTasks,
  ProjectStatusCounts,
  ProjectTasks,
};
