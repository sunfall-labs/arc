import { Resource } from "@sunfall/arc-core";
import { FileRoute } from "@sunfall/arc-start";
import { WelcomeResource } from "../starter.js";

export const Route = FileRoute.define("/")({
  preloadResources: [WelcomeResource],
  preload: () => Resource.preload(WelcomeResource("Sunfall Arc")),
});
