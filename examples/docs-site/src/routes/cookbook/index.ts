import { defineFileRoute } from "@effect-ui/start";
import { RecipeIndex } from "../../content.js";

const RouteBuilder = defineFileRoute("/cookbook");

export const Route = RouteBuilder.preload({
  resources: [RouteBuilder.resource(RecipeIndex, () => "all" as const)],
}).route();
