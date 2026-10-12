import { Action, makeRuntime, runWithRuntime } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Deferred, Effect, Fiber } from "effect";
import type { KeyValueStore } from "effect/persistence";
import { describe, expect, it, vi } from "vitest";
import { collectionStoreKey, makeTestKeyValueStore } from "./key-value-store.js";

type KVE = KeyValueStore.KeyValueStoreError;
type KV = KeyValueStore.KeyValueStore;

interface Project {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

describe("Collection persistence options", () => {
  it("restores persisted rows during preload without loading remotely by default", () => {
    const storage = makeTestKeyValueStore();
    const first = makeRuntime(storage.layer);
    const second = makeRuntime(storage.layer);
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([{ id: "remote", name: "Remote", progress: 1 }]),
    );
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.persisted.preload",
      getKey: (project) => project.id,
      persistence: {
        key: "projects-preload",
      },
      sync: {
        load,
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.scoped(
          first.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  progress: 72,
                },
              },
            ]),
          ),
        );

        yield* Effect.sync(() =>
          expect(storage.values.has(collectionStoreKey("projects-preload"))).toBe(true),
        );

        yield* Effect.scoped(second.provide(Projects.preload()));

        yield* Effect.sync(() => {
          expect(load).not.toHaveBeenCalled();
          expect(runWithRuntime(first, () => Projects.rows().map((project) => project.id))).toEqual(
            ["atlas"],
          );
          expect(
            runWithRuntime(second, () => Projects.rows().map((project) => project.id)),
          ).toEqual(["atlas"]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(Effect.andThen(first.dispose, second.dispose)))),
    );
  });

  it("loads after restore when requested and persists the refreshed snapshot", () => {
    const storage = makeTestKeyValueStore();
    const first = makeRuntime(storage.layer);
    const second = makeRuntime(storage.layer);
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.persisted.load-after-restore",
      getKey: (project) => project.id,
      persistence: {
        key: "projects-refresh",
        loadAfterRestore: true,
      },
      sync: {
        load: () =>
          Effect.succeed<ReadonlyArray<Project>>([{ id: "lumen", name: "Lumen", progress: 34 }]),
      },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.scoped(
          first.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  progress: 72,
                },
              },
            ]),
          ),
        );

        yield* Effect.scoped(second.provide(Projects.preload()));

        yield* Effect.sync(() => {
          expect(
            runWithRuntime(second, () => Projects.rows().map((project) => project.id)),
          ).toEqual(["lumen"]);

          const persisted = storage.snapshot<Project>("projects-refresh");
          expect(persisted?.rows.map((row) => row.key)).toEqual(["lumen"]);
        });
      }).pipe(Effect.ensuring(Effect.orDie(Effect.andThen(first.dispose, second.dispose)))),
    );
  });

  it("never persists an Action's optimistic patch: storage keeps the synced rows", () => {
    const storage = makeTestKeyValueStore();
    const runtime = makeRuntime(storage.layer);
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const Projects = Collection.define<Project, string, KVE, KV>({
      name: "Projects.persisted.optimistic",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", progress: 72 }],
      persistence: {
        key: "projects-optimistic",
      },
    });
    const Advance = Action.define({
      name: "Projects.persisted.optimistic.advance",
      optimistic: (_input: void, transaction) =>
        transaction.update(Projects, "atlas", { progress: 80 }),
      run: (_input: void) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        }),
    });
    const persisted = () => storage.snapshot<Project>("projects-optimistic");

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.persist());
        const submission = runtime.runFork(Action.use(Advance, { runtime }).submit(undefined));
        yield* Deferred.await(started);
        yield* runtime.provide(Projects.persist());

        expect(persisted()?.rows).toMatchObject([
          { key: "atlas", value: { progress: 72 }, synced: true, origin: "remote" },
        ]);
        expect(persisted()).not.toHaveProperty("pendingMutations");

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(submission);
        yield* runtime.provide(Projects.persist());

        expect(persisted()?.rows).toMatchObject([
          { key: "atlas", value: { progress: 80 }, synced: true, origin: "local" },
        ]);
      }).pipe(
        Effect.ensuring(
          Deferred.succeed(release, undefined).pipe(
            Effect.ignore,
            Effect.andThen(Effect.orDie(runtime.dispose)),
          ),
        ),
      ),
    );
  });
});
