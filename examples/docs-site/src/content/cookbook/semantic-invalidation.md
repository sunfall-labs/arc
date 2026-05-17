---
{
  "title": "Semantic invalidation tags",
  "category": "resources",
  "summary": "Model invalidation as domain facts so actions refresh Resources by meaning instead of by string cache keys.",
  "order": 4,
  "related": ["start-action-form", "resource-from-server-function"],
}
---

# Semantic invalidation tags

Tags describe domain facts. They are typed values with stable identity, not cache-key conventions.

```ts
export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});
```

Resources publish the facts they provide after a successful load.

```ts
export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

Actions invalidate facts after mutation success. Devtools and tests can inspect the plan before refresh work runs.

```ts
export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
```
