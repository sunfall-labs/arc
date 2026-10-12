import { Action, Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { Projects } from "./collection.js";
import { ProjectById, ProjectId } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { RenameProject } from "./rename.js";

test("renaming patches the sidebar row and the project page at once", () => {
  const id = ProjectId.make("atlas");
  const { atlas, changes } = Effect.runSync(
    Effect.gen(function* () {
      // A Resource patch reports the value the entry would read, so load it.
      const atlas = yield* Resource.preload(ProjectById(id));
      // Plans the patch without applying it: nothing is written.
      const changes = yield* Action.planOptimistic(RenameProject, { id, name: "Atlas 2" });
      return { atlas, changes };
    }).pipe(Effect.provide(ProjectApiMemory)),
  );
  expect(changes).toEqual([
    { _tag: "Update", rows: Projects, key: id, update: { name: "Atlas 2" } },
    { _tag: "Set", target: ProjectById(id), value: { ...atlas, name: "Atlas 2" } },
  ]);
});
