import { Action } from "@sunfall/arc-core";
import { Schema } from "effect";
import { Project, ProjectApi, ProjectId, ProjectsTag, ProjectTag } from "./model.js";
import { ProjectsRef } from "./rows.js";

// #region archive
export const ArchiveProject = Action.define({
  name: "Projects.archive",
  input: Schema.Struct({ id: ProjectId }),
  output: Project,
  // The key is typed by `rows.key`; the patch by the row type.
  optimistic: ({ id }, transaction) => transaction.update(ProjectsRef, id, { status: "archived" }),
  run: ({ id }) => ProjectApi.use((api) => api.archive(id)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
// #endregion

// #region create
export const CreateProject = Action.define({
  name: "Projects.create",
  input: Schema.Struct({ draftId: Schema.String, name: Schema.String }),
  output: Project,
  // A placeholder row until the reload brings the server's row.
  optimistic: ({ draftId, name }, transaction) =>
    transaction.insert(ProjectsRef, { id: draftId, name, status: "active", progress: 0 }),
  run: ({ name }) => ProjectApi.use((api) => api.create(name)),
  invalidates: () => [ProjectsTag],
});
// #endregion
