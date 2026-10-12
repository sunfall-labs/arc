import { Component } from "@sunfall/arc-solid";
import { Cause } from "effect";
import { Loading, Show } from "solid-js";
import { ProjectById, type Project, type ProjectId } from "./projects.js";
import { RenameForm } from "./rename.js";

export const ProjectPage = Component.define(
  "ProjectPage",
  function* (props: { readonly id: ProjectId }) {
    // E += ProjectNotFound (the load error), R += ProjectApi (the load service).
    const project = yield* Component.resource(ProjectById);
    const Rename = yield* RenameForm;

    return () => (
      <Loading fallback={<p>Loading project</p>}>
        <article class={{ refreshing: project.waiting(props.id) }}>
          <ProjectHeader project={project(props.id)} />
          <Rename project={project(props.id)} />
        </article>
        <Show when={project.failure(props.id)}>
          {(cause) => <p role="alert">Refresh failed: {Cause.pretty(cause())}</p>}
        </Show>
      </Loading>
    );
  },
).pipe(Component.catchTags({ ProjectNotFound: (error) => <p>No project "{error.id}".</p> }));

// A presentational leaf: a plain Solid function, no Effect cost.
function ProjectHeader(props: { readonly project: Project }) {
  return (
    <header>
      <h1>{props.project.name}</h1>
      <p>{props.project.status}</p>
    </header>
  );
}
