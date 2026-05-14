import { makeRuntime, Resource, runWithRuntime } from "@effect-ui/core";
import { Context, Effect, Layer } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { useResource } from "../src/index.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@effect-ui/solid/test/ProjectApi");

describe("solid hooks", () => {
  it("binds returned resource Effects to the Solid runtime", () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) =>
          Effect.sync(() => {
            loads++;
            return { id, name: id === "atlas" ? "Atlas" : id };
          })
      })
    );
    const ProjectById = Resource.family<string, Project, never, ProjectApi>({
      name: "SolidHooks.runtime-bound-resource",
      load: (id) => ProjectApi.use((api) => api.get(id))
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const project = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useResource(ProjectById("atlas"));
          })
        );

        const prefetched = yield* project.prefetchEffect();
        const refreshed = yield* project.refreshEffect();

        expect(prefetched.name).toBe("Atlas");
        expect(refreshed.name).toBe("Atlas");
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });
});
