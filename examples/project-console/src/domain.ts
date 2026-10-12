import { Action, ActionResult, Resource } from "@sunfall/arc-core";
import { StartAction } from "@sunfall/arc-start";
import { Effect, Schedule, Schema, Stream } from "effect";
import {
  ProjectErrorSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectId as ProjectIdSchema,
  SubmitProjectNameInput,
  type ProjectError,
  type ProjectId as ProjectIdType,
  type ProjectReturnTo,
  type ProjectRouteParams as ProjectRouteParamsType,
} from "./model.js";

export {
  AdvanceProjectInput,
  InvalidProjectName,
  ProjectErrorSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectWorkItemSchema,
  ProjectNotFound,
  SubmitProjectNameInput,
  UpdateWorkItemStatusInput,
  WorkItemNotFound,
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  type Project,
  type ProjectError,
  type ProjectHealth,
  type ProjectId,
  type ProjectReturnTo,
  type ProjectStatus,
  type ProjectTab,
  type ProjectSummary,
  type ProjectWorkItem,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemStatus,
} from "./model.js";

export {
  ProjectRouteParams as ProjectRouteParamsSchema,
  ProjectRouteSearch as ProjectRouteSearchSchema,
  type ProjectRouteParams,
  type ProjectRouteSearch,
} from "./model.js";

export {
  formatProjectError,
  isInvalidProjectName,
  normalizeProjectError,
} from "./project-error.js";

/*
 * The console's reads are served Resources and its writes served Actions:
 * declared here and in `project-actions.ts` (browser-safe: schemas, rows,
 * tags, optimistic patches) and run on the server by their implementations in
 * `domain.server.ts`. Resources load in-process during SSR and over RPC in the
 * browser; the browser submits Actions over the action transport, and a form
 * without JavaScript posts the same Action.
 */

export interface PresenceEvent {
  readonly activeUsers: number;
  readonly build: "queued" | "running" | "passed";
  readonly latency: number;
}

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
  error: ProjectErrorSchema,
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
  provides: () => [WorkItemsTag],
  policy: {
    retry: Schedule.exponential("50 millis").pipe(Schedule.upTo({ times: 2 })),
  },
});

export const WorkItemsRef = ProjectWorkItemList("all");

export const preloadProjectsEffect = Resource.preload(ProjectsRef);

export const preloadProjectRouteEffect = (
  params: ProjectRouteParamsType,
): Effect.Effect<void, ProjectError> =>
  Effect.asVoid(Resource.preload([ProjectsRef, ProjectById(params.id)]));

/** What a rename answers: the renamed project, a redirect, or the form's validation failure. */
export const ProjectNameSubmissionResult = Schema.Union([
  ProjectSchema,
  ActionResult.Redirect,
  ActionResult.ValidationFailure,
]);
export type ProjectNameSubmissionResult = typeof ProjectNameSubmissionResult.Type;

/**
 * Renames a project. A too-short name answers a validation failure; a
 * missing project is a typed failure.
 */
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResult,
  error: ProjectErrorSchema,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  // Durable, like the advance: the submission is pending in the Action Outbox
  // until it settles, which is what the sidebar's "Saving" badge reads.
  durable: { maxAge: "1 day" },
  // The sidebar row and the project page show the new name at once; a failure
  // or a validation failure rolls both back.
  optimistic: ({ id, name }, transaction) =>
    Effect.all([
      transaction.update(ProjectsRef, id, { name }),
      transaction.set(ProjectById(id), (project) => ({ ...project, name })),
    ]),
  // A validation failure changed nothing, so these reload only after a rename
  // that happened.
  invalidates: (_result, input) => projectResourceInvalidations(input.id),
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
