import { Action } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { Projects } from "./collection.js";
import { ProjectId } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { RenameProject } from "./rename.js";

test("renaming patches the sidebar row at once", () => {
  const id = ProjectId.make("atlas");
  // Plans the patch without applying it: no runtime, store, or backend.
  // `ProjectApiMemory` satisfies the Action's types; the plan never calls it.
  const changes = Effect.runSync(
    Action.planOptimistic(RenameProject, { id, name: "Atlas 2" }).pipe(
      Effect.provide(ProjectApiMemory),
    ),
  );
  expect(changes).toEqual([
    { _tag: "Update", rows: Projects, key: id, update: { name: "Atlas 2" } },
  ]);
});
