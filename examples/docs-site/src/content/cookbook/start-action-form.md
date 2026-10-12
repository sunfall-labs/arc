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

## Generate the plain form

Generate the form from the Action. `StartAction.form` returns `{ method: "post", hiddenFields }`: the hidden fields carry the Action name and encoded input, and there is no `action`, so the form posts to the page it is on.

```ts
const form = StartAction.form(SubmitProjectName, {
  input: {
    id: project.id,
    redirectTo: projectHref(project.id, "activity"),
  },
});
```

```tsx
<form method={form.method}>
  <For each={form.hiddenFields}>
    {(field) => <input type="hidden" name={field.name} value={field.value} />}
  </For>
  <input name="name" value={posted("name") ?? project.name} />
</form>
```

## What a post without JavaScript gets

Start's request handler treats a form-encoded or multipart `POST` to a page as a submission of the named Action. It decodes the fields into the Action's input (a decode failure is the form's validation failure, with field errors from the schema, and the Action does not run), then runs the Action:

- `ActionResult.redirect(...)` answers with that redirect (303 by default).
- A plain success answers 303 back to the same page (Post/Redirect/Get).
- `ActionResult.validation(...)` renders the page again with status 422.
- A failure (a typed error or `ActionResult.failure(...)`) renders the page again with status 400.

The re-rendered page starts the Action's Component binding from the posted submission: `result()` holds the `ValidationFailure`, so field errors render as they do with JavaScript, and `formValues()` holds the posted fields, so inputs keep what was typed. The hydrating client starts from the same state.

```ts
const rename = yield * Component.action(SubmitProjectName);

const posted = (field: string): string | undefined => {
  const value = rename.formValues()?.[field];
  return typeof value === "string" ? value : undefined;
};
```

## Enhance without changing semantics

Enhanced clients intercept submit and call the same Action through its Component binding. `App.launch` submits a served Action to the server over the action transport, so the handle (and its result type) is the same one a local Action uses.

```ts
const submit = (formData: FormData) =>
  StartAction.decodeFormData(SubmitProjectName, formData).pipe(
    Effect.flatMap((input) => rename.submit(input)),
  );
```

`StartAction.decodeFormData(action, formData)` decodes the form into the
Action's input the way the server decodes the same form posted without
JavaScript: the visible fields merged over the default input
`StartAction.form(action, { input })` encoded, read as the input schema's
encoded shape (a `Schema.Boolean` field is a checkbox, a `Schema.Array` field
takes none, one, or many values, an empty field is `null` for a
`Schema.NullOr` field), then decoded. One domain schema serves both paths;
the form needs no string-only twin.
