import { Resource } from "@effect-ui/core";
import { Effect, Schema } from "effect";

export const StarterWelcome = Schema.Struct({
  message: Schema.String,
  updatedAt: Schema.Number,
});

export type StarterWelcome = typeof StarterWelcome.Type;

export const WelcomeResource = Resource.family({
  name: "Starter.welcome",
  input: Schema.String,
  output: StarterWelcome,
  load: (name) =>
    Effect.succeed({
      message: `Hello, ${name}.`,
      updatedAt: 1,
    }),
});

export const WelcomeRef = WelcomeResource("Effect UI");
