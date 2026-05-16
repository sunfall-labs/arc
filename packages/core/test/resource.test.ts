import { Clock, Deferred, Effect, Exit, Fiber, Layer, Option, PubSub, Request, RequestResolver, Schedule, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeRuntime,
  read,
  Resource,
  EffectInputCallbackError,
  ResourceKeyError,
  ResourceFailure,
  ResourcePending,
  ResourceSnapshotCodecError,
  runWithRuntime,
  validateResourceHydrationSnapshots
} from "../src/index.js";
import { parseDuration } from "../src/resource-duration.js";
import { unsafeMutableResourceStore } from "../src/resource-store.js";

describe("Resource", () => {
  it("parses the full numeric duration strings accepted by the public type", () => {
    expect(parseDuration("1.5 seconds")).toBe(1_500);
    expect(parseDuration("1e-3 minutes")).toBe(60);
    expect(parseDuration("-2 seconds")).toBe(-2_000);
  });

  it("loads on first read and returns cached values afterward", async () => {
    const load = vi.fn((id: string) => Effect.succeed({ id, name: "Ada" }));
    const User = Resource.family({
      name: "User.byId",
      load
    });

    const ref = User("1");
    expect(() => read(ref)).toThrow(ResourcePending);
    await Effect.runPromise(Resource.prefetchEffect(ref));

    expect(read(ref)).toEqual({ id: "1", name: "Ada" });
    expect(read(ref)).toEqual({ id: "1", name: "Ada" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("encodes common built-ins in default resource keys", () => {
    const AnyInput = Resource.family<unknown, string>({
      name: "ResourceKey.codec-builtins",
      load: () => "ok"
    });

    const dateRef = AnyInput(new Date("2024-01-02T03:04:05.000Z"));
    const urlRef = AnyInput(new URL("https://example.com/projects?tab=activity"));
    const mapRef = AnyInput(new Map([
      ["created", new Date("2024-01-02T03:04:05.000Z")],
      ["url", new URL("https://example.com/projects?tab=activity")]
    ]));
    const setRef = AnyInput(new Set(["atlas", new Date("2024-01-02T03:04:05.000Z")]));
    const nestedRef = AnyInput({
      filters: new Map([
        ["ids", new Set(["atlas", "kepler"])],
        ["created", new Date("2024-01-02T03:04:05.000Z")]
      ])
    });

    expect(new Set([
      AnyInput({}).key,
      dateRef.key,
      urlRef.key,
      mapRef.key,
      setRef.key,
      nestedRef.key
    ]).size).toBe(6);
    expect(dateRef.key).toContain("\"Date\"");
    expect(urlRef.key).toContain("\"URL\"");
    expect(mapRef.key).toContain("\"Map\"");
    expect(setRef.key).toContain("\"Set\"");
    expect(nestedRef.key).toContain("\"Map\"");
    expect(nestedRef.key).toContain("\"Set\"");
  });

  it("fails default resource keys for circular and unsupported objects", () => {
    class CustomKey {
      get id() {
        return "atlas";
      }
    }

    const AnyInput = Resource.family<unknown, string>({
      name: "ResourceKey.codec-failures",
      load: () => "ok"
    });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => AnyInput(circular)).toThrow(ResourceKeyError);
    expect(() => AnyInput(new CustomKey())).toThrow(ResourceKeyError);

    try {
      AnyInput(circular);
      expect.fail("Expected circular resource input to fail default key encoding");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "ResourceKeyError",
        operation: "Resource.family.ref",
        name: "ResourceKey.codec-failures",
        path: "$.self",
        reason: "CircularReference",
        referencePath: "$"
      });
      expect((error as ResourceKeyError).guidance).toContain("key");
    }

    try {
      AnyInput(new CustomKey());
      expect.fail("Expected custom resource input to fail default key encoding");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "ResourceKeyError",
        operation: "Resource.family.ref",
        name: "ResourceKey.codec-failures",
        path: "$",
        reason: "UnsupportedObject"
      });
      expect((error as ResourceKeyError).guidance).toContain("key");
    }
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

  it("backs resource families with Effect RequestResolver batches", () => {
    interface GetUserRequest extends Request.Request<{ readonly id: string; readonly name: string }> {
      readonly _tag: "GetUserRequest";
      readonly id: string;
    }
    const GetUserRequest = Request.tagged<GetUserRequest>("GetUserRequest");
    const batches: ReadonlyArray<string>[] = [];
    const resolver = RequestResolver.make<GetUserRequest>((entries) =>
      Effect.sync(() => {
        batches.push(entries.map((entry) => entry.request.id));
        for (const entry of entries) {
          entry.completeUnsafe(
            Exit.succeed({
              id: entry.request.id,
              name: entry.request.id.toUpperCase()
            })
          );
        }
      })
    );
    const User = Resource.requestFamily({
      name: "User.request-resolver",
      request: (id: string) => GetUserRequest({ id }),
      resolver
    });

    return Effect.runPromise(
      Effect.all([
        Resource.prefetchEffect(User("ada")),
        Resource.prefetchEffect(User("grace"))
      ], { concurrency: "unbounded" }).pipe(
        Effect.tap((values) =>
          Effect.sync(() => {
            expect(values).toEqual([
              { id: "ada", name: "ADA" },
              { id: "grace", name: "GRACE" }
            ]);
            expect(batches).toEqual([["ada", "grace"]]);
            expect(read(User("ada"))).toEqual({ id: "ada", name: "ADA" });
          })
        )
      )
    );
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
      await Effect.runPromise(first.provide(Resource.prefetchEffect(ref)));
      expect(runWithRuntime(first, () => read(ref))).toBe(1);
      expect(runWithRuntime(second, () => Resource.result(ref).get()._tag)).toBe("Initial");

      await Effect.runPromise(second.provide(Resource.prefetchEffect(ref)));

      expect(runWithRuntime(second, () => read(ref))).toBe(2);
      expect(runWithRuntime(first, () => read(ref))).toBe(1);
      expect(count).toBe(2);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("resets existing resource result subscribers when a ref is deleted", async () => {
    const Count = Resource.family({
      name: "Count.delete-subscriber-reset",
      load: () => Effect.succeed(1)
    });
    const ref = Count(undefined);
    const result = Resource.result(ref);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(result.get()).toMatchObject({
      _tag: "Success",
      value: 1
    });

    await Effect.runPromise(Resource.deleteEffect(ref));

    expect(result.get()).toEqual({
      _tag: "Initial",
      waiting: false
    });
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

  it("keeps unkeyed and keyed resource tags with colliding public keys separate", async () => {
    const UnkeyedTag = Resource.tag("Project.collision:atlas");
    const KeyedTag = Resource.tag<string>("Project.collision", {
      key: (id) => id
    });
    let unkeyedValue = 1;
    let keyedValue = 1;
    const loadUnkeyed = vi.fn(() => Effect.succeed({ value: unkeyedValue }));
    const loadKeyed = vi.fn(() => Effect.succeed({ value: keyedValue }));
    const Unkeyed = Resource.family({
      name: "Project.unkeyed-collision",
      load: loadUnkeyed,
      provides: () => [UnkeyedTag]
    });
    const Keyed = Resource.family({
      name: "Project.keyed-collision",
      load: loadKeyed,
      provides: () => [KeyedTag("atlas")]
    });
    const unkeyedRef = Unkeyed(undefined);
    const keyedRef = Keyed(undefined);

    expect(UnkeyedTag.key).toBe(KeyedTag("atlas").key);

    await Effect.runPromise(Resource.prefetchEffect(unkeyedRef));
    await Effect.runPromise(Resource.prefetchEffect(keyedRef));

    unkeyedValue = 2;
    keyedValue = 2;
    await Effect.runPromise(Resource.invalidateEffect(UnkeyedTag));

    expect(read(unkeyedRef)).toEqual({ value: 2 });
    expect(read(keyedRef)).toEqual({ value: 1 });
    expect(loadUnkeyed).toHaveBeenCalledTimes(2);
    expect(loadKeyed).toHaveBeenCalledTimes(1);

    await Effect.runPromise(Resource.invalidateEffect(KeyedTag("atlas")));

    expect(read(keyedRef)).toEqual({ value: 2 });
    expect(loadKeyed).toHaveBeenCalledTimes(2);
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
      await Effect.runPromise(first.provide(Resource.prefetchEffect(ref)));

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

  it("inspects Effect status without registering absent refs", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "User.status-absent",
        load: (id: string) => Effect.succeed({ id })
      });
      const ref = User("atlas");

      const status = await Effect.runPromise(
        runtime.provide(Resource.statusEffect(ref))
      );

      expect(status._tag).toBe("Initial");
      const store = unsafeMutableResourceStore(runtime.resourceStore);
      expect(store.families.has("User.status-absent")).toBe(false);
      expect(store.entries.get(User)?.has(ref.key)).not.toBe(true);
      expect(store.inputs.get(User)?.has(ref.key)).not.toBe(true);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("reads absent refs without registering store state", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "User.read-absent",
        load: (id: string) => Effect.succeed({ id })
      });
      const ref = User("atlas");

      expect(() => runWithRuntime(runtime, () => read(ref))).toThrow(ResourcePending);
      const store = unsafeMutableResourceStore(runtime.resourceStore);
      expect(store.families.size).toBe(0);
      expect(store.entries.get(ref.family)).toBeUndefined();
      expect(store.inputs.get(ref.family)).toBeUndefined();
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
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

  it("uses the active runtime Clock for sync status and read timing", async () => {
    let now = 1_000;
    const testClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.sync(() => now),
      currentTimeNanosUnsafe: () => BigInt(Math.trunc(now)) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(Math.trunc(now)) * 1_000_000n),
      sleep: () => Effect.never
    };
    const runtime = makeRuntime(Layer.succeed(Clock.Clock)(testClock));
    const Count = Resource.family({
      name: "Count.sync-clock-status",
      load: () => Effect.succeed(1),
      policy: {
        staleFor: 100,
        gcFor: 500
      }
    });
    const ref = Count(undefined);

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      const syncStatus = runWithRuntime(runtime, () => Resource.status(ref));
      const effectStatus = await Effect.runPromise(runtime.provide(Resource.statusEffect(ref)));

      expect(syncStatus).toMatchObject({
        _tag: "Success",
        updatedAt: 1_000,
        isStale: false,
        isGcExpired: false,
        ageMillis: 0,
        staleInMillis: 100,
        gcInMillis: 500
      });
      expect(syncStatus).toMatchObject({
        isStale: effectStatus.isStale,
        isGcExpired: effectStatus.isGcExpired,
        ageMillis: effectStatus.ageMillis
      });
      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);

      now += 151;

      const staleSyncStatus = runWithRuntime(runtime, () => Resource.status(ref));
      const staleEffectStatus = await Effect.runPromise(runtime.provide(Resource.statusEffect(ref)));
      expect(staleSyncStatus).toMatchObject({
        isStale: true,
        isGcExpired: false,
        ageMillis: 151,
        staleInMillis: 0,
        gcInMillis: 349
      });
      expect(staleSyncStatus).toMatchObject({
        isStale: staleEffectStatus.isStale,
        isGcExpired: staleEffectStatus.isGcExpired,
        ageMillis: staleEffectStatus.ageMillis
      });
      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("uses the Effect Clock for collected checks while prefetching", async () => {
    let now = Date.now() + 1_000_000;
    const testClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.sync(() => now),
      currentTimeNanosUnsafe: () => BigInt(Math.trunc(now)) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(Math.trunc(now)) * 1_000_000n),
      sleep: () => Effect.never
    };
    const runtime = makeRuntime(Layer.succeed(Clock.Clock)(testClock));
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const releaseSecond = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Count = Resource.family({
      name: "Count.effect-clock-collected",
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
        gcFor: 100
      }
    });
    const ref = Count(undefined);

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));
      now += 101;

      const refresh = runtime.runFork(Resource.prefetchEffect(ref));
      await Effect.runPromise(runtime.provide(Deferred.await(secondStarted)));

      const pending = await Effect.runPromise(runtime.provide(Resource.statusEffect(ref)));
      expect(pending).toMatchObject({
        _tag: "Pending",
        previous: 1,
        isRefreshing: true
      });

      await Effect.runPromise(runtime.provide(Deferred.succeed(releaseSecond, undefined)));
      await expect(Effect.runPromise(Fiber.join(refresh))).resolves.toBe(2);
      expect(loads).toBe(2);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
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
      await Effect.runPromise(first.provide(Resource.prefetchEffect(ref)));

      const firstStatus = await Effect.runPromise(first.provide(Resource.statusEffect(ref)));
      const secondStatus = await Effect.runPromise(second.provide(Resource.statusEffect(ref)));

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

  it("reads resources from the provided runtime in Effect code", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Count = Resource.family({
      name: "Count.read.effect-runtime",
      load: () => Effect.succeed(1)
    });
    const ref = Count(undefined);

    try {
      await Effect.runPromise(first.provide(Resource.prefetchEffect(ref)));

      await expect(Effect.runPromise(first.provide(Resource.readEffect(ref)))).resolves.toBe(1);
      await expect(Effect.runPromise(second.provide(Resource.readEffect(ref)))).rejects.toBeInstanceOf(ResourcePending);
      await expect(Effect.runPromise(second.provide(Resource.statusEffect(ref)))).resolves.toMatchObject({
        _tag: "Initial",
        value: undefined
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
    const refreshing = Effect.runFork(Resource.refreshEffect(ref));

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
    await expect(Effect.runPromise(Fiber.join(refreshing))).resolves.toBe(2);
    expect(Resource.status(ref)).toMatchObject({
      _tag: "Success",
      value: 2,
      isRefreshing: false
    });
  });

  it("preserves undefined as a previous value during refresh and failure", async () => {
    const releaseRefresh = Effect.runSync(Deferred.make<void>());
    let shouldFail = false;
    let loads = 0;
    const MaybeValue = Resource.family<void, undefined, Error>({
      name: "MaybeValue.previous-undefined",
      load: () =>
        Effect.gen(function* () {
          loads++;
          if (loads === 2) {
            yield* Deferred.await(releaseRefresh);
          }
          if (shouldFail) {
            return yield* Effect.fail(new Error("refresh failed"));
          }
          return undefined;
        })
    });
    const ref = MaybeValue(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    const refreshing = Effect.runFork(Resource.refreshEffect(ref));

    const pending = Resource.status(ref);
    expect(pending).toMatchObject({
      _tag: "Pending",
      value: undefined,
      previous: undefined,
      hasValue: true,
      hasPrevious: true,
      isLoading: false,
      isRefreshing: true
    });
    expect("previous" in pending.state).toBe(true);
    expect(read(ref)).toBeUndefined();

    shouldFail = true;
    await Effect.runPromise(Deferred.succeed(releaseRefresh, undefined));
    await expect(Effect.runPromise(Fiber.join(refreshing))).rejects.toThrow("refresh failed");

    const failed = Resource.status(ref);
    expect(failed).toMatchObject({
      _tag: "Failure",
      value: undefined,
      previous: undefined,
      hasValue: true,
      hasPrevious: true
    });
    expect("previous" in failed.state).toBe(true);

    try {
      read(ref);
      expect.fail("expected ResourceFailure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceFailure);
      expect((error as ResourceFailure<void, undefined, Error>).previous).toBeUndefined();
      expect((error as ResourceFailure<void, undefined, Error>).hasPrevious).toBe(true);
    }
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

    const first = Effect.runFork(Resource.prefetchEffect(ref));
    const second = Effect.runFork(Resource.prefetchEffect(ref));

    await Effect.runPromise(Deferred.await(started));
    expect(loads).toBe(1);

    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await expect(Effect.runPromise(
      Effect.all([
        Fiber.join(first),
        Fiber.join(second)
      ], { concurrency: "unbounded" })
    )).resolves.toEqual([1, 1]);
    expect(Resource.status(ref)).toMatchObject({
      _tag: "Success",
      value: 1
    });
  });

  it("keeps store-owned in-flight prefetch alive when one joiner is interrupted", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const gate = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Count = Resource.family({
      name: "Count.store-owned-prefetch-fiber",
      load: () =>
        Effect.gen(function* () {
          loads++;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(gate);
          return loads;
        })
    });
    const ref = Count(undefined);

    const first = Effect.runFork(Resource.prefetchEffect(ref));
    const second = Effect.runFork(Resource.prefetchEffect(ref));

    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(first));
    await Effect.runPromise(Deferred.succeed(gate, undefined));

    await expect(Effect.runPromise(Fiber.join(second))).resolves.toBe(1);
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(first)))).toBe(true);
    expect(loads).toBe(1);
    expect(Resource.status(ref)).toMatchObject({
      _tag: "Success",
      value: 1
    });
  });

  it("forced invalidation does not join a stale non-forced load", async () => {
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const firstRelease = Effect.runSync(Deferred.make<void>());
    const CountTag = Resource.tag("Count.force-restarts-prefetch");
    let value = 1;
    let loads = 0;
    const Count = Resource.family({
      name: "Count.force-restarts-prefetch",
      load: () =>
        Effect.gen(function* () {
          loads++;
          const captured = value;
          if (loads === 1) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(firstRelease);
          }
          return captured;
        }),
      provides: () => [CountTag]
    });
    const ref = Count(undefined);

    const prefetch = Effect.runFork(Resource.prefetchEffect(ref));
    await Effect.runPromise(Deferred.await(firstStarted));
    value = 2;
    await Effect.runPromise(Resource.invalidateEffect(ref));
    await Effect.runPromise(Deferred.succeed(firstRelease, undefined));
    await Effect.runPromise(Fiber.await(prefetch));

    expect(read(ref)).toBe(2);
    expect(loads).toBe(2);
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

    const prefetch = runtime.runFork(Resource.prefetchEffect(ref));
    await Effect.runPromise(runtime.provide(Deferred.await(started)));
    await Effect.runPromise(runtime.disposeEffect);

    const exit = await Effect.runPromise(Fiber.await(prefetch));
    expect(exit._tag).toBe("Failure");
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

    const targets = [ref, ProjectTag({ id: "atlas" })];
    const plan = Resource.planInvalidation(targets);
    targets.push(ProjectTag({ id: "ignored" }));

    expect(plan.targets).toHaveLength(2);
    expect(Object.isFrozen(plan.targets)).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.ref.key).toBe(ref.key);
    expect(Object.isFrozen(plan.entries[0]?.causes)).toBe(true);
    expect(plan.entries[0]?.causes.map((cause) => cause._tag)).toEqual(["Ref", "Tag"]);
    expect(() => (plan.targets as Resource.Invalidation[]).push(ProjectTag({ id: "later" }))).toThrow(TypeError);
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

      expect(() => read(ref)).toThrow(ResourcePending);
      await Effect.runPromise(Resource.prefetchEffect(ref));
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

    const deleted = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* Resource.subscribeEventsEffect();
          yield* Resource.deleteEffect(ref);
          return yield* PubSub.take(subscription);
        })
      )
    );

    expect(() => read(ref)).toThrow(ResourcePending);
    await Effect.runPromise(Resource.prefetchEffect(ref));
    expect(read(ref)).toBe(2);
    expect(count).toBe(2);
    expect(deleted).toMatchObject({
      _tag: "ResourceDeleted",
      name: "Count.delete-effect",
      key: ref.key
    });
  });

  it("forgets resource inputs after explicit delete and garbage collection", async () => {
    vi.useFakeTimers();
    const runtime = makeRuntime();
    try {
      const Count = Resource.family({
        name: "Count.input-lifetime",
        load: (id: string) => Effect.succeed(id),
        policy: {
          gcFor: 10
        }
      });
      const deleted = Count("deleted");
      const collected = Count("collected");

      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(deleted)));
      await Effect.runPromise(runtime.provide(Resource.deleteEffect(deleted)));
      const store = unsafeMutableResourceStore(runtime.resourceStore);
      expect(store.inputs.get(deleted.family)?.has(deleted.key)).not.toBe(true);

      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(collected)));
      expect(store.inputs.get(collected.family)?.has(collected.key)).toBe(true);

      await vi.advanceTimersByTimeAsync(11);
      expect(store.inputs.get(collected.family)?.has(collected.key)).not.toBe(true);
    } finally {
      vi.useRealTimers();
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("publishes resource lifecycle events through Effect PubSub", async () => {
    const runtime = makeRuntime();
    const Count = Resource.family({
      name: "Count.events",
      load: () => Effect.succeed(1)
    });
    const ref = Count(undefined);

    try {
      const events = await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Resource.subscribeEventsEffect();
            yield* Resource.prefetchEffect(ref);
            const pending = yield* PubSub.take(subscription);
            const success = yield* PubSub.take(subscription);
            return [pending, success] as const;
          })
        )
      ));

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
      const events = await Effect.runPromise(runtime.provide(
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
      ));

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

  it("captures synchronous resource loader throws in the Effect error channel", async () => {
    const User = Resource.family({
      name: "User.sync-loader-throw",
      load: (_id: string) => {
        throw new Error("loader exploded");
      }
    });
    const ref = User("1");

    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Resource.load(User.sync-loader-throw)",
      cause: expect.any(Error)
    });

    expect(() => read(ref)).toThrow(ResourceFailure);
    try {
      read(ref);
      expect.fail("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceFailure);
      expect((error as ResourceFailure<string, unknown, EffectInputCallbackError>).error).toBeInstanceOf(
        EffectInputCallbackError
      );
    }
  });

  it("captures synchronous resource provides throws in the Effect error channel", async () => {
    const User = Resource.family({
      name: "User.sync-provides-throw",
      load: (id: string) => Effect.succeed({ id }),
      provides: () => {
        throw new Error("provides exploded");
      }
    });
    const ref = User("1");

    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Resource.provides(User.sync-provides-throw)",
      cause: expect.any(Error)
    });

    const status = Resource.status(ref);
    expect(status._tag).toBe("Failure");
    expect(status.error).toBeInstanceOf(EffectInputCallbackError);
  });

  it("keeps previous resource value and tag facts when provides fails during refresh", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.provides-refresh-atomicity", {
      key: ({ id }) => id
    });
    let current = { id: "old" };
    const User = Resource.family({
      name: "User.provides-refresh-atomicity",
      load: () => Effect.succeed(current),
      provides: (user) => {
        if (user.id === "new") {
          throw new Error("provides exploded");
        }
        return [UserTag({ id: user.id })];
      }
    });
    const ref = User(undefined);

    await Effect.runPromise(Resource.prefetchEffect(ref));
    current = { id: "new" };
    await expect(Effect.runPromise(Resource.refreshEffect(ref))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Resource.provides(User.provides-refresh-atomicity)"
    });

    expect(Resource.status(ref)).toMatchObject({
      _tag: "Failure",
      previous: { id: "old" }
    });
    expect(Resource.planInvalidation(UserTag({ id: "old" })).entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(Resource.planInvalidation(UserTag({ id: "new" })).entries).toEqual([]);
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

  it("does not commit hydrated resource state when provides throws", async () => {
    const thrown = new Error("hydrate provides exploded");
    const load = vi.fn((id: string) => Effect.succeed({ id, name: "Loaded" }));
    const User = Resource.family({
      name: "User.hydrate-provides-throw",
      load,
      provides: () => {
        throw thrown;
      }
    });
    const ref = User("1");

    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.hydrate-provides-throw",
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
        })
      )
    ).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Resource.provides(User.hydrate-provides-throw)",
      cause: thrown
    });

    expect(() => read(ref)).toThrow(ResourcePending);
    await expect(Effect.runPromise(Resource.prefetchEffect(ref))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Resource.provides(User.hydrate-provides-throw)"
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("fails invalid hydration payloads through typed snapshot codec errors", async () => {
    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.invalid-hydrate",
              key: "User.invalid-hydrate:1",
              input: "1",
              state: {
                _tag: "Pending",
                waiting: true
              }
            } as never
          ]
        })
      )
    ).rejects.toMatchObject({
      _tag: "ResourceSnapshotCodecError",
      operation: "hydrate",
      path: "$.resources[0].state._tag"
    });
  });

  it("rejects duplicate hydration snapshots for the same resource identity", async () => {
    const snapshot = {
      name: "User.duplicate-hydration",
      key: "User.duplicate-hydration:1",
      input: "1",
      state: {
        _tag: "Success" as const,
        waiting: false as const,
        value: { id: "1" },
        updatedAt: Date.now()
      }
    };

    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [snapshot, snapshot]
        })
      )
    ).rejects.toMatchObject({
      _tag: "ResourceSnapshotCodecError",
      operation: "hydrate",
      path: "$.resources[1].key"
    });
  });

  it("treats resource hydration snapshot identity as a structured name/key tuple", () => {
    const first = {
      name: "User.snapshot\u0000collision",
      key: "1",
      input: "first",
      state: {
        _tag: "Success" as const,
        waiting: false as const,
        value: { id: "first" },
        updatedAt: 1
      }
    };
    const second = {
      name: "User.snapshot",
      key: "collision\u00001",
      input: "second",
      state: {
        _tag: "Success" as const,
        waiting: false as const,
        value: { id: "second" },
        updatedAt: 1
      }
    };

    expect(validateResourceHydrationSnapshots([first, second])).toHaveLength(2);
    expect(() => validateResourceHydrationSnapshots([first, first])).toThrow(ResourceSnapshotCodecError);
  });

  it("fails hydration when a snapshot family is not registered", async () => {
    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.missing-hydration-family",
              key: "User.missing-hydration-family:1",
              input: "1",
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "1" },
                updatedAt: Date.now()
              }
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      _tag: "ResourceHydrationApplyError",
      reason: "MissingFamily",
      name: "User.missing-hydration-family",
      key: "User.missing-hydration-family:1"
    });
  });

  it("fails hydration when a decoded input does not match the snapshot key", async () => {
    const User = Resource.family({
      name: "User.hydration-key-mismatch",
      load: (input: { readonly id: string }) => Effect.succeed(input),
      key: (input) => input.id
    });

    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.hydration-key-mismatch",
              key: "User.hydration-key-mismatch:wrong",
              input: { id: "1" },
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "1" },
                updatedAt: Date.now()
              }
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      _tag: "ResourceHydrationApplyError",
      reason: "KeyMismatch",
      name: "User.hydration-key-mismatch",
      key: "User.hydration-key-mismatch:wrong",
      expectedKey: User({ id: "1" }).key
    });
  });

  it("can explicitly skip missing hydration families and key mismatches", async () => {
    const User = Resource.family({
      name: "User.hydration-explicit-skip",
      load: (input: { readonly id: string }) => Effect.succeed(input),
      key: (input) => input.id
    });

    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.hydration-explicit-skip-missing",
              key: "User.hydration-explicit-skip-missing:1",
              input: { id: "1" },
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "1" },
                updatedAt: Date.now()
              }
            },
            {
              name: "User.hydration-explicit-skip",
              key: "User.hydration-explicit-skip:wrong",
              input: { id: "1" },
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "1" },
                updatedAt: Date.now()
              }
            }
          ]
        }, {
          missingFamily: "skip",
          keyMismatch: "skip"
        })
      )
    ).resolves.toBeUndefined();

    expect(() => read(User({ id: "1" }))).toThrow(ResourcePending);
  });

  it("decodes schema-backed hydration inputs and outputs", async () => {
    const User = Resource.family({
      name: "User.hydration-schema",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      load: (input: { readonly id: string }) => Effect.succeed({ id: input.id, name: "Loaded" }),
      key: (input) => input.id
    });
    const ref = User({ id: "1" });

    await Effect.runPromise(
      Resource.hydrateEffect({
        resources: [
          {
            name: "User.hydration-schema",
            key: ref.key,
            input: { id: "1" },
            state: {
              _tag: "Success",
              waiting: false,
              value: { id: "1", name: "Hydrated", extra: "ignored" },
              updatedAt: Date.now()
            }
          }
        ]
      })
    );

    expect(read(ref)).toEqual({ id: "1", name: "Hydrated" });
  });

  it("normalizes resource hydration schema errors through the snapshot codec", async () => {
    const User = Resource.family({
      name: "User.hydration-schema-error",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      load: (input: { readonly id: string }) => Effect.succeed({ id: input.id, name: "Loaded" }),
      key: (input) => input.id
    });
    const ref = User({ id: "1" });

    await expect(
      Effect.runPromise(
        Resource.hydrateEffect({
          resources: [
            {
              name: "User.hydration-schema-error",
              key: ref.key,
              input: { id: "1" },
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "1" },
                updatedAt: Date.now()
              }
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      _tag: "ResourceSnapshotCodecError",
      operation: "hydrate",
      path: "$.resources[0].state.value"
    });
  });

  it("does not partially commit multi-resource hydration when a later snapshot fails", async () => {
    const runtime = makeRuntime();
    const firstLoad = vi.fn((input: { readonly id: string }) =>
      Effect.succeed({ id: input.id, name: "Loaded" })
    );
    const First = Resource.family({
      name: "User.hydration-atomic-first",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      load: firstLoad,
      key: (input) => input.id
    });
    const Second = Resource.family({
      name: "User.hydration-atomic-second",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      load: (input: { readonly id: string }) => Effect.succeed({ id: input.id, name: "Loaded" }),
      key: (input) => input.id
    });
    const firstRef = First({ id: "1" });
    const secondRef = Second({ id: "2" });

    try {
      const result = await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Resource.subscribeEventsEffect();
            const exit = yield* Effect.exit(
              Resource.hydrateEffect({
                resources: [
                  {
                    name: "User.hydration-atomic-first",
                    key: firstRef.key,
                    input: { id: "1" },
                    state: {
                      _tag: "Success",
                      waiting: false,
                      value: { id: "1", name: "Hydrated" },
                      updatedAt: Date.now()
                    }
                  },
                  {
                    name: "User.hydration-atomic-second",
                    key: secondRef.key,
                    input: { id: "2" },
                    state: {
                      _tag: "Success",
                      waiting: false,
                      value: { id: "2" },
                      updatedAt: Date.now()
                    }
                  }
                ]
              })
            );
            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("20 millis")
            );
            return { exit, event };
          })
        )
      ));

      expect(Exit.isFailure(result.exit)).toBe(true);
      expect(Option.isNone(result.event)).toBe(true);
      expect(() => runWithRuntime(runtime, () => read(firstRef))).toThrow(ResourcePending);
      await expect(Effect.runPromise(runtime.provide(Resource.prefetchEffect(firstRef)))).resolves.toEqual({
        id: "1",
        name: "Loaded"
      });
      expect(firstLoad).toHaveBeenCalledTimes(1);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("clones resource snapshots at dehydration and hydration seams", async () => {
    const User = Resource.family({
      name: "User.snapshot-clone",
      load: (input: { readonly id: string }) =>
        Effect.succeed({
          id: input.id,
          profile: { name: "Loaded" }
        })
    });
    const ref = User({ id: "1" });

    await Effect.runPromise(Resource.prefetchEffect(ref));
    const dehydrated = Resource.dehydrate([ref]);
    (dehydrated[0]?.state.value as { profile: { name: string } }).profile.name = "Mutated";

    expect(read(ref)).toEqual({
      id: "1",
      profile: { name: "Loaded" }
    });

    const hydratedValue = {
      id: "1",
      profile: { name: "Hydrated" }
    };
    await Effect.runPromise(
      Resource.hydrateEffect({
        resources: [
          {
            name: "User.snapshot-clone",
            key: ref.key,
            input: { id: "1" },
            state: {
              _tag: "Success",
              waiting: false,
              value: hydratedValue,
              updatedAt: Date.now()
            }
          }
        ]
      })
    );
    hydratedValue.profile.name = "Mutated";

    expect(read(ref)).toEqual({
      id: "1",
      profile: { name: "Hydrated" }
    });
  });

  it("schema-encodes resource inputs and success values while creating hydration snapshots", async () => {
    const runtime = makeRuntime();
    const Counter = Resource.family({
      name: "Counter.snapshot-schema-encode",
      input: Schema.NumberFromString,
      output: Schema.Struct({
        count: Schema.NumberFromString
      }),
      load: (count: number) => Effect.succeed({ count })
    });
    const ref = Counter(42);

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      const syncSnapshot = runWithRuntime(runtime, () => Resource.dehydrate([ref]));
      const effectSnapshot = await Effect.runPromise(runtime.provide(Resource.dehydrateEffect([ref])));
      const syncPayload = runWithRuntime(runtime, () => Resource.hydrationPayload([ref]));

      expect(syncSnapshot[0]).toMatchObject({
        input: "42",
        state: {
          value: {
            count: "42"
          }
        }
      });
      expect(effectSnapshot).toEqual(syncSnapshot);
      expect(syncPayload.resources).toEqual(syncSnapshot);

      const encoded = await Effect.runPromise(Resource.encodeHydrationPayloadEffect(syncPayload));
      const decoded = await Effect.runPromise(Resource.decodeHydrationPayloadEffect(encoded));
      const hydrated = makeRuntime();
      try {
        await Effect.runPromise(hydrated.provide(Resource.hydrateEffect(decoded)));
        await expect(Effect.runPromise(hydrated.provide(Resource.readEffect(ref)))).resolves.toEqual({
          count: 42
        });
      } finally {
        await Effect.runPromise(hydrated.disposeEffect);
      }
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not register absent refs while dehydrating resources", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "User.dehydrate-absent",
        load: (id: string) => Effect.succeed({ id })
      });
      const ref = User("atlas");

      const snapshot = await Effect.runPromise(
        runtime.provide(Resource.dehydrateEffect([ref]))
      );

      expect(snapshot).toEqual([]);
      const store = unsafeMutableResourceStore(runtime.resourceStore);
      expect(store.families.has("User.dehydrate-absent")).toBe(false);
      expect(store.entries.get(User)?.has(ref.key)).not.toBe(true);
      expect(store.inputs.get(User)?.has(ref.key)).not.toBe(true);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("fails resource dehydration snapshot errors through the Effect error channel", async () => {
    const runtime = makeRuntime();
    try {
      const Broken = Resource.family<string, { readonly id: string; readonly boom: string }>({
        name: "User.dehydrate-broken",
        load: (id) =>
          Effect.succeed(
            Object.defineProperty({ id }, "boom", {
              enumerable: true,
              get() {
                throw new ResourceSnapshotCodecError({
                  operation: "snapshot",
                  path: "$.boom",
                  reason: "boom"
                });
              }
            }) as { readonly id: string; readonly boom: string }
          )
      });
      const ref = Broken("atlas");
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      const failure = await Effect.runPromise(
        runtime.provide(Resource.dehydrateEffect([ref]).pipe(Effect.flip))
      );

      expect(failure).toBeInstanceOf(ResourceSnapshotCodecError);
      expect(failure).toMatchObject({
        operation: "snapshot"
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("encodes and decodes resource hydration payloads through the snapshot codec", async () => {
    const payload: Resource.HydrationPayload = {
      resources: [
        {
          name: "User.encode-hydrate",
          key: "User.encode-hydrate:1",
          input: "1",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "1" },
            updatedAt: 1
          }
        }
      ]
    };

    const encoded = await Effect.runPromise(Resource.encodeHydrationPayloadEffect(payload));
    const decoded = await Effect.runPromise(Resource.decodeHydrationPayloadEffect(encoded));

    expect(decoded).toEqual(payload);
    await expect(Effect.runPromise(Resource.decodeHydrationPayloadEffect("{"))).rejects.toBeInstanceOf(
      ResourceSnapshotCodecError
    );
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

  it("collects resources touched during Effect reads", async () => {
    const Project = Resource.family({
      name: "Project.collect-read",
      load: (id: string) => Effect.succeed({ id })
    });
    const ref = Project("atlas");

    await Effect.runPromise(Resource.prefetchEffect(ref));
    const collected = await Effect.runPromise(
      Resource.collectEffect(Resource.readEffect(ref))
    );

    expect(collected.value).toEqual({ id: "atlas" });
    expect(collected.refs.map((touched) => touched.key)).toEqual([ref.key]);
  });
});
