import { defineFileRoute } from "@sunfall/arc-start";
import { ProjectList } from "../../domain.js";
import { ProjectSummaries, ProjectWorkItems } from "../../project-collections.js";

const RouteBuilder = defineFileRoute("/projects");

export const Route = RouteBuilder.preload({
  resources: [RouteBuilder.resource(ProjectList, () => "all" as const)],
  collections: [ProjectSummaries, ProjectWorkItems],
}).route();
