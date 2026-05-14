import { defineFileRoute } from "@effect-ui/start";
import { Effect } from "effect";
import { preloadWelcomeEffect } from "../starter.js";

export const Route = defineFileRoute("/")({
  preloadResources: ["Starter.welcome"],
  preload: () => Effect.asVoid(preloadWelcomeEffect)
});
