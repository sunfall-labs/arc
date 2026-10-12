import { Resource } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Schema } from "effect";
import { ProjectApi, ProjectSchema } from "./model.js";

// #region resource
const ProjectRows = Resource.define({
  name: "Project.rows",
  output: Schema.Array(ProjectSchema),
  load: () => ProjectApi.use((api) => api.list()),
});

const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: ProjectRows(undefined),
});
// #endregion

export { Projects };
