import { Collection } from "@sunfall/arc-db";
import type { Task } from "./model.js";

// #region tasks
export const Tasks = Collection.define<Task>({
  name: "Tasks",
  getKey: (task) => task.id,
  indexes: {
    byProject: (task) => task.projectId,
    tags: (task) => task.tags,
  },
});

const atlasTasks = Tasks.index("byProject", "atlas");
// #endregion

export { atlasTasks };
