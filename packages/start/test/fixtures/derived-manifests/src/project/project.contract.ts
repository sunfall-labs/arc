import { Server } from "@sunfall/arc-core";
import { Schema } from "effect";

export const GetProject = Server.contract<string, string>("Fixture.project.get", {
  input: Schema.String,
  output: Schema.String,
});

export const getProject = Server.client(GetProject);
