import { Action } from "@sunfall/arc-core";
import type { Query } from "@sunfall/arc-db";
import { Effect } from "effect";
import {
  AdvanceProjectInput,
  ProjectById,
  ProjectErrorSchema,
  ProjectSchema,
  ProjectWorkItemSchema,
  ProjectsRef,
  UpdateWorkItemStatusInput,
  WorkItemsRef,
  WorkItemsTag,
  projectResourceInvalidations,
  type ProjectId,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./domain.js";

/**
 * Advances a project. The sidebar row and the project page show the progress
 * bump at once; success keeps it until the `Projects` and
 * `Project` reloads land, and a failure rolls it back.
 *
 * Durable: offline, the advance is queued in the Action Outbox (its bump stays
 * visible, across reloads too) and replays once the browser is back online.
 * The server runs each submission once, keyed by its id.
 */
export const AdvanceProject = Action.define({
  name: "Project.advance",
  input: AdvanceProjectInput,
  output: ProjectSchema,
  error: ProjectErrorSchema,
  policy: {
    concurrency: "exhaust",
  },
  durable: { maxAge: "1 day" },
  optimistic: ({ id }, transaction) =>
    Effect.all([
      transaction.update(ProjectsRef, id, (project) => ({
        ...project,
        progress: Math.min(100, project.progress + 8),
      })),
      transaction.set(ProjectById(id), (project) => ({
        ...project,
        progress: Math.min(100, project.progress + 8),
      })),
    ]),
  invalidates: (project) => projectResourceInvalidations(project.id),
});

/** Moves a work item to `status`, optimistically, then reloads the work items. */
export const MoveWorkItem = Action.define({
  name: "Project.workItem.move",
  input: UpdateWorkItemStatusInput,
  output: ProjectWorkItemSchema,
  error: ProjectErrorSchema,
  optimistic: ({ id, status }, transaction) => transaction.update(WorkItemsRef, id, { status }),
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
}

export const projectWorkQueueQuery = (projectId: ProjectId) => (query: Query.Root) =>
  query
    .from({ project: ProjectsRef })
    .joinIndexed("workItem", WorkItemsRef, ({ project }) => project.id, "byProject")
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
      }),
    )
    .orderBy(({ workItem }) => priorityWeight(workItem.priority), "desc")
    .orderBy(({ workItem }) => workItem.impact, "desc");
