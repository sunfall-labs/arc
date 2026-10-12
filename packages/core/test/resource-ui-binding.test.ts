import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import { makeRuntime, Resource } from "../src/index.js";
import {
  eraseRuntime,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
} from "../src/internal.js";
import { resourceRefStoreKey } from "../src/resource-dependency-graph.js";
import { unsafeMutableResourceStore } from "../src/resource-store.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-core/test/ResourceUiProjectApi");

describe("Resource UI Binding Controller", () => {
  it("exposes undefined previous values through the bound AsyncResult", async () => {
    const runtime = makeRuntime();
    let fail = false;
    const Maybe = Resource.define<void, undefined, string>({
      name: "ResourceUi.undefined-previous",
      load: () => (fail ? Effect.fail("failed") : Effect.succeed(undefined)),
    });
    const ref = Maybe(undefined);
    const controller = makeResourceUiBindingController<void, undefined, string>({
      runtime: eraseRuntime(runtime),
    });

    try {
      await Effect.runPromise(controller.preload(ref));
      fail = true;
      await Effect.runPromise(Effect.exit(controller.refresh(ref)));

      const result = controller.result(ref).get();
      expect(result).toMatchObject({ _tag: "Failure", waiting: false });
      expect(AsyncResult.error(result)).toEqual(Option.some("failed"));
      expect(AsyncResult.value(result)).toEqual(Option.some(undefined));
    } finally {
      await Effect.runPromise(controller.dispose());
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("binds refresh and preload effects to the supplied runtime", () => {
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) => Effect.succeed({ id, name: id === "atlas" ? "Atlas" : id }),
      }),
    );
    const ProjectById = Resource.define<string, Project, never, ProjectApi>({
      name: "ResourceUiBinding.runtime-bound",
      load: (id) => ProjectApi.use((api) => api.get(id)),
    });
    const controller = makeResourceUiBindingController<string, Project, never, ProjectApi, never>({
      runtime: eraseRuntime(runtime),
    });
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const prefetched = yield* controller.preload(ref);
        const refreshed = yield* controller.refresh(ref);

        expect(prefetched).toEqual({ id: "atlas", name: "Atlas" });
        expect(refreshed).toEqual({ id: "atlas", name: "Atlas" });
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("keys automatic preload failures to the current ref and swallows observers", () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ResourceUiPreloadFailed" } as const;
    const ProjectById = Resource.define<string, Project, typeof failure>({
      name: "ResourceUiBinding.preload-failure",
      load: (id) => (id === "fail" ? Effect.fail(failure) : Effect.succeed({ id, name: "Atlas" })),
    });
    const failedRef = ProjectById("fail");
    const okRef = ProjectById("atlas");
    const changes: Array<Resource.LoadError<typeof failure> | undefined> = [];
    const observed: Array<Resource.LoadError<typeof failure>> = [];
    const observedThroughEffect: Array<Resource.LoadError<typeof failure>> = [];
    const controller = makeResourceUiBindingController<
      string,
      Project,
      typeof failure,
      never,
      never
    >({
      runtime: eraseRuntime(runtime),
      onPreloadFailureChange: (next) => {
        changes.push(next?.error);
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.startInitialPreload(failedRef, {
          onPreloadFailure: (error) => {
            observed.push(error);
            throw "observer failed";
          },
        });
        yield* Effect.sleep("20 millis");

        expect(controller.preloadFailureFor(failedRef)).toBe(failure);
        expect(observed).toEqual([failure]);

        controller.bindRef(okRef);

        expect(controller.preloadFailureFor(okRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();

        yield* runtime.provide(Resource.evict(failedRef));
        controller.startInitialPreload(failedRef, {
          onPreloadFailure: (error) =>
            Effect.sync(() => {
              observedThroughEffect.push(error);
            }).pipe(Effect.andThen(Effect.fail("observer effect failed"))),
        });
        yield* Effect.sleep("20 millis");

        expect(controller.preloadFailureFor(failedRef)).toBe(failure);
        expect(observedThroughEffect).toEqual([failure]);
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("clears keyed automatic preload failures after manual retry succeeds", () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ResourceUiRetryPreloadFailed" } as const;
    let shouldFail = true;
    const ProjectById = Resource.define<string, Project, typeof failure>({
      name: "ResourceUiBinding.preload-failure-retry",
      load: (id) => (shouldFail ? Effect.fail(failure) : Effect.succeed({ id, name: "Atlas" })),
    });
    const prefetchRef = ProjectById("preload");
    const refreshRef = ProjectById("refresh");
    const changes: Array<Resource.LoadError<typeof failure> | undefined> = [];
    const controller = makeResourceUiBindingController<
      string,
      Project,
      typeof failure,
      never,
      never
    >({
      runtime: eraseRuntime(runtime),
      onPreloadFailureChange: (next) => {
        changes.push(next?.error);
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.startInitialPreload(prefetchRef);
        yield* Effect.sleep("20 millis");
        expect(controller.preloadFailureFor(prefetchRef)).toBe(failure);

        shouldFail = false;
        expect(yield* controller.preload(prefetchRef)).toEqual({
          id: "preload",
          name: "Atlas",
        });
        expect(controller.preloadFailureFor(prefetchRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();

        shouldFail = true;
        controller.startInitialPreload(refreshRef);
        yield* Effect.sleep("20 millis");
        expect(controller.preloadFailureFor(refreshRef)).toBe(failure);

        shouldFail = false;
        expect(yield* controller.refresh(refreshRef)).toEqual({
          id: "refresh",
          name: "Atlas",
        });
        expect(controller.preloadFailureFor(refreshRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("swallows automatic preload defects after retaining typed preload failures", () => {
    const baseRuntime = makeRuntime();
    let preloadFiber: Fiber.Fiber<unknown, unknown> | undefined;
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      runFork: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: Effect.RunOptions,
      ): Fiber.Fiber<A, E> => {
        const fiber = baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
        preloadFiber = fiber;
        return fiber;
      },
    };
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.preload-defect",
      load: () => Effect.die("preload defect"),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime: eraseRuntime(runtime),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.startInitialPreload(ref);
        if (preloadFiber === undefined) {
          expect.fail("Expected automatic preload fiber to be captured.");
        }

        const exit = yield* Fiber.await(preloadFiber);

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(controller.preloadFailureFor(ref)).toBeUndefined();
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(baseRuntime.dispose)),
      ),
    );
  });

  it("serializes retained refs across rapid ref changes", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.retention-order",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime: eraseRuntime(runtime),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(firstRef);
        controller.bindRef(secondRef);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(secondRef), 1]]);
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("dispose releases retained refs before completing", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.dispose-retention",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime: eraseRuntime(runtime),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);

        yield* controller.dispose();

        expect([...store.retainedRefs.entries()]).toEqual([]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("dispose swallows preload failure observer defects", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.dispose-observer-defect",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    let observerCalls = 0;
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime: eraseRuntime(runtime),
      onPreloadFailureChange: () => {
        observerCalls++;
        throw new Error("host setter gone");
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* controller.dispose();

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([]);
        expect(observerCalls).toBeGreaterThan(0);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("interrupts automatic preloads through an awaitable Effect", () => {
    const runtime = makeRuntime();
    return Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let releases = 0;
        // The load acquires a resource in the caller's Scope, so the family requires it.
        const ProjectById = Resource.define<string, Project, never, Scope.Scope>({
          name: "ResourceUiBinding.interrupt-preload-effect",
          load: (id) =>
            Effect.acquireRelease(
              Deferred.succeed(started, undefined).pipe(Effect.as({ id, name: id })),
              () =>
                Effect.sync(() => {
                  releases++;
                }),
            ).pipe(Effect.andThen(Effect.never)),
        });
        const controller = makeResourceUiBindingController<
          string,
          Project,
          never,
          Scope.Scope,
          never
        >({
          runtime: eraseRuntime(runtime),
        });
        const ref = ProjectById("atlas");

        controller.startInitialPreload(ref);
        yield* Deferred.await(started);
        yield* controller.interruptPreload();

        expect(releases).toBe(1);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("dispose lets the same ref bind retain again after cleanup replay", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.dispose-rebind",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime: eraseRuntime(runtime),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);

        yield* controller.dispose();
        expect([...store.retainedRefs.entries()]).toEqual([]);

        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("dedupes Suspense preload host tokens per ref", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.suspense-token",
      load: (id) => Effect.never.pipe(Effect.as({ id, name: id })),
    });
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiSuspensePreloadController<
      string,
      Project,
      never,
      never,
      never,
      object
    >(eraseRuntime(runtime));
    const toHostToken = () => ({});

    const firstToken = controller.hostToken(firstRef, { toHostToken });
    const sameToken = controller.hostToken(firstRef, { toHostToken });
    const secondToken = controller.hostToken(secondRef, { toHostToken });

    expect(sameToken).toBe(firstToken);
    expect(secondToken).not.toBe(firstToken);

    return Effect.runPromise(Effect.andThen(controller.dispose(), runtime.dispose));
  });

  it("captures Suspense preload owners before queued sync interruption executes", () => {
    const baseRuntime = makeRuntime();
    const queuedInterrupts: Array<Effect.Effect<void, unknown>> = [];
    let queueNextInterrupt = false;
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      runFork: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: Effect.RunOptions,
      ): Fiber.Fiber<A, E> => {
        if (queueNextInterrupt) {
          queueNextInterrupt = false;
          queuedInterrupts.push(Effect.asVoid(effect as Effect.Effect<A, E, never>));
          return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
        }
        return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
      },
    };
    const starts: Array<string> = [];
    const finalizers: Array<string> = [];
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.suspense-queued-owner",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    let nextForkLabel = "first";
    const fork = (): Fiber.Fiber<Project, Resource.LoadError<never>> => {
      const label = nextForkLabel;
      const preloadEffect = Effect.sync(() => {
        starts.push(label);
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(
          Effect.sync(() => {
            finalizers.push(label);
          }),
        ),
      ) as Effect.Effect<Project, Resource.LoadError<never>, never>;
      return baseRuntime.runFork(preloadEffect);
    };
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiSuspensePreloadController<
      string,
      Project,
      never,
      never,
      never,
      Fiber.Fiber<Project, Resource.LoadError<never>>
    >(eraseRuntime(runtime));

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.hostToken(firstRef, {
          fork,
          toHostToken: (preloadFiber) => preloadFiber,
        });
        yield* Effect.sleep("20 millis");
        expect(starts).toEqual(["first"]);

        queueNextInterrupt = true;
        nextForkLabel = "second";
        controller.hostToken(secondRef, {
          fork,
          toHostToken: (preloadFiber) => preloadFiber,
        });
        yield* Effect.sleep("20 millis");
        expect(starts).toEqual(["first", "second"]);
        expect(queuedInterrupts).toHaveLength(1);

        yield* queuedInterrupts[0]!;
        yield* Effect.sleep("20 millis");
        expect(finalizers).toEqual(["first"]);

        yield* controller.dispose();
        expect(finalizers).toEqual(["first", "second"]);
      }).pipe(
        Effect.ensuring(controller.dispose()),
        Effect.ensuring(Effect.orDie(baseRuntime.dispose)),
      ),
    );
  });

  it("disposes Suspense preload joins through an awaitable Effect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        let releases = 0;
        // The load acquires a resource in the caller's Scope, so the family requires it.
        const ProjectById = Resource.define<string, Project, never, Scope.Scope>({
          name: "ResourceUiBinding.suspense-dispose-effect",
          load: (id) =>
            Effect.acquireRelease(
              Deferred.succeed(started, undefined).pipe(Effect.as({ id, name: id })),
              () =>
                Effect.sync(() => {
                  releases++;
                }),
            ).pipe(Effect.andThen(Effect.never)),
        });
        const ref = ProjectById("atlas");
        const controller = makeResourceUiSuspensePreloadController<
          string,
          Project,
          never,
          Scope.Scope,
          never,
          Fiber.Fiber<Project, Resource.LoadError<never>>
        >(eraseRuntime(runtime));

        controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        yield* Deferred.await(started);
        yield* controller.dispose();

        expect(releases).toBe(1);
        yield* runtime.dispose;
      }),
    ));

  it("clears completed Suspense preload tokens before same-ref reloads", () => {
    const runtime = makeRuntime();
    let loads = 0;
    const ProjectById = Resource.define<string, Project>({
      name: "ResourceUiBinding.suspense-completed-token",
      load: (id) =>
        Effect.sync(() => {
          loads++;
          return { id, name: `Atlas ${loads}` };
        }),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiSuspensePreloadController<
      string,
      Project,
      never,
      never,
      never,
      Fiber.Fiber<Project, Resource.LoadError<never>>
    >(eraseRuntime(runtime));

    return Effect.runPromise(
      Effect.gen(function* () {
        const firstFiber = controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        expect(yield* Fiber.join(firstFiber)).toEqual({ id: "atlas", name: "Atlas 1" });

        yield* runtime.provide(Resource.evict(ref));

        const secondFiber = controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        expect(secondFiber).not.toBe(firstFiber);
        expect(yield* Fiber.join(secondFiber)).toEqual({ id: "atlas", name: "Atlas 2" });
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.suspend(() => controller.dispose())),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("runs default Suspense preload fibers in a Scope", () => {
    const runtime = makeRuntime();
    let releases = 0;
    const ProjectById = Resource.define<string, Project, never, Scope.Scope>({
      name: "ResourceUiBinding.suspense-default-scoped",
      load: (id) =>
        Effect.acquireRelease(Effect.succeed({ id, name: "Atlas" }), () =>
          Effect.sync(() => {
            releases++;
          }),
        ),
    });
    const controller = makeResourceUiSuspensePreloadController<
      string,
      Project,
      never,
      Scope.Scope,
      never,
      Fiber.Fiber<Project, Resource.LoadError<never>>
    >(eraseRuntime(runtime));
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const fiber = controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        const project = yield* Fiber.join(fiber);

        expect(project).toEqual({ id: "atlas", name: "Atlas" });
        expect(releases).toBe(1);
      }).pipe(
        Effect.ensuring(Effect.suspend(() => controller.dispose())),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });
});
