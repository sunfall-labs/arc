import { Component } from "@sunfall/arc-solid";
import { Cause, Effect } from "effect";
import { For, Loading, Show } from "solid-js";
import { type Project, type ProjectId, type ProjectsUnavailable } from "./model.js";
import { ProjectList, ProjectsRef, TasksRef } from "./rows.js";
import { ArchiveProject } from "./writes.js";

const ProjectRow = (props: { readonly project: Project; readonly onArchive: () => void }) => (
  <li>
    {props.project.name} <button onClick={props.onArchive}>Archive</button>
  </li>
);
const ProjectError = (props: { readonly cause: Cause.Cause<ProjectsUnavailable> }) => (
  <p role="alert">{Cause.pretty(props.cause)}</p>
);

// #region component
const ActiveProjects = Component.define("ActiveProjects", function* () {
  const projects = yield* Component.resource(ProjectList); // E += ProjectsUnavailable
  const archive = yield* Component.action(ArchiveProject);
  const onArchive = yield* Component.callback("archive", (id: ProjectId) =>
    archive.submit({ id }).pipe(Effect.ignore),
  );

  // `index` reads like `projects("all")`: it suspends `<Loading>` on the first
  // load only, then follows reloads and optimistic row patches.
  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <ul class={{ refreshing: projects.waiting("all") }}>
        <For each={projects.index("all", "status", "active")} keyed={(project) => project.id}>
          {(project) => (
            <ProjectRow project={project()} onArchive={() => onArchive(project().id)} />
          )}
        </For>
      </ul>
      <Show when={projects.failure("all")}>{(cause) => <ProjectError cause={cause()} />}</Show>
    </Loading>
  );
}).pipe(Component.catchTags({ ProjectsUnavailable: () => <p>Projects are unavailable.</p> }));
// #endregion

// #region live-query
const ProjectTaskTitles = Component.define(
  "ProjectTaskTitles",
  function* (props: { readonly projectId: ProjectId }) {
    // The factory runs tracked: reading `props.projectId` rebuilds the query.
    const titles = yield* Component.liveQuery((query) =>
      query
        .from({ project: ProjectsRef })
        .where(({ project }) => project.id === props.projectId)
        .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
        .orderBy(({ task }) => task.title)
        .select(({ task }) => task.title),
    );

    return () => (
      <ul class={{ refreshing: titles.waiting() }}>
        <For each={titles.rows()}>{(title) => <li>{title}</li>}</For>
      </ul>
    );
  },
).pipe(Component.catchTags({ ProjectsUnavailable: () => <p>Tasks are unavailable.</p> }));
// #endregion

export { ActiveProjects, ProjectTaskTitles };
