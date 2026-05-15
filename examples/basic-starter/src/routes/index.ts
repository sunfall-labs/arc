import { defineFileRoute } from "@effect-ui/start";
import { WelcomeResource } from "../starter.js";

const RouteBuilder = defineFileRoute("/");

export const Route = RouteBuilder({
  ...RouteBuilder.preload({
    resources: [
      RouteBuilder.resource(WelcomeResource, () => "Effect UI")
    ]
  })
});
