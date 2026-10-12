// Shared by the server render test (Solid's server build) and the client
// hydration test (Solid's browser build): one tree whose collection fails its
// first load in the server render.
import { Collection } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import type { JSX } from "@solidjs/web";
import { Data, Effect } from "effect";
import { SolidDb } from "../src/index.js";

export class ProjectsUnavailable extends Data.TaggedError("ProjectsUnavailable")<{}> {}

export interface Project {
  readonly id: string;
  readonly name: string;
}

/**
 * Markup both sides render on the first pass: the collection as not yet
 * loaded. The failure has no hydrated form, so the server does not render it.
 */
export const failingProjectsMarkup = "projects: none";

/** A reactive text child, as JSX compiles `{read()}`. */
const reactive = (read: () => string): JSX.Element => read as unknown as JSX.Element;

export const failingProjectsApp = (
  load: () => Effect.Effect<ReadonlyArray<Project>, ProjectsUnavailable>,
) => {
  const events = { loads: 0, typedFallbacks: 0 };
  const Projects = Collection.define<Project, string, ProjectsUnavailable>({
    name: "SolidDbSsr.failingProjects",
    getKey: (project) => project.id,
    sync: {
      load: () =>
        Effect.suspend(() => {
          events.loads++;
          return load();
        }),
    },
  });
  const Sidebar = Component.define("Sidebar", function* () {
    const projects = yield* SolidDb.collection(Projects);
    return () =>
      reactive(() => {
        const names = projects.rows().map((project) => project.name);
        return `projects: ${names.length === 0 ? "none" : names.join(", ")}`;
      });
  }).pipe(
    Component.catchTags({
      ProjectsUnavailable: () => {
        events.typedFallbacks++;
        return "projects unavailable";
      },
    }),
  );
  const Root = Component.define("Root", function* () {
    const Content = yield* Sidebar;
    return () => Content({});
  });
  return { Projects, Root, events };
};
