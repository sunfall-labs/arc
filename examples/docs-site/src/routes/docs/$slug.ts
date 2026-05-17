import { defineFileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../../content.js";
import { DocsRouteParams } from "../../docs-content.js";

const RouteBuilder = defineFileRoute("/docs/:slug");

export const Route = RouteBuilder.preload({
  params: DocsRouteParams,
  resources: ({ resource }) => [resource(RecipeIndex, () => "all" as const)],
}).route();
