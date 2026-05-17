import { Cause, Deferred, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  disposeResourceStoreEffect,
  makeResourceStore,
  makeRuntime,
  Resource,
  ResourceStoreDisposeError,
  ResourceStoreTypeId,
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
      }),
    );
  });

  it("shuts down its event pubsub when a module finalizer fails", () => {
    const store = makeResourceStore();
    let secondFinalizerRan = false;
    store.moduleRegistry.register(Symbol("failing-module"), {
      disposeEffect: Effect.fail("dispose failed"),
    });
    store.moduleRegistry.register(Symbol("second-module"), {
      disposeEffect: Effect.sync(() => {
        secondFinalizerRan = true;
      }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const error = yield* Effect.flip(disposeResourceStoreEffect(store));
        const shutdown = yield* store.diagnostics.eventBusShutdownEffect;
        const moduleCount = yield* store.diagnostics.moduleCountEffect;
        expect(error).toBeInstanceOf(ResourceStoreDisposeError);
        expect(error.cause.reasons.find(Cause.isFailReason)?.error).toBe("dispose failed");
        expect(shutdown).toBe(true);
        expect(moduleCount).toBe(0);
        expect(secondFinalizerRan).toBe(true);
      }),
    );
  });

  it("exposes stable diagnostics count snapshots without private store maps", () => {
    const runtime = makeRuntime();
    const ProjectTag = Resource.tag("ResourceStore.diagnostics.project");
    const Project = Resource.family({
      name: "ResourceStore.diagnostics.project",
      load: (id: string) => Effect.succeed({ id }),
      provides: () => [ProjectTag],
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
          tagCount: 1,
        });
        expect(familyCount).toBe(1);
        expect(tagCount).toBe(1);
        expect(runtime.resourceStore.diagnostics.snapshotUnsafe()).toEqual(snapshot);
        expect(snapshot).not.toHaveProperty("families");
        expect(snapshot).not.toHaveProperty("tagIndex");
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("ignores deletes for refs that were never present in the store", () => {
    const runtime = makeRuntime();
    const Project = Resource.family({
      name: "ResourceStore.delete-absent",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ref = Project("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* runtime.resourceStore.diagnostics.snapshotEffect;
        yield* runtime.provide(Resource.deleteEffect(ref));
        const after = yield* runtime.resourceStore.diagnostics.snapshotEffect;
        expect(after).toEqual(before);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("rejects structural ResourceStore adapters instead of raw mutable-map failures", () => {
    const runtime = makeRuntime();
    const store = makeResourceStore();
    const fakeStore = {
      [ResourceStoreTypeId]: ResourceStoreTypeId,
      eventBus: store.eventBus,
      moduleRegistry: store.moduleRegistry,
      fiberRegistry: store.fiberRegistry,
      diagnostics: store.diagnostics,
    };
    const Project = Resource.family({
      name: "ResourceStore.fake-adapter",
      load: (id: string) => Effect.succeed({ id }),
    });
    const provided = runtime.provide(Resource.prefetchEffect(Project("atlas")), {
      // @ts-expect-error structural ResourceStore adapters are intentionally rejected at runtime.
      resourceStore: fakeStore,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(provided);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
          expect(defect).toMatchObject({
            _tag: "InvalidResourceStore",
          });
        }
      }).pipe(
        Effect.ensuring(disposeResourceStoreEffect(store)),
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });

  it("rejects stores that spoof the old global implementation marker", () => {
    const runtime = makeRuntime();
    const store = makeResourceStore();
    const spoofedMarker = Symbol.for("@effect-ui/core/ResourceStoreImplementation");
    const fakeStore = {
      [ResourceStoreTypeId]: ResourceStoreTypeId,
      [spoofedMarker]: spoofedMarker,
      eventBus: store.eventBus,
      moduleRegistry: store.moduleRegistry,
      fiberRegistry: store.fiberRegistry,
      diagnostics: store.diagnostics,
    };
    const Project = Resource.family({
      name: "ResourceStore.fake-global-marker",
      load: (id: string) => Effect.succeed({ id }),
    });
    const provided = runtime.provide(Resource.prefetchEffect(Project("atlas")), {
      // @ts-expect-error the implementation marker is private and cannot be recreated with Symbol.for.
      resourceStore: fakeStore,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(provided);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
          expect(defect).toMatchObject({
            _tag: "InvalidResourceStore",
          });
        }
      }).pipe(
        Effect.ensuring(disposeResourceStoreEffect(store)),
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });

  it("untracks stale readEffect refresh fibers when they complete", () => {
    const runtime = makeRuntime();
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const releaseSecond = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Count = Resource.family({
      name: "ResourceStore.stale-read-fiber-cleanup",
      load: () =>
        Effect.gen(function* () {
          loads++;
          if (loads === 2) {
            yield* Deferred.succeed(secondStarted, undefined);
            yield* Deferred.await(releaseSecond);
          }
          return loads;
        }),
      policy: {
        staleFor: "1 millisecond",
      },
    });
    const ref = Count(undefined);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));
        yield* Effect.sleep("5 millis");

        const staleValue = yield* runtime.provide(Resource.readEffect(ref));
        expect(staleValue).toBe(1);

        yield* Deferred.await(secondStarted);
        const duringRefresh = yield* runtime.resourceStore.diagnostics.fiberCountEffect;
        expect(duringRefresh).toBe(2);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Effect.sleep("10 millis");

        const afterRefresh = yield* runtime.resourceStore.diagnostics.fiberCountEffect;
        expect(afterRefresh).toBe(0);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("does not retain synchronously completed stale readEffect refresh fibers", () => {
    const runtime = makeRuntime();
    let loads = 0;
    const Count = Resource.family({
      name: "ResourceStore.sync-stale-read-fiber-cleanup",
      load: () => Effect.succeed(++loads),
      policy: {
        staleFor: "1 millisecond",
      },
    });
    const ref = Count(undefined);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));
        yield* Effect.sleep("5 millis");

        const staleValue = yield* runtime.provide(Resource.readEffect(ref));
        expect(staleValue).toBe(1);
        expect(loads).toBe(2);

        const afterRefresh = yield* runtime.resourceStore.diagnostics.fiberCountEffect;
        expect(afterRefresh).toBe(0);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });
});
