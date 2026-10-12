import { Action, ActionResult, Capability, Resource, Server } from "@sunfall/arc-core";
import { StartAction } from "@sunfall/arc-start";
import { Effect, Schedule, Schema, Stream } from "effect";
import {
  AdvanceProjectInput,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectId as ProjectIdSchema,
  ProjectNameSubmissionResultSchema,
  SubmitProjectNameInput,
  UpdateWorkItemStatusInput,
  advanceProject,
  getProject,
  listProjectWorkItems,
  listProjects,
  submitProjectName,
  updateWorkItemStatus,
  type Project,
  type ProjectId as ProjectIdType,
  type ProjectNameSubmissionResult,
  type ProjectReturnTo,
  type ProjectRemoteError,
  type ProjectRouteParams as ProjectRouteParamsType,
  type ProjectSummary,
  type ProjectWorkItem,
} from "./domain.contract.js";

export {
  AdvanceProjectInput,
  InvalidProjectName,
  ListProjectWorkItemsContract,
  ProjectErrorSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectNotFound,
  ProjectNameSubmissionResultSchema,
  SubmitProjectNameInput,
  UpdateWorkItemStatusInput,
  WorkItemNotFound,
  advanceProject,
  getProject,
  listProjectWorkItems,
  listProjects,
  submitProjectName,
  updateWorkItemStatus,
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  type Project,
  type ProjectError,
  type ProjectHealth,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectReturnTo,
  type ProjectRemoteError,
  type ProjectStatus,
  type ProjectTab,
  type ProjectSummary,
  type ProjectWorkItem,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./domain.contract.js";

export {
  ProjectRouteParams as ProjectRouteParamsSchema,
  ProjectRouteSearch as ProjectRouteSearchSchema,
  type ProjectRouteParams,
  type ProjectRouteSearch,
} from "./domain.contract.js";

export {
  formatProjectError,
  isInvalidProjectName,
  normalizeProjectError,
} from "./project-error.js";

export interface PresenceEvent {
  readonly activeUsers: number;
  readonly build: "queued" | "running" | "passed";
  readonly latency: number;
}

export interface ProjectApi {
  readonly list: () => Effect.Effect<ProjectSummary[], Server.ClientError>;
  readonly listWorkItems: () => Effect.Effect<ProjectWorkItem[], Server.ClientError>;
  readonly get: (id: ProjectIdType) => Effect.Effect<Project, ProjectRemoteError>;
  readonly submitName: (
    input: typeof SubmitProjectNameInput.Type,
  ) => Effect.Effect<ProjectNameSubmissionResult, Server.ClientError>;
  readonly advance: (
    input: typeof AdvanceProjectInput.Type,
  ) => Effect.Effect<Project, ProjectRemoteError>;
  readonly updateWorkItemStatus: (
    input: typeof UpdateWorkItemStatusInput.Type,
  ) => Effect.Effect<ProjectWorkItem, ProjectRemoteError>;
}

export const ProjectApi = Capability.define<ProjectApi>(
  "@sunfall/arc-example-project-console/ProjectApi",
);

export const normalizeProjectNameSubmissionResult = (
  result: ProjectNameSubmissionResult,
): ProjectNameSubmissionResult => {
  switch (result._tag) {
    case "Success":
      return ActionResult.success(result.value);
    case "ValidationFailure":
      return ActionResult.validation<typeof SubmitProjectNameInput.Type, string>({
        fieldErrors: result.fieldErrors,
        formErrors: result.formErrors,
        cause: result.cause,
      });
    case "Redirect":
      return ActionResult.redirect(result.location, {
        status: result.status,
        ...(result.replace === undefined ? {} : { replace: result.replace }),
      });
    case "Failure":
      return ActionResult.failure(result.error);
  }
};

export const ProjectApiLive = ProjectApi.layer({
  list: () => listProjects.effect("all"),
  listWorkItems: () => listProjectWorkItems.effect("all"),
  get: (id) => getProject.effect({ id }),
  submitName: (input) =>
    submitProjectName.effect(input).pipe(Effect.map(normalizeProjectNameSubmissionResult)),
  advance: advanceProject.effect,
  updateWorkItemStatus: updateWorkItemStatus.effect,
});

export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectIdType }>("Project", {
  key: ({ id }) => id,
});

export const projectResourceInvalidations = (
  id: ProjectIdType,
): readonly Resource.Invalidation[] => [ProjectsTag, ProjectTag({ id })];

export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSummarySchema),
  // The sidebar's rows: looked up by id, status, or owner, and patched by key.
  rows: {
    key: (project) => project.id,
    indexes: {
      status: (project) => project.status,
      owner: (project) => project.owner,
    },
  },
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
  policy: {
    staleFor: "20 seconds",
    gcFor: "5 minutes",
    retry: Schedule.exponential("50 millis").pipe(Schedule.upTo({ times: 2 })),
  },
});

export const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectIdSchema,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
  policy: {
    staleFor: "20 seconds",
    gcFor: "5 minutes",
    retry: Schedule.exponential("50 millis").pipe(Schedule.upTo({ times: 2 })),
  },
});

export const ProjectsRef = ProjectList("all");

export const WorkItemsTag = Resource.tag("WorkItems");

export const ProjectWorkItemList = Resource.define({
  name: "Project.workItems.list",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectWorkItemSchema),
  rows: {
    key: (workItem) => workItem.id,
    indexes: {
      byProject: (workItem) => workItem.projectId,
      status: (workItem) => workItem.status,
      owner: (workItem) => workItem.owner,
    },
  },
  load: () => ProjectApi.use((api) => api.listWorkItems()),
  provides: () => [WorkItemsTag],
  policy: {
    retry: Schedule.exponential("50 millis").pipe(Schedule.upTo({ times: 2 })),
  },
});

export const WorkItemsRef = ProjectWorkItemList("all");

export const preloadProjectsEffect = Resource.preload(ProjectsRef);

export const preloadProjectRouteEffect = (
  params: ProjectRouteParamsType,
): Effect.Effect<void, ProjectRemoteError, ProjectApi> =>
  Effect.asVoid(Resource.preload([ProjectsRef, ProjectById(params.id)]));

export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  error: Schema.Unknown,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  // The sidebar row and the project page show the new name at once; a failure
  // or a rejected result (`ValidationFailure`, `Failure`) rolls both back.
  optimistic: ({ id, name }, transaction) =>
    Effect.all([
      transaction.update(ProjectsRef, id, { name }),
      transaction.set(ProjectById(id), (project) => ({ ...project, name })),
    ]),
  run: (input) => ProjectApi.use((api) => api.submitName(input)),
  invalidates: (result, input) =>
    result._tag === "ValidationFailure" || result._tag === "Failure"
      ? []
      : projectResourceInvalidations(input.id),
});

export const projectNameActionTarget = (input: {
  readonly id: ProjectIdType;
  readonly redirectTo?: ProjectReturnTo;
}): StartAction.Form<typeof SubmitProjectName> => StartAction.form(SubmitProjectName, { input });

const presenceEvent = (tick: number): PresenceEvent => ({
  activeUsers: 4 + (tick % 4),
  build: tick % 6 === 0 ? "queued" : tick % 3 === 0 ? "running" : "passed",
  latency: 28 + ((tick * 7) % 23),
});

export const makePresenceStream = (): Stream.Stream<PresenceEvent> =>
  Stream.tick("2400 millis").pipe(Stream.map((_, tick) => presenceEvent(tick)));
