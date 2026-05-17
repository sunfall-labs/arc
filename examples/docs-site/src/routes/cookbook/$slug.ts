import { defineFileRoute } from "@effect-ui/start";
import { RecipeBySlug, RecipeIndex, RecipeRouteParams } from "../../content.js";

const RouteBuilder = defineFileRoute("/cookbook/:slug");

export const Route = RouteBuilder.preload({
  params: RecipeRouteParams,
  resources: ({ resource }) => [
    resource(RecipeIndex, () => "all" as const),
    resource(RecipeBySlug, ({ params }) => params.slug),
  ],
}).route();
