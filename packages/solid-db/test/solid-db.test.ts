import { makeRuntime, runWithRuntime } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { useCollection, useLiveQuery } from "@effect-ui/solid-db";
import { Context, Effect, Layer } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

describe("solid-db", () => {
  interface ProjectApi {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@effect-ui/solid-db/test/ProjectApi");

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

  it("exposes automatic preload failures through typed Solid accessors", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = { _tag: "ProjectLoadError" as const, message: "blocked" };
        const observedCollectionFailures: Array<unknown> = [];
        const observedLiveFailures: Array<unknown> = [];
        const Projects = Collection.define<Project, string, typeof failure>({
          name: "SolidDb.preload-failure.projects",
          getKey: (project) => project.id,
          load: () => Effect.fail(failure)
        });

        const handles = createRoot((rootDispose) => {
          dispose = rootDispose;
          return {
            projects: useCollection(Projects, {
              onPreloadFailure: (error) => observedCollectionFailures.push(error)
            }),
            activeNames: useLiveQuery((query) =>
              query
                .from({ project: Projects })
                .where(({ project }) => project.active)
                .select(({ project }) => project.name),
              {
                onPreloadFailure: (error) => observedLiveFailures.push(error)
              }
            )
          };
        });

        yield* Effect.sleep("0 millis");

        expect(handles.projects.preloadFailure()).toEqual(failure);
        expect(handles.activeNames.preloadFailure()).toEqual(failure);
        expect(observedCollectionFailures).toEqual([failure]);
        expect(observedLiveFailures).toEqual([failure]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.()))
      )
    );
  });

  it("binds returned collection and live-query Effects to the Solid runtime", () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        list: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: "Atlas", active: true },
              { id: "lumen", name: "Lumen", active: true }
            ];
          })
      })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project, string, never, ProjectApi>({
          name: "SolidDb.runtime-bound-effects.projects",
          getKey: (project) => project.id,
          load: () => ProjectApi.use((api) => api.list())
        });

        const handles = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return {
              projects: useCollection(Projects, { preload: false }),
              names: useLiveQuery((query) =>
                query
                  .from({ project: Projects })
                  .select(({ project }) => project.name)
                  .orderBy(({ project }) => project.name),
                { preload: false }
              )
            };
          })
        );

        yield* handles.projects.preloadEffect();
        yield* handles.names.refetchEffect();
        yield* Effect.sleep("0 millis");

        expect(loads).toBe(2);
        expect(handles.projects.rows().map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("represents live query evaluation failures without throwing from accessors", () => {
    let dispose: (() => void) | undefined;

    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-evaluation-failure.projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", active: true }
      ]
    });

    const handle = createRoot((rootDispose) => {
      dispose = rootDispose;
      return useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(() => {
            throw new Error("filter failed");
          })
          .select(({ project }) => project.name),
        { preload: false }
      );
    });

    try {
      expect(() => handle.data()).not.toThrow();
      expect(handle.state()).toMatchObject({
        _tag: "Failure",
        error: { _tag: "QueryEvaluationError", operation: "filter" },
        data: []
      });
    } finally {
      dispose?.();
    }
  });
});
