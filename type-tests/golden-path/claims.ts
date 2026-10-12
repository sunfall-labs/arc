// Pins the claims docs/golden-path.md makes about this fixture's types.
import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Layer } from "effect";
import { App } from "./app.js";
import { ProjectPage } from "./project-page.js";
import { ProjectApi, ProjectById, ProjectId, ProjectNotFound } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";
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

declare const root: HTMLElement;
Component.launch(App, root, { runtime: makeRuntime(ProjectApiMemory) });
// @ts-expect-error a runtime without ProjectApi cannot launch the app
Component.launch(App, root, { runtime: makeRuntime(Layer.empty) });

// Without a boundary a Resource reader's typed load error blocks launch.
const Unhandled = Component.define("Unhandled", function* () {
  const project = yield* Component.resource(ProjectById);
  return () => project(ProjectId.make("atlas")).name;
});
type _unhandled = Assert<Eq<Parts<typeof Unhandled>["E"], ProjectNotFound>>;
// @ts-expect-error ProjectNotFound is unhandled
Component.launch(Unhandled, root, { runtime: makeRuntime(ProjectApiMemory) });
