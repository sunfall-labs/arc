import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Cause, Effect, Schema } from "effect";
import { Show } from "solid-js";
import { Projects } from "./collection.js";
import { Project, ProjectApi, ProjectId, ProjectTag, ProjectsTag } from "./projects.js";

export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
  // The sidebar row shows the new name at once (`$synced: false`); success
  // keeps it until the reload lands, and a failure rolls it back.
  optimistic: (input, transaction) => transaction.update(Projects, input.id, { name: input.name }),
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  // After a success, every Resource that provides these tags reloads.
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});

/** Actions the server serves; the client submits them over the network. */
export const servedActions = [RenameProject] as const;

export const RenameForm = Component.define(
  "RenameForm",
  function* (props: { readonly project: Project }) {
    const rename = yield* Component.action(RenameProject);
    // `submit` fails with the Action's errors; a DOM handler cannot report them,
    // so the callback must handle them. `failure()` still shows the latest one.
    const save = yield* Component.callback((name: string) =>
      rename.submit({ id: props.project.id, name }).pipe(Effect.ignore),
    );

    return () => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(String(new FormData(event.currentTarget).get("name")));
        }}
      >
        <input name="name" value={props.project.name} />
        <button type="submit" disabled={rename.waiting()}>
          Rename
        </button>
        <Show when={rename.failure()}>
          {(cause) => <p role="alert">Rename failed: {Cause.pretty(cause())}</p>}
        </Show>
      </form>
    );
  },
);
