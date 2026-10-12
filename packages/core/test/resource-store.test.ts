import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  disposeResourceStore,
  makeResourceStore,
  makeRuntime,
  Resource,
  ResourceStoreDisposeError,
  ResourceStoreTypeId,
} from "../src/index.js";

interface UnrefTimer {
  unref: () => unknown;
}

const hasUnref = (timer: unknown): timer is UnrefTimer =>
  typeof timer === "object" &&
  timer !== null &&
  "unref" in timer &&
  typeof timer.unref === "function";

describe("Resource Store disposal", () => {
  it("shuts down its event pubsub", () => {
    const store = makeResourceStore();

    expect(Effect.runSync(store.eventBus.isShutdown)).toBe(false);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* disposeResourceStore(store);
        const shutdown = yield* store.diagnostics.eventBusShutdown;
        expect(shutdown).toBe(true);
        yield* disposeResourceStore(store);
      }),
    );
  });

  it("interrupts GC timers and in-flight loads when disposed, and refuses later work", () => {
    const runtime = makeRuntime();
    const loadStarted = Deferred.makeUnsafe<void>();
    let loadInterrupted = false;
    const Cached = Resource.define({
      name: "ResourceStore.dispose.gc",
      load: () => Effect.succeed(1),
      policy: { gcFor: "10 minutes" },
    });
    const Hanging = Resource.define({
      name: "ResourceStore.dispose.in-flight",
      load: () =>
        Deferred.succeed(loadStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              loadInterrupted = true;
            }),
          ),
        ),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.preload(Cached(undefined)));
        const hanging = yield* Effect.forkDetach(
          runtime.provide(Resource.preload(Hanging(undefined))),
        );
        yield* Deferred.await(loadStarted);
        // The load signals from inside its fiber's first synchronous run; yield so
        // the store finishes registering that fiber.
        yield* Effect.yieldNow;
        expect(yield* runtime.resourceStore.diagnostics.fiberCount).toBe(2);

        yield* runtime.dispose;

        expect(loadInterrupted).toBe(true);
        expect(yield* runtime.resourceStore.diagnostics.fiberCount).toBe(0);
        expect(Exit.hasInterrupts(yield* Fiber.await(hanging))).toBe(true);

        let ranAfterDispose = false;
        const late = yield* runtime.resourceStore.fiberRegistry.run(
          Effect.sync(() => {
            ranAfterDispose = true;
          }),
        );
        expect(Exit.hasInterrupts(yield* Fiber.await(late))).toBe(true);
        expect(ranAfterDispose).toBe(false);
        expect(yield* runtime.resourceStore.diagnostics.fiberCount).toBe(0);
      }),
    );
  });

  it("shuts down its event pubsub when a module finalizer fails", () => {
    const store = makeResourceStore();
    let secondFinalizerRan = false;
    store.moduleRegistry.register(Symbol("failing-module"), {
      dispose: Effect.fail("dispose failed"),
    });
    store.moduleRegistry.register(Symbol("second-module"), {
      dispose: Effect.sync(() => {
        secondFinalizerRan = true;
      }),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const error = yield* Effect.flip(disposeResourceStore(store));
        const shutdown = yield* store.diagnostics.eventBusShutdown;
        const moduleCount = yield* store.diagnostics.moduleCount;
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
    const Project = Resource.define({
      name: "ResourceStore.diagnostics.project",
      load: (id: string) => Effect.succeed({ id }),
      provides: () => [ProjectTag],
    });

    runtime.resourceStore.moduleRegistry.register(Symbol("diagnostics-module"), {});

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.preload(Project("atlas")));
        const snapshot = yield* runtime.resourceStore.diagnostics.snapshot;
        const familyCount = yield* runtime.resourceStore.diagnostics.familyCount;
        const tagCount = yield* runtime.resourceStore.diagnostics.tagCount;

        expect(snapshot).toEqual({
          fiberCount: 0,
          familyCount: 1,
          moduleCount: 1,
          tagCount: 1,
        });
        expect(familyCount).toBe(1);
        expect(tagCount).toBe(1);
        expect(Effect.runSync(runtime.resourceStore.diagnostics.snapshot)).toEqual(snapshot);
        expect(snapshot).not.toHaveProperty("families");
        expect(snapshot).not.toHaveProperty("tagIndex");
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("ignores deletes for refs that were never present in the store", () => {
    const runtime = makeRuntime();
    const Project = Resource.define({
      name: "ResourceStore.delete-absent",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ref = Project("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* runtime.resourceStore.diagnostics.snapshot;
        yield* runtime.provide(Resource.evict(ref));
        const after = yield* runtime.resourceStore.diagnostics.snapshot;
        expect(after).toEqual(before);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
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
    const Project = Resource.define({
      name: "ResourceStore.fake-adapter",
      load: (id: string) => Effect.succeed({ id }),
    });
    const provided = runtime.provide(Resource.preload(Project("atlas")), {
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
        Effect.ensuring(Effect.orDie(disposeResourceStore(store))),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("rejects stores that spoof the old global implementation marker", () => {
    const runtime = makeRuntime();
    const store = makeResourceStore();
    const spoofedMarker = Symbol.for("@sunfall/arc-core/ResourceStoreImplementation");
    const fakeStore = {
      [ResourceStoreTypeId]: ResourceStoreTypeId,
      [spoofedMarker]: spoofedMarker,
      eventBus: store.eventBus,
      moduleRegistry: store.moduleRegistry,
      fiberRegistry: store.fiberRegistry,
      diagnostics: store.diagnostics,
    };
    const Project = Resource.define({
      name: "ResourceStore.fake-global-marker",
      load: (id: string) => Effect.succeed({ id }),
    });
    const provided = runtime.provide(Resource.preload(Project("atlas")), {
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
        Effect.ensuring(Effect.orDie(disposeResourceStore(store))),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("untracks stale read refresh fibers when they complete", () => {
    const runtime = makeRuntime();
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const releaseSecond = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Count = Resource.define({
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
        yield* runtime.provide(Resource.preload(ref));
        yield* Effect.sleep("5 millis");

        const staleValue = yield* runtime.provide(Resource.read(ref));
        expect(staleValue).toBe(1);

        yield* Deferred.await(secondStarted);
        const duringRefresh = yield* runtime.resourceStore.diagnostics.fiberCount;
        expect(duringRefresh).toBe(2);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Effect.sleep("10 millis");

        const afterRefresh = yield* runtime.resourceStore.diagnostics.fiberCount;
        expect(afterRefresh).toBe(0);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("does not retain synchronously completed stale read refresh fibers", () => {
    const runtime = makeRuntime();
    let loads = 0;
    const Count = Resource.define({
      name: "ResourceStore.sync-stale-read-fiber-cleanup",
      load: () => Effect.succeed(++loads),
      policy: {
        staleFor: "1 millisecond",
      },
    });
    const ref = Count(undefined);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.preload(ref));
        yield* Effect.sleep("5 millis");

        const staleValue = yield* runtime.provide(Resource.read(ref));
        expect(staleValue).toBe(1);
        expect(loads).toBe(2);

        const afterRefresh = yield* runtime.resourceStore.diagnostics.fiberCount;
        expect(afterRefresh).toBe(0);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("unrefs resource gc timers when the host timer supports it", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let unrefCalls = 0;

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const timer: unknown = originalSetTimeout(handler, timeout, ...args);
      if (hasUnref(timer)) {
        const originalUnref = timer.unref.bind(timer);
        timer.unref = () => {
          unrefCalls++;
          return originalUnref();
        };
      }
      return timer;
    }) as typeof globalThis.setTimeout;

    const runtime = makeRuntime();
    const Count = Resource.define({
      name: "ResourceStore.unref-gc-timer",
      load: () => Effect.succeed(1),
      policy: {
        gcFor: "10 minutes",
      },
    });

    try {
      await Effect.runPromise(
        runtime
          .provide(Resource.preload(Count(undefined)))
          .pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
      );
      expect(unrefCalls).toBeGreaterThan(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
