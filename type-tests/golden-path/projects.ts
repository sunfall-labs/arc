import { Resource } from "@sunfall/arc-core";
import { Schema } from "effect";

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

// Semantic tags: Resources provide them, Actions invalidate them.
export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

// No `load`: the server loads these (`projects.server.ts`). The schemas are
// the wire contract between the two.
export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  // The list's rows: keyed by id, indexed by status. Readers look rows up by
  // key or index, and an Action patches one row by key.
  rows: { key: (project) => project.id, indexes: { status: (project) => project.status } },
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");

export const ProjectById = Resource.define({
  name: "Projects.byId",
  input: ProjectId,
  output: Project,
  // The typed failure: a failed read renders it with its fields, also across SSR.
  error: ProjectNotFound,
  provides: (project) => [ProjectTag({ id: project.id })],
});
