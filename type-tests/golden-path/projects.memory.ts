import { Effect } from "effect";
import { ProjectApi, ProjectId, ProjectNotFound, type Project } from "./projects.js";

// An in-memory implementation, enough to run everything in this guide.
const seed: ReadonlyArray<Project> = [
  { id: ProjectId.make("atlas"), name: "Atlas", status: "active" },
  { id: ProjectId.make("orion"), name: "Orion", status: "archived" },
];
const rows = new Map(seed.map((project) => [project.id, project] as const));
const find = (id: ProjectId): Effect.Effect<Project, ProjectNotFound> => {
  const project = rows.get(id);
  return project === undefined ? Effect.fail(new ProjectNotFound({ id })) : Effect.succeed(project);
};

export const ProjectApiMemory = ProjectApi.layer({
  list: () => Effect.sync(() => [...rows.values()]),
  get: find,
  rename: ({ id, name }) =>
    find(id).pipe(
      Effect.map((project) => ({ ...project, name })),
      Effect.tap((project) => Effect.sync(() => rows.set(id, project))),
    ),
});
