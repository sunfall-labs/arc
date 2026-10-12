import { State } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProjectLoader } from "./project-loader.js";
import { ProjectId, type Project } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";

const atlas: Project = { id: ProjectId.make("atlas"), name: "Atlas", status: "active" };

test("Load starts loading and fetches the projects", () => {
  // One transition is one function call: no runtime, DOM, or timers.
  const loading = State.step(ProjectLoader, ProjectLoader.initial, { _tag: "Load" });
  expect(loading.model.status).toBe("loading");
  expect(loading.commands).toHaveLength(1);

  // A command is a description: run its Effect with test services to get the
  // message it emits.
  const emitted = Effect.runSync(
    loading.commands[0]!.effect.pipe(Effect.provide(ProjectApiMemory)),
  );
  expect(emitted).toMatchObject({ _tag: "Loaded", projects: [atlas, expect.anything()] });
});

test("Loaded shows the projects", () => {
  const loading = { status: "loading", projects: [] } as const;
  const ready = State.step(ProjectLoader, loading, { _tag: "Loaded", projects: [atlas] });
  expect(ready.model).toEqual({ status: "ready", projects: [atlas] });
  expect(ready.commands).toEqual([]);
});
