import { Component } from "@sunfall/arc-solid";
import { SolidDb } from "@sunfall/arc-solid-db";
import { Cause, Effect } from "effect";
import { For, Show } from "solid-js";
import { ArchiveProject } from "./writes.js";
import { Projects, type Project, type ProjectId, type ProjectsUnavailable } from "./model.js";

const ProjectRow = (props: { readonly project: Project; readonly onArchive: () => void }) => (
  <li>
    {props.project.name} <button onClick={props.onArchive}>Archive</button>
  </li>
);
const ProjectError = (props: { readonly cause: Cause.Cause<ProjectsUnavailable> }) => (
  <p role="alert">{Cause.pretty(props.cause)}</p>
);

// #region component
const ProjectList = Component.define("ProjectList", function* () {
  const projects = yield* SolidDb.collection(Projects); // E += the load error
  const archive = yield* Component.action(ArchiveProject);
  const onArchive = yield* Component.callback("archive", (id: ProjectId) =>
    archive.submit({ id }).pipe(Effect.ignore),
  );

  // Rows are their own signal: render them once, keyed by id, and let
  // `waiting` and `failure` drive only the status chrome around them.
  return () => (
    <>
      <For each={projects.rows()} keyed={(project) => project.id}>
        {(project) => <ProjectRow project={project()} onArchive={() => onArchive(project().id)} />}
      </For>
      <Show when={projects.waiting()}>
        <p class="status">Refreshing</p>
      </Show>
      <Show when={projects.failure()}>{(cause) => <ProjectError cause={cause()} />}</Show>
    </>
  );
}).pipe(Component.catchTags({ ProjectsUnavailable: () => <p>Projects are unavailable.</p> }));
// #endregion

export { ProjectList };
