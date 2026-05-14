import { Server, type ActionResult } from "@effect-ui/core";
import { Schema } from "effect";

export const ProjectStatus = Schema.Literals(["tracking", "watch", "blocked"]);
export const ProjectHealth = Schema.Literals(["green", "amber", "red"]);
export const ProjectTab = Schema.Literals(["overview", "activity", "settings"]);
export const ProjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  Schema.brand("ProjectId")
);
export const ProjectReturnTo = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\/projects\/[a-z0-9-]+(?:\?tab=(?:overview|activity|settings))?$/)
  ),
  Schema.brand("ProjectReturnTo")
);

export type ProjectStatus = "tracking" | "watch" | "blocked";
export type ProjectHealth = "green" | "amber" | "red";
export type ProjectTab = "overview" | "activity" | "settings";
export type ProjectId = typeof ProjectId.Type;
export type ProjectReturnTo = typeof ProjectReturnTo.Type;

export const makeProjectId = (id: string): ProjectId =>
  Schema.decodeUnknownSync(ProjectId)(id);

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

export const ProjectRouteParams = Schema.Struct({
  id: ProjectId
});

export const ProjectRouteSearch = Schema.Struct({
  tab: Schema.optional(ProjectTab)
});

export type ProjectRouteParams = typeof ProjectRouteParams.Type;
export type ProjectRouteSearch = typeof ProjectRouteSearch.Type;

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId
}) {}

export class InvalidProjectName extends Schema.TaggedErrorClass<InvalidProjectName>()("InvalidProjectName", {
  name: Schema.String
}) {}

export type ProjectError = ProjectNotFound | InvalidProjectName;
export type ProjectRemoteError = ProjectError | Server.ClientError;

export const ProjectErrorSchema = Schema.Union([ProjectNotFound, InvalidProjectName]);

export const ProjectSummarySchema = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  owner: Schema.String,
  status: ProjectStatus,
  health: ProjectHealth,
  progress: Schema.Number,
  spend: Schema.Number
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
  risks: Schema.Array(Schema.String)
});

export const RenameProjectInput = Schema.Struct({
  id: ProjectId,
  name: Schema.String
});

export const SubmitProjectNameInput = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  redirectTo: Schema.optional(ProjectReturnTo)
});

export const AdvanceProjectInput = Schema.Struct({
  id: ProjectId
});

export type SubmitProjectNameInput = typeof SubmitProjectNameInput.Type;
export type ProjectNameSubmissionResult = ActionResult<
  Project,
  SubmitProjectNameInput,
  string,
  ProjectError
>;

export const ProjectNameSubmissionResultSchema = Schema.TaggedUnion({
  Success: {
    value: ProjectSchema
  },
  ValidationFailure: {
    fieldErrors: Schema.Struct({
      name: Schema.optional(Schema.Array(Schema.String))
    }),
    formErrors: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Unknown)
  },
  Redirect: {
    location: Schema.String,
    status: Schema.Number,
    replace: Schema.optional(Schema.Boolean)
  },
  Failure: {
    error: ProjectErrorSchema
  }
});

export const ListProjectsContract = Server.contract<"all", ProjectSummary[], never>("Project.list", {
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSummarySchema),
  error: Schema.Never
});

export const GetProjectContract = Server.contract<{ readonly id: ProjectId }, Project, ProjectError>("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: ProjectSchema,
  error: ProjectErrorSchema
});

export const RenameProjectContract = Server.contract<
  { readonly id: ProjectId; readonly name: string },
  Project,
  ProjectError
>("Project.rename", {
  input: RenameProjectInput,
  output: ProjectSchema,
  error: ProjectErrorSchema
});

export const SubmitProjectNameContract = Server.contract<
  SubmitProjectNameInput,
  ProjectNameSubmissionResult,
  never
>("Project.name.submit", {
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  error: Schema.Never
});

export const AdvanceProjectContract = Server.contract<{ readonly id: ProjectId }, Project, ProjectError>("Project.advance", {
  input: AdvanceProjectInput,
  output: ProjectSchema,
  error: ProjectErrorSchema
});

export const listProjects = Server.client(ListProjectsContract);
export const getProject = Server.client(GetProjectContract);
export const renameProject = Server.client(RenameProjectContract);
export const submitProjectName = Server.client(SubmitProjectNameContract);
export const advanceProject = Server.client(AdvanceProjectContract);
