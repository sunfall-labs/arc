import { Collection } from "@sunfall/arc-db";
import { Project, ProjectsRef } from "./projects.js";

// Backed by the Resource: it loads through ProjectsRef and follows it, so the
// rename Action's `ProjectsTag` invalidation reconciles these rows with no
// second fetch.
export const Projects = Collection.define({
  name: "Projects.rows",
  output: Project,
  getKey: (project) => project.id,
  indexes: { status: (project) => project.status },
  sync: ProjectsRef,
});
