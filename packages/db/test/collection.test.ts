import { EffectInputCallbackError, makeResourceStore, makeRuntime, read, ResourceStore, runWithRuntime, toEffect, type EffectUiRuntime } from "@effect-ui/core";
import { Collection, CollectionRowKeyChanged, CollectionRowNotFound, CollectionStorageError, Query, QueryEvaluationError, UnknownCollectionIndex, and, eq, gt } from "@effect-ui/db";
import { Cause, Deferred, Effect, Exit, Fiber, Option, PubSub, Schedule, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  markStoreExplicitCollectionSnapshotDefinition,
  type StoreExplicitCollectionSnapshotImplementation
} from "../src/collection-definition-snapshot.js";
import {
  collectionStoreEffect,
  runWithCollectionStore
} from "../src/collection-runtime.js";
import { advanceCollectionTransactionIdentity } from "../src/collection-mutation-queue.js";
import { CollectionSnapshotCodecError, hydrateCollectionSnapshotStateEffect } from "../src/collection-snapshot-codec.js";
import { QueryBuilder } from "../src/query-builder.js";

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

const OwnedProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  meta: Schema.Struct({
    labels: Schema.Array(Schema.String)
  })
});

const runInRuntime = <A, E, R, RuntimeError>(
  runtime: EffectUiRuntime<unknown, RuntimeError>,
  effect: Effect.Effect<A, E, R>
): Promise<A> =>
  Effect.runPromise(runtime.provide(effect));

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "blocked"]),
  progress: Schema.Number
});

const ProjectRowsSchema = Schema.Array(ProjectSchema);

describe("Collection", () => {
  it("loads rows into a runtime-scoped collection", async () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const Projects = Collection.define<Project>({
      name: "Projects.runtime-load",
      getKey: (project) => project.id,
      load
    });

    await Effect.runPromise(Projects.preloadEffect());

    expect(Projects.rows()).toMatchObject([
      {
        id: "atlas",
        name: "Atlas",
        $key: "atlas",
        $collection: "Projects.runtime-load",
        $synced: true,
        $origin: "remote"
      }
    ]);
    expect(read(Projects.state())._tag).toBe("Ready");
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
          { id: "atlas", name: "Atlas", status: "active", progress: 72 }
        ] satisfies ReadonlyArray<Project>;
      })
    );
    const Projects = Collection.define<Project>({
      name: "Projects.concurrent-preload-shared",
      getKey: (project) => project.id,
      load
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(started));
      second = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(load).toHaveBeenCalledTimes(1);

      Effect.runSync(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(first));
      await Effect.runPromise(Fiber.join(second));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (first !== undefined) {
        await Effect.runPromise(Fiber.await(first));
      }
      if (second !== undefined) {
        await Effect.runPromise(Fiber.await(second));
      }
      await Effect.runPromise(runtime.disposeEffect);
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
            Effect.onInterrupt(() =>
              Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)
            )
          );
        }
        return [
          { id: "atlas", name: "Atlas Retry", status: "active", progress: 88 }
        ] satisfies ReadonlyArray<Project>;
      });
    });
    const Projects = Collection.define<Project>({
      name: "Projects.interrupted-preload-retry",
      getKey: (project) => project.id,
      load
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(started));
      await Effect.runPromise(Fiber.interrupt(preload));
      await Effect.runPromise(Deferred.await(interrupted));
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Initial",
        waiting: false
      });

      const retry = await Effect.runPromise(
        runtime.provide(Projects.preloadEffect().pipe(Effect.timeoutOption("1 second")))
      );

      if (Option.isNone(retry)) {
        expect.fail("Expected later preload to retry after interrupted load owner.");
      }
      expect(load).toHaveBeenCalledTimes(2);
      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Ready"
      });
    } finally {
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not let a slow preload overwrite a newer forced refetch", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.preload-refetch-generation",
      getKey: (project) => project.id,
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releasePreload);
          return [
            { id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }
          ];
        }),
      refetch: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }
        ])
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(preloadStarted));

      await Effect.runPromise(runtime.provide(Projects.refetchEffect()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true
      });

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      await Effect.runPromise(Fiber.join(preload));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.succeed(releasePreload, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not fail superseded preload callers after a newer forced refetch is ready", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void, string>());
    const staleFailure = "stale preload failed" as const;
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.preload-refetch-stale-failure",
      getKey: (project) => project.id,
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releasePreload);
          return [
            { id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }
          ];
        }),
      refetch: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }
        ])
    });
    let owner: Fiber.Fiber<unknown, unknown> | undefined;
    let joiner: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      owner = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(preloadStarted));
      joiner = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      await Effect.runPromise(runtime.provide(Projects.refetchEffect()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true
      });

      Effect.runSync(Deferred.fail(releasePreload, staleFailure));
      await Effect.runPromise(Fiber.join(owner));
      await Effect.runPromise(Fiber.join(joiner));

      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Ready",
        waiting: false
      });
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.fail(releasePreload, "cleanup").pipe(Effect.ignore));
      if (owner !== undefined) {
        await Effect.runPromise(Fiber.await(owner));
      }
      if (joiner !== undefined) {
        await Effect.runPromise(Fiber.await(joiner));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("waits for a newer pending forced refetch before completing a superseded preload", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const releaseRefetch = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.preload-refetch-pending-completion",
      getKey: (project) => project.id,
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releasePreload);
          return [
            { id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }
          ];
        }),
      refetch: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releaseRefetch);
          return [
            { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }
          ];
        })
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(preloadStarted));
      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Deferred.await(refetchStarted));

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      const staleCompletion = await Effect.runPromise(
        Fiber.await(preload).pipe(Effect.timeoutOption("20 millis"))
      );
      expect(Option.isNone(staleCompletion)).toBe(true);

      Effect.runSync(Deferred.succeed(releaseRefetch, undefined));
      await Effect.runPromise(Fiber.join(preload));
      await Effect.runPromise(Fiber.join(refetch));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90,
        $synced: true
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
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("fails a superseded successful preload when the newer forced refetch fails", async () => {
    const runtime = makeRuntime();
    const preloadStarted = Effect.runSync(Deferred.make<void>());
    const releasePreload = Effect.runSync(Deferred.make<void>());
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const releaseRefetch = Effect.runSync(Deferred.make<void, string>());
    const refetchFailure = "fresh refetch failed" as const;
    const Projects = Collection.define<Project, string, typeof refetchFailure>({
      name: "Projects.preload-refetch-failure-completion",
      getKey: (project) => project.id,
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(preloadStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releasePreload);
          return [
            { id: "atlas", name: "Atlas Slow", status: "active", progress: 10 }
          ];
        }),
      refetch: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releaseRefetch);
          return [
            { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }
          ];
        })
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(preloadStarted));
      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Deferred.await(refetchStarted));

      Effect.runSync(Deferred.succeed(releasePreload, undefined));
      const staleCompletion = await Effect.runPromise(
        Fiber.await(preload).pipe(Effect.timeoutOption("20 millis"))
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
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Failure",
        error: refetchFailure
      });
    } finally {
      Effect.runSync(Deferred.succeed(releasePreload, undefined).pipe(Effect.ignore));
      Effect.runSync(Deferred.fail(releaseRefetch, "cleanup").pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps prior rows and load state committed when interrupted during load persistence", async () => {
    const runtime = makeRuntime();
    const key = "projects-load-persist-interrupt-cache";
    const persisted = new Map<string, string>();
    const persistStarted = Effect.runSync(Deferred.make<void>());
    const releasePersist = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    let refetches = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: (storageKey) => persisted.get(storageKey) ?? null,
      setItem: (storageKey, value) =>
        Effect.gen(function* () {
          writes++;
          if (writes === 1) {
            yield* Deferred.succeed(persistStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releasePersist);
          }
          persisted.set(storageKey, value);
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.load-persist-interrupt",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Initial", status: "active", progress: 1 }
      ],
      refetch: () =>
        Effect.sync(() => {
          refetches++;
          return [
            { id: "atlas", name: `Refetched ${refetches}`, status: "blocked", progress: 80 + refetches }
          ] satisfies ReadonlyArray<Project>;
        }),
      persistence: {
        storage,
        key,
        persistOnLoad: true
      }
    });
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Deferred.await(persistStarted));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Initial"]);
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Pending",
        waiting: true
      });

      await Effect.runPromise(Fiber.interrupt(refetch));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Initial"]);
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Ready",
        waiting: false
      });

      const retry = await Effect.runPromise(
        runtime.provide(Projects.refetchEffect().pipe(Effect.timeoutOption("1 second")))
      );

      if (Option.isNone(retry)) {
        expect.fail("Expected later refetch to retry after interrupted load persistence.");
      }

      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(refetches).toBe(2);
      expect(writes).toBe(2);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Refetched 2",
        progress: 82
      });
      expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Refetched 2"]);
    } finally {
      Effect.runSync(Deferred.succeed(releasePersist, undefined).pipe(Effect.ignore));
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("restores ready load state when interrupted during a forced refetch load", async () => {
    const runtime = makeRuntime();
    const refetchStarted = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.refetch-load-interrupt-restore",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Initial", status: "active", progress: 1 }
      ],
      refetch: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(refetchStarted, undefined).pipe(Effect.ignore);
          yield* Effect.never.pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)
            )
          );
          return [] satisfies ReadonlyArray<Project>;
        })
    });
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Ready",
        waiting: false
      });

      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Deferred.await(refetchStarted));
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Pending",
        waiting: true
      });

      await Effect.runPromise(Fiber.interrupt(refetch));
      await Effect.runPromise(Deferred.await(interrupted));

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Initial"]);
      expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
        _tag: "Ready",
        waiting: false
      });
    } finally {
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("serializes stale preload persistence behind a newer forced refetch", async () => {
    const runtime = makeRuntime();
    const key = "projects-preload-refetch-durable-generation-cache";
    const persisted = new Map<string, string>();
    const stalePersistStarted = Effect.runSync(Deferred.make<void>());
    const releaseStalePersist = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: (storageKey) => persisted.get(storageKey) ?? null,
      setItem: (storageKey, value) =>
        Effect.gen(function* () {
          writes++;
          if (writes === 1) {
            yield* Deferred.succeed(stalePersistStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseStalePersist);
          }
          persisted.set(storageKey, value);
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.preload-refetch-durable-generation",
      getKey: (project) => project.id,
      load: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Stale", status: "active", progress: 10 }
        ]),
      refetch: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Fresh", status: "active", progress: 90 }
        ]),
      persistence: {
        storage,
        key,
        persistOnLoad: true
      }
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(stalePersistStarted));

      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Effect.sleep("20 millis"));

      Effect.runSync(Deferred.succeed(releaseStalePersist, undefined));
      await Effect.runPromise(Fiber.join(refetch));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(writes).toBe(2);
      expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Atlas Fresh"]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Fresh",
        progress: 90
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseStalePersist, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("reports CollectionLoaded count from stored rows after optimistic rebases", async () => {
    const runtime = makeRuntime();
    const insertStarted = Effect.runSync(Deferred.make<void>());
    const releaseInsert = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.loaded-count-optimistic-rebase",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      refetch: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }
        ]),
      onInsert: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(insertStarted, undefined);
          yield* Deferred.await(releaseInsert);
        })
    });
    let insert: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      insert = runtime.runFork(Projects.insertEffect({
        id: "nova",
        name: "Nova",
        status: "blocked",
        progress: 12
      }));
      await Effect.runPromise(Deferred.await(insertStarted));

      await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* Collection.subscribeEventsEffect();
              yield* Projects.refetchEffect();
              const event = yield* PubSub.take(subscription);

              expect(event).toMatchObject({
                _tag: "CollectionLoaded",
                collection: "Projects.loaded-count-optimistic-rebase",
                count: 2
              });
            })
          )
        )
      );

      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id).sort())).toEqual([
        "atlas",
        "nova"
      ]);
    } finally {
      Effect.runSync(Deferred.fail(releaseInsert, "cleanup").pipe(Effect.ignore));
      if (insert !== undefined) {
        await Effect.runPromise(Fiber.await(insert));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("uses Effect schedules for collection load retry policy", async () => {
    let attempts = 0;
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.load-retry",
      getKey: (project) => project.id,
      policy: {
        retry: Schedule.recurs(2)
      },
      load: () =>
        Effect.gen(function* () {
          attempts++;
          if (attempts < 3) {
            return yield* Effect.fail("temporary");
          }
          return [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ];
        })
    });

    await Effect.runPromise(Projects.preloadEffect());

    expect(attempts).toBe(3);
    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
  });

  it("owns initial rows and read rows through detached values", () => {
    const initial = [
      { id: "atlas", name: "Atlas", meta: { labels: ["initial"] } }
    ];
    const Projects = Collection.define<OwnedProject>({
      name: "Projects.row-ownership.initial",
      getKey: (project) => project.id,
      initialData: initial
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
      initialData: [
        { id: "atlas", name: 123, status: "active", progress: 72 } as never
      ]
    });

    expect(Projects.rows()).toEqual([]);
    expect(Projects.get("atlas")).toBeUndefined();
    expect(Projects.state().get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load"
      }
    });
  });

  it("does not expose Promise-shaped or Effect-shaped row values", () => {
    const throwingThen = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      }
    });
    const PromiseRows = Collection.define<Project>({
      name: "Projects.initial-data-promise-row-ingress",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: Promise.resolve("Atlas"), status: "active", progress: 72 } as never
      ]
    });
    const EffectRows = Collection.define<Project>({
      name: "Projects.initial-data-effect-row-ingress",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: Effect.succeed("Atlas"), status: "active", progress: 72 } as never
      ]
    });
    const ThrowingThenRows = Collection.define<Project>({
      name: "Projects.initial-data-throwing-then-row-ingress",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: throwingThen, status: "active", progress: 72 } as never
      ]
    });

    expect(PromiseRows.rows()).toEqual([]);
    expect(PromiseRows.state().get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "PromiseLikeValue"
      }
    });
    expect(EffectRows.rows()).toEqual([]);
    expect(EffectRows.state().get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "EffectLikeValue"
      }
    });
    expect(ThrowingThenRows.rows()).toEqual([]);
    expect(ThrowingThenRows.state().get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "CollectionSnapshotCodecError",
        operation: "load",
        reason: "PromiseLikeValue"
      }
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
      progress: 72
    } as Project;
    const Projects = Collection.define<Project>({
      name: "Projects.initial-data-hostile-row-ingress",
      getKey: (project) => project.id,
      initialData: [hostile]
    });

    expect(Projects.rows()).toEqual([]);
    expect(Projects.state().get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "EffectInputCallbackError",
        operation: "Collection.rowValue.load"
      }
    });
  });

  it("canonicalizes transform-schema initialData for live reads", () => {
    const WireProjectSchema = Schema.Array(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.Literals(["active", "blocked"]),
      progress: Schema.Union([Schema.Number, Schema.NumberFromString])
    }));
    const Projects = Collection.define<Project>({
      name: "Projects.initial-data-transform-ingress",
      getKey: (project) => project.id,
      output: WireProjectSchema,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: "72" } as never
      ]
    });

    const row = Projects.get("atlas");
    expect(row).toMatchObject({ id: "atlas", progress: 72 });
    expect(typeof row?.progress).toBe("number");
  });

  it("owns loaded and written rows through detached values", async () => {
    const loaded = [
      { id: "atlas", name: "Atlas", meta: { labels: ["loaded"] } }
    ];
    const written = { id: "lumen", name: "Lumen", meta: { labels: ["written"] } };
    const Projects = Collection.define<OwnedProject>({
      name: "Projects.row-ownership.ingress",
      getKey: (project) => project.id,
      load: () => Effect.succeed(loaded)
    });

    await Effect.runPromise(Projects.preloadEffect());
    loaded[0]!.meta.labels.push("external-load");
    Projects.get("atlas")!.meta.labels.push("read-load");

    await Effect.runPromise(Projects.writeInsertEffect(written));
    written.meta.labels.push("external-write");
    Projects.get("lumen")!.meta.labels.push("read-write");

    expect(Projects.get("atlas")?.meta.labels).toEqual(["loaded"]);
    expect(Projects.get("lumen")?.meta.labels).toEqual(["written"]);
  });

  it("runs functional updates against detached drafts before validation", async () => {
    const Projects = Collection.define<OwnedProject>({
      name: "Projects.row-ownership.update-draft",
      getKey: (project) => project.id,
      output: OwnedProjectSchema,
      initialData: [
        { id: "atlas", name: "Atlas", meta: { labels: ["initial"] } }
      ]
    });

    await expect(
      Effect.runPromise(
        Projects.updateEffect("atlas", (draft) => {
          draft.meta.labels.push("callback-mutated");
          throw new Error("update failed");
        })
      )
    ).rejects.toMatchObject({
      _tag: "EffectInputCallbackError"
    });
    expect(Projects.get("atlas")?.meta.labels).toEqual(["initial"]);

    await expect(
      Effect.runPromise(
        Projects.updateEffect("atlas", (draft) => {
          draft.meta.labels.push("schema-mutated");
          return { ...draft, name: 1 as unknown as string };
        })
      )
    ).rejects.toBeInstanceOf(CollectionSnapshotCodecError);
    expect(Projects.get("atlas")?.meta.labels).toEqual(["initial"]);
  });

  it("reports synchronous load callback throws through the Effect error channel", () => {
    const Projects = Collection.define<Project, string, Error>({
      name: "Projects.load-sync-throw",
      getKey: (project) => project.id,
      load: () => {
        throw new Error("load failed");
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Projects.preloadEffect());
        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBeInstanceOf(Error);
          expect(((failure as EffectInputCallbackError).cause as Error).message).toBe("load failed");
        });
      })
    );
  });

  it("reports synchronous getKey throws during collection loads through the Effect error channel", () => {
    const thrown = new Error("key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.load-key-sync-throw",
      getKey: () => {
        throw thrown;
      },
      load: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas", status: "active", progress: 72 }
        ])
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(Projects.preloadEffect());
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.getKey(Projects.load-key-sync-throw)"
          );
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
          expect(read(Projects.state())).toMatchObject({
            _tag: "Failure",
            error: failure
          });
        });
      })
    );
  });

  it("reports synchronous getKey throws during direct writes through the Effect error channel", () => {
    const thrown = new Error("write key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.write-key-sync-throw",
      getKey: () => {
        throw thrown;
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            status: "active",
            progress: 72
          })
        );
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.getKey(Projects.write-key-sync-throw)"
          );
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
        });
      })
    );
  });

  it("rejects non-finite getKey results during preload before rows become visible", () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const Projects = Collection.define<Project, number>({
      name: "Projects.preload-key-nan",
      getKey: () => Number.NaN,
      load
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(Projects.preloadEffect());
        yield* Effect.sync(() => {
          expect(load).toHaveBeenCalledTimes(1);
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "load"
          });
          expect(Projects.rows()).toEqual([]);
          expect(Projects.state().get()).toMatchObject({
            _tag: "Failure",
            error: failure
          });
        });
      })
    );
  });

  it("rejects non-finite getKey results before optimistic mutation state is queued", () => {
    const onInsert = vi.fn(() => Effect.void);
    const Projects = Collection.define<Project, number>({
      name: "Projects.mutation-key-nan",
      getKey: () => Number.NaN,
      onInsert
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(Projects.insertEffect({
          id: "atlas",
          name: "Atlas",
          status: "active",
          progress: 72
        }));
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "mutation"
          });
          expect(onInsert).not.toHaveBeenCalled();
          expect(Projects.pendingMutations()).toEqual([]);
          expect(Projects.rows()).toEqual([]);
        });
      })
    );
  });

  it("describes collection definitions for app graph diagnostics", () => {
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.collection-diagnostics",
      input: { _tag: "ProjectCollectionInput" },
      output: { _tag: "ProjectCollectionOutput" },
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
        progress: {
          key: (project) => project.progress,
          unique: false
        }
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      load: () => Effect.succeed([]),
      onInsert: () => Effect.void,
      onUpdate: () => Effect.void,
      onDelete: () => Effect.void,
      policy: {
        retry: Schedule.recurs(1)
      },
      persistence: {
        storage: Collection.memoryStorage(),
        key: "projects.collection-diagnostics",
        hydrate: {
          replace: true
        },
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: true,
        persistOnMutation: true,
        persistOnWrite: true
      }
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.collection-diagnostics",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
    });

    expect(Collection.definitions().get("Projects.collection-diagnostics")).toBe(Projects);
    expect(Collection.diagnostics().collections).toEqual(
      expect.arrayContaining([
        {
          name: "Projects.collection-diagnostics",
          readOnly: false,
          inputSchema: true,
          outputSchema: true,
          initialData: true,
          indexes: [
            { name: "progress", unique: false },
            { name: "status", unique: false }
          ],
          load: true,
          handlers: {
            insert: true,
            update: true,
            delete: true
          },
          policy: {
            retry: true
          },
          persistence: {
            enabled: true,
            key: "projects.collection-diagnostics",
            hydrate: true,
            restoreOnPreload: true,
            loadAfterRestore: true,
            persistOnLoad: true,
            persistOnMutation: true,
            persistOnWrite: true
          }
        },
        expect.objectContaining({
          name: "ProjectCards.collection-diagnostics",
          readOnly: true
        })
      ])
    );
    expect(Collection.definitions().get("ProjectCards.collection-diagnostics")).toBe(ProjectCards);
  });

  it("collects nested collection preloads into the parent collector", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collect-nested",
      getKey: (project) => project.id
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.collect-nested",
      getKey: (task) => task.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          Collection.collectEffect(
            Effect.gen(function* () {
              yield* Projects.preloadEffect();
              const nested = yield* Collection.collectEffect(Tasks.preloadEffect());
              expect(nested.definitions).toEqual([Tasks]);
            })
          )
        );

        expect(collected.definitions).toEqual([Projects, Tasks]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("preserves duplicate-name preload facts and rejects ambiguous dehydration", () => {
    const runtime = makeRuntime();
    const FirstProjects = Collection.define<Project>({
      name: "Projects.collect-duplicate-name",
      getKey: (project) => project.id
    });
    const SecondProjects = Collection.define<Project>({
      name: "Projects.collect-duplicate-name",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          Collection.collectEffect(
            Effect.all([
              FirstProjects.preloadEffect(),
              SecondProjects.preloadEffect()
            ], { discard: true })
          )
        );

        expect(collected.definitions).toEqual([FirstProjects, SecondProjects]);
        const failure = yield* Effect.flip(runtime.provide(Collection.dehydrateEffect(collected.definitions)));
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "snapshot",
          path: "$.collections"
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("deduplicates identical preload facts during dehydration", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collect-duplicate-identity",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* runtime.provide(
          Collection.collectEffect(
            Effect.all([
              Projects.preloadEffect(),
              Projects.refetchEffect()
            ], { discard: true })
          )
        );

        expect(collected.definitions).toEqual([Projects, Projects]);
        const payload = yield* runtime.provide(Collection.dehydrateEffect(collected.definitions));
        expect(payload.collections.map((snapshot) => snapshot.name)).toEqual([
          "Projects.collect-duplicate-identity"
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("reads rows through named indexes", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexes",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status,
        progressBand: {
          key: (project) => project.progress >= 50 ? "high" : "low"
        },
        facets: (project) => [project.status, project.progress >= 50 ? "high" : "low"],
        duplicateStatus: (project) => [project.status, project.status]
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.firstByIndex("progressBand", "low")).toMatchObject({
      id: "lumen",
      $key: "lumen"
    });
    expect(Projects.index("facets", "high").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.index("duplicateStatus", "active").map((project) => project.id)).toEqual(["atlas"]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", {
      status: "active",
      progress: 58
    }));

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas", "lumen"]);
    expect(Projects.index("facets", "high").map((project) => project.id)).toEqual(["atlas", "lumen"]);
    expect(() => Projects.index("missing", "active")).toThrow(UnknownCollectionIndex);
  });

  it("rejects invalid secondary index selector values before bucketing rows", () => {
    const thrown = new Error("index failed");
    const invalidDate = new Date(Number.NaN);
    const invalidIndexes = [
      {
        name: "promise",
        index: (() => Promise.resolve("active")) as never
      },
      {
        name: "effect",
        index: (() => Effect.succeed("active")) as never
      },
      {
        name: "object",
        index: (() => ({ status: "active" })) as never
      },
      {
        name: "invalid-date",
        index: (() => invalidDate) as never
      },
      {
        name: "throwing",
        index: (() => {
          throw thrown;
        }) as never
      }
    ] as const;

    for (const { name, index } of invalidIndexes) {
      const Projects = Collection.define<Project>({
        name: `Projects.index-invalid-${name}`,
        getKey: (project) => project.id,
        indexes: {
          invalid: index
        },
        initialData: [
          { id: "atlas", name: "Atlas", status: "active", progress: 72 }
        ]
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
        status: (project) => project.status
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });

    for (const lookup of [
      () => Projects.index("status", invalidDate),
      () => Projects.firstByIndex("status", invalidDate)
    ]) {
      expect(lookup).toThrow(EffectInputCallbackError);
      try {
        lookup();
        expect.fail("Expected invalid Date index lookup to fail.");
      } catch (error) {
        expect(error).toMatchObject({
          _tag: "EffectInputCallbackError",
          operation: "Collection.index.value"
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
        status: byStatus
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas"]);
    expect(Projects.firstByIndex("status", "active")).toMatchObject({ id: "atlas" });
    expect(byStatus).toHaveBeenCalledTimes(2);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { status: "active" }));

    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["atlas", "lumen"]);
    expect(byStatus).toHaveBeenCalledTimes(4);
  });

  it("applies external collection change batches through the Collection store", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.change-batch",
      getKey: (project) => project.id,
      indexes: {
        status: (project) => project.status
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });

    await Effect.runPromise(Collection.applyChangesEffect(Projects, [
      {
        _tag: "Upsert",
        value: { id: "atlas", name: "Atlas Prime", status: "blocked", progress: 90 }
      },
      {
        _tag: "Upsert",
        value: { id: "orion", name: "Orion", status: "active", progress: 20 }
      },
      {
        _tag: "Delete",
        key: "lumen"
      }
    ]));

    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "orion"]);
    expect(Projects.get("atlas")).toMatchObject({
      name: "Atlas Prime",
      $origin: "remote",
      $synced: true
    });
    expect(Projects.index("status", "active").map((project) => project.id)).toEqual(["orion"]);
  });

  it("does not partially apply external change batches when persistence fails", async () => {
    const runtime = makeRuntime();
    const storage = {
      getItem: () => Effect.succeed(null),
      setItem: () => Effect.fail("disk-full")
    };
    const Projects = Collection.define<Project, string, never, never>({
      name: "Projects.change-batch-atomic-persist",
      getKey: (project) => project.id,
      persistence: {
        storage,
        persistOnWrite: true
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });

    try {
      await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const beforeVersion = Projects.version().get();
            const subscription = yield* Collection.subscribeEventsEffect();
            const error = yield* Effect.flip(Collection.applyChangesEffect(Projects, [
              {
                _tag: "Upsert",
                value: { id: "orion", name: "Orion", status: "active", progress: 20 }
              },
              {
                _tag: "Delete",
                key: "atlas"
              }
            ]));
            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("20 millis")
            );

            expect(error).toBe("disk-full");
            expect(Option.isNone(event)).toBe(true);
            expect(Projects.version().get()).toBe(beforeVersion);
            expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "lumen"]);
          })
        )
      ));
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rolls back optimistic mutations when the initial mutation persist fails", async () => {
    const runtime = makeRuntime();
    const onInsert = vi.fn(() => Effect.void);
    const storage: Collection.PersistenceStorage<"disk-full"> = {
      getItem: () => null,
      setItem: () => Effect.fail("disk-full")
    };
    const Projects = Collection.define<Project, string, "disk-full">({
      name: "Projects.mutation-atomic-persist",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        persistOnMutation: true
      },
      onInsert
    });

    try {
      await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const beforeVersion = Projects.version().get();
            const subscription = yield* Collection.subscribeEventsEffect();
            const error = yield* Effect.flip(Projects.insertEffect({
              id: "orion",
              name: "Orion",
              status: "blocked",
              progress: 12
            }));
            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("20 millis")
            );

            expect(error).toBe("disk-full");
            expect(onInsert).not.toHaveBeenCalled();
            expect(Option.isNone(event)).toBe(true);
            expect(Projects.version().get()).toBe(beforeVersion);
            expect(Projects.pendingMutations()).toEqual([]);
            expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
          })
        )
      ));
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not publish or retain direct writes when persistence fails", async () => {
    const runtime = makeRuntime();
    const storage: Collection.PersistenceStorage<"disk-full"> = {
      getItem: () => null,
      setItem: () => Effect.fail("disk-full")
    };
    const Projects = Collection.define<Project, string, "disk-full">({
      name: "Projects.direct-write-atomic-persist",
      getKey: (project) => project.id,
      persistence: {
        storage,
        persistOnWrite: true
      }
    });

    try {
      await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const beforeVersion = Projects.version().get();
            const subscription = yield* Collection.subscribeEventsEffect();
            const error = yield* Effect.flip(Projects.writeInsertEffect({
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72
            }));
            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("20 millis")
            );

            expect(error).toBe("disk-full");
            expect(Option.isNone(event)).toBe(true);
            expect(Projects.version().get()).toBe(beforeVersion);
            expect(Projects.rows()).toEqual([]);
          })
        )
      ));
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not persist, publish, or tick versions for empty and missing collection writes", async () => {
    const runtime = makeRuntime();
    const setItem = vi.fn((_key: string, _value: string) => Effect.void);
    const storage: Collection.PersistenceStorage = {
      getItem: () => null,
      setItem
    };
    const Projects = Collection.define<Project>({
      name: "Projects.no-op-writes",
      getKey: (project) => project.id,
      persistence: {
        storage,
        persistOnMutation: true,
        persistOnWrite: true
      }
    });

    try {
      await Effect.runPromise(runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const beforeVersion = Projects.version().get();
            const subscription = yield* Collection.subscribeEventsEffect();

            yield* Projects.writeInsertEffect([]);
            yield* Collection.applyChangesEffect(Projects, []);
            yield* Projects.writeDeleteEffect("missing");
            const transaction = yield* Projects.insertEffect([]);

            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("20 millis")
            );

            expect(transaction).toMatchObject({
              collection: "Projects.no-op-writes",
              mutations: []
            });
            expect(Option.isNone(event)).toBe(true);
            expect(setItem).not.toHaveBeenCalled();
            expect(Projects.version().get()).toBe(beforeVersion);
            expect(Projects.pendingMutations()).toEqual([]);
            expect(Projects.rows()).toEqual([]);
          })
        )
      ));
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps collection rows isolated by Effect UI runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.runtime-isolation",
      getKey: (project) => project.id
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));

      expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
      expect(runWithRuntime(second, () => Projects.rows())).toEqual([]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("evaluates one-shot queries against the active Effect UI runtime store", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.query-runtime-isolation",
      getKey: (project) => project.id
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));

      await expect(runInRuntime(first, Query.onceEffect((query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => project.id)
      ))).resolves.toEqual(["atlas"]);
      await expect(runInRuntime(second, Query.onceEffect((query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => project.id)
      ))).resolves.toEqual([]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("attaches separate Collection stores to separate Resource Stores", async () => {
    const firstStore = makeResourceStore();
    const secondStore = makeResourceStore();
    const Projects = Collection.define<Project>({
      name: "Projects.resource-store-isolation",
      getKey: (project) => project.id
    });

    const firstCollectionStore = await Effect.runPromise(
      Effect.provideService(Collection.storeEffect(), ResourceStore, firstStore)
    );
    const secondCollectionStore = await Effect.runPromise(
      Effect.provideService(Collection.storeEffect(), ResourceStore, secondStore)
    );

    expect(firstCollectionStore).not.toBe(secondCollectionStore);
    await Effect.runPromise(Effect.provideService(Projects.writeInsertEffect({
      id: "atlas",
      name: "Atlas",
      status: "active",
      progress: 72
    }), ResourceStore, firstStore));

    const firstSnapshot = await Effect.runPromise(
      Effect.provideService(Projects.snapshotEffect(), ResourceStore, firstStore)
    );
    const secondSnapshot = await Effect.runPromise(
      Effect.provideService(Projects.snapshotEffect(), ResourceStore, secondStore)
    );
    const firstDiagnostics = await Effect.runPromise(
      Effect.provideService(
        Collection.storeEffect().pipe(Effect.map((store) => store.diagnostics.snapshot())),
        ResourceStore,
        firstStore
      )
    );
    const secondDiagnostics = await Effect.runPromise(
      Effect.provideService(
        Collection.storeEffect().pipe(Effect.map((store) => store.diagnostics.snapshot())),
        ResourceStore,
        secondStore
      )
    );

    expect(firstSnapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
    expect(secondSnapshot.rows).toEqual([]);
    expect(firstDiagnostics).toMatchObject({
      collectionCount: 1,
      rowCount: 1,
      pendingMutationCount: 0
    });
    expect(secondDiagnostics).toMatchObject({
      collectionCount: 1,
      rowCount: 0,
      pendingMutationCount: 0
    });
  });

  it("uses the active Collection store override for synchronous snapshots", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const initialProject: Project = {
      id: "atlas",
      name: "Atlas",
      status: "active",
      progress: 72
    };
    const updatedProject: Project = {
      ...initialProject,
      progress: 80
    };
    const Projects = Collection.define<Project>({
      name: "Projects.collection-store-sync-override",
      getKey: (project) => project.id
    });
    const pendingSnapshot: Collection.Snapshot<Project, string> = {
      name: Projects.name,
      rows: [
        {
          key: "atlas",
          value: initialProject,
          synced: true,
          origin: "remote"
        }
      ],
      pendingMutations: [
        {
          transaction: {
            id: "ctx_1",
            collection: Projects.name,
            mutations: [
              {
                _tag: "Update",
                key: "atlas",
                previous: initialProject,
                value: updatedProject,
                changes: { progress: 80 }
              }
            ]
          },
          rollbackRows: [
            {
              key: "atlas",
              row: {
                key: "atlas",
                value: initialProject,
                synced: true,
                origin: "remote"
              }
            }
          ],
          createdAt: 1,
          attempts: 1
        }
      ],
      updatedAt: 1
    };

    try {
      const firstCollectionStore = await runInRuntime(first, collectionStoreEffect);
      const secondCollectionStore = await runInRuntime(second, collectionStoreEffect);

      await runInRuntime(first, Projects.hydrateEffect(pendingSnapshot));

      expect(runWithCollectionStore(firstCollectionStore, () => Projects.pendingMutations())).toHaveLength(1);
      expect(runWithCollectionStore(secondCollectionStore, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithCollectionStore(firstCollectionStore, () =>
        Projects.snapshot().rows.map((row) => row.key)
      )).toEqual(["atlas"]);
      expect(runWithCollectionStore(secondCollectionStore, () => Projects.snapshot().rows)).toEqual([]);
      expect(runWithCollectionStore(firstCollectionStore, () =>
        Collection.dehydrate([Projects]).collections[0]?.rows.map((row) => row.key)
      )).toEqual(["atlas"]);
      expect(runWithCollectionStore(secondCollectionStore, () =>
        Collection.dehydrate([Projects]).collections[0]?.rows
      )).toEqual([]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("publishes collection events through the active Collection store", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collection-store-events",
      getKey: (project) => project.id
    });

    try {
      const events = await runInRuntime(runtime,
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* Collection.storeEffect();
            const subscription = yield* store.subscribeEventsEffect();
            yield* Projects.writeInsertEffect({
              id: "atlas",
              name: "Atlas",
              status: "active",
              progress: 72
            });
            const written = yield* PubSub.take(subscription);
            return [written] as const;
          })
        )
      );

      expect(events).toMatchObject([
        {
          _tag: "CollectionWritten",
          collection: "Projects.collection-store-events",
          mutations: 1
        }
      ]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
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
          project.progress >= 50 ? "high-progress" : "low-progress"
        ],
        byName: {
          key: (project) => project.name,
          unique: true
        }
      }
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]));
      await runInRuntime(second, Projects.writeInsertEffect({
        id: "kepler",
        name: "Kepler",
        status: "active",
        progress: 52
      }));

      expect(runWithRuntime(first, () => Projects.index("status", "active").map((project) => project.id))).toEqual([
        "atlas"
      ]);
      expect(runWithRuntime(first, () => Collection.index(Projects, "buckets", "high-progress").map((project) => project.id))).toEqual([
        "atlas"
      ]);
      expect(runWithRuntime(first, () => Projects.firstByIndex("byName", "Atlas"))).toMatchObject({
        id: "atlas",
        $key: "atlas"
      });
      expect(runWithRuntime(second, () => Projects.index("status", "active").map((project) => project.id))).toEqual([
        "kepler"
      ]);

      await runInRuntime(first, Projects.writeUpdateEffect("lumen", { status: "active", progress: 66 }));

      expect(runWithRuntime(first, () => Projects.index("status", "active").map((project) => project.id))).toEqual([
        "atlas",
        "lumen"
      ]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("snapshots and hydrates rows with collection metadata inside the active runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-hydrate",
      getKey: (project) => project.id
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }, { origin: "local", synced: false }));

      const snapshot = await runInRuntime(first, Projects.snapshotEffect());

      expect(snapshot).toMatchObject({
        name: "Projects.snapshot-hydrate",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            synced: false,
            origin: "local"
          }
        ]
      });

      await runInRuntime(second, Projects.hydrateEffect(snapshot));

      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        id: "atlas",
        name: "Atlas",
        $synced: false,
        $origin: "local"
      });
      expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("ticks collection version once when hydrating a snapshot", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.hydrate-version-once",
      getKey: (project) => project.id
    });
    const snapshot: Collection.Snapshot<Project, string> = {
      name: "Projects.hydrate-version-once",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          synced: true,
          origin: "remote"
        }
      ],
      pendingMutations: [],
      updatedAt: 1
    };

    try {
      await runInRuntime(runtime, Effect.gen(function* () {
        const version = Projects.version();
        const beforeVersion = version.get();
        let ticks = 0;
        const unsubscribe = version.subscribe(() => {
          ticks++;
        });
        try {
          yield* Projects.hydrateEffect(snapshot);
        } finally {
          unsubscribe();
        }

        expect(version.get()).toBe(beforeVersion + 1);
        expect(ticks).toBe(1);
      }));
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("detaches snapshot rows and pending rollback rows from mutable collection state", () => {
    const runtime = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<SnapshotProject, string, never>({
      name: "Projects.snapshot-codec-detach",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", meta: { labels: ["remote"] } }
      ],
      onUpdate: () => Deferred.await(release)
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        update = runtime.runFork(Projects.updateEffect("atlas", (draft) => {
          draft.meta.labels.push("local");
        }));
        yield* Effect.sleep("10 millis");

        const snapshot = yield* runtime.provide(Projects.snapshotEffect());
        const row = snapshot.rows[0];
        const pending = snapshot.pendingMutations[0];
        const rollback = pending?.rollbackRows[0]?.row;

        yield* Effect.sync(() => {
          expect(row?.value.meta.labels).toEqual(["remote", "local"]);
          expect(rollback?.value.meta.labels).toEqual(["remote"]);

          row?.value.meta.labels.push("snapshot-only");
          rollback?.value.meta.labels.push("rollback-only");

          expect(runWithRuntime(runtime, () => Projects.get("atlas")?.meta.labels)).toEqual([
            "remote",
            "local"
          ]);
        });

        yield* Deferred.succeed(release, undefined);
        if (update !== undefined) {
          yield* Fiber.join(update);
        }
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Deferred.succeed(release, undefined).pipe(Effect.ignore);
            if (update !== undefined) {
              yield* Fiber.await(update);
            }
            yield* runtime.disposeEffect;
          })
        )
      )
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
            buffer: new Uint8Array([4, 5, 6]).buffer
          }
        }
      ]
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

        const snapshot = yield* runtime.provide(Projects.snapshotEffect());
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
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("persists and restores collection snapshots through a storage adapter", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const storage = Collection.memoryStorage();
    const Projects = Collection.define<Project>({
      name: "Projects.persist-restore",
      getKey: (project) => project.id
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]));
      await runInRuntime(first, Projects.persistEffect(storage, { key: "projects-cache" }));

      expect(storage.values.has("projects-cache")).toBe(true);

      await runInRuntime(second, Projects.restoreEffect(storage, { key: "projects-cache" }));

      expect(runWithRuntime(second, () => Projects.rows().map((project) => project.name).sort())).toEqual([
        "Atlas",
        "Lumen"
      ]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("loads after restoring over initial data and persists the refreshed snapshot", () => {
    const runtime = makeRuntime();
    const key = "projects-restore-load-after-initial-cache";
    const storage = Collection.memoryStorage([[
      key,
      JSON.stringify({
        name: "Projects.restore-load-after-initial",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);
    let loads = 0;
    const Projects = Collection.define<Project>({
      name: "Projects.restore-load-after-initial",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Initial", status: "active", progress: 1 }
      ],
      load: () =>
        Effect.sync(() => {
          loads++;
          return [
            { id: "atlas", name: "Loaded", status: "blocked", progress: 99 }
          ];
        }),
      persistence: {
        storage,
        key,
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: true
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());

        const persisted = JSON.parse(storage.values.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
        expect(loads).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded",
          progress: 99
        });
        expect(persisted.rows.map((row) => row.value.name)).toEqual(["Loaded"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("skips restore-before-preload when persistence hydrate is disabled", () => {
    const runtime = makeRuntime();
    const key = "projects-restore-hydrate-disabled-cache";
    const persisted = new Map<string, string>([[
      key,
      JSON.stringify({
        name: "Projects.restore-hydrate-disabled",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);
    let gets = 0;
    let loads = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: (storageKey) =>
        Effect.sync(() => {
          gets++;
          return persisted.get(storageKey) ?? null;
        }),
      setItem: (storageKey, value) =>
        Effect.sync(() => {
          persisted.set(storageKey, value);
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.restore-hydrate-disabled",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          loads++;
          return [
            { id: "atlas", name: "Loaded", status: "blocked", progress: 99 }
          ];
        }),
      persistence: {
        storage,
        key,
        hydrate: false,
        restoreOnPreload: true,
        loadAfterRestore: true,
        persistOnLoad: false
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());

        expect(gets).toBe(0);
        expect(loads).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded",
          progress: 99
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rolls back preload rows and lets later preload retry when persistOnLoad fails", () => {
    const runtime = makeRuntime();
    const key = "projects-preload-persist-failure-cache";
    const persisted = new Map<string, string>();
    let writes = 0;
    let loads = 0;
    const storage: Collection.PersistenceStorage<"disk-full"> = {
      getItem: (storageKey) => persisted.get(storageKey) ?? null,
      setItem: (storageKey, value) =>
        writes++ === 0
          ? Effect.fail("disk-full" as const)
          : Effect.sync(() => {
              persisted.set(storageKey, value);
            })
    };
    const Projects = Collection.define<Project, string, "disk-full">({
      name: "Projects.preload-persist-failure",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          loads++;
          return [
            { id: "atlas", name: `Loaded ${loads}`, status: "blocked", progress: 90 + loads }
          ] satisfies ReadonlyArray<Project>;
        }),
      persistence: {
        storage,
        key,
        persistOnLoad: true
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* Collection.subscribeEventsEffect();
              const failure = yield* Effect.flip(Projects.preloadEffect());
              const failureEvent = yield* PubSub.take(subscription);
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis")
              );

              expect(failure).toBe("disk-full");
              expect(failureEvent).toMatchObject({
                _tag: "CollectionLoadFailure",
                collection: "Projects.preload-persist-failure",
                error: "disk-full"
              });
              expect(Option.isNone(nextEvent)).toBe(true);
            })
          )
        );

        expect(loads).toBe(1);
        expect(writes).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Failure",
          error: "disk-full"
        });

        yield* runtime.provide(Projects.preloadEffect());

        const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
        expect(loads).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded 2",
          progress: 92
        });
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Ready"
        });
        expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Loaded 2"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rolls back forced refetch rows and lets later refetch retry when persistOnLoad fails", () => {
    const runtime = makeRuntime();
    const key = "projects-refetch-persist-failure-cache";
    const persisted = new Map<string, string>();
    let writes = 0;
    let refetches = 0;
    const storage: Collection.PersistenceStorage<"disk-full"> = {
      getItem: (storageKey) => persisted.get(storageKey) ?? null,
      setItem: (storageKey, value) =>
        writes++ === 0
          ? Effect.fail("disk-full" as const)
          : Effect.sync(() => {
              persisted.set(storageKey, value);
            })
    };
    const Projects = Collection.define<Project, string, "disk-full">({
      name: "Projects.refetch-persist-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Initial", status: "active", progress: 1 }
      ],
      refetch: () =>
        Effect.sync(() => {
          refetches++;
          return [
            { id: "atlas", name: `Refetched ${refetches}`, status: "blocked", progress: 80 + refetches }
          ] satisfies ReadonlyArray<Project>;
        }),
      persistence: {
        storage,
        key,
        persistOnLoad: true
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* Collection.subscribeEventsEffect();
              const failure = yield* Effect.flip(Projects.refetchEffect());
              const failureEvent = yield* PubSub.take(subscription);
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis")
              );

              expect(failure).toBe("disk-full");
              expect(failureEvent).toMatchObject({
                _tag: "CollectionLoadFailure",
                collection: "Projects.refetch-persist-failure",
                error: "disk-full"
              });
              expect(Option.isNone(nextEvent)).toBe(true);
            })
          )
        );

        expect(refetches).toBe(1);
        expect(writes).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Initial"]);
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Failure",
          error: "disk-full"
        });

        yield* runtime.provide(Projects.refetchEffect());

        const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
        expect(refetches).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Refetched 2",
          progress: 82
        });
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Ready"
        });
        expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Refetched 2"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("retries persistedOptions loadAfterRestore after persistOnLoad fails", () => {
    const runtime = makeRuntime();
    const key = "projects-persisted-options-load-after-restore-failure-cache";
    const persisted = new Map<string, string>([[
      key,
      JSON.stringify({
        name: "Projects.persisted-options-load-after-restore-failure",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Restored", status: "active", progress: 10 },
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);
    let writes = 0;
    let loads = 0;
    const storage: Collection.PersistenceStorage<"disk-full"> = {
      getItem: (storageKey) => persisted.get(storageKey) ?? null,
      setItem: (storageKey, value) =>
        writes++ === 0
          ? Effect.fail("disk-full" as const)
          : Effect.sync(() => {
              persisted.set(storageKey, value);
            })
    };
    const Projects = Collection.define(
      Collection.persistedOptions<Project, string, never, never, "disk-full">({
        name: "Projects.persisted-options-load-after-restore-failure",
        getKey: (project) => project.id,
        load: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: `Loaded ${loads}`, status: "blocked", progress: 50 + loads }
            ] satisfies ReadonlyArray<Project>;
          }),
        persistence: {
          storage,
          key,
          restoreOnPreload: true,
          loadAfterRestore: true,
          persistOnLoad: true
        }
      })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* Collection.subscribeEventsEffect();
              const failure = yield* Effect.flip(Projects.preloadEffect());
              const events = [
                yield* PubSub.take(subscription),
                yield* PubSub.take(subscription),
                yield* PubSub.take(subscription)
              ];
              const nextEvent = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis")
              );

              expect(failure).toBe("disk-full");
              expect(events.map((event) => event._tag)).toEqual([
                "CollectionHydrated",
                "CollectionRestored",
                "CollectionLoadFailure"
              ]);
              expect(Option.isNone(nextEvent)).toBe(true);
            })
          )
        );

        expect(loads).toBe(1);
        expect(writes).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Restored"]);
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Failure",
          error: "disk-full"
        });

        yield* runtime.provide(Projects.preloadEffect());

        const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
        expect(loads).toBe(2);
        expect(writes).toBe(2);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          name: "Loaded 2",
          progress: 52
        });
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Ready"
        });
        expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Loaded 2"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("does not let a stale preload restore overwrite a newer forced refetch", async () => {
    const runtime = makeRuntime();
    const key = "projects-stale-restore-race-cache";
    const firstRestoreStarted = Effect.runSync(Deferred.make<void>());
    const releaseFirstRestore = Effect.runSync(Deferred.make<void>());
    const persisted = new Map<string, string>([[
      key,
      JSON.stringify({
        name: "Projects.stale-restore-race",
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Restored Old", status: "blocked", progress: 1 },
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);
    let gets = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: (storageKey) => {
        gets++;
        if (gets === 1) {
          const encoded = persisted.get(storageKey) ?? null;
          return Effect.gen(function* () {
            yield* Deferred.succeed(firstRestoreStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseFirstRestore);
            return encoded;
          });
        }
        return null;
      },
      setItem: (storageKey, value) =>
        Effect.sync(() => {
          persisted.set(storageKey, value);
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.stale-restore-race",
      getKey: (project) => project.id,
      load: () => Effect.succeed([{ id: "atlas", name: "Loaded", status: "active", progress: 2 }]),
      refetch: () => Effect.succeed([{ id: "atlas", name: "Refetched Fresh", status: "active", progress: 99 }]),
      persistence: {
        storage,
        key,
        restoreOnPreload: true,
        persistOnLoad: true
      }
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let refetch: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(firstRestoreStarted));
      refetch = runtime.runFork(Projects.refetchEffect());
      await Effect.runPromise(Fiber.join(refetch));

      Effect.runSync(Deferred.succeed(releaseFirstRestore, undefined));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Refetched Fresh",
        progress: 99
      });
      expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Refetched Fresh"]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseFirstRestore, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload).pipe(Effect.timeoutOption("100 millis")));
      }
      if (refetch !== undefined) {
        await Effect.runPromise(Fiber.await(refetch).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("serializes restore-before-preload with direct writes", async () => {
    const runtime = makeRuntime();
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
          origin: "remote"
        }
      ],
      pendingMutations: [],
      updatedAt: 1
    });
    const persisted = new Map<string, string>([[key, oldSnapshot]]);
    let gets = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: (storageKey) => {
        gets++;
        if (gets === 1) {
          const encoded = persisted.get(storageKey) ?? null;
          return Effect.gen(function* () {
            yield* Deferred.succeed(restoreStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseRestore);
            return encoded;
          });
        }
        return persisted.get(storageKey) ?? null;
      },
      setItem: (storageKey, value) =>
        Effect.sync(() => {
          persisted.set(storageKey, value);
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.restore-write-serialization",
      getKey: (project) => project.id,
      persistence: {
        storage,
        key,
        restoreOnPreload: true,
        persistOnWrite: true
      }
    });
    let preload: Fiber.Fiber<unknown, unknown> | undefined;
    let write: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      preload = runtime.runFork(Projects.preloadEffect());
      await Effect.runPromise(Deferred.await(restoreStarted));
      write = runtime.runFork(Projects.writeInsertEffect({
        id: "atlas",
        name: "Fresh Write",
        status: "active",
        progress: 42
      }));
      await Effect.runPromise(Fiber.join(write));

      Effect.runSync(Deferred.succeed(releaseRestore, undefined));
      await Effect.runPromise(Fiber.join(preload));

      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Fresh Write",
        progress: 42
      });
      expect(snapshot.rows.map((row) => row.value.name)).toEqual(["Fresh Write"]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseRestore, undefined).pipe(Effect.ignore));
      if (preload !== undefined) {
        await Effect.runPromise(Fiber.await(preload).pipe(Effect.timeoutOption("100 millis")));
      }
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("serializes durable direct write commits so older storage writes cannot overwrite newer snapshots", async () => {
    const runtime = makeRuntime();
    const key = "projects-direct-write-serialization-cache";
    const firstPersistStarted = Effect.runSync(Deferred.make<void>());
    const releaseFirstPersist = Effect.runSync(Deferred.make<void>());
    const persisted = new Map<string, string>();
    let writes = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: () => persisted.get(key) ?? null,
      setItem: (storageKey, value) => {
        writes++;
        if (writes === 1) {
          return Effect.gen(function* () {
            yield* Deferred.succeed(firstPersistStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseFirstPersist);
            persisted.set(storageKey, value);
          });
        }
        return Effect.sync(() => {
          persisted.set(storageKey, value);
        });
      }
    };
    const Projects = Collection.define<Project>({
      name: "Projects.direct-write-serialization",
      getKey: (project) => project.id,
      persistence: {
        storage,
        key,
        persistOnWrite: true
      }
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 1
      }));
      await Effect.runPromise(Deferred.await(firstPersistStarted));
      second = runtime.runFork(Projects.writeUpdateEffect("atlas", { progress: 2 }));
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseFirstPersist, undefined));
      await Effect.runPromise(Fiber.join(first));
      await Effect.runPromise(Fiber.join(second));

      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(snapshot.rows.map((row) => row.value.progress)).toEqual([2]);
    } finally {
      Effect.runSync(Deferred.succeed(releaseFirstPersist, undefined).pipe(Effect.ignore));
      if (first !== undefined) {
        await Effect.runPromise(Fiber.await(first).pipe(Effect.timeoutOption("100 millis")));
      }
      if (second !== undefined) {
        await Effect.runPromise(Fiber.await(second).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not mark missing preload storage as restored", () => {
    const runtime = makeRuntime();
    const key = "projects-missing-restore-cache";
    const storage = Collection.memoryStorage();
    const Projects = Collection.define<Project>({
      name: "Projects.missing-restore",
      getKey: (project) => project.id,
      persistence: {
        storage,
        key,
        restoreOnPreload: true
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);

        storage.values.set(key, JSON.stringify({
          name: "Projects.missing-restore",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Restored", status: "active", progress: 72 },
              synced: true,
              origin: "remote"
            }
          ],
          pendingMutations: [],
          updatedAt: 1
        }));

        yield* runtime.provide(Projects.preloadEffect());

        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.name))).toEqual(["Restored"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("validates persisted snapshot shape before hydrating storage rows", () => {
    const runtime = makeRuntime();
    const storage = Collection.memoryStorage([[
      "invalid-projects-cache",
      JSON.stringify({
        name: "Projects.snapshot-codec-invalid",
        rows: "not-rows",
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-invalid",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(Projects.restoreEffect(storage, { key: "invalid-projects-cache" }))
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
            path: "$.rows"
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("fails direct malformed snapshots through the hydrate Effect error channel", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-direct-invalid",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            Projects.hydrateEffect({
              name: "Projects.snapshot-codec-direct-invalid",
              // @ts-expect-error runtime validation rejects malformed payload rows.
              rows: "not-rows",
              pendingMutations: [],
              updatedAt: 1
            })
          )
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
            path: "$.rows"
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects duplicate row keys in collection snapshots", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-duplicate-row",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing", name: "Existing", status: "active", progress: 1 }
      ]
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(Projects.hydrateEffect({
            name: "Projects.snapshot-codec-duplicate-row",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                synced: true,
                origin: "remote"
              },
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas Duplicate", status: "blocked", progress: 20 },
                synced: true,
                origin: "remote"
              }
            ],
            pendingMutations: [],
            updatedAt: 1
          }))
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          path: "$.rows[1].key"
        });
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(["existing"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects non-finite numeric collection keys before persistence writes", () => {
    const runtime = makeRuntime();
    const storage = Collection.memoryStorage();
    const Projects = Collection.define<Project, number>({
      name: "Projects.snapshot-codec-non-finite-key",
      getKey: () => Number.NaN
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(runtime.provide(Projects.writeInsertEffect({
          id: "atlas",
          name: "Atlas",
          status: "active",
          progress: 72
        })));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "write",
          path: "$.collections[Projects.snapshot-codec-non-finite-key].rows[0].key"
        });
        yield* runtime.provide(Projects.persistEffect(storage));
        expect(storage.values.size).toBe(1);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects non-finite numeric collection keys before rows can be dehydrated", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project, number>({
      name: "Projects.snapshot-codec-non-finite-key-dehydrate",
      getKey: () => Number.NaN
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(runtime.provide(Projects.writeInsertEffect({
          id: "atlas",
          name: "Atlas",
          status: "active",
          progress: 72
        })));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "write",
          path: "$.collections[Projects.snapshot-codec-non-finite-key-dehydrate].rows[0].key"
        });
        expect(runWithRuntime(runtime, () => Collection.dehydrate([Projects]).collections[0]?.rows)).toEqual([]);
        const payload = yield* runtime.provide(Collection.dehydrateEffect([Projects]));
        expect(payload.collections[0]?.rows).toEqual([]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
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
      progress: 72
    });
    const LoadingProjects = Collection.define<Project>({
      name: "Projects.executable-row-load-ingress",
      getKey: (project) => project.id,
      refetch: () =>
        Effect.succeed([
          { id: "atlas", name: Effect.succeed("Atlas"), status: "active", progress: 72 } as never
        ])
    });
    const Projects = Collection.define<Project>({
      name: "Projects.executable-row-write-ingress",
      getKey: (project) => project.id
    });
    const HostileProjects = Collection.define<Project>({
      name: "Projects.hostile-row-ingress",
      getKey: (project) => project.id,
      refetch: () => Effect.succeed([throwingRow()])
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const loadFailure = yield* Effect.flip(runtime.provide(LoadingProjects.preloadEffect()));
        const writeFailure = yield* Effect.flip(runtime.provide(Projects.writeInsertEffect({
          id: "atlas",
          name: Effect.succeed("Atlas") as never,
          status: "active",
          progress: 72
        })));
        const changeFailure = yield* Effect.flip(runtime.provide(Collection.applyChangesEffect(Projects, [
          {
            _tag: "Upsert",
            value: {
              id: "atlas",
              name: Promise.resolve("Atlas") as never,
              status: "active",
              progress: 72
            }
          }
        ])));
        const hydrateFailure = yield* Effect.flip(runtime.provide(Projects.hydrateEffect({
          name: "Projects.executable-row-write-ingress",
          rows: [
            {
              key: "atlas",
              value: {
                id: "atlas",
                name: Effect.succeed("Atlas") as never,
                status: "active",
                progress: 72
              },
              synced: true,
              origin: "remote"
            }
          ],
          pendingMutations: [],
          updatedAt: 1
        })));
        const hostileLoadFailure = yield* Effect.flip(runtime.provide(HostileProjects.preloadEffect()));
        const hostileWriteFailure = yield* Effect.flip(runtime.provide(HostileProjects.writeInsertEffect(throwingRow())));
        const hostileChangeFailure = yield* Effect.flip(runtime.provide(Collection.applyChangesEffect(HostileProjects, [
          {
            _tag: "Upsert",
            value: throwingRow()
          }
        ])));

        expect(loadFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue"
        });
        expect(writeFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue"
        });
        expect(changeFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "PromiseLikeValue"
        });
        expect(hydrateFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          reason: "EffectLikeValue"
        });
        for (const failure of [hostileLoadFailure, hostileWriteFailure, hostileChangeFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: expect.stringMatching(/^Collection\.rowValue\./)
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(runWithRuntime(runtime, () => HostileProjects.rows())).toEqual([]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("omits invalid initialData from dehydrateEffect payloads", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.dehydrate-invalid-initial-data",
      getKey: (project) => project.id,
      output: ProjectRowsSchema,
      initialData: [
        { id: "atlas", name: 123, status: "active", progress: 72 } as never
      ]
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* runtime.provide(Collection.dehydrateEffect([Projects]));

        expect(payload.collections[0]?.rows).toEqual([]);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        expect(runWithRuntime(runtime, () => Projects.state().get())).toMatchObject({
          _tag: "Failure",
          error: { _tag: "CollectionSnapshotCodecError", operation: "load" }
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("returns canonical dehydrateEffect payloads for transform schemas", () => {
    const runtime = makeRuntime();
    const WireProjectSchema = Schema.Array(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.Literals(["active", "blocked"]),
      progress: Schema.Union([Schema.Number, Schema.NumberFromString])
    }));
    const Projects = Collection.define<Project>({
      name: "Projects.dehydrate-transform-initial-data",
      getKey: (project) => project.id,
      output: WireProjectSchema,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: "72" } as never
      ]
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* runtime.provide(Collection.dehydrateEffect([Projects]));
        const value = payload.collections[0]?.rows[0]?.value;

        expect(value).toMatchObject({
          id: "atlas",
          progress: 72
        });
        expect(typeof value?.progress).toBe("number");
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects pending mutation snapshots with malformed rollback coverage", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-rollback-coverage",
      getKey: (project) => project.id
    });
    const previous: Project = { id: "atlas", name: "Atlas", status: "active", progress: 72 };
    const next: Project = { ...previous, progress: 90 };
    const snapshot = (
      rollbackRows: ReadonlyArray<unknown>
    ) => ({
      name: "Projects.snapshot-codec-rollback-coverage",
      rows: [],
      pendingMutations: [
        {
          transaction: {
            id: "tx:1",
            collection: "Projects.snapshot-codec-rollback-coverage",
            mutations: [
              {
                _tag: "Update" as const,
                key: "atlas",
                previous,
                value: next,
                changes: { progress: 90 }
              }
            ]
          },
          rollbackRows,
          createdAt: 1,
          attempts: 0
        }
      ],
      updatedAt: 1
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const missing = yield* Effect.exit(
          runtime.provide(Projects.hydrateEffect(snapshot([])))
        );
        const mismatched = yield* Effect.exit(
          runtime.provide(Projects.hydrateEffect(snapshot([
            {
              key: "atlas",
              row: {
                key: "lumen",
                value: previous,
                synced: true,
                origin: "remote"
              }
            }
          ])))
        );

        yield* Effect.sync(() => {
          expect(Exit.isFailure(missing)).toBe(true);
          const missingFailure = Exit.isFailure(missing)
            ? missing.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(missingFailure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(missingFailure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            path: "$.pendingMutations[0].rollbackRows"
          });

          expect(Exit.isFailure(mismatched)).toBe(true);
          const mismatchedFailure = Exit.isFailure(mismatched)
            ? mismatched.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(mismatchedFailure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(mismatchedFailure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            path: "$.pendingMutations[0].rollbackRows[0].row.key"
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects pending mutation snapshots with invalid attempt counts", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-invalid-attempts",
      getKey: (project) => project.id
    });
    const previous: Project = { id: "atlas", name: "Atlas", status: "active", progress: 72 };
    const next: Project = { ...previous, progress: 90 };
    const snapshot = (attempts: number) => ({
      name: "Projects.snapshot-codec-invalid-attempts",
      rows: [],
      pendingMutations: [
        {
          transaction: {
            id: `tx:${attempts}`,
            collection: "Projects.snapshot-codec-invalid-attempts",
            mutations: [
              {
                _tag: "Update" as const,
                key: "atlas",
                previous,
                value: next,
                changes: { progress: 90 }
              }
            ]
          },
          rollbackRows: [
            {
              key: "atlas",
              row: {
                key: "atlas",
                value: previous,
                synced: true,
                origin: "remote" as const
              }
            }
          ],
          createdAt: 1,
          attempts
        }
      ],
      updatedAt: 1
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        for (const attempts of [-1, 1.5]) {
          const failure = yield* Effect.flip(runtime.provide(Projects.hydrateEffect(snapshot(attempts))));
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$.pendingMutations[0].attempts"
          });
        }
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects duplicate pending transaction ids during snapshot validation", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-duplicate-pending-id",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const previous: Project = { id: "atlas", name: "Atlas", status: "active", progress: 72 };
    const next: Project = { ...previous, progress: 90 };
    const pending = {
      transaction: {
        id: "tx:duplicate",
        collection: "Projects.snapshot-codec-duplicate-pending-id",
        mutations: [
          {
            _tag: "Update" as const,
            key: "atlas",
            previous,
            value: next,
            changes: { progress: 90 }
          }
        ]
      },
      rollbackRows: [
        {
          key: "atlas",
          row: {
            key: "atlas",
            value: previous,
            synced: true,
            origin: "remote" as const
          }
        }
      ],
      createdAt: 1,
      attempts: 0
    };
    const payload = {
      collections: [
        {
          name: "Projects.snapshot-codec-duplicate-pending-id",
          rows: [
            {
              key: "atlas",
              value: previous,
              synced: true,
              origin: "remote" as const
            }
          ],
          pendingMutations: [pending, pending],
          updatedAt: 1
        }
      ]
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const validationFailure = yield* Effect.flip(
          Collection.validateHydrationPayloadEffect([Projects], payload)
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(Collection.hydratePayloadEffect([Projects], payload))
        );

        expect(validationFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(validationFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          path: "$.collections[0].pendingMutations[1].transaction.id"
        });
        expect(hydrateFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(["existing"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("preflights multi-collection hydration before mutating any collection", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-preflight-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false }
      ]
    });
    const task: Task = { id: "task-1", projectId: "atlas", title: "Plan", done: false };
    const nextTask: Task = { ...task, done: true };
    const pending = {
      transaction: {
        id: "tx:duplicate",
        collection: "Tasks.snapshot-codec-preflight-tasks",
        mutations: [
          {
            _tag: "Update" as const,
            key: "task-1",
            previous: task,
            value: nextTask,
            changes: { done: true }
          }
        ]
      },
      rollbackRows: [
        {
          key: "task-1",
          row: {
            key: "task-1",
            value: task,
            synced: true,
            origin: "remote" as const
          }
        }
      ],
      createdAt: 1,
      attempts: 0
    };

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
                  origin: "remote" as const
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            },
            {
              name: "Tasks.snapshot-codec-preflight-tasks",
              rows: [
                {
                  key: "task-1",
                  value: task,
                  synced: true,
                  origin: "remote" as const
                }
              ],
              pendingMutations: [pending, pending],
              updatedAt: 1
            }
          ]
        };
        const failure = yield* Effect.flip(
          runtime.provide(Collection.hydratePayloadEffect([Projects, Tasks], payload))
        );

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
          "existing-project"
        ]);
        expect(runWithRuntime(runtime, () => Tasks.rows().map((taskRow) => taskRow.id))).toEqual([
          "existing-task"
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("holds durable permits for a full multi-collection hydration payload", () => {
    const runtime = makeRuntime();
    const storeExplicitHydrateStarted = Effect.runSync(Deferred.make<void>());
    const releaseStoreExplicitHydrate = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-payload-atomic-projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-payload-atomic-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false }
      ]
    });
    const snapshotFromStore: StoreExplicitCollectionSnapshotImplementation<Task, string>["snapshotWithStore"] = (
      store,
      updatedAt
    ) => ({
      name: Tasks.name,
      rows: Array.from(store.state(Tasks).rows.values()).map((row) => ({
        key: row.key,
        value: row.value,
        synced: row.synced,
        origin: row.origin
      })),
      pendingMutations: [],
      updatedAt
    });
    Object.assign(Tasks, {
      snapshotWithStore: snapshotFromStore,
      snapshotWithStoreEffect: (store, updatedAt) => Effect.succeed(snapshotFromStore(store, updatedAt)),
      hydratePreflightEffect: () => Effect.void,
      hydrateWithStoreEffect: (store, snapshot, options) =>
        Deferred.succeed(storeExplicitHydrateStarted, undefined).pipe(
          Effect.flatMap(() => Deferred.await(releaseStoreExplicitHydrate)),
          Effect.flatMap(() => {
            const state = store.state(Tasks);
            return hydrateCollectionSnapshotStateEffect(
              state,
              snapshot,
              options,
              (id) => advanceCollectionTransactionIdentity(state, id)
            );
          }),
          Effect.asVoid
        ),
      durableSnapshotSources: () => [Tasks]
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
                  origin: "remote" as const
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            },
            {
              name: Tasks.name,
              rows: [
                {
                  key: "task-1",
                  value: { id: "task-1", projectId: "atlas", title: "Plan", done: false },
                  synced: true,
                  origin: "remote" as const
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            }
          ]
        };

        const hydrate = runtime.runFork(Collection.hydratePayloadEffect([Projects, Tasks], payload));
        yield* Deferred.await(storeExplicitHydrateStarted);

        const dehydrate = runtime.runFork(Collection.dehydrateEffect([Projects, Tasks]).pipe(Effect.exit));
        const earlyDehydrate = yield* Fiber.await(dehydrate).pipe(Effect.timeoutOption("20 millis"));
        expect(Option.isNone(earlyDehydrate)).toBe(true);

        yield* Deferred.succeed(releaseStoreExplicitHydrate, undefined).pipe(Effect.ignore);
        yield* Fiber.join(hydrate);
        const dehydrateExit = yield* Fiber.join(dehydrate);

        if (Exit.isFailure(dehydrateExit)) {
          expect.fail("Expected dehydrate to succeed after payload hydration completed.");
        }
        expect(dehydrateExit.value.collections.map((snapshot) => snapshot.rows.map((row) => row.key))).toEqual([
          ["atlas"],
          ["task-1"]
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("preflights incomplete store-explicit payload hydration before mutating earlier collections", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-store-explicit-projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.snapshot-codec-preflight-store-explicit-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "existing-task", projectId: "existing-project", title: "Existing", done: false }
      ]
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
                  origin: "remote" as const
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            },
            {
              name: "Tasks.snapshot-codec-preflight-store-explicit-tasks",
              rows: [
                {
                  key: "task-1",
                  value: { id: "task-1", projectId: "atlas", title: "Plan", done: false },
                  synced: true,
                  origin: "remote" as const
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            }
          ]
        };
        const validationFailure = yield* Effect.flip(
          runtime.provide(Collection.validateHydrationPayloadEffect([Projects, Tasks], payload))
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(Collection.hydratePayloadEffect([Projects, Tasks], payload))
        );

        for (const failure of [validationFailure, hydrateFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            operation: "hydrate",
            path: "$"
          });
          expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
          expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStoreEffect");
          expect((failure as CollectionSnapshotCodecError).reason).toContain("hydratePreflightEffect");
          expect((failure as CollectionSnapshotCodecError).reason).toContain("hydrateWithStoreEffect");
        }
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
          "existing-project"
        ]);
        expect(runWithRuntime(runtime, () => Tasks.rows().map((task) => task.id))).toEqual([
          "existing-task"
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("applies complete store-explicit hydration through the store-aware adapter", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-store-explicit-hydrate-apply",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
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
        pendingMutations: [],
        updatedAt
      }),
      snapshotWithStoreEffect: (_store, updatedAt) =>
        Effect.succeed({
          name: Projects.name,
          rows: [],
          pendingMutations: [],
          updatedAt
        }),
      hydratePreflightEffect: () => Effect.void,
      hydrateWithStoreEffect: (store, snapshot, options) =>
        Effect.sync(() => {
          calls.push({
            existingKeys: Array.from(store.state(Projects).rows.keys()),
            hydrateKeys: snapshot.rows.map((row) => row.key),
            replace: options.replace
          });
        })
    } satisfies StoreExplicitCollectionSnapshotImplementation<Project, string>;
    Object.assign(Projects, implementation);
    markStoreExplicitCollectionSnapshotDefinition(Projects);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.hydrateEffect({
          name: Projects.name,
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
              synced: true,
              origin: "remote"
            }
          ],
          pendingMutations: [],
          updatedAt: 1
        }, { replace: false }));

        expect(calls).toEqual([
          {
            existingKeys: ["existing-project"],
            hydrateKeys: ["atlas"],
            replace: false
          }
        ]);
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
          "existing-project"
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("preflights merge hydration pending id collisions before mutating earlier collections", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-merge-projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const Tasks = Collection.define<Task, string, string>({
      name: "Tasks.snapshot-codec-preflight-merge-tasks",
      getKey: (task) => task.id,
      initialData: [
        { id: "task-1", projectId: "existing-project", title: "Existing", done: false }
      ],
      onUpdate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Tasks.updateEffect("task-1", { done: true }));
      await Effect.runPromise(Deferred.await(started));
      const tasksSnapshot = runWithRuntime(runtime, () => Tasks.snapshot());
      const payload = {
        collections: [
          {
            name: "Projects.snapshot-codec-preflight-merge-projects",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                synced: true,
                origin: "remote" as const
              }
            ],
            pendingMutations: [],
            updatedAt: 1
          },
          tasksSnapshot
        ]
      };

      const validationFailure = await runInRuntime(
        runtime,
        Effect.flip(Collection.validateHydrationPayloadEffect([Projects, Tasks], payload, { replace: false }))
      );
      const hydrateFailure = await runInRuntime(
        runtime,
        Effect.flip(Collection.hydratePayloadEffect([Projects, Tasks], payload, { replace: false }))
      );

      for (const failure of [validationFailure, hydrateFailure]) {
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          path: "$.pendingMutations[0].transaction.id"
        });
      }
      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
        "existing-project"
      ]);
      expect(runWithRuntime(runtime, () => Tasks.pendingMutations())).toHaveLength(1);
    } finally {
      Effect.runSync(Deferred.fail(release, "cleanup").pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("preflights read-only live query collection hydration before mutating earlier collections", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-preflight-live-projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing-project", name: "Existing", status: "active", progress: 1 }
      ]
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.snapshot-codec-preflight-live",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => eq(project.status, "active"))
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
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
              origin: "remote" as const
            }
          ],
          pendingMutations: [],
          updatedAt: 1
        },
        {
          name: "ProjectCards.snapshot-codec-preflight-live",
          rows: [],
          pendingMutations: [],
          updatedAt: 1
        }
      ]
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const validationFailure = yield* Effect.flip(
          runtime.provide(Collection.validateHydrationPayloadEffect([Projects, ActiveProjectCards], payload))
        );
        const hydrateFailure = yield* Effect.flip(
          runtime.provide(Collection.hydratePayloadEffect([Projects, ActiveProjectCards], payload))
        );

        for (const failure of [validationFailure, hydrateFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "hydrate",
            path: "$"
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
          "existing-project"
        ]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("reports snapshot hydrate getKey throws through the EffectInput callback error policy", () => {
    const runtime = makeRuntime();
    const thrown = new Error("hydrate key failed");
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-key-callback",
      getKey: () => {
        throw thrown;
      }
    });
    const snapshot = {
      name: "Projects.snapshot-codec-key-callback",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          synced: true,
          origin: "remote" as const
        }
      ],
      pendingMutations: [],
      updatedAt: 1
    };
    const payload = { collections: [snapshot] };
    const storage = Collection.memoryStorage([[
      "effect-ui:collection:Projects.snapshot-codec-key-callback",
      JSON.stringify(snapshot)
    ]]);

    return Effect.runPromise(
      Effect.gen(function* () {
        const hydrateFailure = yield* Effect.flip(runtime.provide(Projects.hydrateEffect(snapshot)));
        const payloadFailure = yield* Effect.flip(
          runtime.provide(Collection.hydratePayloadEffect([Projects], payload))
        );
        const validateFailure = yield* Effect.flip(
          Collection.validateHydrationPayloadEffect([Projects], payload)
        );
        const restoreFailure = yield* Effect.flip(
          runtime.provide(Projects.restoreEffect(storage))
        );

        for (const failure of [hydrateFailure, payloadFailure, validateFailure, restoreFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            _tag: "EffectInputCallbackError",
            operation: "Collection.hydrate(Projects.snapshot-codec-key-callback).getKey",
            cause: thrown
          });
        }
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("fails malformed hydration payloads through the hydrate Effect error channel", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-payload-invalid",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            Collection.hydratePayloadEffect([Projects], {
              collections: [
                {
                  name: "Projects.snapshot-codec-payload-invalid",
                  // @ts-expect-error runtime validation rejects malformed payload rows.
                  rows: "not-rows",
                  pendingMutations: [],
                  updatedAt: 1
                }
              ]
            })
          )
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
            path: "$.collections[0].rows"
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects duplicate collection snapshots in hydration payloads", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.snapshot-codec-duplicate-payload",
      getKey: (project) => project.id,
      initialData: [
        { id: "existing", name: "Existing", status: "active", progress: 1 }
      ]
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const snapshot = {
          name: "Projects.snapshot-codec-duplicate-payload",
          rows: [],
          pendingMutations: [],
          updatedAt: 1
        };
        const exit = yield* Effect.exit(
          runtime.provide(Collection.hydratePayloadEffect([Projects], {
            collections: [snapshot, snapshot]
          }))
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          path: "$.collections[1].name"
        });
        expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(["existing"]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects duplicate collection definitions during hydration planning", () => {
    const runtime = makeRuntime();
    const name = "Projects.snapshot-codec-duplicate-definition";
    const Projects = Collection.define<Project>({
      name,
      getKey: (project) => project.id
    });
    const ShadowProjects = Collection.define<{ readonly slug: string; readonly title: string }>({
      name,
      getKey: (project) => project.slug
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(Collection.hydratePayloadEffect([Projects, ShadowProjects], {
            collections: [
              {
                name,
                rows: [],
                pendingMutations: [],
                updatedAt: 1
              }
            ]
          }))
        );

        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit)
          ? exit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "hydrate",
          path: "$.collections"
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("validates collection input schema before local mutation and direct write", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.input-schema-validation",
      getKey: (project) => project.id,
      input: ProjectSchema
    });
    const invalid = {
      id: "atlas",
      name: 123,
      status: "active",
      progress: 72
    } as never;

    return Effect.runPromise(
      Effect.gen(function* () {
        const insertExit = yield* Effect.exit(runtime.provide(Projects.insertEffect(invalid)));
        const writeExit = yield* Effect.exit(runtime.provide(Projects.writeInsertEffect(invalid)));

        expect(Exit.isFailure(insertExit)).toBe(true);
        expect(Exit.isFailure(writeExit)).toBe(true);
        const insertFailure = Exit.isFailure(insertExit)
          ? insertExit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        const writeFailure = Exit.isFailure(writeExit)
          ? writeExit.cause.reasons.find(Cause.isFailReason)?.error
          : undefined;
        expect(insertFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(writeFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("uses decoded update values for optimistic replay and update handlers", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    const updates: Array<{
      readonly value: Project;
      readonly changes: Partial<Project>;
    }> = [];
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    const Projects = Collection.define<Project>({
      name: "Projects.update-decoded-values",
      getKey: (project) => project.id,
      input: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        status: Schema.Literals(["active", "blocked"]),
        progress: Schema.NumberFromString
      }),
      output: ProjectSchema,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (entries) => {
        updates.push(...entries);
        return Deferred.await(release);
      }
    });

    try {
      update = Effect.runFork(
        Projects.updateEffect("atlas", { progress: "80" } as never)
      );
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(Projects.get("atlas")).toMatchObject({
        progress: 80,
        $synced: false,
        $origin: "local"
      });
      expect(updates).toMatchObject([
        {
          value: { id: "atlas", name: "Atlas", status: "active", progress: 80 },
          changes: { progress: 80 }
        }
      ]);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
    }
  });

  it("detaches and freezes mutation handler DTOs from pending, rollback, and restored flush facts", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const key = "projects.mutation-handler-dto-ownership";
    let blockHandler = true;
    const seen: Array<{
      readonly valueProgress: number | undefined;
      readonly changesProgress: number | undefined;
      readonly transactionChangesProgress: number | undefined;
      readonly frozen: boolean;
      readonly mutationCount: number;
    }> = [];
    const corrupt = (
      updates: ReadonlyArray<{
        readonly key: string;
        readonly value: Project;
        readonly previous: Project;
        readonly changes: Partial<Project>;
      }>,
      context: Collection.MutationContext<Project, string>
    ): void => {
      const update = updates[0];
      const mutation = context.transaction.mutations[0];
      seen.push({
        valueProgress: update?.value.progress,
        changesProgress: update?.changes.progress,
        transactionChangesProgress: mutation?._tag === "Update" ? mutation.changes.progress : undefined,
        frozen: Object.isFrozen(updates) &&
          Object.isFrozen(update) &&
          Object.isFrozen(update?.value) &&
          Object.isFrozen(update?.previous) &&
          Object.isFrozen(update?.changes) &&
          Object.isFrozen(context) &&
          Object.isFrozen(context.transaction) &&
          Object.isFrozen(context.transaction.mutations) &&
          Object.isFrozen(mutation),
        mutationCount: context.transaction.mutations.length
      });

      try {
        (updates as Array<unknown>).push({ key: "evil" });
      } catch {
        // Frozen public DTOs may throw; clone-only DTOs still must not affect store facts.
      }
      try {
        (update!.value as { progress: number }).progress = 999;
      } catch {
        // See comment above.
      }
      try {
        (update!.previous as { progress: number }).progress = 999;
      } catch {
        // See comment above.
      }
      try {
        (update!.changes as { progress: number }).progress = 999;
      } catch {
        // See comment above.
      }
      try {
        (context.transaction.mutations as Array<unknown>).push({ _tag: "Delete", key: "evil" });
      } catch {
        // See comment above.
      }
      try {
        ((mutation as Extract<Collection.Mutation<Project, string>, { _tag: "Update" }>).changes as { progress: number }).progress = 999;
      } catch {
        // See comment above.
      }
    };

    const Projects = Collection.define<Project>({
      name: "Projects.mutation-handler-dto-ownership",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        key,
        persistOnMutation: true
      },
      onUpdate: (updates, context) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => corrupt(updates, context));
          yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
          if (blockHandler) {
            yield* Deferred.await(release);
          }
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    let firstDisposed = false;
    let secondDisposed = false;

    try {
      update = first.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await runInRuntime(first, Deferred.await(entered));

      const pending = runWithRuntime(first, () => Projects.pendingMutations()[0]);
      const persisted = JSON.parse(storage.values.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(seen[0]).toEqual({
        valueProgress: 80,
        changesProgress: 80,
        transactionChangesProgress: 80,
        frozen: true,
        mutationCount: 1
      });
      expect(pending?.transaction.mutations[0]).toMatchObject({
        _tag: "Update",
        key: "atlas",
        value: { progress: 80 },
        previous: { progress: 72 },
        changes: { progress: 80 }
      });
      expect(pending?.rollbackRows[0]?.row?.value.progress).toBe(72);
      expect(persisted.pendingMutations[0]?.transaction.mutations[0]).toMatchObject({
        _tag: "Update",
        key: "atlas",
        value: { progress: 80 },
        previous: { progress: 72 },
        changes: { progress: 80 }
      });
      expect(persisted.pendingMutations[0]?.rollbackRows[0]?.row?.value.progress).toBe(72);

      await Effect.runPromise(first.disposeEffect);
      firstDisposed = true;
      blockHandler = false;

      await runInRuntime(second, Projects.restoreEffect(storage, { key }));
      await runInRuntime(second, Projects.flushPendingMutationsEffect());

      expect(seen[1]).toEqual({
        valueProgress: 80,
        changesProgress: 80,
        transactionChangesProgress: 80,
        frozen: true,
        mutationCount: 1
      });
      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true
      });
      expect(runWithRuntime(second, () => Projects.pendingMutations())).toEqual([]);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update).pipe(Effect.ignore));
      }
      if (!firstDisposed) {
        await Effect.runPromise(first.disposeEffect);
      }
      if (!secondDisposed) {
        await Effect.runPromise(second.disposeEffect);
        secondDisposed = true;
      }
    }
  });

  it("canonicalizes hydrated pending update changes after schema decoding", async () => {
    const runtime = makeRuntime();
    const handled: Array<{
      readonly value: Project;
      readonly changes: Partial<Project>;
    }> = [];
    const WireProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.Literals(["active", "blocked"]),
      progress: Schema.Union([Schema.Number, Schema.NumberFromString])
    });
    const Projects = Collection.define<Project>({
      name: "Projects.hydrated-update-decoded-changes",
      getKey: (project) => project.id,
      output: WireProjectSchema,
      onUpdate: (entries) =>
        Effect.sync(() => {
          handled.push(...entries);
        })
    });
    const previous = { id: "atlas", name: "Atlas", status: "active", progress: "72" } as never as Project;
    const value = { id: "atlas", name: "Atlas", status: "active", progress: "80" } as never as Project;

    try {
      await runInRuntime(runtime, Projects.hydrateEffect({
        name: "Projects.hydrated-update-decoded-changes",
        rows: [
          {
            key: "atlas",
            value,
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "ctx_1",
              collection: "Projects.hydrated-update-decoded-changes",
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous,
                  value,
                  changes: { progress: "80" } as never
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: previous,
                  synced: true,
                  origin: "remote"
                }
              }
            ],
            createdAt: 1,
            attempts: 0
          }
        ],
        updatedAt: 1
      }));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: false
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations()[0]?.transaction.mutations[0])).toMatchObject({
        _tag: "Update",
        previous: { progress: 72 },
        value: { progress: 80 },
        changes: { progress: 80 }
      });

      await runInRuntime(runtime, Projects.flushPendingMutationsEffect());

      expect(handled).toMatchObject([
        {
          value: { progress: 80 },
          changes: { progress: 80 }
        }
      ]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("fails hydration payloads when a snapshot has no matching collection definition", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.payload-missing-definition",
      getKey: (project) => project.id
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(
            Collection.hydratePayloadEffect([Projects], {
              collections: [
                {
                  name: "Projects.payload-missing-definition",
                  rows: [
                    {
                      key: "atlas",
                      value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                      synced: true,
                      origin: "remote"
                    }
                  ],
                  pendingMutations: [],
                  updatedAt: 1
                },
                {
                  name: "Tasks.payload-missing-definition",
                  rows: [],
                  pendingMutations: [],
                  updatedAt: 1
                }
              ]
            })
          )
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
            path: "$.collections[1].name"
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("preserves collection output schema failures while hydrating, loading, and writing rows", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.schema-validation",
      output: ProjectRowsSchema,
      getKey: (project) => project.id
    });
    const PersistedProjects = Collection.define<Project>({
      name: "Projects.schema-validation-persisted",
      output: ProjectRowsSchema,
      getKey: (project) => project.id
    });
    const LoadingProjects = Collection.define<Project>({
      name: "Projects.schema-validation-load",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
      load: () => Effect.succeed<ReadonlyArray<Project>>([
        {
          id: "atlas",
          name: "Atlas",
          status: "active",
          progress: "bad"
        } as unknown as Project
      ])
    });
    const RefetchProjects = Collection.define<Project>({
      name: "Projects.schema-validation-refetch",
      output: ProjectRowsSchema,
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      load: () => Effect.succeed<ReadonlyArray<Project>>([
        {
          id: "lumen",
          name: "Lumen",
          status: "blocked",
          progress: "bad"
        } as unknown as Project
      ])
    });
    const invalidProject = {
      id: "atlas",
      name: "Atlas",
      status: "active",
      progress: "bad"
    } as unknown as Project;
    const storage = Collection.memoryStorage([[
      "projects-schema-validation",
      JSON.stringify({
        name: "Projects.schema-validation-persisted",
        rows: [
          {
            key: "atlas",
            value: invalidProject,
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [],
        updatedAt: 1
      })
    ]]);

    return Effect.runPromise(
      Effect.gen(function* () {
        const [
          hydrateFailure,
          restoreFailure,
          preloadFailure,
          refetchFailure,
          insertFailure,
          writeInsertFailure,
          applyChangesFailure,
          changeFeedFailure
        ] = yield* Effect.all([
          Effect.flip(runtime.provide(
            Projects.hydrateEffect({
              name: "Projects.schema-validation",
              rows: [
                {
                  key: "atlas",
                  value: invalidProject,
                  synced: true,
                  origin: "remote"
                }
              ],
              pendingMutations: [],
              updatedAt: 1
            })
          )),
          Effect.flip(runtime.provide(
            PersistedProjects.restoreEffect(storage, { key: "projects-schema-validation" })
          )),
          Effect.flip(runtime.provide(LoadingProjects.preloadEffect())),
          Effect.flip(runtime.provide(RefetchProjects.refetchEffect())),
          Effect.flip(runtime.provide(Projects.insertEffect(invalidProject))),
          Effect.flip(runtime.provide(Projects.writeInsertEffect(invalidProject))),
          Effect.flip(runtime.provide(Collection.applyChangesEffect(Projects, [
            { _tag: "Upsert", value: invalidProject }
          ]))),
          Effect.flip(runtime.provide(Effect.scoped(
            Collection.subscribeChangesEffect(Projects, {
              name: "Projects.schema-validation-feed",
              subscribe: ({ emit }) =>
                emit([{ _tag: "Upsert", value: invalidProject }])
            })
          )))
        ]);

        yield* runtime.provide(Projects.writeInsertEffect({
          id: "atlas",
          name: "Atlas",
          status: "active",
          progress: 72
        }));
        const updateFailure = yield* Effect.flip(
          runtime.provide(Projects.updateEffect("atlas", { progress: "bad" } as unknown as Partial<Project>))
        );
        const writeUpdateFailure = yield* Effect.flip(
          runtime.provide(
            Projects.writeUpdateEffect("atlas", { progress: "bad" } as unknown as Partial<Project>)
          )
        );

        yield* Effect.sync(() => {
          for (const failure of [
            hydrateFailure,
            restoreFailure,
            preloadFailure,
            refetchFailure,
            insertFailure,
            writeInsertFailure,
            applyChangesFailure,
            changeFeedFailure,
            updateFailure,
            writeUpdateFailure
          ]) {
            expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
            expect((failure as CollectionSnapshotCodecError).reason).toContain("progress");
          }
          expect(runWithRuntime(runtime, () => LoadingProjects.state().get())).toMatchObject({
            _tag: "Failure",
            error: preloadFailure
          });
          expect(runWithRuntime(runtime, () => RefetchProjects.state().get())).toMatchObject({
            _tag: "Failure",
            error: refetchFailure
          });
          expect(runWithRuntime(runtime, () => Projects.rows())).toMatchObject([
            { id: "atlas", progress: 72 }
          ]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("accepts collection output schemas as row schemas", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.row-schema-validation",
      output: ProjectSchema,
      getKey: (project) => project.id,
      load: () => Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        yield* runtime.provide(Projects.writeInsertEffect({
          id: "kepler",
          name: "Kepler",
          status: "blocked",
          progress: 34
        }));

        yield* Effect.sync(() => {
          expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
            "atlas",
            "kepler"
          ]);
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("rejects hostile direct-write update patches before persistence", () => {
    const runtime = makeRuntime();
    const getterFailure = new Error("patch getter failed");
    let writes = 0;
    const storage: Collection.PersistenceStorage = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      }
    };
    const Projects = Collection.define<Project>({
      name: "Projects.hostile-write-update-patch",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        persistOnWrite: true
      }
    });
    const changes = Object.defineProperty({}, "progress", {
      enumerable: true,
      get: () => {
        throw getterFailure;
      }
    }) as Partial<Project>;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          runtime.provide(Projects.writeUpdateEffect("atlas", changes))
        );

        expect(failure).toBeInstanceOf(EffectInputCallbackError);
        expect((failure as EffectInputCallbackError).operation).toBe(
          "Collection.update(Projects.hostile-write-update-patch)"
        );
        expect((failure as EffectInputCallbackError).cause).toBe(getterFailure);
        expect(writes).toBe(0);
        expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
          id: "atlas",
          progress: 72,
          $synced: true
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("does not roll back a committed mutation when post-commit persistence fails", () => {
    const runtime = makeRuntime();
    let writes = 0;
    let updates = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return writes === 2 ? Effect.fail("persist-failed" as const) : Effect.void;
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.persist-post-commit-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage
      },
      onUpdate: () =>
        Effect.sync(() => {
          updates += 1;
        })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          runtime.provide(Projects.updateEffect("atlas", { progress: 90 }))
        );
        const pending = yield* runtime.provide(Projects.pendingMutationsEffect());

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          const failure = Exit.isFailure(exit)
            ? exit.cause.reasons.find(Cause.isFailReason)?.error
            : undefined;
          expect(failure).toBe("persist-failed");
          expect(updates).toBe(1);
          expect(writes).toBe(2);
          expect(pending).toEqual([]);
          expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
            progress: 90,
            $synced: true,
            $origin: "local"
          });
        });
      }).pipe(
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("does not publish mutation success or dequeue events before post-commit persistence succeeds", () => {
    const runtime = makeRuntime();
    let writes = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return writes === 2 ? Effect.fail("persist-failed" as const) : Effect.void;
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.persist-post-commit-events",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage
      },
      onUpdate: () => Effect.void
    });

    return Effect.runPromise(
      runtime.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Collection.subscribeEventsEffect();
            const failure = yield* Effect.flip(Projects.updateEffect("atlas", { progress: 90 }));
            const events: Array<Collection.StoreEvent> = [];
            for (let index = 0; index < 5; index++) {
              const event = yield* PubSub.take(subscription).pipe(
                Effect.timeoutOption("20 millis")
              );
              if (Option.isNone(event)) {
                break;
              }
              events.push(event.value);
            }

            expect(failure).toBe("persist-failed");
            expect(events.map((event) => event._tag)).toEqual([
              "CollectionPersisted",
              "CollectionMutationQueued",
              "CollectionMutateStarted"
            ]);
            expect(events.some((event) => event._tag === "CollectionMutationDequeued")).toBe(false);
            expect(events.some((event) => event._tag === "CollectionMutateCommitted")).toBe(false);
          })
        ).pipe(
          Effect.ensuring(runtime.disposeEffect)
        )
      )
    );
  });

  it("completes mutation joiners when post-commit persistence fails", async () => {
    const runtime = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return writes === 2 ? Effect.fail("persist-failed" as const) : Effect.void;
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.persist-post-commit-joiner-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage
      },
      onUpdate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
          yield* Deferred.await(release);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    let flush: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(entered));
      flush = runtime.runFork(Projects.flushPendingMutationsEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(release, undefined));

      const owner = await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("1 second")));
      const joiner = await Effect.runPromise(Fiber.await(flush).pipe(Effect.timeoutOption("1 second")));

      if (Option.isNone(owner) || Option.isNone(joiner)) {
        expect.fail("Expected mutation owner and joiner to terminate.");
      }
      const ownerFailure = Exit.isFailure(owner.value)
        ? owner.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      const joinerFailure = Exit.isFailure(joiner.value)
        ? joiner.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;

      expect(ownerFailure).toBe("persist-failed");
      expect(joinerFailure).toBe("persist-failed");
      expect(writes).toBe(2);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("100 millis")));
      }
      if (flush !== undefined) {
        await Effect.runPromise(Fiber.await(flush).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("preserves active mutation joiners when rollback restores pending state", async () => {
    const runtime = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    let handlerCalls = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return writes === 2 ? Effect.fail("persist-failed" as const) : Effect.void;
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.rollback-preserves-active-attempt",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        persistOnMutation: true,
        persistOnWrite: true
      },
      onUpdate: () =>
        Effect.gen(function* () {
          handlerCalls += 1;
          yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
          yield* Deferred.await(release);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    let flush: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* Collection.subscribeEventsEffect();
              update = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
              yield* Deferred.await(entered);

              const writeFailure = yield* Effect.flip(
                runtime.provide(Projects.writeUpdateEffect("atlas", { name: "Direct Write" }))
              );
              flush = runtime.runFork(Projects.flushPendingMutationsEffect());
              yield* Effect.sleep("20 millis");

              expect(writeFailure).toBe("persist-failed");
              expect(handlerCalls).toBe(1);

              yield* Deferred.succeed(release, undefined);
              const owner = yield* Fiber.await(update).pipe(Effect.timeoutOption("1 second"));
              const joiner = yield* Fiber.await(flush).pipe(Effect.timeoutOption("1 second"));
              if (Option.isNone(owner) || Option.isNone(joiner)) {
                expect.fail("Expected mutation owner and flush joiner to terminate.");
              }

              const events: Array<Collection.StoreEvent> = [];
              for (let index = 0; index < 8; index++) {
                const event = yield* PubSub.take(subscription).pipe(
                  Effect.timeoutOption("20 millis")
                );
                if (Option.isNone(event)) {
                  break;
                }
                events.push(event.value);
              }
              const started = events.filter((event) => event._tag === "CollectionMutateStarted");

              expect(handlerCalls).toBe(1);
              expect(started).toHaveLength(1);
              expect(writes).toBe(3);
              expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
              expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
                progress: 90,
                $synced: true
              });
            })
          )
        )
      );
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("100 millis")));
      }
      if (flush !== undefined) {
        await Effect.runPromise(Fiber.await(flush).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("serializes public persist snapshots behind failing durable writes", async () => {
    const runtime = makeRuntime();
    const key = "projects-public-persist-serialization-cache";
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const releaseWrite = Effect.runSync(Deferred.make<void>());
    const persisted = new Map<string, string>();
    let writes = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => persisted.get(key) ?? null,
      setItem: (storageKey, value) => {
        writes += 1;
        if (writes === 1) {
          return Effect.gen(function* () {
            yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
            yield* Deferred.await(releaseWrite);
            return yield* Effect.fail("persist-failed" as const);
          });
        }
        return Effect.sync(() => {
          persisted.set(storageKey, value);
        });
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.public-persist-serialization",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        key,
        persistOnWrite: true
      }
    });
    let write: Fiber.Fiber<unknown, unknown> | undefined;
    let persist: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      write = runtime.runFork(Projects.writeUpdateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(writeStarted));
      persist = runtime.runFork(Projects.persistEffect(storage, { key }));
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseWrite, undefined));
      const writeExit = await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("1 second")));
      const persistExit = await Effect.runPromise(Fiber.await(persist).pipe(Effect.timeoutOption("1 second")));
      if (Option.isNone(writeExit) || Option.isNone(persistExit)) {
        expect.fail("Expected write and public persist to terminate.");
      }

      const writeFailure = Exit.isFailure(writeExit.value)
        ? writeExit.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      const snapshot = JSON.parse(persisted.get(key) ?? "{}") as Collection.Snapshot<Project, string>;
      expect(writeFailure).toBe("persist-failed");
      expect(snapshot.rows.map((row) => row.value.progress)).toEqual([72]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore));
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      if (persist !== undefined) {
        await Effect.runPromise(Fiber.await(persist).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("restores direct-write state when write persistence is interrupted", async () => {
    const runtime = makeRuntime();
    const key = "projects-direct-write-interrupt-cache";
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const storage: Collection.PersistenceStorage = {
      getItem: () => null,
      setItem: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
          return yield* Effect.never;
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.direct-write-interrupt-rollback",
      getKey: (project) => project.id,
      persistence: {
        storage,
        key,
        persistOnWrite: true
      }
    });
    let write: Fiber.Fiber<void, unknown> | undefined;

    try {
      write = runtime.runFork(Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));
      await Effect.runPromise(Deferred.await(writeStarted));

      await Effect.runPromise(Fiber.interrupt(write));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toBeUndefined();
      expect(runWithRuntime(runtime, () => Projects.rows())).toEqual([]);
    } finally {
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis"), Effect.ignore));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("restores optimistic mutation state when initial mutation persistence is interrupted", async () => {
    const runtime = makeRuntime();
    const key = "projects-mutation-enqueue-interrupt-cache";
    const persistStarted = Effect.runSync(Deferred.make<void>());
    const storage: Collection.PersistenceStorage = {
      getItem: () => null,
      setItem: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(persistStarted, undefined).pipe(Effect.ignore);
          return yield* Effect.never;
        })
    };
    const Projects = Collection.define<Project>({
      name: "Projects.mutation-enqueue-interrupt-rollback",
      getKey: (project) => project.id,
      persistence: {
        storage,
        key,
        persistOnMutation: true
      }
    });
    let mutation: Fiber.Fiber<Collection.Transaction<Project, string>, unknown> | undefined;

    try {
      mutation = runtime.runFork(Projects.insertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));
      await Effect.runPromise(Deferred.await(persistStarted));

      await Effect.runPromise(Fiber.interrupt(mutation));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toBeUndefined();
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
    } finally {
      if (mutation !== undefined) {
        await Effect.runPromise(Fiber.await(mutation).pipe(Effect.timeoutOption("100 millis"), Effect.ignore));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("serializes public hydrate behind failing durable writes", async () => {
    const runtime = makeRuntime();
    const writeStarted = Effect.runSync(Deferred.make<void>());
    const releaseWrite = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return Effect.gen(function* () {
          yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(releaseWrite);
          return yield* Effect.fail("persist-failed" as const);
        });
      }
    };
    const Projects = Collection.define<Project, string, "persist-failed">({
      name: "Projects.public-hydrate-serialization",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage,
        persistOnWrite: true
      }
    });
    const hydratedSnapshot: Collection.Snapshot<Project, string> = {
      name: "Projects.public-hydrate-serialization",
      rows: [
        {
          key: "atlas",
          value: { id: "atlas", name: "Hydrated", status: "active", progress: 11 },
          synced: true,
          origin: "remote"
        }
      ],
      pendingMutations: [],
      updatedAt: 123
    };
    let write: Fiber.Fiber<unknown, unknown> | undefined;
    let hydrate: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      write = runtime.runFork(Projects.writeUpdateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(writeStarted));
      hydrate = runtime.runFork(Projects.hydrateEffect(hydratedSnapshot));
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(releaseWrite, undefined));
      const writeExit = await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("1 second")));
      const hydrateExit = await Effect.runPromise(Fiber.await(hydrate).pipe(Effect.timeoutOption("1 second")));
      if (Option.isNone(writeExit) || Option.isNone(hydrateExit)) {
        expect.fail("Expected write and public hydrate to terminate.");
      }

      const writeFailure = Exit.isFailure(writeExit.value)
        ? writeExit.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      expect(writeFailure).toBe("persist-failed");
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Hydrated",
        progress: 11
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore));
      if (write !== undefined) {
        await Effect.runPromise(Fiber.await(write).pipe(Effect.timeoutOption("100 millis")));
      }
      if (hydrate !== undefined) {
        await Effect.runPromise(Fiber.await(hydrate).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("clears interrupted active mutation attempts so pending flush can retry", async () => {
    const runtime = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    let attempts = 0;
    const Projects = Collection.define<Project>({
      name: "Projects.interrupted-mutation-flush-retry",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () => {
        const attempt = ++attempts;
        return Effect.gen(function* () {
          if (attempt === 1) {
            yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
            yield* Effect.never.pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)
              )
            );
          }
        });
      }
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(entered));
      await Effect.runPromise(Fiber.interrupt(update));
      await Effect.runPromise(Deferred.await(interrupted));

      const flush = await Effect.runPromise(
        runtime.provide(Projects.flushPendingMutationsEffect().pipe(Effect.timeoutOption("1 second")))
      );

      if (Option.isNone(flush)) {
        expect.fail("Expected flush to retry after interrupted mutation owner.");
      }
      expect(attempts).toBe(2);
      expect(flush.value).toHaveLength(1);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: true
      });
    } finally {
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("completes mutation joiners when rollback persistence fails", async () => {
    const runtime = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    let writes = 0;
    const storage: Collection.PersistenceStorage<"persist-failed"> = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        return writes === 2 ? Effect.fail("persist-failed" as const) : Effect.void;
      }
    };
    const Projects = Collection.define<Project, string, "remote-failed" | "persist-failed">({
      name: "Projects.persist-rollback-joiner-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      persistence: {
        storage
      },
      onUpdate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
          yield* Deferred.await(release);
          return yield* Effect.fail("remote-failed" as const);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    let flush: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(entered));
      flush = runtime.runFork(Projects.flushPendingMutationsEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      Effect.runSync(Deferred.succeed(release, undefined));

      const owner = await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("1 second")));
      const joiner = await Effect.runPromise(Fiber.await(flush).pipe(Effect.timeoutOption("1 second")));

      if (Option.isNone(owner) || Option.isNone(joiner)) {
        expect.fail("Expected mutation owner and joiner to terminate.");
      }
      const ownerFailure = Exit.isFailure(owner.value)
        ? owner.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;
      const joinerFailure = Exit.isFailure(joiner.value)
        ? joiner.value.cause.reasons.find(Cause.isFailReason)?.error
        : undefined;

      expect(ownerFailure).toBe("persist-failed");
      expect(joinerFailure).toBe("persist-failed");
      expect(writes).toBe(2);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update).pipe(Effect.timeoutOption("100 millis")));
      }
      if (flush !== undefined) {
        await Effect.runPromise(Fiber.await(flush).pipe(Effect.timeoutOption("100 millis")));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("reports sync storage adapter throws through the persistence error channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync-storage-error",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const setStorage = Collection.storage({
          getItem: () => null,
          setItem: () => {
            throw new Error("quota exceeded");
          }
        });
        const getStorage = Collection.storage({
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => undefined
        });

        const setFailure = yield* Effect.flip(
          Projects.persistEffect(setStorage, { key: "projects-cache" })
        );
        const getFailure = yield* Effect.flip(
          Projects.restoreEffect(getStorage, { key: "projects-cache" })
        );

        yield* Effect.sync(() => {
          expect(setFailure).toBeInstanceOf(CollectionStorageError);
          expect(setFailure).toMatchObject({
            operation: "setItem",
            key: "projects-cache"
          });
          expect(getFailure).toBeInstanceOf(CollectionStorageError);
          expect(getFailure).toMatchObject({
            operation: "getItem",
            key: "projects-cache"
          });
        });
      })
    ));

  it("preserves sync storage receivers for method-style removeItem callbacks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        interface MethodStorage extends Collection.StorageLike {
          readonly values: Map<string, string>;
        }

        const backing: MethodStorage = {
          values: new Map([["projects-cache", "{}"]]),
          getItem(this: MethodStorage, key) {
            return this.values.get(key) ?? null;
          },
          setItem(this: MethodStorage, key, value) {
            this.values.set(key, value);
          },
          removeItem(this: MethodStorage, key) {
            this.values.delete(key);
          }
        };
        const storage = Collection.storage(backing);

        yield* toEffect(storage.removeItem!("projects-cache"));

        expect(backing.values.has("projects-cache")).toBe(false);
      })
    ));

  it("reports direct persistence storage callback throws as EffectInput callback errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thrown = new Error("storage callback exploded");
        const Projects = Collection.define<Project>({
          name: "Projects.direct-storage-callback-error",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const storage: Collection.PersistenceStorage<never> = {
          getItem: () => null,
          setItem: () => {
            throw thrown;
          }
        };

        const failure = yield* Effect.flip(
          Projects.persistEffect(storage, { key: "projects-cache" })
        );

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
        });
      })
    ));

  it("persists and restores pending mutation queue entries", async () => {
    const second = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.pending-persist",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () => Deferred.await(release)
    });

    try {
      const update = Effect.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(Projects.pendingMutations()).toMatchObject([
        {
          transaction: {
            collection: "Projects.pending-persist",
            mutations: [{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]
          },
          attempts: 1,
          rollbackRows: [
            {
              key: "atlas",
              row: {
                value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                synced: true,
                origin: "remote"
              }
            }
          ]
        }
      ]);

      await Effect.runPromise(Projects.persistEffect(storage, { key: "pending-projects-cache" }));
      await runInRuntime(second, Projects.restoreEffect(storage, { key: "pending-projects-cache" }));

      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: false,
        $origin: "local"
      });
      expect(runWithRuntime(second, () => Projects.pendingMutations())).toMatchObject([
        {
          transaction: {
            collection: "Projects.pending-persist",
            mutations: [{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]
          },
          attempts: 1
        }
      ]);

      Effect.runSync(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(update));

      expect(Projects.pendingMutations()).toEqual([]);
      expect(Projects.get("atlas")).toMatchObject({
        progress: 80,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("advances transaction ids from hydrated pending mutations", async () => {
    const runtime = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.pending-id-advance",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "phoenix", name: "Phoenix", status: "active", progress: 64 }
      ],
      onUpdate: () => Deferred.await(release)
    });
    const atlas = { id: "atlas", name: "Atlas", status: "active" as const, progress: 72 };
    const atlasUpdated = { ...atlas, progress: 80 };
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      await runInRuntime(runtime, Projects.hydrateEffect({
        name: "Projects.pending-id-advance",
        rows: [
          {
            key: "atlas",
            value: atlasUpdated,
            synced: false,
            origin: "local"
          },
          {
            key: "phoenix",
            value: { id: "phoenix", name: "Phoenix", status: "active", progress: 64 },
            synced: true,
            origin: "remote"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "ctx_1",
              collection: "Projects.pending-id-advance",
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous: atlas,
                  value: atlasUpdated,
                  changes: { progress: 80 }
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: atlas,
                  synced: true,
                  origin: "remote"
                }
              }
            ],
            createdAt: 1,
            attempts: 1
          }
        ],
        updatedAt: 1
      }));

      update = runtime.runFork(Projects.updateEffect("phoenix", { progress: 90 }));
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(runWithRuntime(runtime, () =>
        Projects.pendingMutations().map((pending) => pending.transaction.id)
      )).toEqual(["ctx_1", "ctx_2"]);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("bumps the collection version when restored pending mutation attempts start", async () => {
    const runtime = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.pending-attempt-version",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () => Deferred.await(release)
    });
    const previous = { id: "atlas", name: "Atlas", status: "active" as const, progress: 72 };
    const updated = { ...previous, progress: 80 };
    let flush: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      await runInRuntime(runtime, Projects.hydrateEffect({
        name: "Projects.pending-attempt-version",
        rows: [
          {
            key: "atlas",
            value: updated,
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "ctx_1",
              collection: "Projects.pending-attempt-version",
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous,
                  value: updated,
                  changes: { progress: 80 }
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: previous,
                  synced: true,
                  origin: "remote"
                }
              }
            ],
            createdAt: 1,
            attempts: 0
          }
        ],
        updatedAt: 1
      }));

      const beforeVersion = runWithRuntime(runtime, () => Projects.version().get());
      flush = runtime.runFork(Projects.flushPendingMutationsEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(runWithRuntime(runtime, () => Projects.pendingMutations()[0]?.attempts)).toBe(1);
      expect(runWithRuntime(runtime, () => Projects.version().get())).toBeGreaterThan(beforeVersion);
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      if (flush !== undefined) {
        await Effect.runPromise(Fiber.await(flush));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("joins an in-flight mutation attempt when flushing pending mutations", async () => {
    const runtime = makeRuntime();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    let calls = 0;
    const onUpdate = vi.fn(() => {
      calls++;
      if (calls > 1) {
        return Effect.fail("stale rollback");
      }
      return Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined).pipe(Effect.ignore);
        yield* Deferred.await(release);
      });
    });
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.pending-flush-joins-active",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    let flush: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Deferred.await(entered));
      flush = runtime.runFork(Projects.flushPendingMutationsEffect());
      await Effect.runPromise(Effect.sleep("10 millis"));

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations()[0]?.attempts)).toBe(1);

      Effect.runSync(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(update));
      const flushed = await Effect.runPromise(Fiber.join(flush));

      expect(flushed).toMatchObject([
        {
          collection: "Projects.pending-flush-joins-active",
          mutations: [{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]
        }
      ]);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined).pipe(Effect.ignore));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
      if (flush !== undefined) {
        await Effect.runPromise(Fiber.await(flush));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("flushes restored pending update mutations through the handler", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const persisted: Array<Project> = [];
    const handledTransactions: Array<string> = [];
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.pending-flush-success",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (updates, context) => {
        handledTransactions.push(context.transaction.id);
        if (handledTransactions.length === 1) {
          return Deferred.await(release);
        }

        return Effect.sync(() => {
          persisted.push(...updates.map((entry) => entry.value));
        });
      }
    });

    try {
      update = first.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      await Effect.runPromise(Effect.scoped(first.provide(
        Projects.persistEffect(storage, { key: "pending-flush-success-cache" })
      )));
      await Effect.runPromise(Effect.scoped(second.provide(
        Projects.restoreEffect(storage, { key: "pending-flush-success-cache" })
      )));

      const flushed = await Effect.runPromise(Effect.scoped(second.provide(
        Projects.flushPendingMutationsEffect()
      )));

      expect(flushed).toMatchObject([
        {
          collection: "Projects.pending-flush-success",
          mutations: [{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]
        }
      ]);
      expect(handledTransactions).toHaveLength(2);
      expect(handledTransactions[1]).toBe(handledTransactions[0]);
      expect(persisted).toEqual([
        { id: "atlas", name: "Atlas", status: "active", progress: 80 }
      ]);
      expect(runWithRuntime(second, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true,
        $origin: "local"
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("rolls restored pending update mutations back when flush fails", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const handledTransactions: Array<string> = [];
    let update: Fiber.Fiber<unknown, unknown> | undefined;
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.pending-flush-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (_updates, context) => {
        handledTransactions.push(context.transaction.id);
        return handledTransactions.length === 1
          ? Deferred.await(release)
          : Effect.fail("offline");
      }
    });

    try {
      update = first.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      await Effect.runPromise(Effect.scoped(first.provide(
        Projects.persistEffect(storage, { key: "pending-flush-failure-cache" })
      )));
      await Effect.runPromise(Effect.scoped(second.provide(
        Projects.restoreEffect(storage, { key: "pending-flush-failure-cache" })
      )));

      const flushFailure = await Effect.runPromise(Effect.flip(Effect.scoped(second.provide(
        Projects.flushPendingMutationsEffect()
      ))));
      expect(flushFailure).toBe("offline");

      expect(handledTransactions).toHaveLength(2);
      expect(handledTransactions[1]).toBe(handledTransactions[0]);
      expect(runWithRuntime(second, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(second, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
        $synced: true,
        $origin: "remote"
      });
    } finally {
      Effect.runSync(Deferred.succeed(release, undefined));
      if (update !== undefined) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("dehydrates and hydrates multiple collections as a payload", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.payload",
      getKey: (project) => project.id
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.payload",
      getKey: (task) => task.id
    });

    try {
      await runInRuntime(first, Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));
      await runInRuntime(first, Tasks.writeInsertEffect({
        id: "t1",
        projectId: "atlas",
        title: "Retry workflow",
        done: false
      }));

      const payload = await runInRuntime(first, Collection.dehydrateEffect([Projects, Tasks]));

      await runInRuntime(second, Collection.hydratePayloadEffect([Projects, Tasks], payload));

      expect(runWithRuntime(second, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
      expect(runWithRuntime(second, () => Tasks.rows().map((task) => task.title))).toEqual(["Retry workflow"]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

  it("commits optimistic row updates after mutation handlers succeed", async () => {
    const persisted: Array<Project> = [];
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-success",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (updates) =>
        Effect.sync(() => {
          persisted.push(...updates.map((update) => update.value));
        })
    });

    const transaction = await Effect.runPromise(Projects.updateEffect("atlas", { progress: 80 }));

    expect(transaction.mutations).toMatchObject([
      {
        _tag: "Update",
        key: "atlas",
        changes: { progress: 80 }
      }
    ]);
    expect(Projects.get("atlas")).toMatchObject({
      progress: 80,
      $synced: true,
      $origin: "local"
    });
    expect(persisted).toEqual([
      { id: "atlas", name: "Atlas", status: "active", progress: 80 }
    ]);
  });

  it("uses Effect schedules for collection mutation retry policy", async () => {
    let attempts = 0;
    const persisted: Array<Project> = [];
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.mutation-retry",
      getKey: (project) => project.id,
      policy: {
        retry: Schedule.recurs(2)
      },
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (updates) =>
        Effect.gen(function* () {
          attempts++;
          if (attempts < 3) {
            return yield* Effect.fail("temporary");
          }
          persisted.push(...updates.map((update) => update.value));
        })
    });

    await Effect.runPromise(Projects.updateEffect("atlas", { progress: 80 }));

    expect(attempts).toBe(3);
    expect(persisted).toEqual([
      { id: "atlas", name: "Atlas", status: "active", progress: 80 }
    ]);
    expect(Projects.pendingMutations()).toEqual([]);
    expect(Projects.get("atlas")).toMatchObject({
      progress: 80,
      $synced: true
    });
  });

  it("rolls optimistic row updates back when mutation handlers fail", async () => {
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-failure",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () => Effect.fail("nope")
    });

    await expect(Effect.runPromise(Projects.updateEffect("atlas", { progress: 80 }))).rejects.toBe("nope");

    expect(Projects.pendingMutations()).toEqual([]);
    expect(Projects.get("atlas")).toMatchObject({
      progress: 72,
      $synced: true,
      $origin: "remote"
    });
  });

  it("rebases later optimistic updates when an earlier same-row mutation fails", async () => {
    const runtime = makeRuntime();
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const firstRelease = Effect.runSync(Deferred.make<void, string>());
    const secondRelease = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-overlap-earlier-fails",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (updates) =>
        Effect.gen(function* () {
          const progress = updates[0]?.value.progress;
          if (progress === 80) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(firstRelease);
          } else if (progress === 90) {
            yield* Deferred.succeed(secondStarted, undefined);
            yield* Deferred.await(secondRelease);
          }
        })
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Deferred.await(firstStarted));
      second = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(secondStarted));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: false
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toHaveLength(2);

      Effect.runSync(Deferred.fail(firstRelease, "first failed"));
      await expect(Effect.runPromise(Fiber.join(first))).rejects.toBe("first failed");

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: false
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toHaveLength(1);

      Effect.runSync(Deferred.fail(secondRelease, "second failed"));
      await expect(Effect.runPromise(Fiber.join(second))).rejects.toBe("second failed");

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
        $synced: true,
        $origin: "remote"
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
    } finally {
      Effect.runSync(Deferred.fail(firstRelease, "cleanup").pipe(Effect.ignore));
      Effect.runSync(Deferred.fail(secondRelease, "cleanup").pipe(Effect.ignore));
      if (first) {
        await Effect.runPromise(Fiber.await(first));
      }
      if (second) {
        await Effect.runPromise(Fiber.await(second));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps later optimistic rows unsynced and restores committed earlier rows when the later mutation fails", async () => {
    const runtime = makeRuntime();
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const firstRelease = Effect.runSync(Deferred.make<void>());
    const secondRelease = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-overlap-later-fails",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: (updates) =>
        Effect.gen(function* () {
          const progress = updates[0]?.value.progress;
          if (progress === 80) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(firstRelease);
          } else if (progress === 90) {
            yield* Deferred.succeed(secondStarted, undefined);
            yield* Deferred.await(secondRelease);
          }
        })
    });
    let first: Fiber.Fiber<unknown, unknown> | undefined;
    let second: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      first = runtime.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Deferred.await(firstStarted));
      second = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(secondStarted));

      Effect.runSync(Deferred.succeed(firstRelease, undefined));
      await Effect.runPromise(Fiber.join(first));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: false
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toHaveLength(1);

      Effect.runSync(Deferred.fail(secondRelease, "second failed"));
      await expect(Effect.runPromise(Fiber.join(second))).rejects.toBe("second failed");

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true,
        $origin: "local"
      });
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
    } finally {
      Effect.runSync(Deferred.succeed(firstRelease, undefined).pipe(Effect.ignore));
      Effect.runSync(Deferred.fail(secondRelease, "cleanup").pipe(Effect.ignore));
      if (first) {
        await Effect.runPromise(Fiber.await(first));
      }
      if (second) {
        await Effect.runPromise(Fiber.await(second));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rebases optimistic updates over refetched remote base rows", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-refetch-base",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      refetch: () => Effect.succeed([
        { id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }
      ]),
      onUpdate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 90 }));
      await Effect.runPromise(Deferred.await(started));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: false
      });

      await Effect.runPromise(runtime.provide(Projects.refetchEffect()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 90,
        $synced: false
      });

      Effect.runSync(Deferred.fail(release, "update failed"));
      await expect(Effect.runPromise(Fiber.join(update))).rejects.toBe("update failed");

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
        $origin: "remote"
      });
    } finally {
      Effect.runSync(Deferred.fail(release, "cleanup").pipe(Effect.ignore));
      if (update) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps pending optimistic deletes hidden across refetched remote rows", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.optimistic-delete-refetch-base",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      refetch: () => Effect.succeed([
        { id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }
      ]),
      onDelete: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        })
    });
    let deletion: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      deletion = runtime.runFork(Projects.deleteEffect("atlas"));
      await Effect.runPromise(Deferred.await(started));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toBeUndefined();

      await Effect.runPromise(runtime.provide(Projects.refetchEffect()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toBeUndefined();

      Effect.runSync(Deferred.fail(release, "delete failed"));
      await expect(Effect.runPromise(Fiber.join(deletion))).rejects.toBe("delete failed");

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
        $origin: "remote"
      });
    } finally {
      Effect.runSync(Deferred.fail(release, "cleanup").pipe(Effect.ignore));
      if (deletion) {
        await Effect.runPromise(Fiber.await(deletion));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("preserves unsynced direct-write rows across refetches that omit them", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.direct-write-refetch-local-unsynced",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      refetch: () => Effect.succeed([
        { id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }
      ])
    });

    try {
      await Effect.runPromise(runtime.provide(Projects.writeInsertEffect({
        id: "local-draft",
        name: "Local Draft",
        status: "blocked",
        progress: 12
      }, { origin: "local", synced: false })));

      await Effect.runPromise(runtime.provide(Projects.refetchEffect()));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
        $origin: "remote"
      });
      expect(runWithRuntime(runtime, () => Projects.get("local-draft"))).toMatchObject({
        name: "Local Draft",
        progress: 12,
        $synced: false,
        $origin: "local"
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rejects merge hydration that collides with existing pending transaction ids", async () => {
    const runtime = makeRuntime();
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void, string>());
    const Projects = Collection.define<Project, string, string>({
      name: "Projects.hydrate-duplicate-pending",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        })
    });
    let update: Fiber.Fiber<unknown, unknown> | undefined;

    try {
      update = runtime.runFork(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Deferred.await(started));
      const snapshot = runWithRuntime(runtime, () => Projects.snapshot());

      const exit = await Effect.runPromiseExit(
        runtime.provide(Projects.hydrateEffect(snapshot, { replace: false }))
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(CollectionSnapshotCodecError);
      }
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toHaveLength(1);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: false
      });
    } finally {
      Effect.runSync(Deferred.fail(release, "cleanup").pipe(Effect.ignore));
      if (update) {
        await Effect.runPromise(Fiber.await(update));
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rebases restored pending mutations over refetched remote base rows", async () => {
    const runtime = makeRuntime();
    const persisted: Array<Project> = [];
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.hydrated-pending-rebase",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      refetch: () => Effect.succeed([
        { id: "atlas", name: "Atlas Remote", status: "active", progress: 88 }
      ]),
      onUpdate: (updates) =>
        Effect.sync(() => {
          persisted.push(...updates.map((entry) => entry.value));
        })
    });
    const base = { id: "atlas", name: "Atlas", status: "active" as const, progress: 72 };
    const pending = { ...base, progress: 80 };

    try {
      await runInRuntime(runtime, Projects.hydrateEffect({
        name: "Projects.hydrated-pending-rebase",
        rows: [
          {
            key: "atlas",
            value: pending,
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "ctx_1",
              collection: "Projects.hydrated-pending-rebase",
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous: base,
                  value: pending,
                  changes: { progress: 80 }
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: base,
                  synced: true,
                  origin: "remote"
                }
              }
            ],
            createdAt: 1,
            attempts: 1
          }
        ],
        updatedAt: 1
      }));

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas",
        progress: 80,
        $synced: false,
        $origin: "local"
      });

      await runInRuntime(runtime, Projects.refetchEffect());

      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 80,
        $synced: false,
        $origin: "local"
      });

      await runInRuntime(runtime, Projects.flushPendingMutationsEffect());

      expect(persisted).toEqual([
        { id: "atlas", name: "Atlas", status: "active", progress: 80 }
      ]);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 80,
        $synced: true
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("reports synchronous mutation callback throws through the Effect error channel", () => {
    const Projects = Collection.define<Project, string, Error>({
      name: "Projects.mutation-sync-throw",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ],
      onUpdate: () => {
        throw new Error("offline");
      }
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(Projects.updateEffect("atlas", { progress: 80 }));
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBeInstanceOf(Error);
          expect(((failure as EffectInputCallbackError).cause as Error).message).toBe("offline");
          expect(Projects.pendingMutations()).toEqual([]);
          expect(Projects.get("atlas")).toMatchObject({
            progress: 72,
            $synced: true
          });
        });
      })
    );
  });

  it("reports synchronous update projection throws through the Effect error channel", () => {
    const thrown = new Error("update projection failed");
    const Projects = Collection.define<Project>({
      name: "Projects.update-projection-sync-throw",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(Projects.updateEffect("atlas", () => {
          throw thrown;
        }));
        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.update(Projects.update-projection-sync-throw)"
          );
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
          expect(Projects.pendingMutations()).toEqual([]);
          expect(Projects.get("atlas")).toMatchObject({
            progress: 72,
            $synced: true
          });
        });
      })
    );
  });

  it("fails typed updates when the row is missing", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.missing-row",
      getKey: (project) => project.id
    });

    await expect(Effect.runPromise(Projects.updateEffect("missing", { progress: 80 }))).rejects.toBeInstanceOf(CollectionRowNotFound);
  });

  it("rejects updates that would move a row to a different key", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.key-changing-update",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });

    await expect(
      Effect.runPromise(Projects.writeUpdateEffect("atlas", { id: "lumen" }))
    ).rejects.toMatchObject({
      _tag: "CollectionRowKeyChanged",
      collection: "Projects.key-changing-update",
      key: "atlas",
      nextKey: "lumen"
    });
    expect(Projects.get("atlas")).toMatchObject({
      id: "atlas",
      $synced: true
    });
    expect(Projects.get("lumen")).toBeUndefined();

    await expect(
      Effect.runPromise(Projects.updateEffect("atlas", { id: "lumen" }))
    ).rejects.toBeInstanceOf(CollectionRowKeyChanged);
    expect(Projects.pendingMutations()).toEqual([]);
    expect(Projects.get("atlas")).toMatchObject({
      id: "atlas",
      $synced: true
    });
    expect(Projects.get("lumen")).toBeUndefined();
  });
});

describe("Query", () => {
  const expectUnsupportedLiveQueryPlan = (
    factory: Query.Factory<any, any, any>,
    reason: string
  ): void => {
    expect(() => Query.build(factory).execute()).toThrow(QueryEvaluationError);
    try {
      Query.build(factory).execute();
      expect.fail("Expected query build execution to reject the unsupported live query plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason
        }
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
          reason
        }
      });
    }
  };

  it("normalizes build, live, and diagnostics factory throws to QueryEvaluationError", () => {
    const thrown = new Error("query factory failed");
    const factory: Query.Factory<string> = () => {
      throw thrown;
    };

    for (const evaluate of [
      () => Query.build(factory).execute(),
      () => Query.live(factory),
      () => Query.diagnostics(factory)
    ]) {
      expect(evaluate).toThrow(QueryEvaluationError);
      try {
        evaluate();
      } catch (error) {
        expect(error).toMatchObject({
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: thrown
        });
      }
    }
  });

  it("rejects invalid query factory results at the factory boundary", async () => {
    const promised = Effect.runPromise(
      Effect.succeed(Query.from({ project: Collection.define<Project>({
        name: "Projects.promise-query-factory",
        getKey: (project) => project.id,
        initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }]
      }) }))
    );
    const throwingThenFactoryResult = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      }
    });
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly reason: "promise" | "effect" | "builder";
      readonly factory: Query.Factory<string>;
    }> = [
      {
        label: "promise",
        reason: "promise",
        factory: (() => promised) as never
      },
      {
        label: "throwing then",
        reason: "promise",
        factory: (() => throwingThenFactoryResult) as never
      },
      {
        label: "effect",
        reason: "effect",
        factory: (() => Effect.succeed(Query.from({}))) as never
      },
      {
        label: "non-builder",
        reason: "builder",
        factory: (() => ({ execute: () => [] })) as never
      }
    ];

    for (const testCase of cases) {
      for (const evaluate of [
        () => Query.build(testCase.factory).execute(),
        () => Query.live(testCase.factory),
        () => Query.diagnostics(testCase.factory)
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
              reason: testCase.reason
            }
          });
        }
      }

      const onceExit = await Effect.runPromiseExit(Query.onceEffect(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "QueryFactoryResultRejected",
            reason: testCase.reason
          }
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
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => and(eq(project.status, "active"), gt(project.progress, 50)))
        .select(({ project }) => project.name)
        .orderBy(({ project }) => project.name)
    );

    expect(live.evaluate()).toEqual(["Atlas"]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", {
      status: "active",
      progress: 56
    }));

    expect(live.evaluate()).toEqual(["Atlas", "Lumen"]);

    await Effect.runPromise(Projects.writeDeleteEffect("atlas"));

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
        { id: "1", name: "String", status: "active", progress: 20 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name)
    );

    expect(live.evaluate()).toEqual(["Numeric", "String"]);

    await Effect.runPromise(Projects.writeUpdateEffect(1, { name: "Numeric Updated" }));

    expect(live.evaluate()).toEqual(["Numeric Updated", "String"]);
  });

  it("keeps one-shot and live ordering parity for equal sort keys", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.query-order-parity",
      getKey: (project) => project.id,
      initialData: [
        { id: "zeta", name: "Zeta", status: "active", progress: 10 },
        { id: "alpha", name: "Alpha", status: "active", progress: 10 }
      ]
    });
    const factory: Query.Factory<string> = (query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name);

    expect(Query.build(factory).execute()).toEqual(["Alpha", "Zeta"]);
    expect(Query.live(factory).evaluate()).toEqual(["Alpha", "Zeta"]);
  });

  it("deduplicates live query source ownership for self joins", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-self-join-sources",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join("right", Projects, ({ left }) => left.id, (right) => right.id)
        .select(({ left, right }) => `${left.name}:${right.name}`)
    );

    expect(live.sources).toEqual([Projects]);
    expect(live.evaluate()).toEqual(["Atlas:Atlas"]);
  });

  it("refetches self-join source collections once", async () => {
    const refetch = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const Projects = Collection.define<Project>({
      name: "Projects.live-self-join-refetch-source",
      getKey: (project) => project.id,
      refetch
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join("right", Projects, ({ left }) => left.id, (right) => right.id)
        .select(({ left, right }) => `${left.name}:${right.name}`)
    );

    await Effect.runPromise(live.refetchEffect());

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
      []
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(
      factory,
      "Live queries require at least one source collection."
    );

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Live queries require at least one source collection."
        }
      });
    }

    const live = Query.live(factory);
    expect(live.data.get()).toEqual([]);
    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      data: [],
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Live queries require at least one source collection."
        }
      }
    });
  });

  it("normalizes query factory throws as query evaluation errors", async () => {
    const thrown = new Error("factory failed");

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(() => {
      throw thrown;
    }));

    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: thrown
      });
    }
  });

  it("rejects non-finite and fractional query windows consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-query-window",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const cases = [
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(Number.NaN),
        reason: "Query limit must be a finite non-negative safe integer."
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).offset(Number.POSITIVE_INFINITY),
        reason: "Query offset must be a finite non-negative safe integer."
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(1.5),
        reason: "Query limit must be a finite non-negative safe integer."
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(-1),
        reason: "Query limit must be a finite non-negative safe integer."
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).offset(-0.5),
        reason: "Query offset must be a finite non-negative safe integer."
      }
    ];

    for (const { factory, reason } of cases) {
      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason
          }
        });
      }

      const live = Query.live(factory);
      expect(live.state.get()).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason
          }
        }
      });
    }
  });

  it("rejects reserved query source aliases consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.reserved-query-alias",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const aliases = ["__proto__", "constructor", "prototype"] as const;

    for (const alias of aliases) {
      const reason = `Query source alias "${alias}" is reserved. Use a domain alias that can be represented as an own object property.`;
      const factory = (query: Query.Root) =>
        query
          .from({ [alias]: Projects } as Record<string, typeof Projects>)
          .select(() => "unreachable");

      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason
          }
        });
      }

      const live = Query.live(factory);
      expect(live.data.get()).toEqual([]);
      expect(live.state.get()).toMatchObject({
        _tag: "Failure",
        data: [],
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason
          }
        }
      });
    }
  });

  it("rejects duplicate query aliases consistently", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const Projects = Collection.define<Project>({
      name: "Projects.duplicate-query-alias",
      getKey: (project) => project.id,
      load: projectLoad
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.duplicate-query-alias",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ]
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join("project", Tasks, ({ project }) => project.id, (task) => task.projectId)
        .select(({ project }) => project.name);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Query source alias "project" is registered more than once.'
    );

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.'
        }
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();

    const live = Query.live(factory);
    const livePreloadExit = await Effect.runPromiseExit(live.preloadEffect());
    expect(Exit.isFailure(livePreloadExit)).toBe(true);
    if (Exit.isFailure(livePreloadExit)) {
      const error = livePreloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.'
        }
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();
    expect(live.data.get()).toEqual([]);
    const state = live.state.get();
    expect(state).toMatchObject({
      _tag: "Failure",
      data: [],
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.'
        }
      }
    });
  });

  it("normalizes invalid join key encoding as join evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-join-key",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.invalid-join-key",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ]
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join("task", Tasks, () => invalidDate, (task) => task.projectId)
        .select(({ project }) => project.name);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid join keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const live = Query.live(factory);
    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "join"
      }
    });
  });

  it("normalizes invalid group key encoding as aggregate evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-group-key",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .groupBy(
          () => ({ createdAt: invalidDate }),
          { count: Query.count() }
        )
        .select((group) => group.count);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid group keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const live = Query.live(factory);
    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "aggregate"
      }
    });
  });

  it("normalizes invalid order values as order evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.invalid-order-value",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const cases = [
      { label: "invalid-date", value: invalidDate },
      { label: "nan", value: Number.NaN }
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

      const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({ operation: "order" });
      }

      const live = Query.live(factory);
      expect(live.data.get()).toEqual([]);
      expect(live.state.get()).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "order"
        }
      });
    }
  });

  it("rejects Promise-shaped query callbacks as typed evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.promise-query-callbacks",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.promise-query-callbacks",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ]
    });
    const promised = <A,>(value: A): A =>
      Effect.runPromise(Effect.succeed(value)) as never;
    const throwingThen = (): unknown =>
      Object.defineProperty({}, "then", {
        get: () => {
          throw new Error("then getter failed");
        }
      });
    const cases: ReadonlyArray<{
      readonly operation: "filter" | "join" | "order" | "projection" | "aggregate";
      readonly factory: (query: Query.Root) => Query.Builder<any, any, any, any>;
    }> = [
      {
        operation: "filter",
        factory: (query) =>
          query
            .from({ project: Projects })
            .where((() => promised(true)) as never)
            .select(({ project }) => project.name)
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => promised("Atlas")) as never)
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: promised("Atlas") } })) as never)
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: throwingThen() } })) as never)
      },
      {
        operation: "join",
        factory: (query) =>
          query
            .from({ project: Projects })
            .join("task", Tasks, (() => promised("atlas")) as never, (task) => task.projectId)
            .select(({ project }) => project.name)
      },
      {
        operation: "order",
        factory: (query) =>
          query
            .from({ project: Projects })
            .orderBy((() => promised(1)) as never)
            .select(({ project }) => project.name)
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              ({ project }) => ({ status: project.status }),
              { count: Query.count((() => promised("present")) as never) }
            )
            .select((group) => group.count)
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }) => ({ status: project.status, asyncKey: promised("active") })) as never,
              { count: Query.count() }
            )
            .select((group) => group.count)
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }) => ({ status: project.status, asyncKey: throwingThen() })) as never,
              { count: Query.count() }
            )
            .select((group) => group.count)
      }
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.onceEffect(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" }
        });
      }

      const live = Query.live(testCase.factory);
      expect(live.state.get()).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" }
        }
      });
    }
  });

  it("rejects Effect-shaped query callback values as typed evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.effect-query-callbacks",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const cases: ReadonlyArray<{
      readonly operation: "projection" | "aggregate";
      readonly factory: (query: Query.Root) => Query.Builder<any, any, any, any>;
    }> = [
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: Effect.succeed("Atlas") } })) as never)
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }) => ({ status: project.status, effectKey: Effect.succeed("active") })) as never,
              { count: Query.count() }
            )
            .select((group) => group.count)
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              ({ project }) => ({ status: project.status }),
              { count: Query.count((() => Effect.succeed("present")) as never) }
            )
            .select((group) => group.count)
      }
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.onceEffect(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" }
        });
      }

      const live = Query.live(testCase.factory);
      expect(live.state.get()).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" }
        }
      });
    }
  });

  it("rejects query joins without registered source aliases consistently", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.missing-query-join-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.missing-query-join-source",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ]
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
          rightKeys: () => ["atlas"]
        }
      ]
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(
      factory,
      'Join source "task" is not registered.'
    );

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.'
        }
      });
    }

    const live = Query.live(factory);
    expect(live.data.get()).toEqual([]);
    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      data: [],
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.'
        }
      }
    });
  });

  it("maintains live joins across collections", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.live-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects, task: Tasks })
        .where(({ project, task }) => eq(project.id, task.projectId))
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    await Effect.runPromise(Tasks.writeInsertEffect({
      id: "t3",
      projectId: "atlas",
      title: "Webhook replay",
      done: false
    }));

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Atlas:Webhook replay",
      "Lumen:Queue ownership"
    ]);
  });

  it("maintains explicit keyed joins through the IVM join operator", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.explicit-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.explicit-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .join("task", Tasks, ({ project }) => project.id, (task) => task.projectId)
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    await Effect.runPromise(Tasks.writeUpdateEffect("t3", { projectId: "atlas" }));

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    await Effect.runPromise(Projects.writeDeleteEffect("lumen"));

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow"
    ]);
  });

  it("uses declared collection indexes for indexed joins", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    await Effect.runPromise(Tasks.writeUpdateEffect("t3", { projectId: "atlas" }));

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);
  });

  it("evaluates indexed join selectors against public row values", async () => {
    const seenTaskKeys: Array<ReadonlyArray<string>> = [];
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join-public-values",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join-public-values",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => {
          seenTaskKeys.push(Object.keys(task));
          return task.projectId;
        }
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false }
      ]
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
          outputRows: 2
        }
      ]
    });
    await expect(Effect.runPromise(Query.onceEffect(factory))).resolves.toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    const live = Query.live(factory);
    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);
    expect(seenTaskKeys.length).toBeGreaterThan(0);
    expect(seenTaskKeys.every((keys) => keys.every((key) => !key.startsWith("$")))).toBe(true);
  });

  it("normalizes indexed join index selector throws as join evaluation errors", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.indexed-join-selector-error",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.indexed-join-selector-error",
      getKey: (task) => task.id,
      indexes: {
        byProject: () => {
          throw "index failed";
        }
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ]
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      const indexError = error instanceof QueryEvaluationError ? error.cause : undefined;
      expect(indexError).toBeInstanceOf(EffectInputCallbackError);
      expect(error).toMatchObject({
        operation: "join"
      });
      expect(indexError).toMatchObject({
        cause: "index failed"
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
      initialData: [
        { id: "atlas", name: "Atlas", callback: () => undefined }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .select(({ project }) => project.name)
    );

    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "source",
        cause: {
          _tag: "StableStringifyUnsupportedValue",
          path: "$.callback"
        }
      }
    });
  });

  it("rejects indexed joins that name an undeclared collection index before live preload loads sources", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const taskLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Task>>([
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false }
      ])
    );
    const Projects = Collection.define<Project>({
      name: "Projects.missing-indexed-join",
      getKey: (project) => project.id,
      load: projectLoad
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.missing-indexed-join",
      getKey: (task) => task.id,
      load: taskLoad
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "missing")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".'
    );

    const onceExit = await Effect.runPromiseExit(Query.onceEffect(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".'
        }
      });
    }

    const live = Query.live(factory);
    const preloadExit = await Effect.runPromiseExit(live.preloadEffect());
    expect(Exit.isFailure(preloadExit)).toBe(true);
    if (Exit.isFailure(preloadExit)) {
      const error = preloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" uses unknown index "missing" on collection "Tasks.missing-indexed-join".'
        }
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
        { id: "a|right:string:b", label: "left-delimited" }
      ]
    });
    const Right = Collection.define<IdentityRow>({
      name: "Live.identity-right",
      getKey: (row) => row.id,
      initialData: [
        { id: "b|right:string:c", label: "right-delimited" },
        { id: "c", label: "right-c" }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ left: Left, right: Right })
        .select(({ left, right }) => `${left.label}:${right.label}`)
        .orderBy(({ left, right }) => `${left.label}:${right.label}`)
    );

    expect(live.evaluate()).toEqual([
      "left-a:right-c",
      "left-a:right-delimited",
      "left-delimited:right-c",
      "left-delimited:right-delimited"
    ]);
  });

  it("describes query plans with indexed join cost diagnostics", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.query-diagnostics",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<Task>({
      name: "Tasks.query-diagnostics",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false }
      ]
    });

    const plan = Query.diagnostics((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .where(({ project }) => project.status === "active")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
        .limit(1)
    );

    expect(plan).toEqual({
      sources: [
        { alias: "project", collection: "Projects.query-diagnostics", rows: 2 },
        { alias: "task", collection: "Tasks.query-diagnostics", rows: 3 }
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
          estimatedComparisons: 2
        }
      ],
      filters: 1,
      orders: 1,
      grouped: false,
      offset: 0,
      limit: 1,
      contextRows: 2
    });
  });

  it("joins through multi-value collection indexes", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.multi-indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const Tasks = Collection.define<TaggedTask>({
      name: "Tasks.multi-indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byTag: (task) => task.tags
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false, tags: ["active", "urgent"] },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false, tags: ["blocked"] },
        { id: "t3", projectId: "missing", title: "Orphan", done: false, tags: ["missing"] }
      ]
    });

    await expect(Effect.runPromise(Query.onceEffect((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
    ))).resolves.toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership"
    ]);

    await Effect.runPromise(Tasks.writeUpdateEffect("t3", { tags: ["active", "blocked"] }));

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Orphan",
      "Lumen:Queue ownership"
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
        { id: "meridian", name: "Meridian", status: "active", progress: 84 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .select(({ project }) => ({
          id: project.id,
          progress: project.progress
        }))
        .orderBy(({ project }) => project.progress, "desc")
        .limit(2)
    );

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 }
    ]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { progress: 95 }));

    expect(live.evaluate()).toEqual([
      { id: "lumen", progress: 95 },
      { id: "meridian", progress: 84 }
    ]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { progress: 40 }));

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 }
    ]);
  });

  it("maintains grouped aggregate live queries inside the IVM graph", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-groupBy",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(
          ({ project }) => ({ status: project.status }),
          {
            count: Query.count(),
            totalProgress: Query.sum(({ project }) => project.progress),
            avgProgress: Query.avg(({ project }) => project.progress)
          }
        )
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress,
          avgProgress: group.avgProgress
        }))
        .orderBy((group) => group.status)
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 2, totalProgress: 124, avgProgress: 62 },
      { status: "blocked", count: 1, totalProgress: 34, avgProgress: 34 }
    ]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", {
      status: "active",
      progress: 40
    }));

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 }
    ]);

    await Effect.runPromise(Projects.writeInsertEffect({
      id: "meridian",
      name: "Meridian",
      status: "blocked",
      progress: 80
    }));

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 },
      { status: "blocked", count: 1, totalProgress: 80, avgProgress: 80 }
    ]);
  });

  it("applies grouped aggregate filters before and after grouping", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-groupBy-filter",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 50)
        .groupBy(
          ({ project }) => ({ status: project.status }),
          { count: Query.count() }
        )
        .where((group) => group.count > 1)
        .select((group) => group.status)
    );

    expect(live.evaluate()).toEqual(["active"]);

    await Effect.runPromise(Projects.writeUpdateEffect("kepler", { progress: 30 }));

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
        { id: "vega", name: "Vega", status: "queued", progress: 24 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(
          ({ project }) => ({ status: project.status }),
          { count: Query.count() }
        )
        .select((group) => ({
          status: group.status,
          count: group.count
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2)
    );

    expect(live.evaluate()).toEqual([
      { status: "queued", count: 3 },
      { status: "active", count: 2 }
    ]);

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { status: "active" }));

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3 },
      { status: "queued", count: 3 }
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
        { id: "meridian", name: "Meridian", status: "queued", progress: 80 }
      ]
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 20)
        .groupBy(
          ({ project }) => ({ status: project.status }),
          {
            count: Query.count(),
            totalProgress: Query.sum(({ project }) => project.progress)
          }
        )
        .where((group) => group.count >= 2)
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2);
    const expected = [
      { status: "active", count: 2, totalProgress: 124 },
      { status: "blocked", count: 2, totalProgress: 58 }
    ];

    expect(Query.build(factory).execute()).toEqual(expected);
    await expect(Effect.runPromise(Query.onceEffect(factory))).resolves.toEqual(expected);
    expect(Query.live(factory).evaluate()).toEqual(expected);
  });
});
