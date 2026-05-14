import { makeRuntime, runWithRuntime } from "@effect-ui/core";
import { Collection, type CollectionSnapshot } from "@effect-ui/db";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

describe("Collection.persistedOptions", () => {
  it("restores persisted rows during preload without loading remotely by default", () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const storage = Collection.memoryStorage();
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "remote", name: "Remote", progress: 1 }
      ])
    );
    const Projects = Collection.define(Collection.persistedOptions<Project>({
      name: "Projects.persisted.preload",
      getKey: (project) => project.id,
      load,
      persistence: {
        storage,
        key: "projects-preload"
      }
    }));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          first.runPromise(Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            progress: 72
          }))
        );

        yield* Effect.sync(() => expect(storage.values.has("projects-preload")).toBe(true));

        yield* Effect.scoped(second.provide(Projects.preloadEffect()));

        yield* Effect.sync(() => {
          expect(load).not.toHaveBeenCalled();
          expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
          expect(runWithRuntime(second, () => Projects.rows().map((project) => project.id))).toEqual(["atlas"]);
        });
      }).pipe(
        Effect.ensuring(Effect.andThen(first.disposeEffect, second.disposeEffect))
      )
    );
  });

  it("loads after restore when requested and persists the refreshed snapshot", () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const storage = Collection.memoryStorage();
    const Projects = Collection.define(Collection.persistedOptions<Project>({
      name: "Projects.persisted.load-after-restore",
      getKey: (project) => project.id,
      load: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "lumen", name: "Lumen", progress: 34 }
        ]),
      persistence: {
        storage,
        key: "projects-refresh",
        loadAfterRestore: true
      }
    }));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          first.runPromise(Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            progress: 72
          }))
        );

        yield* Effect.scoped(second.provide(Projects.preloadEffect()));

        yield* Effect.sync(() => {
          expect(runWithRuntime(second, () => Projects.rows().map((project) => project.id))).toEqual(["lumen"]);

          const persisted = JSON.parse(storage.values.get("projects-refresh") ?? "{}") as CollectionSnapshot<Project>;
          expect(persisted.rows.map((row) => row.key)).toEqual(["lumen"]);
        });
      }).pipe(
        Effect.ensuring(Effect.andThen(first.disposeEffect, second.disposeEffect))
      )
    );
  });

  it("persists in-flight optimistic mutation queues and the committed result", () => {
    const runtime = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const Projects = Collection.define(Collection.persistedOptions<Project, string, never>({
      name: "Projects.persisted.optimistic",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", progress: 72 }
      ],
      onUpdate: () => Deferred.await(release),
      persistence: {
        storage,
        key: "projects-optimistic"
      }
    }));

    return Effect.runPromise(
      Effect.gen(function* () {
        const update = runtime.runFork(Projects.updateEffect("atlas", { progress: 80 }));
        yield* Effect.sleep("10 millis");

        yield* Effect.sync(() => {
          const pendingSnapshot = JSON.parse(storage.values.get("projects-optimistic") ?? "{}") as CollectionSnapshot<Project>;
          expect(pendingSnapshot.rows).toMatchObject([
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas", progress: 80 },
              synced: false,
              origin: "local"
            }
          ]);
          expect(pendingSnapshot.pendingMutations).toMatchObject([
            {
              transaction: {
                collection: "Projects.persisted.optimistic",
                mutations: [{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]
              }
            }
          ]);
        });

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(update);

        yield* Effect.sync(() => {
          const committedSnapshot = JSON.parse(storage.values.get("projects-optimistic") ?? "{}") as CollectionSnapshot<Project>;
          expect(committedSnapshot.rows).toMatchObject([
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas", progress: 80 },
              synced: true,
              origin: "local"
            }
          ]);
          expect(committedSnapshot.pendingMutations).toEqual([]);
        });
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, undefined).pipe(
            Effect.ignore,
            Effect.andThen(runtime.disposeEffect)
          )
        )
      )
    );
  });
});
