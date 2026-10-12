import { Resource, Route } from "@sunfall/arc-core";
import { ProjectList, ProjectWorkItemList, ProjectsRef, WorkItemsRef } from "../domain.js";

export const route = Route.define("/", {
  preloadResources: [ProjectList, ProjectWorkItemList],
  preload: () => Resource.preload([ProjectsRef, WorkItemsRef]),
});
