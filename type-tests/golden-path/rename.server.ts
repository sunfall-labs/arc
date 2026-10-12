import { Action } from "@sunfall/arc-core";
import { ProjectStore } from "./projects.server.js";
import { RenameProject } from "./rename.js";

// The rename's server body: it may succeed only with `Project` and fail only
// with `ProjectNotFound`, as the definition declares.
export const renameProject = Action.implement(RenameProject, (input) =>
  ProjectStore.use((store) => store.rename(input)),
);
