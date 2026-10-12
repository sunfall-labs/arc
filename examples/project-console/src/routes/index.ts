import { Resource, Route } from "@sunfall/arc-core";
import { ProjectsRef, WorkItemsRef } from "../domain.js";

export const route = Route.define("/", {
  preload: () => Resource.preload([ProjectsRef, WorkItemsRef]),
});
