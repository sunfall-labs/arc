import {
  EffectInputCallbackError,
  makeResourceStore,
  makeRuntime,
  ResourceStore,
  runWithRuntime,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { eraseRuntime } from "@sunfall/arc-core/internal";
import { Collection, Query, QueryEvaluationError, UnknownCollectionIndex } from "@sunfall/arc-db";
import {
  buildQuery,
  collectCollections,
  defineCollection,
  makeCollectionDefinitionRegistry,
  defaultCollectionDefinitionRegistry,
  dehydrateCollectionsSync,
  dehydrateCollections,
  hydrateCollections,
  makeCollectionReactivePreloadController,
  subscribeCollectionEvents,
  validateCollectionsHydration,
} from "@sunfall/arc-db/internal";
import { Cause, Deferred, Effect, Exit, Fiber, Option, PubSub, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  markStoreExplicitCollectionSnapshotDefinition,
  type StoreExplicitCollectionSnapshotImplementation,
} from "../src/collection-definition-snapshot.js";
import { activeCollectionStore, runWithCollectionStore } from "../src/collection-runtime.js";
import {
  CollectionSnapshotCodecError,
  hydrateCollectionSnapshotState,
} from "../src/collection-snapshot-codec.js";
import { QueryBuilder } from "../src/query-builder.js";
import { exitContractDefect, flipContractDefect } from "./contract-defect.js";
import {
  collectionStoreKey,
  keyValueStoreError,
  makeTestKeyValueStore,
} from "./key-value-store.js";

type KVE = KeyValueStore.KeyValueStoreError;
type KV = KeyValueStore.KeyValueStore;

interface Project {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked";
  readonly progress: number;
}

interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly done: boolean;
}

interface ProjectCard {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

interface TaggedTask extends Task {
  readonly tags: ReadonlyArray<string>;
}

interface RankedProject {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked" | "queued";
  readonly progress: number;
}

interface SnapshotProject {
  readonly id: string;
  readonly meta: {
    readonly labels: Array<string>;
  };
}

interface OwnedProject {
  readonly id: string;
  readonly name: string;
  readonly meta: {
    readonly labels: Array<string>;
  };
}

const runInRuntime = <A, E, Services, RuntimeError>(
  runtime: SunfallArcRuntime<Services, RuntimeError>,
  effect: Effect.Effect<A, E, Services>,
): Promise<A> => Effect.runPromise(runtime.provide(effect));

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "blocked"]),
  progress: Schema.Number,
});

const ProjectRowsSchema = Schema.Array(ProjectSchema);

/** Flattens an `AsyncResult` into matchable facts: tag, waiting, value/timestamp, typed error, defect, and previous success value. */
const asyncResultFacts = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  switch (result._tag) {
    case "Initial":
      return { _tag: result._tag, waiting: result.waiting };
    case "Success":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        value: result.value,
        timestamp: result.timestamp,
      };
    case "Failure":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        error: Option.getOrUndefined(AsyncResult.error(result)),
        defect: result.cause.reasons.find(Cause.isDieReason)?.defect,
        previous: Option.getOrUndefined(AsyncResult.value(result)),
        cause: result.cause,
      };
  }
};

describe("Collection", () => {
  it("interrupts reactive preloads through an awaitable Effect", () => {
    const runtime = makeRuntime();
    return Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let releases = 0;
        const controller = makeCollectionReactivePreloadController({
          runtime: eraseRuntime(runtime),
        });

        controller.start(
          Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
            Effect.sync(() => {
              releases++;
            }),
          ).pipe(Effect.andThen(Effect.never)),
          true,
        );
        yield* Deferred.await(started);
        yield* controller.interrupt();

        expect(releases).toBe(1);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("swallows reactive preload defects at the fire-and-forget adapter seam", () => {
    const baseRuntime = makeRuntime();
    return Effect.runPromise(
      Effect.gen(function* () {
        let preloadFiber: Fiber.Fiber<void, unknown> | undefined;
        const runtime: typeof baseRuntime = {
          ...baseRuntime,
          runFork: (effect, options) => {
            const fiber = baseRuntime.runFork(effect, options);
            preloadFiber = fiber as Fiber.Fiber<void, unknown>;
            return fiber;
          },
        };
        const controller = makeCollectionReactivePreloadController({
          runtime: eraseRuntime(runtime),
        });

        controller.start(Effect.die("reactive preload defect"), true);

        if (preloadFiber === undefined) {
          expect.fail("Expected reactive preload to fork.");
        }
        const exit = yield* Effect.exit(Fiber.join(preloadFiber));
        expect(exit._tag).toBe("Success");
      }).pipe(Effect.ensuring(Effect.orDie(baseRuntime.dispose))),
    );
  });

  it("loads rows into a runtime-scoped collection", async () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.runtime-load",
      getKey: (project) => project.id,
      sync: {
        load,
      },
    });

    await Effect.runPromise(Projects.preload());

    expect(Projects.rows()).toMatchObject([
      {
        id: "atlas",
        name: "Atlas",
        $key: "atlas",
        $collection: "Projects.runtime-load",
        $synced: true,
        $origin: "remote",
      },
    ]);
    expect(Projects.result().get()._tag).toBe("Success");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight loader across concurrent preloads", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const load = vi.fn(() =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined).pipe(Effect.ignore);
        yield* Deferred.await(release);
        return [
          { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        ] satisfies ReadonlyArray<Project>;
      }),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.concurrent-preload-shared",
      getKey: (project) => project.id,
      sync: {
        load,
      },
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(started));
      second = runtime.runFork(Projects.preload());
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(load).toHaveBeenCalledTimes(1);

      Effect.runSync(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(first));
      await Effect.runPromise(Fiber.join(second));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
      ]);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (first !== undefined) {
        await Effect.runPromise(Fiber.await(first));
      }
      if (second !== undefined) {
        await Effect.runPromise(Fiber.await(second));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("clears interrupted in-flight load ownership so later preloads can retry", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    let attempts = 0;
    const load = vi.fn(() => {
      const attempt = ++attempts;
      return Effect.gen(function* () {
        if (attempt === 1) {
          yield* Deferred.succeed(started, undefined).pipe(Effect.ignore);
          yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
          );
        }
        return [
          { id: "atlas", name: "Atlas Retry", status: "active", progress: 88 },
        ] satisfies ReadonlyArray<Project>;
      });
    });
    const Projects = Collection.define<Project>({
      name: "Projects.interrupted-preload-retry",
      getKey: (project) => project.id,
      sync: {
        load,
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(started));
      await Effect.runPromise(Fiber.interrupt(preload));
      await Effect.runPromise(Deferred.await(interrupted));
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Initial",
        waiting: false,
      });

      const retry = await Effect.runPromise(
        runtime.provide(Projects.preload().pipe(Effect.timeoutOption("1 second"))),
      );

      if (Option.isNone(retry)) {
        expect.fail("Expected later preload to retry after interrupted load owner.");
      }
      expect(load).toHaveBeenCalledTimes(2);
      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
      ]);
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
      });
    } finally {
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("does not let a slow preload overwrite a newer forced refresh", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.preload-refresh-generation",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePreload);
            return [{ id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }];
          }),
        refresh: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 },
          ]),
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(preloadStarted));

      await Effect.runPromise(runtime.provide(Projects.refresh()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true,
      });

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      await Effect.runPromise(Fiber.join(preload));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releasePreload, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("does not fail superseded preload callers after a newer forced refresh is ready", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void, string>());
    const staleFailure = "stale preload failed" as const;
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.preload-refresh-stale-failure",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePreload);
            return [{ id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }];
          }),
        refresh: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 },
          ]),
      },
    });
    let owner: Fiber.Fiber<unknown, unknown> | undefined;
    let joiner: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      owner = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(preloadStarted));
      joiner = runtime.runFork(Projects.preload());
      await Effect.runPromise(Effect.sleep("10 millis"));

      await Effect.runPromise(runtime.provide(Projects.refresh()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true,
      });

      Effect.runSync(Deferred.fail(releasePreload, staleFailure));
      await Effect.runPromise(Fiber.join(owner));
      await Effect.runPromise(Fiber.join(joiner));

      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: false,
      });
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true,
      });
    } finally {
      Effect.runSync(Deferred.fail(releasePreload, "cleanup").pipe(Effect.ignore));
      if (owner !== undefined) {
        await Effect.runPromise(Fiber.await(owner));
      }
      if (joiner !== undefined) {
        await Effect.runPromise(Fiber.await(joiner));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("waits for a newer pending forced refresh before completing a superseded preload", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const releaseRefetch = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.preload-refresh-pending-completion",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePreload);
            return [{ id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }];
          }),
        refresh: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseRefetch);
            return [{ id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }];
          }),
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(preloadStarted));
      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Deferred.await(refetchStarted));

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      const staleCompletion = await Effect.runPromise(
        Fiber.await(preload).pipe(Effect.timeoutOption("20 millis")),
      );
      expect(Option.isNone(staleCompletion)).toBe(true);

      Effect.runSync(Deferred.succeed(releaseRefetch, undefined));
      await Effect.runPromise(Fiber.join(preload));
      await Effect.runPromise(Fiber.join(refetch));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releasePreload, undefined).pipe(Effect.ignore));
      Effect.runSync(Deferred.succeed(releaseRefetch, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("fails a superseded successful preload when the newer forced refresh fails", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const releaseRefetch = Effect.runSync(Deferred.make<void, typeof refetchFailure>());
    const refetchFailure = "fresh refresh failed" as const;
    const Projects = Collection.define<Project, string, typeof refetchFailure>({
      name: "Projects.preload-refresh-failure-completion",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePreload);
            return [{ id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }];
          }),
        refresh: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseRefetch);
            return [{ id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }];
          }),
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(preloadStarted));
      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Deferred.await(refetchStarted));

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      const staleCompletion = await Effect.runPromise(
        Fiber.await(preload).pipe(Effect.timeoutOption("20 millis")),
      );
      expect(Option.isNone(staleCompletion)).toBe(true);

      Effect.runSync(Deferred.fail(releaseRefetch, refetchFailure));
      const preloadExit = await Effect.runPromiseExit(Fiber.join(preload));
      const refetchExit = await Effect.runPromiseExit(Fiber.join(refetch));
      expect(Exit.isFailure(preloadExit)).toBe(true);
      expect(Exit.isFailure(refetchExit)).toBe(true);
      if (Exit.isFailure(preloadExit) && Exit.isFailure(refetchExit)) {
        expect(preloadExit.cause.reasons.find(Cause.isFailReason)?.error).toBe(refetchFailure);
        expect(refetchExit.cause.reasons.find(Cause.isFailReason)?.error).toBe(refetchFailure);
      }
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Failure",
        error: refetchFailure,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releasePreload, undefined).pipe(Effect.ignore));
      Effect.runSync(Deferred.succeed(releaseRefetch, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps prior rows and load state committed when interrupted during load persistence", async () => {
    const key = "projects-load-persist-interrupt-cache";
    const persistStarted = Effect.runSync(Deferred.make<void>());
    const releasePersist = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    let refetches = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () =>
        Effect.gen(function* () {
          writes++;
          if (writes === 1) {
            yield* Deferred.succeed(persistStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePersist);
          }
        }),
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.load-persist-interrupt",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Initial", status: "active", progress: 1 }],
      persistence: {
        key,
        persistOnLoad: true,
      },
      sync: {
        refresh: () =>
          Effect.sync(() => {
            refetches++;
            return [
              {
                id: "atlas",
                name: `Refetched ${refetches}`,
                status: "blocked",
                progress: 80 + refetches,
              },
            ] satisfies ReadonlyArray<Project>;
          }),
      },
    });
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Deferred.await(persistStarted));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(
        ["Initial"],
      );
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: true,
      });

      await Effect.runPromise(Fiber.interrupt(refetch));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(
        ["Initial"],
      );
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: false,
      });

      const retry = await Effect.runPromise(
        runtime.provide(Projects.refresh().pipe(Effect.timeoutOption("1 second"))),
      );

      if (Option.isNone(retry)) {
        expect.fail("Expected later refresh to retry after interrupted load persistence.");
      }

      const snapshot = storage.snapshot<Project>(key);
      expect(refetches).toBe(2);
      expect(writes).toBe(2);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Refetched 2",
        progress: 82,
      });
      expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Refetched 2"]);
    } finally {
      Effect.runSync(Deferred.succeed(releasePersist, undefined).pipe(Effect.ignore));
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("restores ready load state when interrupted during a forced refresh load", async () => {
    const runtime = makeRuntime();
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.refresh-load-interrupt-restore",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Initial", status: "active", progress: 1 }],
      sync: {
        refresh: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
            yield* Effect.never.pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
              ),
            );
            return [] satisfies ReadonlyArray<Project>;
          }),
      },
    });
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: false,
      });

      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Deferred.await(refetchStarted));
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: true,
      });

      await Effect.runPromise(Fiber.interrupt(refetch));
      await Effect.runPromise(Deferred.await(interrupted));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(
        ["Initial"],
      );
      expect(
        asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
      ).toMatchObject({
        _tag: "Success",
        waiting: false,
      });
    } finally {
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("serializes stale preload persistence behind a newer forced refresh", async () => {
    const key = "projects-preload-refresh-durable-generation-cache";
    const stalePersistStarted = Effect.runSync(Deferred.make<void>());
    const releaseStalePersist = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () =>
        Effect.gen(function* () {
          writes++;
          if (writes === 1) {
            yield* Deferred.succeed(stalePersistStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseStalePersist);
          }
        }),
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.preload-refresh-durable-generation",
      getKey: (project) => project.id,
      persistence: {
        key,
        persistOnLoad: true,
      },
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Stale", status: "active", progress: 10 },
          ]),
        refresh: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 },
          ]),
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(stalePersistStarted));

      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Effect.sleep("20 millis"));

      Effect.runSync(Deferred.succeed(releaseStalePersist, undefined));
      await Effect.runPromise(Fiber.join(refetch));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = storage.snapshot<Project>(key);
      expect(writes).toBe(2);
      expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Atlas Fresh"]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseStalePersist, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("uses Effect schedules for collection load retry policy", async () => {
    let attempts = 0;
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.load-retry",
      getKey: (project) => project.id,
      policy: {
        retry: Schedule.recurs(2),
      },
      sync: {
        load: () =>
          Effect.gen(function* () {
            attempts++;
            if (attempts < 3) {
              return yield* Effect.fail("temporary");
            }
            return [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }];
          }),
      },
    });

    await Effect.runPromise(Projects.preload());

    expect(attempts).toBe(3);
    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
  });

  it("owns initial rows and read rows through detached values", () => {
    const initial = [{ id: "atlas", name: "Atlas", meta: { labels: ["initial"] } }];
    const Projects = Collection.define<OwnedProject>({
      name: "Projects.row-ownership.initial",
      getKey: (project) => project.id,
      initialData: initial,
    });

    const row = Projects.get("atlas");
    initial[0]!.meta.labels.push("external");
    row!.meta.labels.push("read");

    expect(Projects.get("atlas")?.meta.labels).toEqual(["initial"]);
    expect(Projects.rows()[0]?.meta.labels).toEqual(["initial"]);
  });

  it("does not expose invalid initialData rows", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.initial-data-invalid-ingress",
      getKey: (project) => project.id,
      output: ProjectRowsSchema,
      initialData: [{ id: "atlas", name: 123, status: "active", progress: 72 } as never],
    });

    expect(Projects.rows()).toEqual([]);
    expect(Projects.get("atlas")).toBeUndefined();
    expect(asyncResultFacts(Projects.result().get())).toMatchObject({
      _tag: "Failure",
      error: undefined,
      defect: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
      },
    });
  });

  it("does not expose Promise-shaped or Effect-shaped row values", () => {
    const throwingThen = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      },
    });
    const PromiseRows = Collection.define<Project>({
      name: "Projects.initial-data-promise-row-ingress",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: Promise.resolve("Atlas"), status: "active", progress: 72 } as never,
      ],
    });
    const EffectRows = Collection.define<Project>({
      name: "Projects.initial-data-effect-row-ingress",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: Effect.succeed("Atlas"), status: "active", progress: 72 } as never,
      ],
    });
    const ThrowingThenRows = Collection.define<Project>({
      name: "Projects.initial-data-throwing-then-row-ingress",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: throwingThen, status: "active", progress: 72 } as never],
    });

    expect(PromiseRows.rows()).toEqual([]);
    expect(asyncResultFacts(PromiseRows.result().get())).toMatchObject({
      _tag: "Failure",
      error: undefined,
      defect: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "PromiseLikeValue",
      },
    });
    expect(EffectRows.rows()).toEqual([]);
    expect(asyncResultFacts(EffectRows.result().get())).toMatchObject({
      _tag: "Failure",
      error: undefined,
      defect: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "EffectLikeValue",
      },
    });
    expect(ThrowingThenRows.rows()).toEqual([]);
    expect(asyncResultFacts(ThrowingThenRows.result().get())).toMatchObject({
      _tag: "Failure",
      error: undefined,
      defect: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "PromiseLikeValue",
      },
    });
  });

  it("does not expose initialData rows whose properties throw while reading", () => {
    const cause = new Error("name getter failed");
    const hostile = {
      id: "atlas",
      get name(): string {
        throw cause;
      },
      status: "active",
      progress: 72,
    } as Project;
    const Projects = Collection.define<Project>({
      name: "Projects.initial-data-hostile-row-ingress",
      getKey: (project) => project.id,
      initialData: [hostile],
    });

    expect(Projects.rows()).toEqual([]);
    expect(asyncResultFacts(Projects.result().get())).toMatchObject({
      _tag: "Failure",
      error: undefined,
      defect: {
        _tag: "EffectInputCallbackError",
        operation: "Collection.rowValue.load",
      },
    });
  });

  it("canonicalizes transform-schema initialData for live reads", () => {
    const WireProjectSchema = Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        status: Schema.Literals(["active", "blocked"]),
        progress: Schema.Union([Schema.Number, Schema.NumberFromString]),
      }),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.initial-data-transform-ingress",
      getKey: (project) => project.id,
      output: WireProjectSchema,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: "72" } as never],
    });

    const row = Projects.get("atlas");
    expect(row).toMatchObject({ id: "atlas", progress: 72 });
    expect(typeof row?.progress).toBe("number");
  });

  it("owns loaded and written rows through detached values", async () => {
    const loaded = [{ id: "atlas", name: "Atlas", meta: { labels: ["loaded"] } }];
    const written = { id: "lumen", name: "Lumen", meta: { labels: ["written"] } };
    const Projects = Collection.define<OwnedProject>({
      name: "Projects.row-ownership.ingress",
      getKey: (project) => project.id,
      sync: {
        load: () => Effect.succeed(loaded),
      },
    });

    await Effect.runPromise(Projects.preload());
    loaded[0]!.meta.labels.push("external-load");
    Projects.get("atlas")!.meta.labels.push("read-load");

    await Effect.runPromise(
      Projects.applyChanges(
        Array.from([written].flat(), (value) => ({ _tag: "Upsert" as const, value })),
      ),
    );
    written.meta.labels.push("external-write");
    Projects.get("lumen")!.meta.labels.push("read-write");

    expect(Projects.get("atlas")?.meta.labels).toEqual(["loaded"]);
    expect(Projects.get("lumen")?.meta.labels).toEqual(["written"]);
  });

  it("reports synchronous load callback throws as defects", () => {
    const Projects = Collection.define<Project, string, Error>({
      name: "Projects.load-sync-throw",
      getKey: (project) => project.id,
      sync: {
        load: () => {
          throw new Error("load failed");
        },
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Projects.preload());
        yield* Effect.sync(() => {
          const failure = exitContractDefect(exit);
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBeInstanceOf(Error);
          expect(((failure as EffectInputCallbackError).cause as Error).message).toBe(
            "load failed",
          );
        });
      }),
    );
  });

  it("reports synchronous getKey throws during collection loads as defects", () => {
    const thrown = new Error("key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.load-key-sync-throw",
      getKey: () => {
        throw thrown;
      },
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          ]),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(Projects.preload());
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.getKey(Projects.load-key-sync-throw)",
          );
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
          expect(asyncResultFacts(Projects.result().get())).toMatchObject({
            _tag: "Failure",
            error: undefined,
            defect: failure,
          });
        });
      }),
    );
  });

  it("reports synchronous getKey throws during direct writes as defects", () => {
    const thrown = new Error("write key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.write-key-sync-throw",
      getKey: () => {
        throw thrown;
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(
          Projects.applyChanges([
            {
              _tag: "Upsert",
              value: {
                id: "atlas",
                name: "Atlas",
                status: "active",
                progress: 72,
              },
            },
          ]),
        );
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.getKey(Projects.write-key-sync-throw)",
          );
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
        });
      }),
    );
  });

  it("rejects non-finite getKey results during preload before rows become visible", () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = Collection.define<Project, number>({
      name: "Projects.preload-key-nan",
      getKey: () => Number.NaN,
      sync: {
        load,
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(Projects.preload());
        yield* Effect.sync(() => {
          expect(load).toHaveBeenCalledTimes(1);
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "load",
          });
          expect(Projects.rows()).toEqual([]);
          expect(asyncResultFacts(Projects.result().get())).toMatchObject({
            _tag: "Failure",
            error: undefined,
            defect: failure,
          });
        });
      }),
    );
  });

  it("describes collection definitions for app graph diagnostics", () => {
    const Projects = Collection.define<Project, string, string | KVE, KV>({
      name: "Projects.collection-diagnostics",
      output: { _tag: "ProjectCollectionOutput" },
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
        progress: {
          key: (project) => project.progress,
          unique: false,
        },
      },
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      policy: {
        retry: Schedule.recurs(1),
      },
      persistence: {
        key: "projects.collection-diagnostics",
        hydrate: {
          replace: true,
        },
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: true,
        persistOnWrite: true,
      },
      sync: {
        load: () => Effect.succeed([]),
      },
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string, string | KVE, KV>({
      name: "ProjectCards.collection-diagnostics",
      getKey: (project) => project.id,
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          name: project.name,
          progress: project.progress,
        })),
    });

    expect(
      defaultCollectionDefinitionRegistry.definitions().get("Projects.collection-diagnostics"),
    ).toBe(Projects);
    expect(defaultCollectionDefinitionRegistry.diagnostics().collections).toEqual(
      expect.arrayContaining([
        {
          name: "Projects.collection-diagnostics",
          readOnly: false,
          outputSchema: true,
          initialData: true,
          indexes: [
            { name: "progress", unique: false },
            { name: "status", unique: false },
          ],
          load: true,
          policy: {
            retry: true,
          },
          persistence: {
            enabled: true,
            key: "projects.collection-diagnostics",
            hydrate: true,
            restoreOnPreload: true,
            loadAfterRestore: true,
            persistOnLoad: true,
            persistOnWrite: true,
          },
        },
        expect.objectContaining({
          name: "ProjectCards.collection-diagnostics",
          readOnly: true,
        }),
      ]),
    );
    expect(
      defaultCollectionDefinitionRegistry.definitions().get("ProjectCards.collection-diagnostics"),
    ).toBe(ProjectCards);
  });

  it("collects nested collection preloads into the parent collector", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collect-nested",
      getKey: (project) => project.id,
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.collect-nested",
      getKey: (task) => task.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          collectCollections(
            Effect.gen(function* () {
              yield* Projects.preload();
              const nested = yield* collectCollections(Tasks.preload());
              expect(nested.definitions).toEqual([Tasks]);
            }),
          ),
        );

        expect(collected.definitions).toEqual([Projects, Tasks]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("preserves duplicate-name preload facts and rejects ambiguous dehydration", () => {
    const runtime = makeRuntime();
    const FirstProjects = Collection.define<Project>({
      name: "Projects.collect-duplicate-name",
      getKey: (project) => project.id,
    });
    // Same-name definitions only coexist across registries; the default
    // registry rejects them at define time.
    const SecondProjects = defineCollection<Project>(
      {
        name: "Projects.collect-duplicate-name",
        getKey: (project) => project.id,
      },
      makeCollectionDefinitionRegistry(),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          collectCollections(
            Effect.all([FirstProjects.preload(), SecondProjects.preload()], {
              discard: true,
            }),
          ),
        );

        expect(collected.definitions).toEqual([FirstProjects, SecondProjects]);
        const failure = yield* Effect.flip(
          runtime.provide(dehydrateCollections(collected.definitions)),
        );
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "snapshot",
          path: "$.collections",
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects a second definition with an existing collection name", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.define-duplicate-name",
      getKey: (project) => project.id,
    });

    const Redefined = Collection.define<Project>({
      name: "Projects.define-duplicate-name",
      getKey: (project) => project.id,
    });
    expect(defaultCollectionDefinitionRegistry.definitions().get(Projects.name)).toBe(Redefined);
  });

  it("deduplicates identical preload facts during dehydration", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collect-duplicate-identity",
      getKey: (project) => project.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          collectCollections(
            Effect.all([Projects.preload(), Projects.refresh()], { discard: true }),
          ),
        );

        expect(collected.definitions).toEqual([Projects, Projects]);
        const payload = yield* runtime.provide(dehydrateCollections(collected.definitions));
        expect(payload.collections.map((snapshot) => snapshot.name)).toEqual([
          "Projects.collect-duplicate-identity",
        ]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("reads rows through named indexes", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexes",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
        progressBand: {
          key: (project) => (project.progress >= 50 ? "high" : "low"),
        },
        facets: (project) => [project.status, project.progress >= 50 ? "high" : "low"],
        duplicateStatus: (project) => [project.status, project.status],
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.firstByIndex("progressBand", "low")).toMatchObject({
      id: "lumen",
      $key: "lumen",
    });
    expect(Projects.index("facets", "high").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.index("duplicateStatus", "active").map((project) => project.id)).toEqual([
      "atlas",
    ]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Update",
          key: "lumen",
          changes: {
            status: "active",
            progress: 58,
          },
        },
      ]),
    );

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual([
      "atlas",
      "lumen",
    ]);
    expect(Projects.index("facets", "high").map((project) => project.id)).toEqual([
      "atlas",
      "lumen",
    ]);
    expect(() => Projects.index("missing", "active")).toThrow(UnknownCollectionIndex);
  });

  it("rejects invalid secondary index selector values before bucketing rows", () => {
    const thrown = new Error("index failed");
    const invalidDate = new Date(Number.NaN);
    const invalidIndexes = [
      {
        name: "promise",
        index: (() => Promise.resolve("active")) as never,
      },
      {
        name: "effect",
        index: (() => Effect.succeed("active")) as never,
      },
      {
        name: "object",
        index: (() => ({ status: "active" })) as never,
      },
      {
        name: "invalid-date",
        index: (() => invalidDate) as never,
      },
      {
        name: "throwing",
        index: (() => {
          throw thrown;
        }) as never,
      },
    ] as const;

    for (const { name, index } of invalidIndexes) {
      const Projects = Collection.define<Project>({
        name: `Projects.index-invalid-${name}`,
        getKey: (project) => project.id,
        indexes: {
          invalid: index,
        },
        initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      });

      expect(() => Projects.index("invalid", "active")).toThrow(EffectInputCallbackError);
      expect(() => Projects.firstByIndex("invalid", "active")).toThrow(EffectInputCallbackError);
    }
  });

  it("rejects invalid secondary index lookup Date values", () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.index-invalid-date-lookup",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
      },
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });

    for (const lookup of [
      () => Projects.index("status", invalidDate),
      () => Projects.firstByIndex("status", invalidDate),
    ]) {
      expect(lookup).toThrow(EffectInputCallbackError);
      try {
        lookup();
        expect.fail("Expected invalid Date index lookup to fail.");
      } catch (error) {
        expect(error).toMatchObject({
          _tag: "EffectInputCallbackError",
          operation: "Collection.index.value",
        });
      }
    }
  });

  it("materializes secondary indexes inside the active Collection store", async () => {
    const byStatus = vi.fn((project: Project) => project.status);
    const Projects = Collection.define<Project>({
      name: "Projects.index-cache",
      getKey: (project) => project.id,
      indexes: {
        status: byStatus,
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.firstByIndex("status", "active")).toMatchObject({ id: "atlas" });
    expect(byStatus).toHaveBeenCalledTimes(2);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { status: "active" } }]),
    );

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual([
      "atlas",
      "lumen",
    ]);
    expect(byStatus).toHaveBeenCalledTimes(4);
  });

  it("applies external collection change batches through the Collection store", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.change-batch",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Upsert",
          value: { id: "atlas", name: "Atlas Prime", status: "blocked", progress: 90 },
        },
        {
          _tag: "Upsert",
          value: { id: "orion", name: "Orion", status: "active", progress: 20 },
        },
        {
          _tag: "Delete",
          key: "lumen",
        },
      ]),
    );

    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "orion"]);
    expect(Projects.get("atlas")).toMatchObject({
      name: "Atlas Prime",
      $origin: "remote",
      $synced: true,
    });
    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["orion"]);
  });

  it("does not partially apply external change batches when persistence fails", async () => {
    const diskFull = keyValueStoreError("set", "projects", "disk-full");
    const storage = makeTestKeyValueStore({ beforeSet: () => Effect.fail(diskFull) });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.change-batch-atomic-persist",
      getKey: (project) => project.id,
      persistence: {
        persistOnWrite: true,
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });

    try {
      await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const beforeVersion = Projects.version().get();
              const subscription = yield* subscribeCollectionEvents();
              const error = yield* Effect.flip(
                Projects.applyChanges([
                  {
                    _tag: "Upsert",
                    value: { id: "orion", name: "Orion", status: "active", progress: 20 },
                  },
                  {
                    _tag: "Delete",
                    key: "atlas",
                  },
                ]),
              );
              const event = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(error).toBe(diskFull);
              expect(Option.isNone(event)).toBe(true);
              expect(Projects.version().get()).toBe(beforeVersion);
              expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "lumen"]);
            }),
          ),
        ),
      );
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("does not publish or retain direct writes when persistence fails", async () => {
    const diskFull = keyValueStoreError("set", "projects", "disk-full");
    const storage = makeTestKeyValueStore({ beforeSet: () => Effect.fail(diskFull) });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.direct-write-atomic-persist",
      getKey: (project) => project.id,
      persistence: {
        persistOnWrite: true,
      },
    });

    try {
      await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const beforeVersion = Projects.version().get();
              const subscription = yield* subscribeCollectionEvents();
              const error = yield* Effect.flip(
                Projects.applyChanges([
                  {
                    _tag: "Upsert",
                    value: {
                      id: "atlas",
                      name: "Atlas",
                      status: "active",
                      progress: 72,
                    },
                  },
                ]),
              );
              const event = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(error).toBe(diskFull);
              expect(Option.isNone(event)).toBe(true);
              expect(Projects.version().get()).toBe(beforeVersion);
              expect(Projects.rows()).toEqual([]);
            }),
          ),
        ),
      );
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("does not persist, publish, or tick versions for empty and missing collection writes", async () => {
    const setItem = vi.fn((_key: string, _value: string) => Effect.void);
    const storage = makeTestKeyValueStore({ beforeSet: setItem });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.no-op-writes",
      getKey: (project) => project.id,
      persistence: {
        persistOnWrite: true,
      },
    });

    try {
      await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const beforeVersion = Projects.version().get();
              const subscription = yield* subscribeCollectionEvents();

              yield* Projects.applyChanges([]);
              yield* Projects.applyChanges([]);
              yield* Projects.applyChanges([{ _tag: "Delete", key: "missing" }]);

              const event = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(Option.isNone(event)).toBe(true);
              expect(setItem).not.toHaveBeenCalled();
              expect(Projects.version().get()).toBe(beforeVersion);
              expect(Projects.rows()).toEqual([]);
            }),
          ),
        ),
      );
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps collection rows isolated by Sunfall Arc runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.runtime-isolation",
      getKey: (project) => project.id,
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72,
            },
          },
        ]),
      );

      expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
      ]);
      expect(runWithRuntime(second, () => Projects.rows())).toEqual([]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("evaluates one-shot queries against the active Sunfall Arc runtime store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.query-runtime-isolation",
      getKey: (project) => project.id,
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72,
            },
          },
        ]),
      );

      await expect(
        runInRuntime(
          first,
          Query.once((query) =>
            query.from({ project: Projects }).select(({ project }) => project.id),
          ),
        ),
      ).resolves.toEqual(["atlas"]);
      await expect(
        runInRuntime(
          second,
          Query.once((query) =>
            query.from({ project: Projects }).select(({ project }) => project.id),
          ),
        ),
      ).resolves.toEqual([]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("attaches separate Collection stores to separate Resource Stores", async () => {
    const firstStore = makeResourceStore();
    const secondStore = makeResourceStore();
    const Projects = Collection.define<Project>({
      name: "Projects.resource-store-isolation",
      getKey: (project) => project.id,
    });

    const firstCollectionStore = await Effect.runPromise(
      Effect.provideService(activeCollectionStore, ResourceStore, firstStore),
    );
    const secondCollectionStore = await Effect.runPromise(
      Effect.provideService(activeCollectionStore, ResourceStore, secondStore),
    );

    expect(firstCollectionStore).not.toBe(secondCollectionStore);
    await Effect.runPromise(
      Effect.provideService(
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72,
            },
          },
        ]),
        ResourceStore,
        firstStore,
      ),
    );

    const firstSnapshot = await Effect.runPromise(
      Effect.provideService(Projects.snapshot(), ResourceStore, firstStore),
    );
    const secondSnapshot = await Effect.runPromise(
      Effect.provideService(Projects.snapshot(), ResourceStore, secondStore),
    );
    const firstDiagnostics = await Effect.runPromise(
      Effect.provideService(
        activeCollectionStore.pipe(Effect.flatMap((store) => store.diagnostics.snapshot)),
        ResourceStore,
        firstStore,
      ),
    );
    const secondDiagnostics = await Effect.runPromise(
      Effect.provideService(
        activeCollectionStore.pipe(Effect.flatMap((store) => store.diagnostics.snapshot)),
        ResourceStore,
        secondStore,
      ),
    );

    expect(firstSnapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
    expect(secondSnapshot.rows).toEqual([]);
    expect(firstDiagnostics).toMatchObject({
      collectionCount: 1,
      rowCount: 1,
      pendingMutationCount: 0,
    });
    expect(secondDiagnostics).toMatchObject({
      collectionCount: 1,
      rowCount: 0,
      pendingMutationCount: 0,
    });
  });

  it("snapshots and dehydrates from the active Collection store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const initialProject: Project = {
      id: "atlas",
      name: "Atlas",
      status: "active",
      progress: 72,
    };
    const Projects = Collection.define<Project>({
      name: "Projects.collection-store-sync-override",
      getKey: (project) => project.id,
    });
    const pendingSnapshot: Collection.Snapshot<Project, string> = {
      name: Projects.name,
      rows: [
        {
          key: "atlas",
          value: initialProject,
          synced: true,
          origin: "remote",
        },
      ],
      updatedAt: 1,
    };

    try {
      const firstCollectionStore = await runInRuntime(first, activeCollectionStore);
      const secondCollectionStore = await runInRuntime(second, activeCollectionStore);

      await runInRuntime(first, Projects.hydrate(pendingSnapshot));

      expect(
        runWithCollectionStore(firstCollectionStore, () => Projects.rows().map((row) => row.id)),
      ).toEqual(["atlas"]);
      expect(runWithCollectionStore(secondCollectionStore, () => Projects.rows())).toEqual([]);
      expect((await runInRuntime(first, Projects.snapshot())).rows.map((row) => row.key)).toEqual([
        "atlas",
      ]);
      expect((await runInRuntime(second, Projects.snapshot())).rows).toEqual([]);
      expect(
        runWithCollectionStore(firstCollectionStore, () =>
          dehydrateCollectionsSync([Projects]).collections[0]?.rows.map((row) => row.key),
        ),
      ).toEqual(["atlas"]);
      expect(
        runWithCollectionStore(
          secondCollectionStore,
          () => dehydrateCollectionsSync([Projects]).collections[0]?.rows,
        ),
      ).toEqual([]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("publishes collection events through the active Collection store", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collection-store-events",
      getKey: (project) => project.id,
    });

    try {
      const events = await runInRuntime(
        runtime,
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* activeCollectionStore;
            const subscription = yield* store.subscribeEvents();
            yield* Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]);
            const written = yield* PubSub.take(subscription);
            return [written] as const;
          }),
        ),
      );

      expect(events).toMatchObject([
        {
          _tag: "CollectionWritten",
          collection: "Projects.collection-store-events",
          mutations: 1,
        },
      ]);
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("reads runtime-local rows through secondary collection indexes", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.secondary-index",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
        buckets: (project) => [
          project.status,
          project.progress >= 50 ? "high-progress" : "low-progress",
        ],
        byName: {
          key: (project) => project.name,
          unique: true,
        },
      },
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges([
          { _tag: "Upsert", value: { id: "atlas", name: "Atlas", status: "active", progress: 72 } },
          {
            _tag: "Upsert",
            value: { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          },
        ]),
      );
      await runInRuntime(
        second,
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "kepler",
              name: "Kepler",
              status: "active",
              progress: 52,
            },
          },
        ]),
      );

      expect(
        runWithRuntime(first, () =>
          Projects.index("status", "active").map((project) => project.id),
        ),
      ).toEqual(["atlas"]);
      expect(
        runWithRuntime(first, () =>
          Projects.index("buckets", "high-progress").map((project) => project.id),
        ),
      ).toEqual(["atlas"]);
      expect(runWithRuntime(first, () => Projects.firstByIndex("byName", "Atlas"))).toMatchObject({
        id: "atlas",
        $key: "atlas",
      });
      expect(
        runWithRuntime(second, () =>
          Projects.index("status", "active").map((project) => project.id),
        ),
      ).toEqual(["kepler"]);

      await runInRuntime(
        first,
        Projects.applyChanges([
          { _tag: "Update", key: "lumen", changes: { status: "active", progress: 66 } },
        ]),
      );

      expect(
        runWithRuntime(first, () =>
          Projects.index("status", "active").map((project) => project.id),
        ),
      ).toEqual(["atlas", "lumen"]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("snapshots and hydrates rows with collection metadata inside the active runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-hydrate",
      getKey: (project) => project.id,
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges(
          [
            {
              _tag: "Upsert",
              value: {
                id: "atlas",
                name: "Atlas",
                status: "active",
                progress: 72,
              },
            },
          ],
          { origin: "local", synced: false },
        ),
      );

      const snapshot = await runInRuntime(first, Projects.snapshot());

      expect(snapshot).toMatchObject({
        name: "Projects.snapshot-hydrate",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            synced: false,
            origin: "local",
          },
        ],
      });

      await runInRuntime(second, Projects.hydrate(snapshot));

      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        id: "atlas",
        name: "Atlas",
        $synced: false,
        $origin: "local",
      });
      expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
      ]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("ticks collection version once when hydrating a snapshot", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.hydrate-version-once",
      getKey: (project) => project.id,
    });
    const snapshot: Collection.Snapshot<Project, string> = {
      name: "Projects.hydrate-version-once",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          synced: true,
          origin: "remote",
        },
      ],
      updatedAt: 1,
    };

    try {
      await runInRuntime(
        runtime,
        Effect.gen(function* () {
          const version = Projects.version();
          const beforeVersion = version.get();
          let ticks = 0;
          const unsubscribe = version.subscribe(() => {
            ticks++;
          });
          try {
            yield* Projects.hydrate(snapshot);
          } finally {
            unsubscribe();
          }

          expect(version.get()).toBe(beforeVersion + 1);
          expect(ticks).toBe(1);
        }),
      );
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("detaches snapshot rows from mutable collection state", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<SnapshotProject, string, never>({
      name: "Projects.snapshot-codec-detach",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", meta: { labels: ["remote"] } }],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = yield* runtime.provide(Projects.snapshot());
        const row = snapshot.rows[0];

        expect(row?.value.meta.labels).toEqual(["remote"]);
        row?.value.meta.labels.push("snapshot-only");
        expect(runWithRuntime(runtime, () => Projects.get("atlas")?.meta.labels)).toEqual([
          "remote",
        ]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("detaches collection values with Maps, class instances, and binary views", () => {
    class Owner {
      constructor(readonly labels: Array<string>) {}
    }
    interface RichProject {
      readonly id: string;
      readonly meta: {
        readonly labels: Map<string, Array<string>>;
        readonly owner: Owner;
        readonly bytes: Uint8Array;
        readonly buffer: ArrayBuffer;
      };
    }

    const runtime = makeRuntime();
    const Projects = Collection.define<RichProject>({
      name: "Projects.collection-value-detach",
      getKey: (project) => project.id,
      initialData: [
        {
          id: "atlas",
          meta: {
            labels: new Map([["status", ["remote"]]]),
            owner: new Owner(["primary"]),
            bytes: new Uint8Array([1, 2, 3]),
            buffer: new Uint8Array([4, 5, 6]).buffer,
          },
        },
      ],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const row = runWithRuntime(runtime, () => Projects.rows()[0]);
        row?.meta.labels.get("status")?.push("row-only");
        row?.meta.owner.labels.push("row-only");
        if (row) {
          row.meta.bytes[0] = 9;
          new Uint8Array(row.meta.buffer)[0] = 9;
        }

        yield* Effect.sync(() => {
          const stored = runWithRuntime(runtime, () => Projects.get("atlas"));
          expect(stored?.meta.labels.get("status")).toEqual(["remote"]);
          expect(stored?.meta.owner).toBeInstanceOf(Owner);
          expect(stored?.meta.owner.labels).toEqual(["primary"]);
          expect(stored?.meta.bytes[0]).toBe(1);
          expect(new Uint8Array(stored?.meta.buffer ?? new ArrayBuffer(0))[0]).toBe(4);
        });

        const snapshot = yield* runtime.provide(Projects.snapshot());
        const snapshotValue = snapshot.rows[0]?.value;
        snapshotValue?.meta.labels.get("status")?.push("snapshot-only");
        snapshotValue?.meta.owner.labels.push("snapshot-only");
        if (snapshotValue) {
          snapshotValue.meta.bytes[0] = 7;
          new Uint8Array(snapshotValue.meta.buffer)[0] = 7;
        }

        yield* Effect.sync(() => {
          const stored = runWithRuntime(runtime, () => Projects.get("atlas"));
          expect(stored?.meta.labels.get("status")).toEqual(["remote"]);
          expect(stored?.meta.owner.labels).toEqual(["primary"]);
          expect(stored?.meta.bytes[0]).toBe(1);
          expect(new Uint8Array(stored?.meta.buffer ?? new ArrayBuffer(0))[0]).toBe(4);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("persists and restores collection snapshots through the runtime KeyValueStore", async () => {
    const storage = makeTestKeyValueStore();
    const first = makeRuntime(storage.layer);
    const second = makeRuntime(storage.layer);
    const Projects = Collection.define<Project>({
      name: "Projects.persist-restore",
      getKey: (project) => project.id,
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges([
          { _tag: "Upsert", value: { id: "atlas", name: "Atlas", status: "active", progress: 72 } },
          {
            _tag: "Upsert",
            value: { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          },
        ]),
      );
      await runInRuntime(first, Projects.persist({ key: "projects-cache" }));

      expect(storage.values.has(collectionStoreKey("projects-cache"))).toBe(true);

      await runInRuntime(second, Projects.restore({ key: "projects-cache" }));

      expect(
        runWithRuntime(second, () =>
          Projects.rows()
            .map((project) => project.name)
            .sort(),
        ),
      ).toEqual(["Atlas", "Lumen"]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("loads after restoring over initial data and persists the refreshed snapshot", () => {
    const key = "projects-restore-load-after-initial-cache";
    const storage = makeTestKeyValueStore(
      {},
      new Map([
        [
          collectionStoreKey(key),
          JSON.stringify({
            name: "Projects.restore-load-after-initial",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
                synced: true,
                origin: "remote",
              },
            ],
            updatedAt: 1,
          }),
        ],
      ]),
    );
    const runtime = makeRuntime(storage.layer);
    let loads = 0;
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.restore-load-after-initial",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Initial", status: "active", progress: 1 }],
      persistence: {
        key,
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: true,
      },
      sync: {
        load: () =>
          Effect.sync(() => {
            loads++;
            return [{ id: "atlas", name: "Loaded", status: "blocked", progress: 99 }];
          }),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preload());

        const persisted = storage.snapshot<Project>(key);
        expect(loads).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded",
          progress: 99,
        });
        expect(persisted?.rows.map((row) => row.value.name)).toEqual(["Loaded"]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("skips restore-before-preload when persistence hydrate is disabled", () => {
    const key = "projects-restore-hydrate-disabled-cache";
    let gets = 0;
    const storage = makeTestKeyValueStore(
      { beforeGet: () => Effect.sync(() => void gets++) },
      new Map([
        [
          collectionStoreKey(key),
          JSON.stringify({
            name: "Projects.restore-hydrate-disabled",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
                synced: true,
                origin: "remote",
              },
            ],
            updatedAt: 1,
          }),
        ],
      ]),
    );
    const runtime = makeRuntime(storage.layer);
    let loads = 0;
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.restore-hydrate-disabled",
      getKey: (project) => project.id,
      persistence: {
        key,
        hydrate: false,
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: false,
      },
      sync: {
        load: () =>
          Effect.sync(() => {
            loads++;
            return [{ id: "atlas", name: "Loaded", status: "blocked", progress: 99 }];
          }),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preload());

        expect(gets).toBe(0);
        expect(loads).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded",
          progress: 99,
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rolls back preload rows and lets later preload retry when persistOnLoad fails", () => {
    const key = "projects-preload-persist-failure-cache";
    const persisted = new Map<string, string>();
    let writes = 0;
    let loads = 0;
    const diskFull = keyValueStoreError("set", collectionStoreKey(key), "disk-full");
    const storage = makeTestKeyValueStore(
      { beforeSet: () => (writes++ === 0 ? Effect.fail(diskFull) : Effect.void) },
      persisted,
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.preload-persist-failure",
      getKey: (project) => project.id,
      persistence: {
        key,
        persistOnLoad: true,
      },
      sync: {
        load: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: `Loaded ${loads}`, status: "blocked", progress: 90 + loads },
            ] satisfies ReadonlyArray<Project>;
          }),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* subscribeCollectionEvents();
              const failure = yield* Effect.flip(Projects.preload());
              const failureEvent = yield* PubSub.take(subscription);
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(failure).toBe(diskFull);
              expect(failureEvent).toMatchObject({
                _tag: "CollectionLoadFailure",
                collection: "Projects.preload-persist-failure",
                error: diskFull,
              });
              expect(Option.isNone(nextEvent)).toBe(true);
            }),
          ),
        );

        expect(loads).toBe(1);
        expect(writes).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Failure",
          error: diskFull,
        });

        yield* runtime.provide(Projects.preload());

        const snapshot = storage.snapshot<Project>(key);
        expect(loads).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded 2",
          progress: 92,
        });
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Success",
        });
        expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Loaded 2"]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rolls back forced refresh rows and lets later refresh retry when persistOnLoad fails", () => {
    const key = "projects-refresh-persist-failure-cache";
    const persisted = new Map<string, string>();
    let writes = 0;
    let refetches = 0;
    const diskFull = keyValueStoreError("set", collectionStoreKey(key), "disk-full");
    const storage = makeTestKeyValueStore(
      { beforeSet: () => (writes++ === 0 ? Effect.fail(diskFull) : Effect.void) },
      persisted,
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.refresh-persist-failure",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Initial", status: "active", progress: 1 }],
      persistence: {
        key,
        persistOnLoad: true,
      },
      sync: {
        refresh: () =>
          Effect.sync(() => {
            refetches++;
            return [
              {
                id: "atlas",
                name: `Refetched ${refetches}`,
                status: "blocked",
                progress: 80 + refetches,
              },
            ] satisfies ReadonlyArray<Project>;
          }),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* subscribeCollectionEvents();
              const failure = yield* Effect.flip(Projects.refresh());
              const failureEvent = yield* PubSub.take(subscription);
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(failure).toBe(diskFull);
              expect(failureEvent).toMatchObject({
                _tag: "CollectionLoadFailure",
                collection: "Projects.refresh-persist-failure",
                error: diskFull,
              });
              expect(Option.isNone(nextEvent)).toBe(true);
            }),
          ),
        );

        expect(refetches).toBe(1);
        expect(writes).toBe(1);
        expect(
          runWithRuntime(runtime, () => Projects.rows().map((project) => project.name)),
        ).toEqual(["Initial"]);
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Failure",
          error: diskFull,
        });

        yield* runtime.provide(Projects.refresh());

        const snapshot = storage.snapshot<Project>(key);
        expect(refetches).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Refetched 2",
          progress: 82,
        });
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Success",
        });
        expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Refetched 2"]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("retries persistedOptions loadAfterRestore after persistOnLoad fails", () => {
    const key = "projects-persisted-options-load-after-restore-failure-cache";
    const persisted = new Map<string, string>([
      [
        collectionStoreKey(key),
        JSON.stringify({
          name: "Projects.persisted-options-load-after-restore-failure",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
              synced: true,
              origin: "remote",
            },
          ],
          updatedAt: 1,
        }),
      ],
    ]);
    let writes = 0;
    let loads = 0;
    const diskFull = keyValueStoreError("set", collectionStoreKey(key), "disk-full");
    const storage = makeTestKeyValueStore(
      { beforeSet: () => (writes++ === 0 ? Effect.fail(diskFull) : Effect.void) },
      persisted,
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.persisted-options-load-after-restore-failure",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: `Loaded ${loads}`, status: "blocked", progress: 50 + loads },
            ] satisfies ReadonlyArray<Project>;
          }),
      },
      persistence: {
        key,
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: true,
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* subscribeCollectionEvents();
              const failure = yield* Effect.flip(Projects.preload());
              const events = [
                yield* PubSub.take(subscription),
                yield* PubSub.take(subscription),
                yield* PubSub.take(subscription),
              ];
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis"),
              );

              expect(failure).toBe(diskFull);
              expect(events.map((event) => event._tag)).toEqual([
                "CollectionHydrated",
                "CollectionRestored",
                "CollectionLoadFailure",
              ]);
              expect(Option.isNone(nextEvent)).toBe(true);
            }),
          ),
        );

        expect(loads).toBe(1);
        expect(writes).toBe(1);
        expect(
          runWithRuntime(runtime, () => Projects.rows().map((project) => project.name)),
        ).toEqual(["Restored"]);
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Failure",
          error: diskFull,
        });

        yield* runtime.provide(Projects.preload());

        const snapshot = storage.snapshot<Project>(key);
        expect(loads).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded 2",
          progress: 52,
        });
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Success",
        });
        expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Loaded 2"]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("does not let a stale preload restore overwrite a newer forced refresh", async () => {
    const key = "projects-stale-restore-race-cache";
    const firstRestoreStarted = Effect.runSync(Deferred.make<void>());
    const releaseFirstRestore = Effect.runSync(Deferred.make<void>());
    const persisted = new Map<string, string>([
      [
        collectionStoreKey(key),
        JSON.stringify({
          name: "Projects.stale-restore-race",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Restored Old", status: "blocked", progress: 1 },
              synced: true,
              origin: "remote",
            },
          ],
          updatedAt: 1,
        }),
      ],
    ]);
    let gets = 0;
    const storage = makeTestKeyValueStore(
      {
        get: (_storageKey, stored) => {
          gets++;
          if (gets === 1) {
            return Effect.gen(function* () {
              yield* Deferred.succeed(firstRestoreStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseFirstRestore);
              return stored;
            });
          }
          return Effect.succeed(undefined);
        },
      },
      persisted,
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.stale-restore-race",
      getKey: (project) => project.id,
      persistence: {
        key,
        restoreOnPreload: true,
        persistOnLoad: true,
      },
      sync: {
        load: () =>
          Effect.succeed([{ id: "atlas", name: "Loaded", status: "active", progress: 2 }]),
        refresh: () =>
          Effect.succeed([
            { id: "atlas", name: "Refetched Fresh", status: "active", progress: 99 },
          ]),
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(firstRestoreStarted));
      refetch = runtime.runFork(Projects.refresh());
      await Effect.runPromise(Fiber.join(refetch));

      Effect.runSync(Deferred.succeed(releaseFirstRestore, undefined));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = storage.snapshot<Project>(key);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Refetched Fresh",
        progress: 99,
      });
      expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Refetched Fresh"]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseFirstRestore, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload).pipe(Effect.timeoutOption("100 millis")));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("serializes restore-before-preload with direct writes", async () => {
    const key = "projects-restore-write-serialization-cache";
    const restoreStarted = Effect.runSync(Deferred.make<void>());
    const releaseRestore = Effect.runSync(Deferred.make<void>());
    const oldSnapshot = JSON.stringify({
      name: "Projects.restore-write-serialization",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Restored Old", status: "blocked", progress: 1 },
          synced: true,
          origin: "remote",
        },
      ],
      updatedAt: 1,
    });
    const persisted = new Map<string, string>([[collectionStoreKey(key), oldSnapshot]]);
    let gets = 0;
    const storage = makeTestKeyValueStore(
      {
        get: (_storageKey, stored) => {
          gets++;
          if (gets === 1) {
            return Effect.gen(function* () {
              yield* Deferred.succeed(restoreStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseRestore);
              return stored;
            });
          }
          return Effect.succeed(stored);
        },
      },
      persisted,
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.restore-write-serialization",
      getKey: (project) => project.id,
      persistence: {
        key,
        restoreOnPreload: true,
        persistOnWrite: true,
      },
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let write: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preload());
      await Effect.runPromise(Deferred.await(restoreStarted));
      write = runtime.runFork(
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Fresh Write",
              status: "active",
              progress: 42,
            },
          },
        ]),
      );
      await Effect.runPromise(Fiber.join(write));

      Effect.runSync(Deferred.succeed(releaseRestore, undefined));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = storage.snapshot<Project>(key);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Fresh Write",
        progress: 42,
      });
      expect(snapshot?.rows.map((row) => row.value.name)).toEqual(["Fresh Write"]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseRestore, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload).pipe(Effect.timeoutOption("100 millis")));
      }
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("serializes durable direct write commits so older storage writes cannot overwrite newer snapshots", async () => {
    const key = "projects-direct-write-serialization-cache";
    const firstPersistStarted = Effect.runSync(Deferred.make<void>());
    const releaseFirstPersist = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () => {
        writes++;
        return writes === 1
          ? Effect.gen(function* () {
              yield* Deferred.succeed(firstPersistStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseFirstPersist);
            })
          : Effect.void;
      },
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.direct-write-serialization",
      getKey: (project) => project.id,
      persistence: {
        key,
        persistOnWrite: true,
      },
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 1,
            },
          },
        ]),
      );
      await Effect.runPromise(Deferred.await(firstPersistStarted));
      second = runtime.runFork(
        Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 2 } }]),
      );
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseFirstPersist, undefined));
      await Effect.runPromise(Fiber.join(first));
      await Effect.runPromise(Fiber.join(second));

      const snapshot = storage.snapshot<Project>(key);
      expect(snapshot?.rows.map((row) => row.value.progress)).toEqual([2]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseFirstPersist, undefined).pipe(Effect.ignore));
      if (first !== undefined) {
        await Effect.runPromise(Fiber.await(first).pipe(Effect.timeoutOption("100 millis")));
      }
      if (second !== undefined) {
        await Effect.runPromise(Fiber.await(second).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("does not mark missing preload storage as restored", () => {
    const key = "projects-missing-restore-cache";
    const storage = makeTestKeyValueStore();
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.missing-restore",
      getKey: (project) => project.id,
      persistence: {
        key,
        restoreOnPreload: true,
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preload());
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);

        yield* Effect.sync(() =>
          storage.values.set(
            collectionStoreKey(key),
            JSON.stringify({
              name: "Projects.missing-restore",
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Restored", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote",
                },
              ],
              updatedAt: 1,
            }),
          ),
        );

        yield* runtime.provide(Projects.preload());

        expect(
          runWithRuntime(runtime, () => Projects.rows().map((project) => project.name)),
        ).toEqual(["Restored"]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("validates persisted snapshot shape before hydrating storage rows", () => {
    const storage = makeTestKeyValueStore(
      {},
      new Map([
        [
          collectionStoreKey("invalid-projects-cache"),
          JSON.stringify({
            name: "Projects.snapshot-codec-invalid",
            rows: "not-rows",
            updatedAt: 1,
          }),
        ],
      ]),
    );
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-invalid",
      getKey: (project) => project.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(Projects.restore({ key: "invalid-projects-cache" })),
        );

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "decode",
            path: "$.rows",
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("fails direct malformed snapshots through the hydrate Effect error channel", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-direct-invalid",
      getKey: (project) => project.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            Projects.hydrate({
              name: "Projects.snapshot-codec-direct-invalid",
              // @ts-expect-error runtime validation rejects malformed payload rows.
              rows: "not-rows",
              updatedAt: 1,
            }),
          ),
        );

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$.rows",
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects duplicate row keys in collection snapshots", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-duplicate-row",
      getKey: (project) => project.id,
      initialData: [{ id: "existing", name: "Existing", status: "active", progress: 1 }],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            Projects.hydrate({
              name: "Projects.snapshot-codec-duplicate-row",
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote",
                },
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas Duplicate", status: "blocked", progress: 20 },
                  synced: true,
                  origin: "remote",
                },
              ],
              updatedAt: 1,
            }),
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          path: "$.rows[1].key",
        });
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing"],
        );
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects non-finite numeric collection keys before persistence writes", () => {
    const storage = makeTestKeyValueStore();
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, number>({
      name: "Projects.snapshot-codec-non-finite-key",
      getKey: () => Number.NaN,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          ),
        );

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "write",
          path: "$.collections[Projects.snapshot-codec-non-finite-key].changes[0].key",
        });
        yield* runtime.provide(Projects.persist());
        expect(storage.values.size).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects non-finite numeric collection keys before rows can be dehydrated", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project, number>({
      name: "Projects.snapshot-codec-non-finite-key-dehydrate",
      getKey: () => Number.NaN,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          ),
        );

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "write",
          path: "$.collections[Projects.snapshot-codec-non-finite-key-dehydrate].changes[0].key",
        });
        expect(
          runWithRuntime(runtime, () => dehydrateCollectionsSync([Projects]).collections[0]?.rows),
        ).toEqual([]);
        const payload = yield* runtime.provide(dehydrateCollections([Projects]));
        expect(payload.collections[0]?.rows).toEqual([]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects executable-shaped row values at load, write, change-feed, and hydrate ingress", () => {
    const runtime = makeRuntime();
    const throwingRow = (): Project => ({
      id: "atlas",
      get name(): string {
        throw new Error("name getter failed");
      },
      status: "active",
      progress: 72,
    });
    const LoadingProjects = Collection.define<Project>({
      name: "Projects.executable-row-load-ingress",
      getKey: (project) => project.id,
      sync: {
        refresh: () =>
          Effect.succeed([
            { id: "atlas", name: Effect.succeed("Atlas"), status: "active", progress: 72 } as never,
          ]),
      },
    });
    const Projects = Collection.define<Project>({
      name: "Projects.executable-row-write-ingress",
      getKey: (project) => project.id,
    });
    const HostileProjects = Collection.define<Project>({
      name: "Projects.hostile-row-ingress",
      getKey: (project) => project.id,
      sync: {
        refresh: () => Effect.succeed([throwingRow()]),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const loadFailure = yield* flipContractDefect(runtime.provide(LoadingProjects.preload()));
        const writeFailure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: Effect.succeed("Atlas") as never,
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          ),
        );
        const changeFailure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: Promise.resolve("Atlas") as never,
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          ),
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(
            Projects.hydrate({
              name: "Projects.executable-row-write-ingress",
              rows: [
                {
                  key: "atlas",
                  value: {
                    id: "atlas",
                    name: Effect.succeed("Atlas") as never,
                    status: "active",
                    progress: 72,
                  },
                  synced: true,
                  origin: "remote",
                },
              ],
              updatedAt: 1,
            }),
          ),
        );
        const hostileLoadFailure = yield* flipContractDefect(
          runtime.provide(HostileProjects.preload()),
        );
        const hostileWriteFailure = yield* flipContractDefect(
          runtime.provide(
            HostileProjects.applyChanges(
              Array.from([throwingRow()].flat(), (value) => ({ _tag: "Upsert" as const, value })),
            ),
          ),
        );
        const hostileChangeFailure = yield* flipContractDefect(
          runtime.provide(
            HostileProjects.applyChanges([
              {
                _tag: "Upsert",
                value: throwingRow(),
              },
            ]),
          ),
        );

        expect(loadFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue",
        });
        expect(writeFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue",
        });
        expect(changeFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "PromiseLikeValue",
        });
        expect(hydrateFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue",
        });
        for (const failure of [hostileLoadFailure, hostileWriteFailure, hostileChangeFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: expect.stringMatching(/^Collection\.rowValue\./),
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(runWithRuntime(runtime, () => HostileProjects.rows())).toEqual([]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("omits invalid initialData from dehydrate payloads", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.dehydrate-invalid-initial-data",
      getKey: (project) => project.id,
      output: ProjectRowsSchema,
      initialData: [{ id: "atlas", name: 123, status: "active", progress: 72 } as never],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* runtime.provide(dehydrateCollections([Projects]));

        expect(payload.collections[0]?.rows).toEqual([]);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(
          asyncResultFacts(runWithRuntime(runtime, () => Projects.result().get())),
        ).toMatchObject({
          _tag: "Failure",
          error: undefined,
          defect: { _tag: "CollectionSnapshotCodecError", operation: "load" },
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("returns canonical dehydrate payloads for transform schemas", () => {
    const runtime = makeRuntime();
    const WireProjectSchema = Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        status: Schema.Literals(["active", "blocked"]),
        progress: Schema.Union([Schema.Number, Schema.NumberFromString]),
      }),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.dehydrate-transform-initial-data",
      getKey: (project) => project.id,
      output: WireProjectSchema,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: "72" } as never],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* runtime.provide(dehydrateCollections([Projects]));
        const value = payload.collections[0]?.rows[0]?.value;

        expect(value).toMatchObject({
          id: "atlas",
          progress: 72,
        });
        expect(typeof value?.progress).toBe("number");
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("preflights multi-collection hydration before mutating any collection", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-projects",
      getKey: (project) => project.id,
      initialData: [{ id: "existing-project", name: "Existing", status: "active", progress: 1 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-preflight-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false },
      ],
    });
    const task: Task = { id: "task-1", projectId: "atlas", title: "Plan", done: false };
    const taskRow = { key: "task-1", value: task, synced: true, origin: "remote" as const };

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = {
          collections: [
            {
              name: "Projects.snapshot-codec-preflight-projects",
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              updatedAt: 1,
            },
            {
              name: "Tasks.snapshot-codec-preflight-tasks",
              // A duplicate row key fails the second snapshot after the first validated.
              rows: [taskRow, taskRow],
              updatedAt: 1,
            },
          ],
        };
        const failure = yield* Effect.flip(
          runtime.provide(hydrateCollections([Projects, Tasks], payload)),
        );

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing-project"],
        );
        expect(runWithRuntime(runtime, () => Tasks.rows().map((taskRow) => taskRow.id))).toEqual([
          "existing-task",
        ]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("holds durable permits for a full multi-collection hydration payload", () => {
    const runtime = makeRuntime();
    const storeExplicitHydrateStarted = Effect.runSync(Deferred.make<void>());
    const releaseStoreExplicitHydrate = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-payload-atomic-projects",
      getKey: (project) => project.id,
      initialData: [{ id: "existing-project", name: "Existing", status: "active", progress: 1 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-payload-atomic-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false },
      ],
    });
    const snapshotFromStore: StoreExplicitCollectionSnapshotImplementation<
      Task,
      string
    >["snapshotWithStore"] = (store, updatedAt) => ({
      name: Tasks.name,
      rows: Array.from(store.state(Tasks).rows.values()).map((row) => ({
        key: row.key,
        value: row.value,
        synced: row.synced,
        origin: row.origin,
      })),
      updatedAt,
    });
    Object.assign(Tasks, {
      snapshotWithStore: snapshotFromStore,
      snapshotWithStoreEffect: (store, updatedAt) =>
        Effect.succeed(snapshotFromStore(store, updatedAt)),
      hydratePreflightEffect: () => Effect.void,
      hydrateWithStoreEffect: (store, snapshot, options) =>
        Deferred.succeed(storeExplicitHydrateStarted, undefined).pipe(
          Effect.flatMap(() => Deferred.await(releaseStoreExplicitHydrate)),
          Effect.flatMap(() => {
            return hydrateCollectionSnapshotState(store.state(Tasks), snapshot, options);
          }),
          Effect.asVoid,
        ),
      durableSnapshotSources: () => [Tasks],
    } satisfies StoreExplicitCollectionSnapshotImplementation<Task, string>);
    markStoreExplicitCollectionSnapshotDefinition(Tasks);

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = {
          collections: [
            {
              name: Projects.name,
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              updatedAt: 1,
            },
            {
              name: Tasks.name,
              rows: [
                {
                  key: "task-1",
                  value: { id: "task-1", projectId: "atlas", title: "Plan", done: false },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              updatedAt: 1,
            },
          ],
        };

        const hydrate = runtime.runFork(hydrateCollections([Projects, Tasks], payload));
        yield* Deferred.await(storeExplicitHydrateStarted);

        const dehydrate = runtime.runFork(
          dehydrateCollections([Projects, Tasks]).pipe(Effect.exit),
        );
        const earlyDehydrate = yield* Fiber.await(dehydrate).pipe(
          Effect.timeoutOption("20 millis"),
        );
        expect(Option.isNone(earlyDehydrate)).toBe(true);

        yield* Deferred.succeed(releaseStoreExplicitHydrate, undefined).pipe(Effect.ignore);
        yield* Fiber.join(hydrate);
        const dehydrateExit = yield* Fiber.join(dehydrate);

        if (Exit.isFailure(dehydrateExit)) {
          expect.fail("Expected dehydrate to succeed after payload hydration completed.");
        }
        expect(
          dehydrateExit.value.collections.map((snapshot) => snapshot.rows.map((row) => row.key)),
        ).toEqual([["atlas"], ["task-1"]]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("preflights incomplete store-explicit payload hydration before mutating earlier collections", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-store-explicit-projects",
      getKey: (project) => project.id,
      initialData: [{ id: "existing-project", name: "Existing", status: "active", progress: 1 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-preflight-store-explicit-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false },
      ],
    });
    markStoreExplicitCollectionSnapshotDefinition(Tasks);

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = {
          collections: [
            {
              name: "Projects.snapshot-codec-preflight-store-explicit-projects",
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              updatedAt: 1,
            },
            {
              name: "Tasks.snapshot-codec-preflight-store-explicit-tasks",
              rows: [
                {
                  key: "task-1",
                  value: { id: "task-1", projectId: "atlas", title: "Plan", done: false },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              updatedAt: 1,
            },
          ],
        };
        const validationFailure = yield* Effect.flip(
          runtime.provide(validateCollectionsHydration([Projects, Tasks], payload)),
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(hydrateCollections([Projects, Tasks], payload)),
        );

        for (const failure of [validationFailure, hydrateFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            operation: "hydrate",
            path: "$",
          });
          expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
          expect((failure as CollectionSnapshotCodecError).reason).toContain(
            "snapshotWithStoreEffect",
          );
          expect((failure as CollectionSnapshotCodecError).reason).toContain(
            "hydratePreflightEffect",
          );
          expect((failure as CollectionSnapshotCodecError).reason).toContain(
            "hydrateWithStoreEffect",
          );
        }
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing-project"],
        );
        expect(runWithRuntime(runtime, () => Tasks.rows().map((task) => task.id))).toEqual([
          "existing-task",
        ]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("applies complete store-explicit hydration through the store-aware adapter", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-store-explicit-hydrate-apply",
      getKey: (project) => project.id,
      initialData: [{ id: "existing-project", name: "Existing", status: "active", progress: 1 }],
    });
    const calls: Array<{
      readonly existingKeys: readonly string[];
      readonly hydrateKeys: readonly string[];
      readonly replace: boolean | undefined;
    }> = [];
    const implementation = {
      snapshotWithStore: (_store, updatedAt) => ({
        name: Projects.name,
        rows: [],
        updatedAt,
      }),
      snapshotWithStoreEffect: (_store, updatedAt) =>
        Effect.succeed({
          name: Projects.name,
          rows: [],
          updatedAt,
        }),
      hydratePreflightEffect: () => Effect.void,
      hydrateWithStoreEffect: (store, snapshot, options) =>
        Effect.sync(() => {
          calls.push({
            existingKeys: Array.from(store.state(Projects).rows.keys()),
            hydrateKeys: snapshot.rows.map((row) => row.key),
            replace: options.replace,
          });
        }),
    } satisfies StoreExplicitCollectionSnapshotImplementation<Project, string>;
    Object.assign(Projects, implementation);
    markStoreExplicitCollectionSnapshotDefinition(Projects);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Projects.hydrate(
            {
              name: Projects.name,
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                  synced: true,
                  origin: "remote",
                },
              ],
              updatedAt: 1,
            },
            { replace: false },
          ),
        );

        expect(calls).toEqual([
          {
            existingKeys: ["existing-project"],
            hydrateKeys: ["atlas"],
            replace: false,
          },
        ]);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing-project"],
        );
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("preflights read-only live query collection hydration before mutating earlier collections", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-live-projects",
      getKey: (project) => project.id,
      initialData: [{ id: "existing-project", name: "Existing", status: "active", progress: 1 }],
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.snapshot-codec-preflight-live",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.status === "active")
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress,
          })),
    });
    const payload = {
      collections: [
        {
          name: "Projects.snapshot-codec-preflight-live-projects",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
              synced: true,
              origin: "remote" as const,
            },
          ],
          updatedAt: 1,
        },
        {
          name: "ProjectCards.snapshot-codec-preflight-live",
          rows: [],
          updatedAt: 1,
        },
      ],
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const validationFailure = yield* Effect.flip(
          runtime.provide(validateCollectionsHydration([Projects, ActiveProjectCards], payload)),
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(hydrateCollections([Projects, ActiveProjectCards], payload)),
        );

        for (const failure of [validationFailure, hydrateFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$",
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing-project"],
        );
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("reports snapshot hydrate getKey throws through the EffectInput callback error policy", () => {
    const runtime = makeRuntime();
    const thrown = new Error("hydrate key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-key-callback",
      getKey: () => {
        throw thrown;
      },
    });
    const snapshot: Collection.Snapshot<Project, string> = {
      name: "Projects.snapshot-codec-key-callback",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          synced: true,
          origin: "remote" as const,
        },
      ],
      updatedAt: 1,
    };
    const payload = { collections: [snapshot] };
    const storage = makeTestKeyValueStore(
      {},
      new Map([
        [collectionStoreKey("Projects.snapshot-codec-key-callback"), JSON.stringify(snapshot)],
      ]),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const hydrateFailure = yield* Effect.flip(runtime.provide(Projects.hydrate(snapshot)));
        const payloadFailure = yield* Effect.flip(
          runtime.provide(hydrateCollections([Projects], payload)),
        );
        const validateFailure = yield* Effect.flip(
          validateCollectionsHydration([Projects], payload),
        );
        const restoreFailure = yield* Effect.flip(
          runtime.provide(Projects.restore()).pipe(Effect.provide(storage.layer)),
        );

        for (const failure of [hydrateFailure, payloadFailure, validateFailure, restoreFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            _tag: "EffectInputCallbackError",
            operation: "Collection.hydrate(Projects.snapshot-codec-key-callback).getKey",
            cause: thrown,
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("fails malformed hydration payloads through the hydrate Effect error channel", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-payload-invalid",
      getKey: (project) => project.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            hydrateCollections([Projects], {
              collections: [
                {
                  name: "Projects.snapshot-codec-payload-invalid",
                  // @ts-expect-error runtime validation rejects malformed payload rows.
                  rows: "not-rows",
                  updatedAt: 1,
                },
              ],
            }),
          ),
        );

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$.collections[0].rows",
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects duplicate collection snapshots in hydration payloads", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-duplicate-payload",
      getKey: (project) => project.id,
      initialData: [{ id: "existing", name: "Existing", status: "active", progress: 1 }],
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = {
          name: "Projects.snapshot-codec-duplicate-payload",
          rows: [],
          updatedAt: 1,
        };
        const exit = yield* Effect.exit(
          runtime.provide(
            hydrateCollections([Projects], {
              collections: [snapshot, snapshot],
            }),
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          path: "$.collections[1].name",
        });
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
          ["existing"],
        );
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects duplicate collection definitions during hydration planning", () => {
    const runtime = makeRuntime();
    const name = "Projects.snapshot-codec-duplicate-definition";
    const Projects = Collection.define<Project>({
      name,
      getKey: (project) => project.id,
    });
    const ShadowProjects = defineCollection<{ readonly slug: string; readonly title: string }>(
      {
        name,
        getKey: (project) => project.slug,
      },
      makeCollectionDefinitionRegistry(),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            hydrateCollections([Projects, ShadowProjects], {
              collections: [
                {
                  name,
                  rows: [],
                  updatedAt: 1,
                },
              ],
            }),
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "hydrate",
          path: "$.collections",
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("fails hydration payloads when a snapshot has no matching collection definition", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.payload-missing-definition",
      getKey: (project) => project.id,
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            hydrateCollections([Projects], {
              collections: [
                {
                  name: "Projects.payload-missing-definition",
                  rows: [
                    {
                      key: "atlas",
                      value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                      synced: true,
                      origin: "remote",
                    },
                  ],
                  updatedAt: 1,
                },
                {
                  name: "Tasks.payload-missing-definition",
                  rows: [],
                  updatedAt: 1,
                },
              ],
            }),
          ),
        );

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$.collections[1].name",
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("preserves collection output schema failures while hydrating, loading, and writing rows", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.schema-validation",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
    });
    const PersistedProjects = Collection.define<Project>({
      name: "Projects.schema-validation-persisted",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
    });
    const LoadingProjects = Collection.define<Project>({
      name: "Projects.schema-validation-load",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: "bad",
            } as unknown as Project,
          ]),
      },
    });
    const RefetchProjects = Collection.define<Project>({
      name: "Projects.schema-validation-refresh",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            {
              id: "lumen",
              name: "Lumen",
              status: "blocked",
              progress: "bad",
            } as unknown as Project,
          ]),
      },
    });
    const invalidProject = {
      id: "atlas",
      name: "Atlas",
      status: "active",
      progress: "bad",
    } as unknown as Project;
    const storage = makeTestKeyValueStore(
      {},
      new Map([
        [
          collectionStoreKey("projects-schema-validation"),
          JSON.stringify({
            name: "Projects.schema-validation-persisted",
            rows: [
              {
                key: "atlas",
                value: invalidProject,
                synced: true,
                origin: "remote",
              },
            ],
            updatedAt: 1,
          }),
        ],
      ]),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const [
          hydrateFailure,
          restoreFailure,
          preloadFailure,
          refetchFailure,
          applyChangesFailure,
        ] = yield* Effect.all([
          Effect.flip(
            runtime.provide(
              Projects.hydrate({
                name: "Projects.schema-validation",
                rows: [
                  {
                    key: "atlas",
                    value: invalidProject,
                    synced: true,
                    origin: "remote",
                  },
                ],
                updatedAt: 1,
              }),
            ),
          ),
          Effect.flip(
            runtime
              .provide(PersistedProjects.restore({ key: "projects-schema-validation" }))
              .pipe(Effect.provide(storage.layer)),
          ),
          flipContractDefect(runtime.provide(LoadingProjects.preload())),
          flipContractDefect(runtime.provide(RefetchProjects.refresh())),
          flipContractDefect(
            runtime.provide(Projects.applyChanges([{ _tag: "Upsert", value: invalidProject }])),
          ),
        ]);

        yield* runtime.provide(
          Projects.applyChanges([
            {
              _tag: "Upsert",
              value: {
                id: "atlas",
                name: "Atlas",
                status: "active",
                progress: 72,
              },
            },
          ]),
        );
        const applyUpdateFailure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([
              {
                _tag: "Update",
                key: "atlas",
                changes: { progress: "bad" } as unknown as Partial<Project>,
              },
            ]),
          ),
        );

        yield* Effect.sync(() => {
          for (const failure of [
            hydrateFailure,
            restoreFailure,
            preloadFailure,
            refetchFailure,
            applyChangesFailure,
            applyUpdateFailure,
          ]) {
            expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
            const { path, reason } = failure as CollectionSnapshotCodecError;
            expect(`${path} ${reason}`).toContain("progress");
          }
          expect(
            asyncResultFacts(runWithRuntime(runtime, () => LoadingProjects.result().get())),
          ).toMatchObject({
            _tag: "Failure",
            error: undefined,
            defect: preloadFailure,
          });
          expect(
            asyncResultFacts(runWithRuntime(runtime, () => RefetchProjects.result().get())),
          ).toMatchObject({
            _tag: "Failure",
            error: undefined,
            defect: refetchFailure,
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toMatchObject([
            { id: "atlas", progress: 72 },
          ]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("accepts collection output schemas as row schemas", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.row-schema-validation",
      output: ProjectSchema,
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          ]),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preload());
        yield* runtime.provide(
          Projects.applyChanges([
            {
              _tag: "Upsert",
              value: {
                id: "kepler",
                name: "Kepler",
                status: "blocked",
                progress: 34,
              },
            },
          ]),
        );

        yield* Effect.sync(() => {
          expect(
            runWithRuntime(runtime, () => Projects.rows().map((project) => project.id)),
          ).toEqual(["atlas", "kepler"]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("rejects hostile direct-write update patches before persistence", () => {
    const getterFailure = new Error("patch getter failed");
    let writes = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () => Effect.sync(() => void (writes += 1)),
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.hostile-write-update-patch",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      persistence: {
        persistOnWrite: true,
      },
    });
    const changes = Object.defineProperty({}, "progress", {
      enumerable: true,
      get: () => {
        throw getterFailure;
      },
    }) as Partial<Project>;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* flipContractDefect(
          runtime.provide(
            Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: changes }]),
          ),
        );

        expect(failure).toBeInstanceOf(EffectInputCallbackError);
        expect((failure as EffectInputCallbackError).operation).toBe(
          "Collection.update(Projects.hostile-write-update-patch)",
        );
        expect((failure as EffectInputCallbackError).cause).toBe(getterFailure);
        expect(writes).toBe(0);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          id: "atlas",
          progress: 72,
          $synced: true,
        });
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("serializes public persist snapshots behind failing durable writes", async () => {
    const key = "projects-public-persist-serialization-cache";
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const releaseWrite = Effect.runSync(Deferred.make<void>());
    const persistFailed = keyValueStoreError("set", collectionStoreKey(key), "persist-failed");
    let writes = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () => {
        writes += 1;
        return writes === 1
          ? Effect.gen(function* () {
              yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseWrite);
              return yield* Effect.fail(persistFailed);
            })
          : Effect.void;
      },
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.public-persist-serialization",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      persistence: {
        key,
        persistOnWrite: true,
      },
    });
    let write: Fiber.Fiber<unknown, unknown> | undefined;
    let persist: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      write = runtime.runFork(
        Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 90 } }]),
      );
      await Effect.runPromise(Deferred.await(writeStarted));
      persist = runtime.runFork(Projects.persist());
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseWrite, undefined));
      const writeExit = await Effect.runPromise(
        Fiber.await(write).pipe(Effect.timeoutOption("1 second")),
      );
      const persistExit = await Effect.runPromise(
        Fiber.await(persist).pipe(Effect.timeoutOption("1 second")),
      );
      if (Option.isNone(writeExit) || Option.isNone(persistExit)) {
        expect.fail("Expected write and public persist to terminate.");
      }

      const writeFailure = Exit.isFailure(writeExit.value)
        ? writeExit.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      const snapshot = storage.snapshot<Project>(key);
      expect(writeFailure).toBe(persistFailed);
      expect(snapshot?.rows.map((row) => row.value.progress)).toEqual([72]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore));
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      if (persist !== undefined) {
        await Effect.runPromise(Fiber.await(persist).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("restores direct-write state when write persistence is interrupted", async () => {
    const key = "projects-direct-write-interrupt-cache";
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const storage = makeTestKeyValueStore({
      beforeSet: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
          return yield* Effect.never;
        }),
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.direct-write-interrupt-rollback",
      getKey: (project) => project.id,
      persistence: {
        key,
        persistOnWrite: true,
      },
    });
    let write: Fiber.Fiber<void, unknown> | undefined;

    try {
      write = runtime.runFork(
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72,
            },
          },
        ]),
      );
      await Effect.runPromise(Deferred.await(writeStarted));

      await Effect.runPromise(Fiber.interrupt(write));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toBeUndefined();
      expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
    } finally {
      if (write !== undefined) {
        await Effect.runPromise(
          Fiber.await(write).pipe(Effect.timeoutOption("100 millis"), Effect.ignore),
        );
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("serializes public hydrate behind failing durable writes", async () => {
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const releaseWrite = Effect.runSync(Deferred.make<void>());
    const persistFailed = keyValueStoreError("set", "projects", "persist-failed");
    let writes = 0;
    const storage = makeTestKeyValueStore({
      beforeSet: () => {
        writes += 1;
        return Effect.gen(function* () {
          yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releaseWrite);
          return yield* Effect.fail(persistFailed);
        });
      },
    });
    const runtime = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.public-hydrate-serialization",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      persistence: {
        persistOnWrite: true,
      },
    });
    const hydratedSnapshot: Collection.Snapshot<Project, string> = {
      name: "Projects.public-hydrate-serialization",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Hydrated", status: "active", progress: 11 },
          synced: true,
          origin: "remote",
        },
      ],
      updatedAt: 123,
    };
    let write: Fiber.Fiber<unknown, unknown> | undefined;
    let hydrate: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      write = runtime.runFork(
        Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 90 } }]),
      );
      await Effect.runPromise(Deferred.await(writeStarted));
      hydrate = runtime.runFork(Projects.hydrate(hydratedSnapshot));
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseWrite, undefined));
      const writeExit = await Effect.runPromise(
        Fiber.await(write).pipe(Effect.timeoutOption("1 second")),
      );
      const hydrateExit = await Effect.runPromise(
        Fiber.await(hydrate).pipe(Effect.timeoutOption("1 second")),
      );
      if (Option.isNone(writeExit) || Option.isNone(hydrateExit)) {
        expect.fail("Expected write and public hydrate to terminate.");
      }

      const writeFailure = Exit.isFailure(writeExit.value)
        ? writeExit.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      expect(writeFailure).toBe(persistFailed);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Hydrated",
        progress: 11,
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore));
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      if (hydrate !== undefined) {
        await Effect.runPromise(Fiber.await(hydrate).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("surfaces KeyValueStore failures through the persistence error channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.key-value-store-error",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const blocked = {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("quota exceeded");
          },
        } as unknown as Storage;
        const failing = KeyValueStore.layerStorage(() => blocked);

        const setFailure = yield* Effect.flip(
          Projects.persist({ key: "projects-cache" }).pipe(Effect.provide(failing)),
        );
        const getFailure = yield* Effect.flip(
          Projects.restore({ key: "projects-cache" }).pipe(Effect.provide(failing)),
        );

        yield* Effect.sync(() => {
          expect(setFailure).toBeInstanceOf(KeyValueStore.KeyValueStoreError);
          expect(setFailure).toMatchObject({ key: collectionStoreKey("projects-cache") });
          expect(getFailure).toBeInstanceOf(KeyValueStore.KeyValueStoreError);
          expect(getFailure).toMatchObject({ key: collectionStoreKey("projects-cache") });
        });
      }),
    ));

  it("dehydrates and hydrates multiple collections as a payload", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.payload",
      getKey: (project) => project.id,
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.payload",
      getKey: (task) => task.id,
    });

    try {
      await runInRuntime(
        first,
        Projects.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72,
            },
          },
        ]),
      );
      await runInRuntime(
        first,
        Tasks.applyChanges([
          {
            _tag: "Upsert",
            value: {
              id: "t1",
              projectId: "atlas",
              title: "Retry workflow",
              done: false,
            },
          },
        ]),
      );

      const payload = await runInRuntime(first, dehydrateCollections([Projects, Tasks]));

      await runInRuntime(second, hydrateCollections([Projects, Tasks], payload));

      expect(runWithRuntime(second, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
      ]);
      expect(runWithRuntime(second, () => Tasks.rows().map((task) => task.title))).toEqual([
        "Retry workflow",
      ]);
    } finally {
      await Effect.runPromise(first.dispose);
      await Effect.runPromise(second.dispose);
    }
  });

  it("preserves unsynced direct-write rows across refreshes that omit them", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.direct-write-refresh-local-unsynced",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
      sync: {
        refresh: () =>
          Effect.succeed([{ id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }]),
      },
    });

    try {
      await Effect.runPromise(
        runtime.provide(
          Projects.applyChanges(
            [
              {
                _tag: "Upsert",
                value: {
                  id: "local-draft",
                  name: "Local Draft",
                  status: "blocked",
                  progress: 12,
                },
              },
            ],
            { origin: "local", synced: false },
          ),
        ),
      );

      await Effect.runPromise(runtime.provide(Projects.refresh()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
        $origin: "remote",
      });
      expect(runWithRuntime(runtime, () => Projects.get("local-draft"))).toMatchObject({
        name: "Local Draft",
        progress: 12,
        $synced: false,
        $origin: "local",
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });
});

describe("Query", () => {
  const expectUnsupportedLiveQueryPlan = (
    factory: Query.Factory<any, any, any>,
    reason: string,
  ): void => {
    expect(() => buildQuery(factory).execute()).toThrow(QueryEvaluationError);
    try {
      buildQuery(factory).execute();
      expect.fail("Expected query build execution to reject the unsupported live query plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason,
        },
      });
    }

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject the unsupported live query plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason,
        },
      });
    }
  };

  it("normalizes build, live, and diagnostics factory throws to QueryEvaluationError", () => {
    const thrown = new Error("query factory failed");
    const factory: Query.Factory<string> = () => {
      throw thrown;
    };

    for (const evaluate of [
      () => buildQuery(factory).execute(),
      () => Query.live(factory),
      () => Query.diagnostics(factory),
    ]) {
      expect(evaluate).toThrow(QueryEvaluationError);
      try {
        evaluate();
      } catch (error) {
        expect(error).toMatchObject({
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: thrown,
        });
      }
    }
  });

  it("rejects invalid query factory results at the factory boundary", async () => {
    const promised = Effect.runPromise(
      Effect.succeed(
        Query.from({
          project: Collection.define<Project>({
            name: "Projects.promise-query-factory",
            getKey: (project) => project.id,
            initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
          }),
        }),
      ),
    );
    const throwingThenFactoryResult = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      },
    });
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly reason: "promise" | "effect" | "builder";
      readonly factory: Query.Factory<string>;
    }> = [
      {
        label: "promise",
        reason: "promise",
        factory: (() => promised) as never,
      },
      {
        label: "throwing then",
        reason: "promise",
        factory: (() => throwingThenFactoryResult) as never,
      },
      {
        label: "effect",
        reason: "effect",
        factory: (() => Effect.succeed(Query.from({}))) as never,
      },
      {
        label: "non-builder",
        reason: "builder",
        factory: (() => ({ execute: () => [] })) as never,
      },
    ];

    for (const testCase of cases) {
      for (const evaluate of [
        () => buildQuery(testCase.factory).execute(),
        () => Query.live(testCase.factory),
        () => Query.diagnostics(testCase.factory),
      ]) {
        expect(evaluate, testCase.label).toThrow(QueryEvaluationError);
        try {
          evaluate();
          expect.fail(`Expected ${testCase.label} query factory result to reject.`);
        } catch (error) {
          expect(error).toMatchObject({
            _tag: "QueryEvaluationError",
            operation: "evaluate",
            cause: {
              _tag: "QueryFactoryResultRejected",
              reason: testCase.reason,
            },
          });
        }
      }

      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "QueryFactoryResultRejected",
            reason: testCase.reason,
          },
        });
      }
    }
  });

  it("keeps a live single-collection query updated through the IVM adapter", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-filter",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.status === "active" && project.progress > 50)
        .select(({ project }) => project.name)
        .orderBy(({ project }) => project.name),
    );

    expect(live.evaluate()).toEqual(["Atlas"]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Update",
          key: "lumen",
          changes: {
            status: "active",
            progress: 56,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual(["Atlas", "Lumen"]);

    await Effect.runPromise(Projects.applyChanges([{ _tag: "Delete", key: "atlas" }]));

    expect(live.evaluate()).toEqual(["Lumen"]);
  });

  it("keeps numeric and string collection keys distinct in live queries", async () => {
    interface NumericKeyProject {
      readonly id: string | number;
      readonly name: string;
      readonly status: "active" | "blocked";
      readonly progress: number;
    }
    const Projects = Collection.define<NumericKeyProject, string | number>({
      name: "Projects.live-key-kind",
      getKey: (project) => project.id,
      initialData: [
        { id: 1, name: "Numeric", status: "active", progress: 10 },
        { id: "1", name: "String", status: "active", progress: 20 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name),
    );

    expect(live.evaluate()).toEqual(["Numeric", "String"]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: 1, changes: { name: "Numeric Updated" } }]),
    );

    expect(live.evaluate()).toEqual(["Numeric Updated", "String"]);
  });

  it("keeps one-shot and live ordering parity for equal sort keys", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.query-order-parity",
      getKey: (project) => project.id,
      initialData: [
        { id: "zeta", name: "Zeta", status: "active", progress: 10 },
        { id: "alpha", name: "Alpha", status: "active", progress: 10 },
      ],
    });
    const factory: Query.Factory<string, never> = (query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name);

    expect(buildQuery(factory).execute()).toEqual(["Alpha", "Zeta"]);
    expect(Query.live(factory).evaluate()).toEqual(["Alpha", "Zeta"]);
  });

  it("deduplicates live query source ownership for self joins", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-self-join-sources",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join(
          "right",
          Projects,
          ({ left }) => left.id,
          (right) => right.id,
        )
        .select(({ left, right }) => `${left.name}:${right.name}`),
    );

    expect(live.sources).toEqual([Projects]);
    expect(live.evaluate()).toEqual(["Atlas:Atlas"]);
  });

  it("refreshes self-join source collections once", async () => {
    const refetch = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.live-self-join-refresh-source",
      getKey: (project) => project.id,
      sync: {
        refresh: refetch,
      },
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join(
          "right",
          Projects,
          ({ left }) => left.id,
          (right) => right.id,
        )
        .select(({ left, right }) => `${left.name}:${right.name}`),
    );

    await Effect.runPromise(live.refresh());

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(live.sources).toEqual([Projects]);
    expect(live.evaluate()).toEqual(["Atlas:Atlas"]);
  });

  it("rejects zero-source live queries consistently", async () => {
    const malformed = new QueryBuilder<Record<string, never>, string>(
      [],
      [],
      () => "empty",
      [],
      0,
      undefined,
      [],
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(factory, "Live queries require at least one source collection.");

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Live queries require at least one source collection.",
        },
      });
    }

    const live = Query.live(factory);
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Live queries require at least one source collection.",
        },
      },
    });
  });

  it("normalizes query factory throws as query evaluation errors", async () => {
    const thrown = new Error("factory failed");

    const onceExit = await Effect.runPromiseExit(
      Query.once(() => {
        throw thrown;
      }),
    );

    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: thrown,
      });
    }
  });

  it("rejects non-finite and fractional query windows consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-query-window",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const cases = [
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(Number.NaN),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) =>
          query.from({ project: Projects }).offset(Number.POSITIVE_INFINITY),
        reason: "Query offset must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(1.5),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(-1),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).offset(-0.5),
        reason: "Query offset must be a finite non-negative safe integer.",
      },
    ];

    for (const { factory, reason } of cases) {
      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        });
      }

      const live = Query.live(factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        },
      });
    }
  });

  it("rejects reserved query source aliases consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.reserved-query-alias",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const aliases = ["__proto__", "constructor", "prototype"] as const;

    for (const alias of aliases) {
      const reason = `Query source alias "${alias}" is reserved. Use a domain alias that can be represented as an own object property.`;
      const factory = (query: Query.Root) =>
        query
          .from({ [alias]: Projects } as Record<string, typeof Projects>)
          .select(() => "unreachable");

      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        });
      }

      const live = Query.live(factory);
      expect(live.rows.get()).toEqual([]);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        previous: undefined,
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        },
      });
    }
  });

  it("rejects duplicate query aliases consistently", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.duplicate-query-alias",
      getKey: (project) => project.id,
      sync: {
        load: projectLoad,
      },
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.duplicate-query-alias",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join(
          "project",
          Tasks,
          ({ project }) => project.id,
          (task) => task.projectId,
        )
        .select(({ project }) => project.name);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Query source alias "project" is registered more than once.',
    );

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();

    const live = Query.live(factory);
    const livePreloadExit = await Effect.runPromiseExit(live.preload());
    expect(Exit.isFailure(livePreloadExit)).toBe(true);
    if (Exit.isFailure(livePreloadExit)) {
      const error = livePreloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();
    expect(live.rows.get()).toEqual([]);
    const state = live.state.get();
    expect(asyncResultFacts(state)).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      },
    });
  });

  it("normalizes invalid join key encoding as join evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-join-key",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.invalid-join-key",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join(
          "task",
          Tasks,
          () => invalidDate,
          (task) => task.projectId,
        )
        .select(({ project }) => project.name);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid join keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const live = Query.live(factory);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "join",
      },
    });
  });

  it("normalizes invalid group key encoding as aggregate evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-group-key",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .groupBy(() => ({ createdAt: invalidDate }), { count: Query.count() })
        .select((group) => group.count);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid group keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const live = Query.live(factory);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "aggregate",
      },
    });
  });

  it("normalizes invalid order values as order evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-order-value",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const cases = [
      { label: "invalid-date", value: invalidDate },
      { label: "nan", value: Number.NaN },
    ] as const;

    for (const testCase of cases) {
      const factory = (query: Query.Root) =>
        query
          .from({ project: Projects })
          .orderBy(() => testCase.value)
          .select(({ project }) => project.name);

      expect(() => Query.diagnostics(factory), testCase.label).toThrow(QueryEvaluationError);
      try {
        Query.diagnostics(factory);
        expect.fail(`Expected query diagnostics to reject ${testCase.label} order values.`);
      } catch (error) {
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({ operation: "order" });
      }

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({ operation: "order" });
      }

      const live = Query.live(factory);
      expect(live.rows.get()).toEqual([]);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "order",
        },
      });
    }
  });

  it("rejects Promise-shaped query callbacks as typed evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.promise-query-callbacks",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.promise-query-callbacks",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const promised = <A>(value: A): A => Effect.runPromise(Effect.succeed(value)) as never;
    const throwingThen = (): unknown =>
      Object.defineProperty({}, "then", {
        get: () => {
          throw new Error("then getter failed");
        },
      });
    const cases: ReadonlyArray<{
      readonly operation: "filter" | "join" | "order" | "projection" | "aggregate";
      readonly factory: Query.Factory<unknown, never>;
    }> = [
      {
        operation: "filter",
        factory: (query) =>
          query
            .from({ project: Projects })
            .where((() => promised(true)) as never)
            .select(({ project }) => project.name),
      },
      {
        operation: "projection",
        factory: (query) =>
          query.from({ project: Projects }).select((() => promised("Atlas")) as never),
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: promised("Atlas") } })) as never),
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: throwingThen() } })) as never),
      },
      {
        operation: "join",
        factory: (query) =>
          query
            .from({ project: Projects })
            .join("task", Tasks, (() => promised("atlas")) as never, (task) => task.projectId)
            .select(({ project }) => project.name),
      },
      {
        operation: "order",
        factory: (query) =>
          query
            .from({ project: Projects })
            .orderBy((() => promised(1)) as never)
            .select(({ project }) => project.name),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(({ project }) => ({ status: project.status }), {
              count: Query.count((() => promised("present")) as never),
            })
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                asyncKey: promised("active"),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                asyncKey: throwingThen(),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" },
        });
      }

      const live = Query.live(testCase.factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" },
        },
      });
    }
  });

  it("rejects Effect-shaped query callback values as typed evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.effect-query-callbacks",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const cases: ReadonlyArray<{
      readonly operation: "projection" | "aggregate";
      readonly factory: Query.Factory<unknown, never>;
    }> = [
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: Effect.succeed("Atlas") } })) as never),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                effectKey: Effect.succeed("active"),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(({ project }) => ({ status: project.status }), {
              count: Query.count((() => Effect.succeed("present")) as never),
            })
            .select((group) => group.count),
      },
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" },
        });
      }

      const live = Query.live(testCase.factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" },
        },
      });
    }
  });

  it("rejects query joins without registered source aliases consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.missing-query-join-source",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.missing-query-join-source",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const malformed = new QueryBuilder<{ readonly project: Project }, string>(
      [["project", Projects]],
      [],
      ({ project }) => project.name,
      [],
      0,
      undefined,
      [
        {
          alias: "task",
          collection: Tasks,
          leftKey: ({ project }) => project.id,
          rightKeys: () => ["atlas"],
        },
      ],
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(factory, 'Join source "task" is not registered.');

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.',
        },
      });
    }

    const live = Query.live(factory);
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.',
        },
      },
    });
  });

  it("maintains live joins across collections", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.live-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects, task: Tasks })
        .where(({ project, task }) => project.id === task.projectId)
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([
        {
          _tag: "Upsert",
          value: {
            id: "t3",
            projectId: "atlas",
            title: "Webhook replay",
            done: false,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Atlas:Webhook replay",
      "Lumen:Queue ownership",
    ]);
  });

  it("maintains explicit keyed joins through the IVM join operator", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.explicit-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.explicit-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .join(
          "task",
          Tasks,
          ({ project }) => project.id,
          (task) => task.projectId,
        )
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { projectId: "atlas" } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);

    await Effect.runPromise(Projects.applyChanges([{ _tag: "Delete", key: "lumen" }]));

    expect(live.evaluate()).toEqual(["Atlas:Orphan", "Atlas:Retry workflow"]);
  });

  it("uses declared collection indexes for indexed joins", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId,
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { projectId: "atlas" } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);
  });

  it("evaluates indexed join selectors against public row values", async () => {
    const seenTaskKeys: Array<ReadonlyArray<string>> = [];
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join-public-values",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join-public-values",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => {
          seenTaskKeys.push(Object.keys(task));
          return task.projectId;
        },
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
      ],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`);

    expect(Query.diagnostics(factory)).toMatchObject({
      joins: [
        {
          alias: "task",
          strategy: "collection-index",
          index: "byProject",
          outputRows: 2,
        },
      ],
    });
    await expect(Effect.runPromise(Query.once(factory))).resolves.toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);

    const live = Query.live(factory);
    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);
    expect(seenTaskKeys.length).toBeGreaterThan(0);
    expect(seenTaskKeys.every((keys) => keys.every((key) => !key.startsWith("$")))).toBe(true);
  });

  it("normalizes indexed join index selector throws as join evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join-selector-error",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join-selector-error",
      getKey: (task) => task.id,
      indexes: {
        byProject: () => {
          throw "index failed";
        },
      },
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      const indexError = error instanceof QueryEvaluationError ? error.cause : undefined;
      expect(indexError).toBeInstanceOf(EffectInputCallbackError);
      expect(error).toMatchObject({
        operation: "join",
      });
      expect(indexError).toMatchObject({
        cause: "index failed",
      });
    }
  });

  it("reports live-query source fingerprint failures as source evaluation errors", () => {
    interface ProjectWithCallback {
      readonly id: string;
      readonly name: string;
      readonly callback: () => void;
    }

    const Projects = Collection.define<ProjectWithCallback>({
      name: "Projects.live-source-fingerprint-error",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", callback: () => undefined }],
    });
    const live = Query.live((query) =>
      query.from({ project: Projects }).select(({ project }) => project.name),
    );

    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "source",
        cause: {
          _tag: "StableStringifyUnsupportedValue",
          path: "$.callback",
        },
      },
    });
  });

  it("rejects indexed joins that name an undeclared collection index before live preload loads sources", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const taskLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Task>>([
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
      ]),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.missing-indexed-join",
      getKey: (project) => project.id,
      sync: {
        load: projectLoad,
      },
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.missing-indexed-join",
      getKey: (task) => task.id,
      sync: {
        load: taskLoad,
      },
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "missing")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".',
    );

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason:
            'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".',
        },
      });
    }

    const live = Query.live(factory);
    const preloadExit = await Effect.runPromiseExit(live.preload());
    expect(Exit.isFailure(preloadExit)).toBe(true);
    if (Exit.isFailure(preloadExit)) {
      const error = preloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason:
            'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();
    expect(taskLoad).not.toHaveBeenCalled();
  });

  it("keeps live-query output identities distinct when keys contain old delimiters", () => {
    interface IdentityRow {
      readonly id: string;
      readonly label: string;
    }

    const Left = Collection.define<IdentityRow>({
      name: "Live.identity-left",
      getKey: (row) => row.id,
      initialData: [
        { id: "a", label: "left-a" },
        { id: "a|right:string:b", label: "left-delimited" },
      ],
    });
    const Right = Collection.define<IdentityRow>({
      name: "Live.identity-right",
      getKey: (row) => row.id,
      initialData: [
        { id: "b|right:string:c", label: "right-delimited" },
        { id: "c", label: "right-c" },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ left: Left, right: Right })
        .select(({ left, right }) => `${left.label}:${right.label}`)
        .orderBy(({ left, right }) => `${left.label}:${right.label}`),
    );

    expect(live.evaluate()).toEqual([
      "left-a:right-c",
      "left-a:right-delimited",
      "left-delimited:right-c",
      "left-delimited:right-delimited",
    ]);
  });

  it("describes query plans with indexed join cost diagnostics", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.query-diagnostics",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.query-diagnostics",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId,
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });

    const plan = Query.diagnostics((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .where(({ project }) => project.status === "active")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
        .limit(1),
    );

    expect(plan).toEqual({
      sources: [
        { alias: "project", collection: "Projects.query-diagnostics", rows: 2 },
        { alias: "task", collection: "Tasks.query-diagnostics", rows: 3 },
      ],
      joins: [
        {
          alias: "task",
          collection: "Tasks.query-diagnostics",
          strategy: "collection-index",
          index: "byProject",
          leftRows: 2,
          rightRows: 3,
          outputRows: 2,
          estimatedComparisons: 2,
        },
      ],
      filters: 1,
      orders: 1,
      grouped: false,
      offset: 0,
      limit: 1,
      contextRows: 2,
    });
  });

  it("joins through multi-value collection indexes", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.multi-indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = Collection.define<TaggedTask>({
      name: "Tasks.multi-indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byTag: (task) => task.tags,
      },
      initialData: [
        {
          id: "t1",
          projectId: "atlas",
          title: "Retry workflow",
          done: false,
          tags: ["active", "urgent"],
        },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false, tags: ["blocked"] },
        { id: "t3", projectId: "missing", title: "Orphan", done: false, tags: ["missing"] },
      ],
    });

    await expect(
      Effect.runPromise(
        Query.once((query) =>
          query
            .from({ project: Projects })
            .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
            .select(({ project, task }) => `${project.name}:${task.title}`)
            .orderBy(({ project, task }) => `${project.name}:${task.title}`),
        ),
      ),
    ).resolves.toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { tags: ["active", "blocked"] } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Orphan",
      "Lumen:Queue ownership",
    ]);
  });

  it("maintains ordered live query windows inside the IVM graph", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-window",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 51 },
        { id: "lumen", name: "Lumen", status: "active", progress: 34 },
        { id: "meridian", name: "Meridian", status: "active", progress: 84 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .select(({ project }) => ({
          id: project.id,
          progress: project.progress,
        }))
        .orderBy(({ project }) => project.progress, "desc")
        .limit(2),
    );

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { progress: 95 } }]),
    );

    expect(live.evaluate()).toEqual([
      { id: "lumen", progress: 95 },
      { id: "meridian", progress: 84 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { progress: 40 } }]),
    );

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 },
    ]);
  });

  it("maintains grouped aggregate live queries inside the IVM graph", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-groupBy",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(({ project }) => ({ status: project.status }), {
          count: Query.count(),
          totalProgress: Query.sum(({ project }) => project.progress),
          avgProgress: Query.avg(({ project }) => project.progress),
        })
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress,
          avgProgress: group.avgProgress,
        }))
        .orderBy((group) => group.status),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 2, totalProgress: 124, avgProgress: 62 },
      { status: "blocked", count: 1, totalProgress: 34, avgProgress: 34 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Update",
          key: "lumen",
          changes: {
            status: "active",
            progress: 40,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Upsert",
          value: {
            id: "meridian",
            name: "Meridian",
            status: "blocked",
            progress: 80,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 },
      { status: "blocked", count: 1, totalProgress: 80, avgProgress: 80 },
    ]);
  });

  it("applies grouped aggregate filters before and after grouping", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-groupBy-filter",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 50)
        .groupBy(({ project }) => ({ status: project.status }), { count: Query.count() })
        .where((group) => group.count > 1)
        .select((group) => group.status),
    );

    expect(live.evaluate()).toEqual(["active"]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "kepler", changes: { progress: 30 } }]),
    );

    expect(live.evaluate()).toEqual([]);
  });

  it("maintains grouped aggregate ordered windows inside the IVM graph", async () => {
    const Projects = Collection.define<RankedProject>({
      name: "Projects.live-groupBy-window",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
        { id: "meridian", name: "Meridian", status: "queued", progress: 80 },
        { id: "orion", name: "Orion", status: "queued", progress: 12 },
        { id: "vega", name: "Vega", status: "queued", progress: 24 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(({ project }) => ({ status: project.status }), { count: Query.count() })
        .select((group) => ({
          status: group.status,
          count: group.count,
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2),
    );

    expect(live.evaluate()).toEqual([
      { status: "queued", count: 3 },
      { status: "active", count: 2 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { status: "active" } }]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3 },
      { status: "queued", count: 3 },
    ]);
  });

  it("shares grouped query execution plan stages across snapshot, once, and live queries", async () => {
    const Projects = Collection.define<RankedProject>({
      name: "Projects.query-execution-plan-parity",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
        { id: "orion", name: "Orion", status: "blocked", progress: 24 },
        { id: "meridian", name: "Meridian", status: "queued", progress: 80 },
      ],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 20)
        .groupBy(({ project }) => ({ status: project.status }), {
          count: Query.count(),
          totalProgress: Query.sum(({ project }) => project.progress),
        })
        .where((group) => group.count >= 2)
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress,
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2);
    const expected = [
      { status: "active", count: 2, totalProgress: 124 },
      { status: "blocked", count: 2, totalProgress: 58 },
    ];

    expect(buildQuery(factory).execute()).toEqual(expected);
    await expect(Effect.runPromise(Query.once(factory))).resolves.toEqual(expected);
    expect(Query.live(factory).evaluate()).toEqual(expected);
  });
});
