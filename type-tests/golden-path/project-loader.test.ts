import { Machine } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { LoaderMessage, ProjectLoader } from "./project-loader.js";
import { ProjectId, type Project } from "./projects.js";
import { ProjectsServerMemory } from "./projects.memory.js";

const atlas: Project = { id: ProjectId.make("atlas"), name: "Atlas", status: "active" };

test("ClickedLoad enters Loading, and the received projects show", () => {
  // Transitions replay without a runtime, DOM, or timers.
  const replay = (messages: Parameters<typeof Machine.replay<any, any, any>>[1]) =>
    Effect.runSync(
      Machine.replay(ProjectLoader.machine, messages).pipe(Effect.provide(ProjectsServerMemory)),
    );
  expect(replay([LoaderMessage.ClickedLoad])._tag).toBe("Loading");
  expect(
    replay([LoaderMessage.ClickedLoad, LoaderMessage.ReceivedProjects({ projects: [atlas] })]),
  ).toMatchObject({ _tag: "Ready", projects: [atlas] });
  // Not valid while idle: the message changes nothing.
  expect(replay([LoaderMessage.ReceivedProjects({ projects: [atlas] })])._tag).toBe("Idle");
});
