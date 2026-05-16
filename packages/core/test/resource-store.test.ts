import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  disposeResourceStoreEffect,
  makeResourceStore,
  makeRuntime,
  Resource
} from "../src/index.js";

describe("Resource Store disposal", () => {
  it("shuts down its event pubsub", () => {
    const store = makeResourceStore();

    expect(store.eventBus.isShutdownUnsafe()).toBe(false);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* disposeResourceStoreEffect(store);
        const shutdown = yield* store.diagnostics.eventBusShutdownEffect;
        expect(shutdown).toBe(true);
        yield* disposeResourceStoreEffect(store);
      })
    );
  });

  it("shuts down its event pubsub when a module finalizer fails", () => {
    const store = makeResourceStore();
    let secondFinalizerRan = false;
    store.moduleRegistry.register(Symbol("failing-module"), {
      disposeEffect: Effect.fail("dispose failed")
    });
    store.moduleRegistry.register(Symbol("second-module"), {
      disposeEffect: Effect.sync(() => {
        secondFinalizerRan = true;
      })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.flip(disposeResourceStoreEffect(store));
        const shutdown = yield* store.diagnostics.eventBusShutdownEffect;
        const moduleCount = yield* store.diagnostics.moduleCountEffect;
        expect(shutdown).toBe(true);
        expect(moduleCount).toBe(0);
        expect(secondFinalizerRan).toBe(true);
      })
    );
  });

  it("exposes stable diagnostics count snapshots without private store maps", () => {
    const runtime = makeRuntime();
    const ProjectTag = Resource.tag("ResourceStore.diagnostics.project");
    const Project = Resource.family({
      name: "ResourceStore.diagnostics.project",
      load: (id: string) => Effect.succeed({ id }),
      provides: () => [ProjectTag]
    });

    runtime.resourceStore.moduleRegistry.register(Symbol("diagnostics-module"), {});

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(Project("atlas")));
        const snapshot = yield* runtime.resourceStore.diagnostics.snapshotEffect;
        const familyCount = yield* runtime.resourceStore.diagnostics.familyCountEffect;
        const tagCount = yield* runtime.resourceStore.diagnostics.tagCountEffect;

        expect(snapshot).toEqual({
          fiberCount: 0,
          familyCount: 1,
          moduleCount: 1,
          tagCount: 1
        });
        expect(familyCount).toBe(1);
        expect(tagCount).toBe(1);
        expect(runtime.resourceStore.diagnostics.snapshotUnsafe()).toEqual(snapshot);
        expect(snapshot).not.toHaveProperty("families");
        expect(snapshot).not.toHaveProperty("tagIndex");
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });
});
