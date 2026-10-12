import { Server } from "@sunfall/arc-core";
import { Effect, Layer } from "effect";
import { ProjectId, ProjectNotFound, type Project } from "./projects.js";
import { ProjectStore, projectById, projectList } from "./projects.server.js";

// An in-memory store, enough to run everything in this guide.
const seed: ReadonlyArray<Project> = [
  { id: ProjectId.make("atlas"), name: "Atlas", status: "active" },
  { id: ProjectId.make("orion"), name: "Orion", status: "archived" },
];
const rows = new Map(seed.map((project) => [project.id, project] as const));
const find = (id: ProjectId): Effect.Effect<Project, ProjectNotFound> => {
  const project = rows.get(id);
  return project === undefined ? Effect.fail(new ProjectNotFound({ id })) : Effect.succeed(project);
};

export const ProjectStoreMemory = Layer.succeed(ProjectStore, {
  list: () => Effect.sync(() => [...rows.values()]),
  get: find,
  rename: ({ id, name }) =>
    find(id).pipe(
      Effect.map((project) => ({ ...project, name })),
      Effect.tap((project) => Effect.sync(() => rows.set(id, project))),
    ),
});

// For tests: answers the served Resources' loads in-process, over the memory store.
export const ProjectsServerMemory = Layer.merge(
  Server.mockLayer(projectList, projectById),
  ProjectStoreMemory,
);
