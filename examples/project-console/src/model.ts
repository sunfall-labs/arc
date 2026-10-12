import { Schema } from "effect";

/*
 * The console's domain schemas and errors: browser-safe, shared by the served
 * Resources and Actions (`domain.ts`, `project-actions.ts`) and their server
 * implementations (`domain.server.ts`).
 */

export const ProjectStatus = Schema.Literals(["tracking", "watch", "blocked"]);
export const ProjectHealth = Schema.Literals(["green", "amber", "red"]);
export const ProjectTab = Schema.Literals(["overview", "activity", "tasks", "settings"]);
export const WorkItemStatus = Schema.Literals(["queued", "running", "blocked", "done"]);
export const WorkItemPriority = Schema.Literals(["low", "medium", "high"]);
export const ProjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  Schema.brand("ProjectId"),
);
export const WorkItemId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  Schema.brand("WorkItemId"),
);
export const ProjectReturnTo = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\/projects\/[a-z0-9-]+(?:\?tab=(?:overview|activity|tasks|settings))?$/),
  ),
  Schema.brand("ProjectReturnTo"),
);

export type ProjectStatus = "tracking" | "watch" | "blocked";
export type ProjectHealth = "green" | "amber" | "red";
export type ProjectTab = "overview" | "activity" | "tasks" | "settings";
export type WorkItemStatus = "queued" | "running" | "blocked" | "done";
export type WorkItemPriority = "low" | "medium" | "high";
export type ProjectId = typeof ProjectId.Type;
export type WorkItemId = typeof WorkItemId.Type;
export type ProjectReturnTo = typeof ProjectReturnTo.Type;

export const makeProjectId = (id: string): ProjectId => Schema.decodeUnknownSync(ProjectId)(id);

export const makeWorkItemId = (id: string): WorkItemId => Schema.decodeUnknownSync(WorkItemId)(id);

export const makeProjectReturnTo = (href: string): ProjectReturnTo =>
  Schema.decodeUnknownSync(ProjectReturnTo)(href);

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly owner: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly progress: number;
  readonly spend: number;
}

export interface Project extends ProjectSummary {
  readonly goal: string;
  readonly nextMilestone: string;
  readonly updatedAt: string;
  readonly risks: ReadonlyArray<string>;
}

export interface ProjectWorkItem {
  readonly id: WorkItemId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly owner: string;
  readonly status: WorkItemStatus;
  readonly priority: WorkItemPriority;
  readonly impact: number;
  readonly updatedAt: string;
}

export const ProjectRouteParams = Schema.Struct({
  id: ProjectId,
});

export const ProjectRouteSearch = Schema.Struct({
  tab: Schema.optional(ProjectTab),
});

export type ProjectRouteParams = typeof ProjectRouteParams.Type;
export type ProjectRouteSearch = typeof ProjectRouteSearch.Type;

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId,
}) {}

export class InvalidProjectName extends Schema.TaggedError<InvalidProjectName>()(
  "InvalidProjectName",
  {
    name: Schema.String,
  },
) {}

export class WorkItemNotFound extends Schema.TaggedError<WorkItemNotFound>()("WorkItemNotFound", {
  id: WorkItemId,
}) {}

export type ProjectError = ProjectNotFound | InvalidProjectName | WorkItemNotFound;

export const ProjectErrorSchema = Schema.Union([
  ProjectNotFound,
  InvalidProjectName,
  WorkItemNotFound,
]);

export const ProjectSummarySchema = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  owner: Schema.String,
  status: ProjectStatus,
  health: ProjectHealth,
  progress: Schema.Number,
  spend: Schema.Number,
});

export const ProjectSchema = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  owner: Schema.String,
  status: ProjectStatus,
  health: ProjectHealth,
  progress: Schema.Number,
  spend: Schema.Number,
  goal: Schema.String,
  nextMilestone: Schema.String,
  updatedAt: Schema.String,
  risks: Schema.Array(Schema.String),
});

export const ProjectWorkItemSchema = Schema.Struct({
  id: WorkItemId,
  projectId: ProjectId,
  title: Schema.String,
  owner: Schema.String,
  status: WorkItemStatus,
  priority: WorkItemPriority,
  impact: Schema.Number,
  updatedAt: Schema.String,
});

export const SubmitProjectNameInput = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  redirectTo: Schema.optional(ProjectReturnTo),
});

export const AdvanceProjectInput = Schema.Struct({
  id: ProjectId,
});

export const UpdateWorkItemStatusInput = Schema.Struct({
  id: WorkItemId,
  status: WorkItemStatus,
});

export type SubmitProjectNameInput = typeof SubmitProjectNameInput.Type;
