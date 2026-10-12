// A form bound to fields of a Resource value, as an app writes it in JSX.
import { Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { Component } from "../src/index.js";

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly owner: { readonly name: string };
  readonly tags: ReadonlyArray<string>;
  readonly updatedAt: number;
}

/** Builds a Project family whose load returns a fresh copy of `source.current` each time. */
export const stableRefreshApp = (source: { current: Project }) => {
  const runs = { name: 0, owner: 0 };
  const ProjectById = Resource.define<string, Project>({
    name: `SolidStableRefresh.ProjectById.${Math.random().toString(36).slice(2)}`,
    load: (_id: string) => Effect.sync((): Project => structuredClone(source.current)),
  });
  // A presentational leaf: a plain Solid function over the reader's value.
  const Editor = (props: { readonly project: Project }) => (
    <form>
      <input name="name" value={(runs.name++, props.project.name)} />
      <span class="owner">{(runs.owner++, props.project.owner.name)}</span>
    </form>
  );
  const Page = Component.define("Page", function* () {
    const project = yield* Component.resource(ProjectById);
    return () => <Editor project={project("atlas")} />;
  });
  return { ProjectById, Page, runs };
};
