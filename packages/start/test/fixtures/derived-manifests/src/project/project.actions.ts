import { Action } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";

export const RenameProject = Action.define({
  name: "Fixture.project.rename",
  input: Schema.String,
  output: Schema.String,
  run: (name) => Effect.succeed(name),
});
