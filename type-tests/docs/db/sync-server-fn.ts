import { Collection } from "@sunfall/arc-db";
import { listProjects, ProjectSchema } from "./model.js";

// #region server-fn
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: {
    load: listProjects, // Server.Fn<void, ReadonlyArray<Project>>
  },
});
// #endregion

export { Projects };
