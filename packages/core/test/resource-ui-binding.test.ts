import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  makeRuntime,
  Resource,
  resourceUiMatchState,
} from "../src/index.js";
import { resourceRefStoreKey } from "../src/resource-dependency-graph.js";
import { unsafeMutableResourceStore } from "../src/resource-store.js";

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
    const pending = resourceUiMatchState<void, string, string>(
      {
        _tag: "Pending",
        waiting: true,
        previous: undefined,
      },
      {
        initial: () => "initial",
        pending: (previous, meta) => `pending:${String(previous)}:${String(meta.hasPrevious)}`,
        success: () => "success",
        failure: () => "failure",
      },
    );
    const failure = resourceUiMatchState<void, string, string>(
      {
        _tag: "Failure",
        waiting: false,
        error: "failed",
        previous: undefined,
      },
      {
        initial: () => "initial",
        pending: () => "pending",
        success: () => "success",
        failure: (_error, previous, meta) =>
          `failure:${String(previous)}:${String(meta.hasPrevious)}`,
      },
    );

    expect(pending).toBe("pending:undefined:true");
    expect(failure).toBe("failure:undefined:true");
  });

  it("binds refresh and prefetch effects to the supplied runtime", () => {
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) => Effect.succeed({ id, name: id === "atlas" ? "Atlas" : id }),
      }),
    );
    const ProjectById = Resource.family<string, Project, never, ProjectApi>({
      name: "ResourceUiBinding.runtime-bound",
      load: (id) => ProjectApi.use((api) => api.get(id)),
    });
    const controller = makeResourceUiBindingController<string, Project, never, ProjectApi, never>({
      runtime,
    });
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        const prefetched = yield* controller.prefetchEffect(ref);
        const refreshed = yield* controller.refreshEffect(ref);

        expect(prefetched).toEqual({ id: "atlas", name: "Atlas" });
        expect(refreshed).toEqual({ id: "atlas", name: "Atlas" });
      }).pipe(Effect.ensuring(controller.disposeEffect()), Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("keys automatic preload failures to the current ref and swallows observers", () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ResourceUiPreloadFailed" } as const;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ResourceUiBinding.preload-failure",
      load: (id) => (id === "fail" ? Effect.fail(failure) : Effect.succeed({ id, name: "Atlas" })),
    });
    const failedRef = ProjectById("fail");
    const okRef = ProjectById("atlas");
    const changes: Array<typeof failure | undefined> = [];
    const observed: Array<typeof failure> = [];
    const observedThroughEffect: Array<typeof failure> = [];
    const controller = makeResourceUiBindingController<
      string,
      Project,
      typeof failure,
      never,
      never
    >({
      runtime,
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

        yield* runtime.provide(Resource.deleteEffect(failedRef));
        controller.startInitialPreload(failedRef, {
          onPreloadFailure: (error) =>
            Effect.sync(() => {
              observedThroughEffect.push(error);
            }).pipe(Effect.andThen(Effect.fail("observer effect failed"))),
        });
        yield* Effect.sleep("20 millis");

        expect(controller.preloadFailureFor(failedRef)).toBe(failure);
        expect(observedThroughEffect).toEqual([failure]);
      }).pipe(Effect.ensuring(controller.disposeEffect()), Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("clears keyed automatic preload failures after manual retry succeeds", () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ResourceUiRetryPreloadFailed" } as const;
    let shouldFail = true;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ResourceUiBinding.preload-failure-retry",
      load: (id) => (shouldFail ? Effect.fail(failure) : Effect.succeed({ id, name: "Atlas" })),
    });
    const prefetchRef = ProjectById("prefetch");
    const refreshRef = ProjectById("refresh");
    const changes: Array<typeof failure | undefined> = [];
    const controller = makeResourceUiBindingController<
      string,
      Project,
      typeof failure,
      never,
      never
    >({
      runtime,
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
        expect(yield* controller.prefetchEffect(prefetchRef)).toEqual({
          id: "prefetch",
          name: "Atlas",
        });
        expect(controller.preloadFailureFor(prefetchRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();

        shouldFail = true;
        controller.startInitialPreload(refreshRef);
        yield* Effect.sleep("20 millis");
        expect(controller.preloadFailureFor(refreshRef)).toBe(failure);

        shouldFail = false;
        expect(yield* controller.refreshEffect(refreshRef)).toEqual({
          id: "refresh",
          name: "Atlas",
        });
        expect(controller.preloadFailureFor(refreshRef)).toBeUndefined();
        expect(changes.at(-1)).toBeUndefined();
      }).pipe(Effect.ensuring(controller.disposeEffect()), Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("swallows automatic preload defects after retaining typed preload failures", () => {
    const baseRuntime = makeRuntime();
    let preloadFiber: Fiber.Fiber<unknown, unknown> | undefined;
    const runtime = {
      ...baseRuntime,
      runFork: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: Effect.RunOptions,
      ): Fiber.Fiber<A, E> => {
        const fiber = baseRuntime.runFork(effect, options);
        preloadFiber = fiber;
        return fiber;
      },
    };
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.preload-defect",
      load: () => Effect.die("preload defect"),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
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
        Effect.ensuring(controller.disposeEffect()),
        Effect.ensuring(baseRuntime.disposeEffect),
      ),
    );
  });

  it("serializes retained refs across rapid ref changes", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.retention-order",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(firstRef);
        controller.bindRef(secondRef);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(secondRef), 1]]);
      }).pipe(Effect.ensuring(controller.disposeEffect()), Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("disposeEffect releases retained refs before completing", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.dispose-retention",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);

        yield* controller.disposeEffect();

        expect([...store.retainedRefs.entries()]).toEqual([]);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("disposeEffect swallows preload failure observer defects", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.dispose-observer-defect",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    let observerCalls = 0;
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
      onPreloadFailureChange: () => {
        observerCalls++;
        throw new Error("host setter gone");
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* controller.disposeEffect();

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([]);
        expect(observerCalls).toBeGreaterThan(0);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("interrupts automatic preloads through an awaitable Effect", () => {
    const runtime = makeRuntime();
    return Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let releases = 0;
        const ProjectById = Resource.family<string, Project>({
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
        const controller = makeResourceUiBindingController({ runtime });
        const ref = ProjectById("atlas");

        controller.startInitialPreload(ref);
        yield* Deferred.await(started);
        yield* controller.interruptPreloadEffect();

        expect(releases).toBe(1);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("disposeEffect lets the same ref bind retain again after cleanup replay", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.dispose-rebind",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const ref = ProjectById("atlas");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(runtime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);

        yield* controller.disposeEffect();
        expect([...store.retainedRefs.entries()]).toEqual([]);

        controller.bindRef(ref);
        yield* Effect.sleep("20 millis");
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(ref), 1]]);
      }).pipe(Effect.ensuring(controller.disposeEffect()), Effect.ensuring(runtime.disposeEffect)),
    );
  });

  it("captures retained refs before queued sync disposal executes", () => {
    const baseRuntime = makeRuntime();
    const queuedDisposals: Array<Effect.Effect<void>> = [];
    let queueNextDispose = false;
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      runFork: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: Effect.RunOptions,
      ): Fiber.Fiber<A, E> => {
        if (queueNextDispose) {
          queueNextDispose = false;
          queuedDisposals.push(effect as Effect.Effect<void>);
          return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
        }
        return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
      },
    };
    const ProjectById = Resource.family<string, Project>({
      name: "ResourceUiBinding.queued-dispose-owner",
      load: (id) => Effect.succeed({ id, name: id }),
    });
    const firstRef = ProjectById("first");
    const secondRef = ProjectById("second");
    const controller = makeResourceUiBindingController<string, Project, never, never, never>({
      runtime,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        controller.bindRef(firstRef);
        yield* Effect.sleep("20 millis");

        const store = unsafeMutableResourceStore(baseRuntime.resourceStore);
        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(firstRef), 1]]);

        queueNextDispose = true;
        controller.dispose();
        controller.bindRef(secondRef);
        yield* Effect.sleep("20 millis");

        expect(queuedDisposals).toHaveLength(1);
        expect([...store.retainedRefs.entries()]).toEqual([
          [resourceRefStoreKey(firstRef), 1],
          [resourceRefStoreKey(secondRef), 1],
        ]);

        yield* queuedDisposals[0]!;
        yield* Effect.sleep("20 millis");

        expect([...store.retainedRefs.entries()]).toEqual([[resourceRefStoreKey(secondRef), 1]]);
      }).pipe(
        Effect.ensuring(controller.disposeEffect()),
        Effect.ensuring(baseRuntime.disposeEffect),
      ),
    );
  });

  it("dedupes Suspense preload host tokens per ref", () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
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
    >(runtime);
    const toHostToken = () => ({});

    const firstToken = controller.hostToken(firstRef, { toHostToken });
    const sameToken = controller.hostToken(firstRef, { toHostToken });
    const secondToken = controller.hostToken(secondRef, { toHostToken });

    expect(sameToken).toBe(firstToken);
    expect(secondToken).not.toBe(firstToken);

    controller.dispose();
    return Effect.runPromise(runtime.disposeEffect);
  });

  it("captures Suspense preload owners before queued sync interruption executes", () => {
    const baseRuntime = makeRuntime();
    const queuedInterrupts: Array<Effect.Effect<void>> = [];
    let queueNextInterrupt = false;
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      runFork: <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: Effect.RunOptions,
      ): Fiber.Fiber<A, E> => {
        if (queueNextInterrupt) {
          queueNextInterrupt = false;
          queuedInterrupts.push(effect as Effect.Effect<void>);
          return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
        }
        return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
      },
    };
    const starts: Array<string> = [];
    const finalizers: Array<string> = [];
    const ProjectById = Resource.family<string, Project>({
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
    >(runtime);

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

        yield* controller.disposeEffect();
        expect(finalizers).toEqual(["first", "second"]);
      }).pipe(
        Effect.ensuring(controller.disposeEffect()),
        Effect.ensuring(baseRuntime.disposeEffect),
      ),
    );
  });

  it("disposes Suspense preload joins through an awaitable Effect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        let releases = 0;
        const ProjectById = Resource.family<string, Project>({
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
          never,
          never,
          Fiber.Fiber<Project, Resource.LoadError<never>>
        >(runtime);

        controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        yield* Deferred.await(started);
        yield* controller.disposeEffect();

        expect(releases).toBe(1);
        yield* runtime.disposeEffect;
      }),
    ));

  it("clears completed Suspense preload tokens before same-ref reloads", () => {
    const runtime = makeRuntime();
    let loads = 0;
    const ProjectById = Resource.family<string, Project>({
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
    >(runtime);

    return Effect.runPromise(
      Effect.gen(function* () {
        const firstFiber = controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        expect(yield* Fiber.join(firstFiber)).toEqual({ id: "atlas", name: "Atlas 1" });

        yield* runtime.provide(Resource.deleteEffect(ref));

        const secondFiber = controller.hostToken(ref, {
          toHostToken: (preloadFiber) => preloadFiber,
        });
        expect(secondFiber).not.toBe(firstFiber);
        expect(yield* Fiber.join(secondFiber)).toEqual({ id: "atlas", name: "Atlas 2" });
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.sync(() => controller.dispose())),
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });

  it("runs default Suspense preload fibers in a Scope", () => {
    const runtime = makeRuntime();
    let releases = 0;
    const ProjectById = Resource.family<string, Project, never, Scope.Scope>({
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
    >(runtime);
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
        Effect.ensuring(Effect.sync(() => controller.dispose())),
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });
});
