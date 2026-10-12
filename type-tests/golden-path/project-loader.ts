import { Program } from "@sunfall/arc-core";
import { Effect } from "effect";
import { ProjectApi, type Project } from "./projects.js";

type Model = {
  readonly status: "idle" | "loading" | "ready";
  readonly projects: ReadonlyArray<Project>;
};
type Message =
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly projects: ReadonlyArray<Project> };

// Handlers are pure: they return the next model, and Effect work leaves them
// as commands that run after the model commits.
export const ProjectLoader = Program.define<Model, Message, never, ProjectApi>({
  name: "ProjectLoader",
  initial: { status: "idle", projects: [] },
  on: {
    Load: (model) =>
      Program.next(
        { ...model, status: "loading" },
        Program.emit(
          ProjectApi.use((api) => api.list()).pipe(
            Effect.map((projects) => ({ _tag: "Loaded", projects }) as const),
          ),
        ),
      ),
    Loaded: (_model, message) => ({ status: "ready", projects: message.projects }),
  },
});
