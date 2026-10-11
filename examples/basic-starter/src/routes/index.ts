import { Resource } from "@sunfall/arc-core";
import { defineFileRoute } from "@sunfall/arc-start";
import { WelcomeResource } from "../starter.js";

export const Route = defineFileRoute("/")({
  preloadResources: [WelcomeResource],
  preload: () => Resource.prefetchEffect(WelcomeResource("Sunfall Arc")),
});
