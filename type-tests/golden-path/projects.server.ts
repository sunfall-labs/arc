import { Resource } from "@sunfall/arc-core";
import { Context, Effect } from "effect";
import {
  ProjectById,
  ProjectList,
  type Project,
  type ProjectId,
  ProjectNotFound,
} from "./projects.js";

// The server's data access: an Effect service the server Layer provides (a
// database client in a real app). It never reaches the browser bundle.
export interface ProjectStore {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectNotFound>;
}
export const ProjectStore = Context.Service<ProjectStore>("ProjectStore");

// The loads: each may succeed only with its Resource's `output` and fail only
// with its `error`.
export const projectList = Resource.implement(ProjectList, () =>
  ProjectStore.use((store) => store.list()),
);
export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);
