import { Resource } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { Project, ProjectApi, ProjectTag, ProjectsRef, type ProjectId } from "./projects.js";

// The same Resource-backed collection, spelled inline so it can commit writes.
export const Projects = Collection.define({
  name: "Projects.rows",
  output: Project,
  getKey: (project) => project.id,
  indexes: { status: (project) => project.status },
  sync: {
    load: () => Resource.preload(ProjectsRef),
    refresh: () => Resource.refresh(ProjectsRef),
    follow: () => Resource.changes(ProjectsRef),
    // Runs after the optimistic write; a failure rolls the row back.
    update: ({ updates }) =>
      Effect.forEach(updates, ({ key, value }) =>
        ProjectApi.use((api) => api.rename({ id: key, name: value.name })).pipe(
          Effect.andThen(Resource.invalidate(ProjectTag({ id: key }))),
        ),
      ),
  },
});

export const QuickRename = Component.define(
  "QuickRename",
  function* (props: { readonly id: ProjectId }) {
    // The row changes now (`$synced: false`) and settles when `update` commits.
    const rename = yield* Component.callback((name: string) =>
      Projects.update(props.id, { name }).pipe(Effect.ignore),
    );
    return () => <input onChange={(event) => rename(event.currentTarget.value)} />;
  },
);
