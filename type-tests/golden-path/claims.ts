// Pins the claims docs/golden-path.md makes about this fixture's types.
import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import * as Start from "@sunfall/arc-start";
import { Layer } from "effect";
import { App } from "./app.js";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import { ProjectApi, ProjectById, ProjectId, ProjectNotFound } from "./projects.js";
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

// A collection's load error joins E like a reader's; ProjectsRef cannot fail.
type _sidebar = Assert<Eq<Parts<typeof ProjectSidebar>["E"], never>>;

// An Action's failures belong to whoever submits it: a callback must handle them.
Component.define("UnhandledRename", function* () {
  const rename = yield* Component.action(RenameProject);
  // @ts-expect-error ProjectNotFound (and transport failures) are unhandled
  yield* Component.callback((name: string) => rename.submit({ id: ProjectId.make("atlas"), name }));
  return () => null;
});
