import { defineFileRoute } from "@effect-ui/start";
import { ProjectList } from "../domain.js";
import { ProjectSummaries } from "../project-collections.js";

const RouteBuilder = defineFileRoute("/");

export const Route = RouteBuilder.preload({
  resources: [RouteBuilder.resource(ProjectList, () => "all" as const)],
  collections: [ProjectSummaries],
}).route();
