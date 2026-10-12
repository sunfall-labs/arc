import { Collection, Query } from "@sunfall/arc-db";
import { Effect, Schedule } from "effect";
import {
  ProjectApi,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectsRef,
  type ProjectId,
  type ProjectSummary,
  type ProjectWorkItem,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./domain.js";

// Resource-backed: the collection loads through the `ProjectList` Resource and
// follows it afterward, so any invalidation of the `Projects` tag (renames,
// advances, refreshes) reconciles these rows without a second list fetch.
export const ProjectSummaries = Collection.define({
  name: "Projects.collection",
  output: ProjectSummarySchema,
  getKey: (project: ProjectSummary) => project.id,
  indexes: {
    status: (project) => project.status,
    owner: (project) => project.owner,
  },
  sync: ProjectsRef,
});

export const ProjectWorkItems = Collection.define({
  name: "Project.workItems",
  output: ProjectWorkItemSchema,
  getKey: (workItem: ProjectWorkItem): WorkItemId => workItem.id,
  indexes: {
    byProject: (workItem) => workItem.projectId,
    status: (workItem) => workItem.status,
    owner: (workItem) => workItem.owner,
  },
  policy: {
    retry: Schedule.exponential("50 millis").pipe(Schedule.upTo({ times: 2 })),
  },
  sync: {
    load: () => ProjectApi.use((api) => api.listWorkItems()),
    update: ({ updates }) =>
      Effect.forEach(
        updates,
        (update) =>
          typeof update.changes.status === "string"
            ? ProjectApi.use((api) =>
                api.updateWorkItemStatus({
                  id: update.key as WorkItemId,
                  status: update.changes.status as WorkItemStatus,
                }),
              ).pipe(Effect.asVoid)
            : Effect.void,
        { discard: true },
      ),
  },
});

const priorityWeight = (priority: WorkItemPriority): number => {
  switch (priority) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
};

export interface ProjectWorkQueueItem {
  readonly id: WorkItemId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly title: string;
  readonly owner: string;
  readonly status: WorkItemStatus;
  readonly priority: WorkItemPriority;
  readonly impact: number;
  readonly updatedAt: string;
  readonly synced: boolean;
}

export const projectWorkQueueQuery = (projectId: ProjectId) => (query: Query.Root) =>
  query
    .from({ project: ProjectSummaries })
    .joinIndexed("workItem", ProjectWorkItems, ({ project }) => project.id, "byProject")
    .where(({ project, workItem }) => project.id === projectId && workItem.status !== "done")
    .select(
      ({ project, workItem }): ProjectWorkQueueItem => ({
        id: workItem.id,
        projectId: workItem.projectId,
        projectName: project.name,
        title: workItem.title,
        owner: workItem.owner,
        status: workItem.status,
        priority: workItem.priority,
        impact: workItem.impact,
        updatedAt: workItem.updatedAt,
        synced: workItem.$synced,
      }),
    )
    .orderBy(({ workItem }) => priorityWeight(workItem.priority), "desc")
    .orderBy(({ workItem }) => workItem.impact, "desc");
