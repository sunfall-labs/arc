---
{
  "title": "Progressive Start action form",
  "category": "actions",
  "summary": "Use one Action definition for enhanced submissions and plain form posts, with validation and redirects modeled as data.",
  "order": 3,
  "related": ["semantic-invalidation", "route-preload-hydration"],
}
---

# Progressive Start action form

## Define one served Action

Define the mutation once as an Action without `run`: a served Action, whose schemas are its wire contract. Validation failure and redirect are typed values in its `output`, and domain failures are its typed `error`, not hidden control flow.

```ts
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: Schema.Union([ProjectSchema, ActionResult.Redirect, ActionResult.ValidationFailure]),
  error: ProjectNotFound,
  invalidates: (_result, input) => projectInvalidations(input.id),
});
```

## Implement it on the server

The Action's `run` is the server's `Action.implement`, in a `.server.ts` module. List it in `createRequestHandler(app, { implementations })`.

```ts
// projects.server.ts
export const submitProjectName = Action.implement(SubmitProjectName, (input) =>
  input.name.trim().length < 3
    ? Effect.succeed(
        ActionResult.validation({ fieldErrors: { name: ["Use at least three characters."] } }),
      )
    : renameProject(input).pipe(
        Effect.map((project) =>
          input.redirectTo ? ActionResult.redirect(input.redirectTo) : project,
        ),
      ),
);
```

## Generate a plain form target

Generate the form target from the Action. The hidden fields carry the Action name and encoded input for plain HTML posts.

```ts
const form = StartAction.form(SubmitProjectName, {
  input: {
    id: project.id,
    redirectTo: projectHref(project.id, "activity"),
  },
});
```

## Enhance without changing semantics

Enhanced clients intercept submit and call the same Action through its Component binding. `App.launch` submits a served Action to the server over the action transport, so the handle (and its result type) is the same one a local Action uses.

```ts
const rename = yield * Component.action(SubmitProjectName);

const submit = (formData: FormData) =>
  StartAction.decodeFormData(ProjectNameFormInput, formData).pipe(
    Effect.flatMap(({ name }) => rename.submit({ id: project.id, name })),
  );
```

`StartAction.decodeFormData` decodes the form the way the server decodes the
same form posted without JavaScript: the visible fields merged over the
default input `StartAction.form(action, { input })` encoded. So decoding with
the Action's own input schema gives the full input on both paths, defaults
such as an `id` included.
