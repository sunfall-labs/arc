// The model db.md's snippets refer to. Type-checked, not shown.
import { Resource } from "@sunfall/arc-core";
import { Context, Effect, Layer, Schema } from "effect";

export const ProjectId = Schema.String;
export type ProjectId = typeof ProjectId.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  status: Schema.Literals(["active", "archived"]),
  progress: Schema.Number,
});
export type Project = typeof Project.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
});
export type Task = typeof Task.Type;

export class ProjectsUnavailable extends Schema.TaggedError<ProjectsUnavailable>()(
  "ProjectsUnavailable",
  {},
) {}

export interface ProjectApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, ProjectsUnavailable>;
  readonly tasks: () => Effect.Effect<ReadonlyArray<Task>>;
  readonly archive: (id: ProjectId) => Effect.Effect<Project, ProjectsUnavailable>;
  readonly create: (name: string) => Effect.Effect<Project, ProjectsUnavailable>;
}
export const ProjectApi = Context.Service<ProjectApi>("ProjectApi");
export declare const ProjectApiLive: Layer.Layer<ProjectApi>;

export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

/** A host change feed: calls back with batches until unsubscribed. */
export declare const feed: {
  readonly onChange: (
    listener: (changes: ReadonlyArray<Resource.RowChange<Project, string>>) => void,
  ) => () => void;
};
