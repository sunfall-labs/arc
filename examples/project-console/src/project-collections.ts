import { Action, ActionResult, Server } from "@sunfall/arc-core";
import {
  Collection,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  CollectionSnapshotCodecError,
  Query,
} from "@sunfall/arc-db";
import { Effect, Schedule, Schema } from "effect";
import {
  ProjectApi,
  ProjectNameSubmissionResultSchema,
  ProjectNotFound,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  SubmitProjectNameInput,
  normalizeProjectError,
  projectResourceInvalidations,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectRemoteError,
  type ProjectSummary,
  type ProjectWorkItem,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./domain.js";

export const ProjectSummaries = Collection.define(
  Collection.serverOptions<ProjectSummary, ProjectId, ProjectRemoteError, ProjectApi>({
    id: "Projects.collection",
    output: ProjectSummarySchema,
    getKey: (project) => project.id,
    indexes: {
      status: (project) => project.status,
      owner: (project) => project.owner,
    },
    policy: {
      retry: Schedule.exponential("50 millis").pipe(Schedule.take(2)),
    },
    load: () => ProjectApi.use((api) => api.list()),
    update: ({ updates }) =>
      Effect.forEach(
        updates,
        (update) =>
          typeof update.changes.name === "string"
            ? ProjectApi.use((api) =>
                api.rename({
                  id: update.key,
                  name: update.changes.name as string,
                }),
              ).pipe(Effect.asVoid)
            : Effect.void,
        { discard: true },
      ),
  }),
);

export const ProjectWorkItems = Collection.define(
  Collection.serverOptions<ProjectWorkItem, WorkItemId, ProjectRemoteError, ProjectApi>({
    id: "Project.workItems",
    output: ProjectWorkItemSchema,
    getKey: (workItem) => workItem.id,
    indexes: {
      byProject: (workItem) => workItem.projectId,
      status: (workItem) => workItem.status,
      owner: (workItem) => workItem.owner,
    },
    policy: {
      retry: Schedule.exponential("50 millis").pipe(Schedule.take(2)),
    },
    load: () => ProjectApi.use((api) => api.listWorkItems()),
    update: ({ updates }) =>
      Effect.forEach(
        updates,
        (update) =>
          typeof update.changes.status === "string"
            ? ProjectApi.use((api) =>
                api.updateWorkItemStatus({
                  id: update.key,
                  status: update.changes.status as WorkItemStatus,
                }),
              ).pipe(Effect.asVoid)
            : Effect.void,
        { discard: true },
      ),
  }),
);

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

type ProjectNameSubmissionInput = typeof SubmitProjectNameInput.Type;

const validationMessage = "Use at least three meaningful characters.";

const toProjectNameResultError = (
  input: ProjectNameSubmissionInput,
  error:
    | ProjectRemoteError
    | CollectionRowKeyChanged
    | CollectionRowNotFound
    | CollectionSnapshotCodecError,
): Effect.Effect<
  ProjectNameSubmissionResult,
  Server.ClientError | CollectionSnapshotCodecError
> => {
  const projectError = normalizeProjectError(error);

  if (error instanceof CollectionRowNotFound) {
    return ActionResult.failureEffect(new ProjectNotFound({ id: input.id }));
  }

  if (error instanceof CollectionRowKeyChanged) {
    return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
      fieldErrors: {
        name: ["Project identity cannot be changed from this form."],
      },
      formErrors: [],
      cause: error,
    });
  }

  if (error instanceof CollectionSnapshotCodecError) {
    return Effect.fail(error);
  }

  if (projectError?._tag === "InvalidProjectName") {
    return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
      fieldErrors: {
        name: [validationMessage],
      },
      formErrors: [],
      cause: error,
    });
  }

  if (projectError !== undefined) {
    return ActionResult.failureEffect(projectError);
  }

  return Effect.fail(error as Server.ClientError);
};

export const RenameProjectFromCollection = Action.define({
  name: "Project.collection.rename",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  error: Schema.Unknown,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  run: (input) => {
    const name = input.name.trim();

    if (name.length < 3) {
      return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
        fieldErrors: {
          name: [validationMessage],
        },
        formErrors: [],
      });
    }

    return Effect.gen(function* () {
      yield* ProjectSummaries.preloadEffect();
      yield* ProjectSummaries.updateEffect(input.id, { name });

      if (input.redirectTo) {
        return ActionResult.redirect(input.redirectTo, {
          status: 303,
          replace: true,
          invalidates: projectResourceInvalidations(input.id),
        });
      }

      const project = yield* ProjectApi.use((api) => api.get(input.id));
      return ActionResult.success(project, {
        invalidates: projectResourceInvalidations(input.id),
      });
    }).pipe(
      Effect.catch(
        (
          error:
            | ProjectRemoteError
            | CollectionRowKeyChanged
            | CollectionRowNotFound
            | CollectionSnapshotCodecError,
        ) => toProjectNameResultError(input, error),
      ),
    );
  },
});
