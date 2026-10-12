import { Resource, Route } from "@sunfall/arc-core";
import { ProjectsRef, TasksRef } from "./rows.js";

// #region route-preload
// Rows hydrate as their Resource does: preload it, and SSR, hydration, and
// navigation render the rows without a fallback.
const ProjectRoute = Route.define("/projects/:id", {
  preload: () => Resource.preload([ProjectsRef, TasksRef]),
});
// #endregion

export { ProjectRoute };
