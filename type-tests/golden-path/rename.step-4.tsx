import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Cause, Effect, Schema } from "effect";
import { Show } from "solid-js";
import { Project, ProjectId, ProjectNotFound, ProjectTag, ProjectsTag } from "./projects.js";

// No `run`: the server runs it (`rename.server.ts`). Its schemas are the wire
// contract, so the typed failure arrives typed in the browser.
export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
  error: ProjectNotFound,
  // After a success, every Resource that provides these tags reloads.
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});

export const RenameForm = Component.define(
  "RenameForm",
  function* (props: { readonly project: Project }) {
    const rename = yield* Component.action(RenameProject);
    // `submit` fails with the Action's errors; a DOM handler cannot report them,
    // so the callback must handle them. `failure()` still shows the latest one.
    // A named transition: its commits read `RenameForm.save` on the Timeline.
    const save = yield* Component.callback("save", (name: string) =>
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
