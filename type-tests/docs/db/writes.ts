import { Action } from "@sunfall/arc-core";
import { Schema } from "effect";
import { Project, ProjectApi, ProjectId, Projects, ProjectsTag, ProjectTag } from "./model.js";

// #region archive
export const ArchiveProject = Action.define({
  name: "Projects.archive",
  input: Schema.Struct({ id: ProjectId }),
  output: Project,
  optimistic: ({ id }, transaction) => transaction.update(Projects, id, { status: "archived" }),
  run: ({ id }) => ProjectApi.use((api) => api.archive(id)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
// #endregion
