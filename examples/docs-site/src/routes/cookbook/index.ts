import { defineFileRoute } from "@sunfall/arc-start";
import { RecipeIndex } from "../../content.js";

const RouteBuilder = defineFileRoute("/cookbook");

export const Route = RouteBuilder.preload({
  resources: [RouteBuilder.resource(RecipeIndex, () => "all" as const)],
}).route();
