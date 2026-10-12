import { Resource, Route } from "@sunfall/arc-core";
import { WelcomeResource } from "../starter.js";

export const route = Route.define("/", {
  preloadResources: [WelcomeResource],
  preload: () => Resource.preload(WelcomeResource("Sunfall Arc")),
});
