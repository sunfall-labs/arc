// Pins the claims docs/golden-path.md makes about this fixture's types.
import { Action, makeRuntime, Resource } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import * as Start from "@sunfall/arc-start";
import { Effect, Layer } from "effect";
import { App } from "./app.js";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import {
  ProjectApi,
  ProjectById,
  ProjectId,
  ProjectList,
  ProjectNotFound,
  ProjectsRef,
  Project,
} from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { RenameProject } from "./rename.js";
import { routes } from "./routes.js";
import { TimelinePanel } from "./timeline-panel.js";

type Assert<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Parts<C> = C extends Component<infer P, infer E, infer R> ? { P: P; E: E; R: R } : never;

// catchTags removed ProjectNotFound; the Resource load and the Action need ProjectApi.
type _page = Assert<Eq<Parts<typeof ProjectPage>["E"], never>>;
type _pageR = Assert<Eq<Parts<typeof ProjectPage>["R"], ProjectApi>>;
type _app = Assert<Eq<Parts<typeof App>["E"], never>>;
type _appR = Assert<Eq<Parts<typeof App>["R"], ProjectApi>>;
type _panel = Assert<Eq<Parts<typeof TimelinePanel>["E"], never>>;

// The app's client Layer must provide what the root needs, and so must the
// server Layer given to the request handler.
const app = Start.App.define({ root: App, routes, client: ProjectApiMemory });
// @ts-expect-error a client Layer without ProjectApi cannot define the app
Start.App.define({ root: App, routes, client: Layer.empty });
Start.createRequestHandler(app, { server: ProjectApiMemory });
// @ts-expect-error a server without ProjectApi cannot serve the app
Start.createRequestHandler(app, {});

declare const root: HTMLElement;

// Without a boundary a Resource reader's typed load error blocks launch.
const Unhandled = Component.define("Unhandled", function* () {
  const project = yield* Component.resource(ProjectById);
  return () => project(ProjectId.make("atlas")).name;
});
type _unhandled = Assert<Eq<Parts<typeof Unhandled>["E"], ProjectNotFound>>;
// @ts-expect-error ProjectNotFound is unhandled
Component.launch(Unhandled, root, { runtime: makeRuntime(ProjectApiMemory) });

// The list's load cannot fail, so the sidebar's E stays never.
type _sidebar = Assert<Eq<Parts<typeof ProjectSidebar>["E"], never>>;

// An Action's failures belong to whoever submits it: a callback must handle them.
Component.define("UnhandledRename", function* () {
  const rename = yield* Component.action(RenameProject);
  // @ts-expect-error ProjectNotFound (and transport failures) are unhandled
  yield* Component.callback("save", (name: string) =>
    rename.submit({ id: ProjectId.make("atlas"), name }),
  );
  return () => null;
});

// Every callback is a named transition, so every commit it makes has a name.
Component.define("UnnamedCallback", function* () {
  // @ts-expect-error a callback needs a name
  yield* Component.callback(() => Effect.void);
  return () => null;
});

// `rows` types the reader's row lookups: keys by `rows.key`, indexes by name and value.
Component.define("SidebarRows", function* () {
  const projects = yield* Component.resource(ProjectList);
  return () => {
    const atlas: Project | undefined = projects.get("all", ProjectId.make("atlas"));
    const active: ReadonlyArray<Project> = projects.index("all", "status", "active");
    // @ts-expect-error keys are ProjectIds
    projects.get("all", 1);
    // @ts-expect-error only declared indexes
    projects.index("all", "owner", "x");
    // @ts-expect-error index values are typed by the selector
    projects.index("all", "status", "deleted");
    return [atlas?.name, active.length].join();
  };
});

// A reader of a Resource without `rows` has no row lookups.
Component.define("ByIdRows", function* () {
  const project = yield* Component.resource(ProjectById);
  // @ts-expect-error ProjectById declares no rows
  return () => project.get(ProjectId.make("atlas"), "atlas");
});

// Actions patch rows only on a Resource with `rows`, keyed by its key type.
Action.define({
  name: "Projects.touch",
  input: ProjectId,
  run: () => Effect.void,
  optimistic: (id, transaction) =>
    Effect.all([
      // @ts-expect-error ProjectById declares no rows
      transaction.update(ProjectById(id), id, { name: "x" }),
      // @ts-expect-error row keys are ProjectIds
      transaction.delete(ProjectsRef, 1),
      // @ts-expect-error rows are Projects
      transaction.insert(ProjectsRef, { id }),
    ]),
});

// `rows` needs an array `output`: no overload accepts rows of a single Project.
Resource.define({
  name: "Projects.rowsOfOne",
  input: ProjectId,
  // @ts-expect-error a single Project has no rows
  output: Project,
  rows: { key: (project) => project.id },
  load: (id) => ProjectApi.use((api) => api.get(id)),
});
