import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Show } from "solid-js";
import { Project, ProjectApi, ProjectId, ProjectTag, ProjectsTag } from "./projects.js";

export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
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
    // A DOM handler cannot report a typed failure, so the callback must handle
    // it. The outcome (including the failure) lands in `rename.result()`.
    const save = yield* Component.callback((name: string) =>
      rename.submit({ id: props.project.id, name }).pipe(Effect.ignore),
    );
    const error = () => Option.getOrUndefined(AsyncResult.error(rename.result()));

    return () => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(String(new FormData(event.currentTarget).get("name")));
        }}
      >
        <input name="name" value={props.project.name} />
        <button type="submit" disabled={rename.result().waiting}>
          Rename
        </button>
        <Show when={error()}>{(failure) => <p role="alert">{failure()._tag}</p>}</Show>
      </form>
    );
  },
);
