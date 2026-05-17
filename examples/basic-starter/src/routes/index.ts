import { defineFileRoute } from "@sunfall/arc-start";
import { WelcomeResource } from "../starter.js";

const RouteBuilder = defineFileRoute("/");

export const Route = RouteBuilder.preload({
  resources: [RouteBuilder.resource(WelcomeResource, () => "Sunfall Arc")],
}).route();
