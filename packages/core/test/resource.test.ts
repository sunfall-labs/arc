import { Deferred, Effect, PubSub, Schedule, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeRuntime, read, Resource, ResourceFailure, runWithRuntime } from "../src/index.js";

describe("Resource", () => {
  it("loads on first read and returns cached values afterward", async () => {
    const load = vi.fn((id: string) => Effect.succeed({ id, name: "Ada" }));
    const User = Resource.family({
      name: "User.byId",
      load
    });

    const ref = User("1");
    expect(() => read(ref)).toThrow();
    await Effect.runPromise(Resource.prefetchEffect(ref));

    expect(read(ref)).toEqual({ id: "1", name: "Ada" });
    expect(read(ref)).toEqual({ id: "1", name: "Ada" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("exposes resource family and tag diagnostics", () => {
    const ProjectTag = Resource.tag<{ readonly id: string }>("Project.diagnostics-tag", {
      key: ({ id }) => id
    });
    Resource.tag("Project.diagnostics-all");
    Resource.family({
      name: "Project.diagnostics",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
      load: (input: { readonly id: string }) => Effect.succeed(input),
      provides: (project) => [ProjectTag({ id: project.id })],
      policy: {
        staleFor: "20 seconds",
        gcFor: "5 minutes",
        retry: Schedule.recurs(1)
      }
    });

    const diagnostics = Resource.diagnostics();

    expect(diagnostics.families).toEqual(
      expect.arrayContaining([
        {
          name: "Project.diagnostics",
          inputSchema: true,
          outputSchema: true,
          errorSchema: false,
          providesTags: true,
          policy: {
            staleFor: "20 seconds",
            gcFor: "5 minutes",
            retry: true
          }
        }
      ])
    );
    expect(diagnostics.tags).toEqual(
      expect.arrayContaining([
        {
          name: "Project.diagnostics-all",
          keyed: false
        },
        {
          name: "Project.diagnostics-tag",
          keyed: true
        }
      ])
    );
  });

  it("deduplicates in-flight refreshes", async () => {
    const load = vi.fn(() => Effect.succeed(1));
    const Count = Resource.family({
      name: "Count",
      load
    });
    const ref = Count(undefined);

    await Effect.runPromise(
      Effect.all([
        Resource.prefetchEffect(ref),
        Resource.prefetchEffect(ref)
      ], { concurrency: "unbounded" })
    );

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("uses Effect cache entries for prefetch and forced refresh", async () => {
    let count = 0;
    const Count = Resource.family({
      name: "Count.effect-cache",
      load: () => Effect.sync(() => ++count)
    });
    const ref = Count(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(read(ref)).toBe(1);
    expect(count).toBe(1);

    await Effect.runPromise(Resource.refreshEffect(ref));
    expect(read(ref)).toBe(2);
    expect(count).toBe(2);
  });

  it("scopes resource cache entries to the current runtime store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    let count = 0;
    const Count = Resource.family({
      name: "Count.runtime-store",
      load: () => Effect.sync(() => ++count)
    });
    const ref = Count(undefined);

    try {
      await first.runPromise(Resource.prefetchEffect(ref));
      expect(runWithRuntime(first, () => read(ref))).toBe(1);
      expect(runWithRuntime(second, () => Resource.result(ref).get()._tag)).toBe("Initial");

      await second.runPromise(Resource.prefetchEffect(ref));

      expect(runWithRuntime(second, () => read(ref))).toBe(2);
      expect(runWithRuntime(first, () => read(ref))).toBe(1);
      expect(count).toBe(2);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("records semantic tags and invalidates matching resource refs", async () => {
    const ProjectTag = Resource.tag<{ readonly id: string }>("Project.resource-test", {
      key: ({ id }) => id
    });
    let project = { id: "atlas", name: "Atlas" };
    const load = vi.fn((id: string) => Effect.succeed({ ...project, id }));
    const Project = Resource.family({
      name: "Project.tag-resource-test",
      load,
      provides: (value) => [ProjectTag({ id: value.id })]
    });
    const ref = Project("atlas");

    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(Resource.refsForTag(ProjectTag({ id: "atlas" })).map((tagRef) => tagRef.key)).toContain(ref.key);

    project = { id: "atlas", name: "Renamed" };
    await Effect.runPromise(Resource.invalidateEffect(ProjectTag({ id: "atlas" })));

    expect(read(ref)).toEqual({ id: "atlas", name: "Renamed" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("scopes the resource dependency graph to the current runtime store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const ProjectTag = Resource.tag("Project.runtime-store-tag");
    const Project = Resource.family({
      name: "Project.runtime-store-tag",
      load: (id: string) => Effect.succeed({ id }),
      provides: () => [ProjectTag]
    });
    const ref = Project("atlas");

    try {
      await first.runPromise(Resource.prefetchEffect(ref));

      expect(runWithRuntime(first, () => Resource.refsForTag(ProjectTag).map((tagRef) => tagRef.key))).toEqual([ref.key]);
      expect(runWithRuntime(second, () => Resource.refsForTag(ProjectTag))).toEqual([]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("inspects query status without loading the resource", () => {
    const load = vi.fn(() => Effect.succeed("loaded"));
    const Count = Resource.family({
      name: "Count.status.initial",
      load
    });
    const ref = Count(undefined);

    const status = Resource.status(ref);

    expect(status).toMatchObject({
      _tag: "Initial",
      name: "Count.status.initial",
      key: ref.key,
      input: undefined,
      waiting: false,
      hasValue: false,
      hasPrevious: false,
      isInitial: true,
      isPending: false,
      isSuccess: false,
      isFailure: false,
      isFetching: false,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      isGcExpired: false,
      updatedAt: undefined,
      staleAt: undefined,
      gcAt: undefined,
      ageMillis: undefined,
      staleInMillis: undefined,
      gcInMillis: undefined,
      value: undefined,
      previous: undefined,
      error: undefined
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("reports stale and gc timing diagnostics for successful resources", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const Count = Resource.family({
        name: "Count.status.timing",
        load: () => Effect.succeed(1),
        policy: {
          staleFor: 100,
          gcFor: 500
        }
      });
      const ref = Count(undefined);

      await Effect.runPromise(Resource.prefetchEffect(ref));

      expect(Resource.status(ref)).toMatchObject({
        _tag: "Success",
        value: 1,
        hasValue: true,
        isSuccess: true,
        isStale: false,
        isGcExpired: false,
        updatedAt: 1_000,
        staleAt: 1_100,
        gcAt: 1_500,
        ageMillis: 0,
        staleInMillis: 100,
        gcInMillis: 500
      });

      vi.setSystemTime(1_151);

      expect(Resource.status(ref)).toMatchObject({
        _tag: "Success",
        isStale: true,
        isGcExpired: false,
        ageMillis: 151,
        staleInMillis: 0,
        gcInMillis: 349
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes native Effect query status scoped to the runtime store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Count = Resource.family({
      name: "Count.status.effect",
      load: () => Effect.succeed(1)
    });
    const ref = Count(undefined);

    try {
      await first.runPromise(Resource.prefetchEffect(ref));

      const firstStatus = await first.runPromise(Resource.statusEffect(ref));
      const secondStatus = await second.runPromise(Resource.statusEffect(ref));

      expect(firstStatus).toMatchObject({
        _tag: "Success",
        value: 1,
        hasValue: true
      });
      expect(secondStatus).toMatchObject({
        _tag: "Initial",
        value: undefined,
        hasValue: false
      });
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("reports refreshes with previous data as refreshing instead of loading", async () => {
    const gate = Effect.runSync(Deferred.make<void>());
    let count = 0;
    const Count = Resource.family({
      name: "Count.status.refreshing",
      load: () =>
        Effect.gen(function* () {
          count++;
          if (count > 1) {
            yield* Deferred.await(gate);
          }
          return count;
        })
    });
    const ref = Count(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    const refreshing = Effect.runPromise(Resource.refreshEffect(ref));

    expect(Resource.status(ref)).toMatchObject({
      _tag: "Pending",
      value: 1,
      previous: 1,
      hasValue: true,
      hasPrevious: true,
      isFetching: true,
      isLoading: false,
      isRefreshing: true
    });

    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await expect(refreshing).resolves.toBe(2);
    expect(Resource.status(ref)).toMatchObject({
      _tag: "Success",
      value: 2,
      isRefreshing: false
    });
  });

  it("dedupes Effect prefetch through one in-flight fiber", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const gate = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Count = Resource.family({
      name: "Count.public-prefetch-fiber",
      load: () =>
        Effect.gen(function* () {
          loads++;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(gate);
          return loads;
        })
    });
    const ref = Count(undefined);

    const first = Effect.runPromise(Resource.prefetchEffect(ref));
    const second = Effect.runPromise(Resource.prefetchEffect(ref));

    await Effect.runPromise(Deferred.await(started));
    expect(loads).toBe(1);

    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(1);
    expect(Resource.status(ref)).toMatchObject({
      _tag: "Success",
      value: 1
    });
  });

  it("interrupts Effect prefetch fibers when the owning runtime is disposed", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    let interrupted = false;
    const Count = Resource.family({
      name: "Count.public-prefetch-dispose",
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.ensuring(
            Effect.never,
            Effect.sync(() => {
              interrupted = true;
            })
          );
        })
    });
    const ref = Count(undefined);

    const prefetch = runtime.runPromise(Resource.prefetchEffect(ref));
    await runtime.runPromise(Deferred.await(started));
    await Effect.runPromise(runtime.disposeEffect);

    await expect(prefetch).rejects.toBeDefined();
    expect(interrupted).toBe(true);
  });

  it("explains invalidation plans with direct refs and tag causes", async () => {
    const ProjectTag = Resource.tag<{ readonly id: string }>("Project.plan-resource-test", {
      key: ({ id }) => id
    });
    const Project = Resource.family({
      name: "Project.invalidation-plan-resource-test",
      load: (id: string) => Effect.succeed({ id }),
      provides: (value) => [ProjectTag({ id: value.id })]
    });
    const ref = Project("atlas");

    await Effect.runPromise(Resource.prefetchEffect(ref));

    const plan = Resource.planInvalidation([ref, ProjectTag({ id: "atlas" })]);

    expect(plan.targets).toHaveLength(2);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.ref.key).toBe(ref.key);
    expect(plan.entries[0]?.causes.map((cause) => cause._tag)).toEqual(["Ref", "Tag"]);
  });

  it("keeps the tag index aligned when a resource provides different tags after refresh", async () => {
    const SlugTag = Resource.tag<{ readonly slug: string }>("Project.slug-resource-test", {
      key: ({ slug }) => slug
    });
    let slug = "draft";
    const Project = Resource.family({
      name: "Project.dynamic-tags-resource-test",
      load: () => Effect.succeed({ id: "atlas", slug }),
      provides: (value) => [SlugTag({ slug: value.slug })]
    });
    const ref = Project(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(Resource.refsForTag(SlugTag({ slug: "draft" })).map((tagRef) => tagRef.key)).toEqual([ref.key]);

    slug = "published";
    await Effect.runPromise(Resource.refreshEffect(ref));

    expect(Resource.refsForTag(SlugTag({ slug: "draft" }))).toEqual([]);
    expect(Resource.refsForTag(SlugTag({ slug: "published" })).map((tagRef) => tagRef.key)).toEqual([ref.key]);
  });

  it("expires resource entries with gcFor", async () => {
    vi.useFakeTimers();
    try {
      let count = 0;
      const Count = Resource.family({
        name: "Count.gc",
        load: () => Effect.sync(() => ++count),
        policy: {
          gcFor: 10
        }
      });
      const ref = Count(undefined);

      await Effect.runPromise(Resource.prefetchEffect(ref));
      expect(read(ref)).toBe(1);

      await vi.advanceTimersByTimeAsync(11);

      let pending: Promise<number> | undefined;
      try {
        read(ref);
      } catch (error) {
        pending = error as Promise<number>;
      }

      await pending;
      expect(read(ref)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes resource entries through the native Effect API", async () => {
    let count = 0;
    const Count = Resource.family({
      name: "Count.delete-effect",
      load: () => Effect.sync(() => ++count)
    });
    const ref = Count(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(read(ref)).toBe(1);

    await Effect.runPromise(Count.family.deleteEffect(ref));

    let pending: Promise<number> | undefined;
    try {
      read(ref);
    } catch (error) {
      pending = error as Promise<number>;
    }

    await pending;
    expect(read(ref)).toBe(2);
    expect(count).toBe(2);
  });

  it("publishes resource lifecycle events through Effect PubSub", async () => {
    const runtime = makeRuntime();
    const Count = Resource.family({
      name: "Count.events",
      load: () => Effect.succeed(1)
    });
    const ref = Count(undefined);

    try {
      const events = await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Resource.subscribeEventsEffect();
            yield* Resource.prefetchEffect(ref);
            const pending = yield* PubSub.take(subscription);
            const success = yield* PubSub.take(subscription);
            return [pending, success] as const;
          })
        )
      );

      expect(events.map((event) => event._tag)).toEqual(["ResourcePending", "ResourceSuccess"]);
      expect(events.map((event) => event.key)).toEqual([ref.key, ref.key]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("publishes semantic invalidation events before refreshed resources reload", async () => {
    const runtime = makeRuntime();
    let value = 0;
    const CountTag = Resource.tag("Count.invalidation-events");
    const Count = Resource.family({
      name: "Count.invalidation-events",
      load: () =>
        Effect.sync(() => {
          value++;
          return value;
        }),
      provides: () => [CountTag]
    });
    const ref = Count(undefined);

    try {
      const events = await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Resource.subscribeEventsEffect();
            yield* Resource.prefetchEffect(ref);
            yield* PubSub.take(subscription);
            yield* PubSub.take(subscription);

            yield* Resource.invalidateEffect(CountTag);
            const invalidated = yield* PubSub.take(subscription);
            const pending = yield* PubSub.take(subscription);
            const success = yield* PubSub.take(subscription);
            return [invalidated, pending, success] as const;
          })
        )
      );

      expect(events.map((event) => event._tag)).toEqual([
        "ResourceInvalidated",
        "ResourcePending",
        "ResourceSuccess"
      ]);
      expect(events[0]).toEqual({
        _tag: "ResourceInvalidated",
        name: "Count.invalidation-events",
        key: ref.key,
        causes: [
          {
            _tag: "Tag",
            key: "Count.invalidation-events",
            name: "Count.invalidation-events"
          }
        ]
      });
      expect(value).toBe(2);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("exposes native Effect prefetch", async () => {
    const User = Resource.family({
      name: "User.effect",
      load: (id: string) => Effect.succeed({ id })
    });
    const ref = User("effect");

    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).resolves.toEqual({
      id: "effect"
    });
    expect(read(ref)).toEqual({ id: "effect" });
  });

  it("uses Effect schedules for retry policy", async () => {
    let attempts = 0;
    const User = Resource.family({
      name: "User.retry",
      load: () =>
        Effect.gen(function* () {
          attempts++;
          if (attempts < 3) {
            return yield* Effect.fail("temporary");
          }
          return { id: "retry" };
        }),
      policy: {
        retry: Schedule.recurs(2)
      }
    });
    const ref = User(undefined);

    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).resolves.toEqual({
      id: "retry"
    });
    expect(attempts).toBe(3);
    expect(read(ref)).toEqual({ id: "retry" });
  });

  it("throws typed resource failures with previous data", async () => {
    let shouldFail = false;
    const Item = Resource.family({
      name: "Item",
      load: () =>
        shouldFail
          ? Effect.fail(new Error("nope"))
          : Effect.succeed("ok")
    });
    const ref = Item(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    shouldFail = true;
    await expect(Effect.runPromise(Resource.refreshEffect(ref))).rejects.toThrow("nope");

    try {
      read(ref);
      expect.fail("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceFailure);
      expect((error as ResourceFailure<string, Error>).previous).toBe("ok");
    }
  });

  it("hydrates resource state and Effect cache without loading", async () => {
    const load = vi.fn((id: string) => Effect.succeed({ id, name: "Loaded" }));
    const User = Resource.family({
      name: "User.hydrate",
      load
    });
    const ref = User("1");

    Resource.hydrate({
      resources: [
        {
          name: "User.hydrate",
          key: ref.key,
          input: "1",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "1", name: "Hydrated" },
            updatedAt: Date.now()
          }
        }
      ]
    });

    expect(read(ref)).toEqual({ id: "1", name: "Hydrated" });
    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).resolves.toEqual({ id: "1", name: "Hydrated" });
    expect(load).not.toHaveBeenCalled();
  });

  it("collects resources touched during Effect preload", async () => {
    const Project = Resource.family({
      name: "Project.collect",
      load: (id: string) => Effect.succeed({ id })
    });
    const ref = Project("atlas");

    const collected = await Effect.runPromise(
      Resource.collectEffect(Resource.prefetchEffect(ref))
    );
    const snapshot = Resource.dehydrate(collected.refs);

    expect(collected.value).toEqual({ id: "atlas" });
    expect(collected.refs.map((touched) => touched.key)).toEqual([ref.key]);
    expect(snapshot).toEqual([
      {
        name: "Project.collect",
        key: ref.key,
        input: "atlas",
        state: {
          _tag: "Success",
          waiting: false,
          value: { id: "atlas" },
          updatedAt: expect.any(Number)
        }
      }
    ]);
  });
});
