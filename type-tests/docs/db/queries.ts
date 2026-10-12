import { Collection, Query } from "@sunfall/arc-db";
import { Tasks } from "./indexes.js";
import { Projects } from "./model.js";

// #region active-names
const ActiveProjectNames = Query.live((query) =>
  query
    .from({ project: Projects })
    .where(({ project }) => project.status === "active")
    .select(({ project }) => project.name)
    .orderBy(({ project }) => project.name),
);
// #endregion

// #region join
const ProjectTasks = Query.live((query) =>
  query
    .from({ project: Projects })
    .join(
      "task",
      Tasks,
      ({ project }) => project.id,
      (task) => task.projectId,
    )
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
// #endregion

// #region indexed-join
const IndexedProjectTasks = Query.live((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);
// #endregion

// #region diagnostics
const plan = Query.diagnostics((query) =>
  query
    .from({ project: Projects })
    .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}: ${task.title}`),
);

plan.joins[0];
// {
//   strategy: "collection-index",
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
    .from({ project: Projects })
    .groupBy(({ project }) => ({ status: project.status }), {
      count: Query.count(),
      avgProgress: Query.avg(({ project }) => project.progress),
    })
    .orderBy((group) => group.status),
);
// #endregion

// #region live-query-collection
const ActiveProjectCards = Collection.liveQuery({
  name: "ProjectCards.active",
  query: (query) =>
    query
      .from({ project: Projects })
      .where(({ project }) => project.status === "active")
      .select(({ project }) => ({
        id: project.id,
        name: project.name,
        progress: project.progress,
      })),
  // After `query`, so the row type is inferred from its `select`.
  getKey: (card) => card.id,
});
// #endregion

export {
  ActiveProjectCards,
  ActiveProjectNames,
  IndexedProjectTasks,
  ProjectStatusCounts,
  ProjectTasks,
};
