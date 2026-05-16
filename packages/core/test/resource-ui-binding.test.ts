import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  makeRuntime,
  Resource,
  resourceUiMatchState
} from "../src/index.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@effect-ui/core/test/ResourceUiProjectApi");

describe("Resource UI Binding Controller", () => {
  it("passes previous-value presence through match metadata", () => {
    const pending = resourceUiMatchState<void, string, string>({
      _tag: "Pending",
      waiting: true,
      previous: undefined
    }, {
      initial: () => "initial",
      pending: (previous, meta) => `pending:${String(previous)}:${String(meta.hasPrevious)}`,
      success: () => "success",
      failure: () => "failure"
    });
    const failure = resourceUiMatchState<void, string, string>({
      _tag: "Failure",
      waiting: false,
      error: "failed",
      previous: undefined
    }, {
      initial: () => "initial",
      pending: () => "pending",
      success: () => "success",
      failure: (_error, previous, meta) => `failure:${String(previous)}:${String(meta.hasPrevious)}`
    });

    expect(pending).toBe("pending:undefined:true");
    expect(failure).toBe("failure:undefined:true");
  });

  it("binds refresh and prefetch effects to the supplied runtime", () => {
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) => Effect.succeed({ id, name: id === "atlas" ? "Atlas" : id })
      })
    );
    const ProjectById = Resource.family<string, Project, never, ProjectApi>({
      name: "ResourceUiBinding.runtime-bound",
      load: (id) => ProjectApi.use((api) => api.get(id))
    });
    const controller = makeResourceUiBindingController<string, Project, never, ProjectApi, never>({
      runtime
    });
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const prefetched = yield* controller.prefetchEffect(ref);
        const refreshed = yield* controller.refreshEffect(ref);

        expect(prefetched).toEqual({ id: "atlas", name: "Atlas" });
        expect(refreshed).toEqual({ id: "atlas", name: "Atlas" });
      }).pipe(
        Effect.ensuring(Effect.sync(() => controller.dispose())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("keys automatic preload failures to the current ref and swallows observers", () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ResourceUiPreloadFailed" } as const;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ResourceUiBinding.preload-failure",
      load: (id) =>
        id === "fail"
          ? Effect.fail(failure)
          : Effect.succeed({ id, name: "Atlas" })
    });
    const failedRef = ProjectById("fail");
    const okRef = ProjectById("atlas");
    const changes: Array<typeof failure | undefined> = [];
    const observed: Array<typeof failure> = [];
    const controller = makeResourceUiBindingController<string, Project, typeof failure, never, never>({
      runtime,
      onPreloadFailureChange: (next) => {
        changes.push(next?.error);
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.startInitialPreload(failedRef, {
          onPreloadFailure: (error) => {
            observed.push(error);
            throw "observer failed";
          }
        });
        yield* Effect.sleep("20 millis");

        expect(controller.preloadFailureFor(failedRef)).toBe(failure);
        expect(observed).toEqual([failure]);

        controller.bindRef(okRef);

        expect(controller.preloadFailureFor(okRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();
      }).pipe(
        Effect.ensuring(Effect.sync(() => controller.dispose())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("dedupes Suspense preload host tokens per ref", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.suspense-token",
      load: (id) => Effect.succeed({ id, name: id })
    });
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiSuspensePreloadController<string, Project, never, never, never, object>(runtime);
    const toHostToken = () => ({});

    const firstToken = controller.hostToken(firstRef, { toHostToken });
    const sameToken = controller.hostToken(firstRef, { toHostToken });
    const secondToken = controller.hostToken(secondRef, { toHostToken });

    expect(sameToken).toBe(firstToken);
    expect(secondToken).not.toBe(firstToken);

    controller.dispose();
    return Effect.runPromise(runtime.disposeEffect);
  });
});
