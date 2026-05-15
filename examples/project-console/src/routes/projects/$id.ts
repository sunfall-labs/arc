import { defineFileRoute } from "@effect-ui/start";
import { ProjectById, ProjectList } from "../../domain.js";
import { ProjectRouteParams, ProjectRouteSearch } from "../../domain.contract.js";
import { ProjectSummaries } from "../../project-collections.js";

const RouteBuilder = defineFileRoute("/projects/:id");

export const Route = RouteBuilder({
  ...RouteBuilder.preload({
    params: ProjectRouteParams,
    search: ProjectRouteSearch,
    resources: ({ resource }) => [
      resource(ProjectList, () => "all" as const),
      resource(ProjectById, ({ params }) => params.id)
    ],
    collections: [ProjectSummaries]
  })
});
