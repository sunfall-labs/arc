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

## Define one Action

Define the mutation once as an Action. Validation failure, domain failure, redirect, and success are typed values, not hidden control flow.

```ts
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  run: (input) => ProjectApi.use((api) => api.submitName(input)),
  invalidates: (result, input) =>
    result._tag === "ValidationFailure" ? [] : projectInvalidations(input.id),
});
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

Enhanced clients intercept submit and call the same Action through its Component binding. Listing it in `App.define({ actions: [SubmitProjectName] })` makes `App.launch` route it to the server, so the handle (and its result type) is the same one a local Action uses.

```ts
const rename = yield * Component.action(SubmitProjectName);

const submit = (formData: FormData) =>
  StartAction.decodeFormData(ProjectNameFormInput, formData).pipe(
    Effect.flatMap(({ name }) => rename.submit({ id: project.id, name })),
  );
```
