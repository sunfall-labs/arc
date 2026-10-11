import {
  EffectInputCallbackError,
  Resource,
  Server,
  makeRuntime,
  type ServerClientError,
} from "@sunfall/arc-core";
import { Collection, CollectionSnapshotCodecError } from "@sunfall/arc-db";
import {
  defaultCollectionDefinitionRegistry,
  subscribeCollectionEventsEffect,
} from "@sunfall/arc-db/internal";
import { Deferred, Effect, Fiber, PubSub, Queue, Schema, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("Collection sync adapters", () => {
  it("adapts generic sync loads, refetches, and mutation handlers", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const inserts: Array<Collection.SyncInsertPayload<Project, string>> = [];
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
        const deletes: Array<Collection.SyncDeletePayload<Project, string>> = [];
        const load = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([{ id: "atlas", name: "Atlas", archived: false }]),
        );
        const refetch = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Prime", archived: false },
          ]),
        );
        const Projects = Collection.define<Project>({
          name: "Projects.sync.generic",
          getKey: (project) => project.id,
          sync: {
            name: "generic-test",
            load,
            refetch,
            insert: (payload) =>
              Effect.sync(() => {
                inserts.push(payload);
              }),
            update: (payload) =>
              Effect.sync(() => {
                updates.push(payload);
              }),
            delete: (payload) =>
              Effect.sync(() => {
                deletes.push(payload);
              }),
          },
        });

        expect(defaultCollectionDefinitionRegistry.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.generic",
              sync: { adapter: "generic-test" },
            }),
          ]),
        );

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(refetch).not.toHaveBeenCalled();

        yield* Projects.refetchEffect();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(refetch).toHaveBeenCalledTimes(1);

        yield* Projects.insertEffect({ id: "lumen", name: "Lumen", archived: false });
        yield* Projects.updateEffect("atlas", { archived: true });
        yield* Projects.deleteEffect("lumen");

        expect(inserts).toMatchObject([
          {
            values: [{ id: "lumen", name: "Lumen", archived: false }],
            transaction: {
              collection: "Projects.sync.generic",
              mutations: [{ _tag: "Insert", key: "lumen" }],
            },
          },
        ]);
        expect(updates).toMatchObject([
          {
            updates: [
              {
                key: "atlas",
                previous: { id: "atlas", name: "Atlas Prime", archived: false },
                value: { id: "atlas", name: "Atlas Prime", archived: true },
                changes: { archived: true },
              },
            ],
          },
        ]);
        expect(deletes).toMatchObject([
          {
            deletes: [
              {
                key: "lumen",
                previous: { id: "lumen", name: "Lumen", archived: false },
              },
            ],
          },
        ]);
      }),
    );
  });

  it("keeps synchronous sync adapter throws in the Effect error channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loadFailure = new Error("load exploded");
        const insertFailure = new Error("insert exploded");
        const LoadProjects = Collection.define<Project, string, Error>({
          name: "Projects.sync.throw.load",
          getKey: (project) => project.id,
          sync: {
            name: "throwing-load",
            load: () => {
              throw loadFailure;
            },
          },
        });
        const InsertProjects = Collection.define<Project, string, Error>({
          name: "Projects.sync.throw.insert",
          getKey: (project) => project.id,
          sync: {
            name: "throwing-insert",
            insert: () => {
              throw insertFailure;
            },
          },
        });

        const loadError = yield* Effect.flip(LoadProjects.preloadEffect());
        const insertError = yield* Effect.flip(
          InsertProjects.insertEffect({ id: "atlas", name: "Atlas", archived: false }),
        );

        expect(loadError).toBeInstanceOf(EffectInputCallbackError);
        expect((loadError as EffectInputCallbackError).cause).toBe(loadFailure);
        expect(insertError).toBeInstanceOf(EffectInputCallbackError);
        expect((insertError as EffectInputCallbackError).cause).toBe(insertFailure);
        expect(InsertProjects.pendingMutations()).toEqual([]);
        expect(InsertProjects.rows()).toEqual([]);
      }),
    ));

  it("preserves sync adapter receivers for method-style load and refetch callbacks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        interface MethodSyncAdapter extends Collection.SyncAdapter<Project> {
          readonly loaded: ReadonlyArray<Project>;
          readonly refreshed: ReadonlyArray<Project>;
        }

        const sync: MethodSyncAdapter = {
          name: "method-style-sync",
          loaded: [{ id: "atlas", name: "Atlas", archived: false }],
          refreshed: [{ id: "atlas", name: "Atlas Prime", archived: false }],
          load(this: MethodSyncAdapter) {
            return this.loaded;
          },
          refetch(this: MethodSyncAdapter) {
            return this.refreshed;
          },
        };
        const Projects = Collection.define<Project>({
          name: "Projects.sync.method-receiver",
          getKey: (project) => project.id,
          sync,
        });

        yield* Projects.preloadEffect();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);

        yield* Projects.refetchEffect();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
      }),
    ));

  it("keeps first load versus refetch selection local to each runtime", () => {
    const first = makeRuntime();
    const second = makeRuntime();

    return Effect.runPromise(
      Effect.gen(function* () {
        const load = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([{ id: "atlas", name: "Atlas", archived: false }]),
        );
        const refetch = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Prime", archived: false },
          ]),
        );
        const Projects = Collection.define<Project>({
          name: "Projects.sync.runtime-local-load",
          getKey: (project) => project.id,
          sync: {
            name: "runtime-local-load",
            load,
            refetch,
          },
        });

        yield* first.provide(Projects.preloadEffect());
        yield* second.provide(Projects.preloadEffect());

        expect(load).toHaveBeenCalledTimes(2);
        expect(refetch).not.toHaveBeenCalled();
        expect(
          first.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas"]);
        expect(
          second.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas"]);

        yield* first.provide(Projects.refetchEffect());

        expect(load).toHaveBeenCalledTimes(2);
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(
          first.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas Prime"]);
        expect(
          second.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas"]);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.orDie(first.disposeEffect);
            yield* Effect.orDie(second.disposeEffect);
          }),
        ),
      ),
    );
  });

  it("accepts Server functions directly as sync adapter operations", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const load = Server.fn<void, ReadonlyArray<Project>>("Projects.sync.server.load", {
          handler: () =>
            Effect.succeed<ReadonlyArray<Project>>([
              { id: "atlas", name: "Atlas", archived: false },
            ]),
        });
        const inserted: Array<ReadonlyArray<Project>> = [];
        const insert = Server.fn<Collection.SyncInsertPayload<Project, string>, void>(
          "Projects.sync.server.insert",
          {
            handler: (payload) =>
              Effect.sync(() => {
                inserted.push(payload.values);
              }),
          },
        );
        const Projects = Collection.define<
          Project,
          string,
          ServerClientError | EffectInputCallbackError
        >({
          name: "Projects.sync.server",
          getKey: (project) => project.id,
          sync: { load, insert },
        });

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);

        yield* Projects.insertEffect({ id: "lumen", name: "Lumen", archived: false });

        expect(inserted).toMatchObject([[{ id: "lumen", name: "Lumen", archived: false }]]);
      }),
    );
  });

  it("backs a collection with a Resource ref", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const ProjectRows = Resource.family<void, ReadonlyArray<Project>>({
          name: "Projects.sync.resource.rows",
          load: () =>
            Effect.sync(() => {
              loads++;
              return loads === 1
                ? [{ id: "atlas", name: "Atlas", archived: false }]
                : [{ id: "lumen", name: "Lumen", archived: true }];
            }),
        });
        const Projects = Collection.define<Project, string, EffectInputCallbackError>({
          name: "Projects.sync.resource",
          getKey: (project) => project.id,
          sync: ProjectRows(undefined),
        });

        expect(defaultCollectionDefinitionRegistry.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.resource",
              sync: { adapter: "resource:Projects.sync.resource.rows" },
            }),
          ]),
        );

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);

        yield* Projects.refetchEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["lumen"]);

        expect(loads).toBe(2);
      }),
    );
  });
});

describe("Collection sync changes", () => {
  it("applies streamed remote changes in order once the collection loads", () => {
    const runtime = makeRuntime();
    const remote = Effect.runSync(
      Queue.unbounded<ReadonlyArray<Collection.Change<Project, string>>>(),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.sync.changes",
      getKey: (project) => project.id,
      sync: {
        load: () => [
          { id: "atlas", name: "Atlas", archived: false },
          { id: "lumen", name: "Lumen", archived: false },
        ],
        changes: () => Stream.fromQueue(remote),
      },
    });
    const rows = () => runtime.runSync(Effect.sync(() => Projects.rows()));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        yield* Queue.offer(remote, [
          { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } },
          { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
          { _tag: "Delete", key: "lumen" },
          { _tag: "Update", key: "orion", changes: { archived: false } },
        ]);
        yield* eventually(() => rows().some((row) => row.id === "orion"));

        expect(rows()).toMatchObject([
          { id: "atlas", name: "Atlas Prime", $origin: "remote", $synced: true },
          { id: "orion", name: "Orion", archived: false, $origin: "remote", $synced: true },
        ]);
      }).pipe(Effect.ensuring(Effect.orDie(runtime.disposeEffect))),
    );
  });

  it("publishes a failed batch and keeps applying later batches", () => {
    const runtime = makeRuntime();
    const ProjectRows = Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, archived: Schema.Boolean }),
    );
    const remote = Effect.runSync(
      Queue.unbounded<ReadonlyArray<Collection.Change<Project, string>>>(),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.sync.changes-failure",
      output: ProjectRows,
      getKey: (project) => project.id,
      sync: {
        load: () => [{ id: "atlas", name: "Atlas", archived: false }],
        changes: () => Stream.fromQueue(remote),
      },
    });
    const rows = () => runtime.runSync(Effect.sync(() => Projects.rows()));

    return Effect.runPromise(
      runtime
        .provide(
          Effect.scoped(
            Effect.gen(function* () {
              const events = yield* subscribeCollectionEventsEffect();
              yield* Projects.preloadEffect();
              yield* Queue.offer(remote, [
                { _tag: "Update", key: "missing", changes: { name: "Ghost" } },
              ]);
              yield* Queue.offer(remote, [
                {
                  _tag: "Upsert",
                  value: { id: "lumen", name: 7, archived: false } as unknown as Project,
                },
              ]);
              yield* Queue.offer(remote, [
                { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } },
              ]);
              yield* eventually(() => rows().length === 2);

              const failures: Array<unknown> = [];
              while (failures.length < 2) {
                const event = yield* PubSub.take(events);
                if (event._tag === "CollectionChangeFeedFailure") {
                  failures.push(event.error);
                }
              }
              expect(failures[0]).toMatchObject({ _tag: "CollectionRowNotFound", key: "missing" });
              expect(failures[1]).toBeInstanceOf(CollectionSnapshotCodecError);
              expect(rows().map((row) => row.id)).toEqual(["atlas", "orion"]);
            }),
          ),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.disposeEffect))),
    );
  });

  it("starts the changes stream once per store and stops it on runtime disposal", () => {
    const runtime = makeRuntime();
    const lifecycle = { started: 0, stopped: 0 };
    const remote = Effect.runSync(
      PubSub.unbounded<ReadonlyArray<Collection.Change<Project, string>>>(),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.sync.changes-dispose",
      getKey: (project) => project.id,
      sync: {
        changes: () =>
          Stream.fromPubSub(remote).pipe(
            Stream.onStart(
              Effect.sync(() => {
                lifecycle.started++;
              }),
            ),
            Stream.ensuring(
              Effect.sync(() => {
                lifecycle.stopped++;
              }),
            ),
          ),
      },
    });
    const names = () => runtime.runSync(Effect.sync(() => Projects.rows().map((row) => row.name)));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        yield* runtime.provide(Projects.refetchEffect());
        yield* eventually(() => lifecycle.started === 1);

        yield* PubSub.publish(remote, [
          { _tag: "Upsert", value: { id: "atlas", name: "Atlas Live", archived: false } },
        ]);
        yield* eventually(() => names()[0] === "Atlas Live");

        yield* Effect.orDie(runtime.disposeEffect);
        expect(lifecycle).toEqual({ started: 1, stopped: 1 });
      }),
    );
  });

  it("records a failed changes stream as a load failure", () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project, string, "feed-lost">({
      name: "Projects.sync.changes-stream-failure",
      getKey: (project) => project.id,
      sync: {
        load: () => [{ id: "atlas", name: "Atlas", archived: false }],
        changes: () => Stream.fail("feed-lost" as const),
      },
    });
    const state = () => runtime.runSync(Effect.sync(() => Projects.state().get()));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        yield* eventually(() => state()._tag === "Failure");
      }).pipe(Effect.ensuring(Effect.orDie(runtime.disposeEffect))),
    );
  });
});

const eventually = (check: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (check()) {
        return;
      }
      yield* Effect.sleep("1 millis");
    }
    expect(check()).toBe(true);
  });

describe("Collection sync follow", () => {
  const ProjectSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    archived: Schema.Boolean,
  });

  // `optimistic` backs the collection with an inline adapter over the Resource
  // so it can also commit updates; otherwise the collection is `sync: ref`.
  const makeProjects = (name: string, optimistic = false) => {
    let rows: ReadonlyArray<Project> = [{ id: "atlas", name: "Atlas", archived: false }];
    const loads = { count: 0 };
    const Tag = Resource.tag(`${name}.tag`);
    const Family = Resource.family({
      name: `${name}.resource`,
      input: Schema.Literal("all"),
      output: Schema.Array(ProjectSchema),
      load: () =>
        Effect.sync(() => {
          loads.count++;
          return rows;
        }),
      provides: () => [Tag],
    });
    const ref = Family("all");
    const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
    const gate = { deferred: undefined as Deferred.Deferred<void> | undefined };
    const Projects = Collection.define<Project, string, Resource.LoadError<never>>({
      name: `${name}.collection`,
      getKey: (project) => project.id,
      sync: optimistic
        ? {
            load: () => Resource.prefetchEffect(ref),
            refetch: () => Resource.refreshEffect(ref),
            follow: () => Resource.changes(ref),
            update: (payload: Collection.SyncUpdatePayload<Project, string>) =>
              Effect.gen(function* () {
                updates.push(payload);
                if (gate.deferred !== undefined) {
                  yield* Deferred.await(gate.deferred);
                }
              }),
          }
        : ref,
    });
    return {
      Tag,
      ref,
      Projects,
      loads,
      updates,
      gate,
      setRows: (next: ReadonlyArray<Project>) => {
        rows = next;
      },
    };
  };

  it("reconciles rows when the Resource reloads after tag invalidation", () => {
    const runtime = makeRuntime();
    const fixture = makeProjects("Projects.follow.invalidate");
    const names = () =>
      runtime.runSync(Effect.sync(() => fixture.Projects.rows().map((row) => row.name)));

    return Effect.runPromise(
      runtime
        .provide(
          Effect.gen(function* () {
            yield* fixture.Projects.preloadEffect();
            expect(names()).toEqual(["Atlas"]);
            expect(fixture.loads.count).toBe(1);

            fixture.setRows([{ id: "atlas", name: "Atlas Prime", archived: false }]);
            yield* Resource.invalidateEffect(fixture.Tag);

            yield* eventually(() => names()[0] === "Atlas Prime");
            // The Resource reload fed the collection; the collection did not fetch again.
            expect(fixture.loads.count).toBe(2);
            expect(fixture.Projects.rows()).toMatchObject([{ id: "atlas", $synced: true }]);

            fixture.setRows([{ id: "lumen", name: "Lumen", archived: true }]);
            yield* Resource.refreshEffect(fixture.ref);
            yield* eventually(() => names()[0] === "Lumen");
            expect(fixture.loads.count).toBe(3);
          }),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.disposeEffect))),
    );
  });

  it("keeps pending optimistic updates on top of followed snapshots", () => {
    const runtime = makeRuntime();
    const fixture = makeProjects("Projects.follow.optimistic", true);
    const rows = () => runtime.runSync(Effect.sync(() => fixture.Projects.rows()));

    return Effect.runPromise(
      runtime
        .provide(
          Effect.gen(function* () {
            yield* fixture.Projects.preloadEffect();
            fixture.gate.deferred = yield* Deferred.make<void>();
            const mutation = yield* Effect.forkChild(
              fixture.Projects.updateEffect("atlas", { name: "Atlas Local" }),
            );
            yield* eventually(() => fixture.updates.length === 1);

            fixture.setRows([{ id: "atlas", name: "Atlas Remote", archived: true }]);
            yield* Resource.invalidateEffect(fixture.Tag);
            yield* eventually(() => fixture.loads.count === 2 && rows()[0]?.archived === true);
            // The followed snapshot rebases the pending patch instead of clobbering it.
            expect(rows()).toMatchObject([{ name: "Atlas Local", archived: true, $synced: false }]);

            yield* Deferred.succeed(fixture.gate.deferred, undefined);
            yield* Fiber.join(mutation);
            expect(rows()).toMatchObject([{ name: "Atlas Local", archived: true, $synced: true }]);
          }),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.disposeEffect))),
    );
  });

  it("follows hydrated state without fetching again on the client", () => {
    const server = makeRuntime();
    const client = makeRuntime();
    const fixture = makeProjects("Projects.follow.hydrate");
    const names = () =>
      client.runSync(Effect.sync(() => fixture.Projects.rows().map((row) => row.name)));

    return Effect.runPromise(
      Effect.gen(function* () {
        const { resources, collection } = yield* server.provide(
          Effect.gen(function* () {
            yield* fixture.Projects.preloadEffect();
            return {
              resources: yield* Resource.hydrationPayloadEffect([fixture.ref]),
              collection: yield* fixture.Projects.snapshotEffect(),
            };
          }),
        );
        expect(fixture.loads.count).toBe(1);

        yield* client.provide(
          Effect.gen(function* () {
            yield* Resource.hydrateEffect(resources);
            yield* fixture.Projects.hydrateEffect(collection);
            yield* fixture.Projects.preloadEffect();
            yield* Effect.sleep("5 millis");
            expect(fixture.loads.count).toBe(1);
            expect(names()).toEqual(["Atlas"]);

            fixture.setRows([{ id: "atlas", name: "Atlas Prime", archived: false }]);
            yield* Resource.invalidateEffect(fixture.Tag);
            yield* eventually(() => names()[0] === "Atlas Prime");
            expect(fixture.loads.count).toBe(2);
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.orDie(server.disposeEffect);
            yield* Effect.orDie(client.disposeEffect);
          }),
        ),
      ),
    );
  });

  it("stops following when the runtime that owns the collection store is disposed", () => {
    const runtime = makeRuntime();
    const lifecycle = { started: 0, stopped: 0 };
    const source = Effect.runSync(PubSub.unbounded<ReadonlyArray<Project>>());
    const Projects = Collection.define<Project>({
      name: "Projects.follow.dispose",
      getKey: (project) => project.id,
      sync: {
        name: "follow-dispose",
        load: () => [{ id: "atlas", name: "Atlas", archived: false }],
        follow: () =>
          Stream.fromPubSub(source).pipe(
            Stream.onStart(
              Effect.sync(() => {
                lifecycle.started++;
              }),
            ),
            Stream.ensuring(
              Effect.sync(() => {
                lifecycle.stopped++;
              }),
            ),
          ),
      },
    });
    const names = () => runtime.runSync(Effect.sync(() => Projects.rows().map((row) => row.name)));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preloadEffect());
        yield* runtime.provide(Projects.preloadEffect());
        yield* runtime.provide(Projects.refetchEffect());
        yield* eventually(() => lifecycle.started === 1);

        yield* PubSub.publish(source, [{ id: "atlas", name: "Atlas Live", archived: false }]);
        yield* eventually(() => names()[0] === "Atlas Live");

        yield* Effect.orDie(runtime.disposeEffect);
        expect(lifecycle).toEqual({ started: 1, stopped: 1 });
      }),
    );
  });
});
