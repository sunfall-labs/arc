import { Action, ActionResult, Capability, Resource, Server, Signal } from "@effect-ui/core";
import { StartAction, type StartActionForm } from "@effect-ui/start";
import { Effect, Schedule, Schema, Stream } from "effect";
import {
  AdvanceProjectInput,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectId as ProjectIdSchema,
  ProjectNameSubmissionResultSchema,
  RenameProjectInput,
  SubmitProjectNameInput,
  advanceProject,
  getProject,
  listProjects,
  renameProject,
  submitProjectName,
  type Project,
  type ProjectId as ProjectIdType,
  type ProjectNameSubmissionResult,
  type ProjectReturnTo,
  type ProjectRemoteError,
  type ProjectRouteParams as ProjectRouteParamsType,
  type ProjectSummary,
} from "./domain.contract.js";

export {
  AdvanceProjectInput,
  InvalidProjectName,
  ProjectErrorSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectNotFound,
  ProjectNameSubmissionResultSchema,
  RenameProjectInput,
  SubmitProjectNameInput,
  advanceProject,
  getProject,
  listProjects,
  renameProject,
  submitProjectName,
  makeProjectId,
  makeProjectReturnTo,
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
  readonly get: (id: ProjectIdType) => Effect.Effect<Project, ProjectRemoteError>;
  readonly rename: (
    input: typeof RenameProjectInput.Type,
  ) => Effect.Effect<Project, ProjectRemoteError>;
  readonly submitName: (
    input: typeof SubmitProjectNameInput.Type,
  ) => Effect.Effect<ProjectNameSubmissionResult, Server.ClientError>;
  readonly advance: (
    input: typeof AdvanceProjectInput.Type,
  ) => Effect.Effect<Project, ProjectRemoteError>;
}

export const ProjectApi = Capability.define<ProjectApi>(
  "@effect-ui/example-project-console/ProjectApi",
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
  get: (id) => getProject.effect({ id }),
  rename: renameProject.effect,
  submitName: (input) =>
    submitProjectName.effect(input).pipe(Effect.map(normalizeProjectNameSubmissionResult)),
  advance: advanceProject.effect,
});

export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectIdType }>("Project", {
  key: ({ id }) => id,
});

export const projectResourceInvalidations = (
  id: ProjectIdType,
): readonly Resource.Invalidation[] => [ProjectsTag, ProjectTag({ id })];

export const ProjectList = Resource.family({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSummarySchema),
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
  policy: {
    staleFor: "20 seconds",
    gcFor: "5 minutes",
    retry: Schedule.exponential("50 millis").pipe(Schedule.take(2)),
  },
});

export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectIdSchema,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
  policy: {
    staleFor: "20 seconds",
    gcFor: "5 minutes",
    retry: Schedule.exponential("50 millis").pipe(Schedule.take(2)),
  },
});

export const ProjectsRef = ProjectList("all");

export const preloadProjectsEffect = Resource.prefetchEffect(ProjectsRef);

export const preloadProjectRouteEffect = (
  params: ProjectRouteParamsType,
): Effect.Effect<void, ProjectRemoteError, ProjectApi> =>
  Effect.asVoid(
    Effect.all([
      Resource.prefetchEffect(ProjectsRef),
      Resource.prefetchEffect(ProjectById(params.id)),
    ]),
  );

export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => projectResourceInvalidations(project.id),
});

export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  error: Schema.Unknown,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  run: (input) => ProjectApi.use((api) => api.submitName(input)),
  invalidates: (result, input) =>
    result._tag === "ValidationFailure" || result._tag === "Failure"
      ? []
      : projectResourceInvalidations(input.id),
});

export const AdvanceProject = Action.define({
  name: "Project.advance",
  input: AdvanceProjectInput,
  output: ProjectSchema,
  policy: {
    concurrency: "exhaust",
  },
  run: (input) => ProjectApi.use((api) => api.advance(input)),
  invalidates: (project) => projectResourceInvalidations(project.id),
});

export const projectNameActionTarget = (input: {
  readonly id: ProjectIdType;
  readonly redirectTo?: ProjectReturnTo;
}): StartActionForm => StartAction.form(SubmitProjectName, { input });

export const projectSearch = Signal.make("");

const presenceEvent = (tick: number): PresenceEvent => ({
  activeUsers: 4 + (tick % 4),
  build: tick % 6 === 0 ? "queued" : tick % 3 === 0 ? "running" : "passed",
  latency: 28 + ((tick * 7) % 23),
});

export const makePresenceStream = (): Stream.Stream<PresenceEvent> =>
  Stream.tick("2400 millis").pipe(Stream.map((_, tick) => presenceEvent(tick)));
