import { Collection } from "@effect-ui/db";
import { useCollection, useLiveQuery } from "@effect-ui/solid-db";
import { Effect } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

describe("solid-db", () => {
  it("adapts collections and live queries to Solid accessors", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "SolidDb.projects",
          getKey: (project) => project.id,
          indexes: {
            active: (project) => project.active
          },
          initialData: [
            { id: "atlas", name: "Atlas", active: true },
            { id: "lumen", name: "Lumen", active: false }
          ]
        });

        const handles = createRoot((rootDispose) => {
          dispose = rootDispose;
          return {
            projects: useCollection(Projects, { preload: false }),
            activeNames: useLiveQuery((query) =>
              query
                .from({ project: Projects })
                .where(({ project }) => project.active)
                .select(({ project }) => project.name)
                .orderBy(({ project }) => project.name),
              { preload: false }
            )
          };
        });

        yield* Effect.sleep("0 millis");

        expect(handles.projects.rows().map((project) => project.name)).toEqual([
          "Atlas",
          "Lumen"
        ]);
        expect(handles.projects.get("atlas")?.name).toBe("Atlas");
        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual(["atlas"]);
        expect(handles.projects.firstByIndex("active", false)?.id).toBe("lumen");
        expect(handles.activeNames.data()).toEqual(["Atlas"]);

        yield* Projects.writeUpdateEffect("lumen", { active: true });

        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual(["atlas", "lumen"]);
        expect(handles.activeNames.data()).toEqual(["Atlas", "Lumen"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.()))
      )
    );
  });
});
