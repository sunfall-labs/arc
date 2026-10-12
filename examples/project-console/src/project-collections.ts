import { Action } from "@sunfall/arc-core";
import { Collection, Query } from "@sunfall/arc-db";
import {
  AdvanceProjectInput,
  ProjectApi,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectsRef,
  SubmitProjectName,
  UpdateWorkItemStatusInput,
  WorkItemsRef,
  WorkItemsTag,
  projectResourceInvalidations,
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
// Actions change the rows: their `optimistic` patches them until they settle.
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
  sync: WorkItemsRef,
});

/**
 * Advances a project. The sidebar row shows the progress bump at once
 * (`$synced: false`); success keeps it until the `Projects` reload lands, and
 * a failure rolls it back.
 *
 * Durable: offline, the advance is queued in the Action Outbox (its bump stays
 * visible, across reloads too) and replays once the browser is back online.
 * The server runs each submission once, keyed by its id.
 */
export const AdvanceProject = Action.define({
  name: "Project.advance",
  input: AdvanceProjectInput,
  output: ProjectSchema,
  policy: {
    concurrency: "exhaust",
  },
  durable: { maxAge: "1 day" },
  optimistic: ({ id }, transaction) =>
    transaction.update(ProjectSummaries, id, (project) => ({
      ...project,
      progress: Math.min(100, project.progress + 8),
    })),
  run: (input) => ProjectApi.use((api) => api.advance(input)),
  invalidates: (project) => projectResourceInvalidations(project.id),
});

/**
 * Actions the Start server serves. The server registers them, and the client
 * runtime's action transport submits them over the network; every other
 * Action (like `MoveWorkItem`) runs locally through the same binding.
 */
export const projectConsoleActions = [SubmitProjectName, AdvanceProject] as const;

/** Moves a work item to `status`, optimistically, then reloads the work items. */
export const MoveWorkItem = Action.define({
  name: "Project.workItem.move",
  input: UpdateWorkItemStatusInput,
  output: ProjectWorkItemSchema,
  optimistic: ({ id, status }, transaction) => transaction.update(ProjectWorkItems, id, { status }),
  run: (input) => ProjectApi.use((api) => api.updateWorkItemStatus(input)),
  invalidates: () => [WorkItemsTag],
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
