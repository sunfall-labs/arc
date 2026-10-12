// The docs site's homepage shows regions of this file (`// #region name`), so
// its snippets are type-checked by `pnpm typecheck:types` and cannot drift.
// examples/docs-site/src/home-snippets.ts reads the regions at build time.
import { Action, makeRuntime, Resource, Route, Timeline } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { App } from "@sunfall/arc-start";
import { Context, Effect, Layer, Schema } from "effect";
import { For, Loading } from "solid-js";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  archived: Schema.Boolean,
});
export type Project = typeof Project.Type;

export interface ProjectApi {
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectNotFound>;
  readonly archive: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
}
export const ProjectApi = Context.Service<ProjectApi>("ProjectApi");

export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

// #region resource
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId,
}) {}

// A named, cached, typed read. Its failure and its service are in its type.
export const ProjectById = Resource.define({
  name: "Projects.byId",
  input: ProjectId,
  output: Project,
  error: ProjectNotFound,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
// #endregion

// #region action
// A named mutation. The page shows the new name at once; a failure rolls it back.
export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
  optimistic: (input, transaction) =>
    transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  // Every Resource that provides this tag reloads after a success.
  invalidates: (project) => [ProjectTag({ id: project.id })],
});
// #endregion

// #region component
export const ProjectPage = Component.define(
  "ProjectPage",
  function* (props: { readonly id: ProjectId }) {
    const project = yield* Component.resource(ProjectById); // E += ProjectNotFound
    const rename = yield* Component.action(RenameProject);
    const save = yield* Component.callback("save", (name: string) =>
      rename.submit({ id: props.id, name }).pipe(Effect.ignore),
    );

    return () => (
      <Loading fallback={<p>Loading</p>}>
        <input
          value={project(props.id).name}
          onChange={(event) => save(event.currentTarget.value)}
        />
      </Loading>
    );
  },
  // Remove this line and the app no longer compiles.
).pipe(Component.catchTags({ ProjectNotFound: (error) => <p>No project {error.id}</p> }));
// #endregion

const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
});
const routes = [
  Route.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id })),
] as const;
const Root = Component.define("Root", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  return () => <p>{router.state()._tag}</p>;
});
declare const ProjectApiLive: Layer.Layer<ProjectApi>;
declare const root: HTMLElement;

// #region unhandled
const Unhandled = Component.define("Unhandled", function* () {
  const project = yield* Component.resource(ProjectById);
  return () => <h1>{project(ProjectId.make("atlas")).name}</h1>;
});
// @ts-expect-error ProjectNotFound is not handled
Component.launch(Unhandled, root, { runtime: makeRuntime(ProjectApiLive) });
// @ts-expect-error the client Layer does not provide ProjectApi
App.define({ root: Root, routes, client: Layer.empty });
// #endregion

App.define({ root: Root, routes, client: ProjectApiLive });

// #region durable
export const ArchiveProject = Action.define({
  name: "Projects.archive",
  input: ProjectId,
  output: Project,
  // Persisted before it is sent: survives going offline and reloading.
  durable: { maxAge: "1 day" },
  optimistic: (id, transaction) =>
    transaction.set(ProjectById(id), (project) => ({ ...project, archived: true })),
  run: (id) => ProjectApi.use((api) => api.archive(id)),
});
// #endregion

// #region timeline
export const TimelinePanel = Component.define("TimelinePanel", function* () {
  const recording = yield* Timeline.record({ limit: 500 });
  const travel = yield* Component.callback("travel", (sequence: number) =>
    recording.travel(sequence).pipe(Effect.ignore),
  );
  return () => (
    <For each={recording.entries.get()} keyed={(entry) => entry.sequence}>
      {(entry) => (
        <button title="Travel to this commit" onClick={() => travel(entry().sequence)}>
          {Timeline.describe(entry().cause)}
        </button>
      )}
    </For>
  );
}).pipe(Component.catchAll(() => null));
// #endregion

// #region refresh
function ProjectName(props: { readonly project: Project }) {
  // A reload that leaves `name` unchanged never touches this input,
  // so text the user is typing survives every refresh.
  return <input value={props.project.name} />;
}
// #endregion

export const shown = [ProjectName, TimelinePanel, ArchiveProject, Unhandled];
