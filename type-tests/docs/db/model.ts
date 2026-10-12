// The model db.md's snippets refer to. Type-checked, not shown.
import { Capability, Resource, Server } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Effect, Layer, Schema } from "effect";

export const ProjectId = Schema.String;
export type ProjectId = typeof ProjectId.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  status: Schema.Literals(["active", "archived"]),
  progress: Schema.Number,
});
export type Project = typeof Project.Type;
export const ProjectSchema = Project;

export interface Task {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
}

export class ProjectsUnavailable extends Schema.TaggedError<ProjectsUnavailable>()(
  "ProjectsUnavailable",
  {},
) {}

export interface ProjectApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, ProjectsUnavailable>;
  readonly archive: (id: ProjectId) => Effect.Effect<Project, ProjectsUnavailable>;
}
export const ProjectApi = Capability.define<ProjectApi>("ProjectApi");
export declare const ProjectApiLive: Layer.Layer<ProjectApi>;

export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const Projects = Collection.define({
  name: "Projects",
  output: Project,
  getKey: (project) => project.id,
  sync: { load: () => ProjectApi.use((api) => api.list()) },
});

export const listProjects = Server.implement(
  Server.contract<void, ReadonlyArray<Project>>("docs/db/list-projects"),
  () => Effect.succeed([]),
);

/** A host change feed: calls back with batches until unsubscribed. */
export declare const feed: {
  readonly onChange: (
    listener: (changes: ReadonlyArray<Collection.Change<Project, string>>) => void,
  ) => () => void;
};
