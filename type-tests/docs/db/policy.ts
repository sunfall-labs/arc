import { Collection } from "@sunfall/arc-db";
import { Schedule } from "effect";
import { ProjectApi, ProjectSchema } from "./model.js";

// #region retry
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 })),
  },
  sync: {
    load: () => ProjectApi.use((api) => api.list()),
  },
});
// #endregion

export { Projects };
