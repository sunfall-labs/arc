import { Capability, Resource } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  status: Schema.Literals(["active", "archived"]),
});
export type Project = typeof Project.Type;

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId,
}) {}

// The service boundary. Resources and Actions depend on it; Layers implement it.
export interface ProjectApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectNotFound>;
}
export const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

// Semantic tags: Resources provide them, Actions invalidate them.
export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");

export const ProjectById = Resource.define({
  name: "Projects.byId",
  input: ProjectId,
  output: Project,
  // The typed failure: a failed read renders it with its fields, also across SSR.
  error: ProjectNotFound,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
