import {
  Action,
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
import { flipContractDefect } from "./contract-defect.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("Collection sync adapters", () => {
  it("adapts generic sync loads and refreshes", () => {
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
          name: "Projects.sync.generic",
          getKey: (project) => project.id,
          sync: {
            name: "generic-test",
            load,
            refresh: refetch,
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

        yield* Projects.preload();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(refetch).not.toHaveBeenCalled();

        yield* Projects.refresh();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(refetch).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it("reports synchronous sync adapter throws as defects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loadFailure = new Error("load exploded");
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
        const loadError = yield* flipContractDefect(LoadProjects.preload());

        expect(loadError).toBeInstanceOf(EffectInputCallbackError);
        expect((loadError as EffectInputCallbackError).cause).toBe(loadFailure);
      }),
    ));

  it("preserves sync adapter receivers for method-style load and refresh callbacks", () =>
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
          refresh(this: MethodSyncAdapter) {
            return this.refreshed;
          },
        };
        const Projects = Collection.define<Project>({
          name: "Projects.sync.method-receiver",
          getKey: (project) => project.id,
          sync,
        });

        yield* Projects.preload();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);

        yield* Projects.refresh();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
      }),
    ));

  it("keeps first load versus refresh selection local to each runtime", () => {
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
            refresh: refetch,
          },
        });

        yield* first.provide(Projects.preload());
        yield* second.provide(Projects.preload());

        expect(load).toHaveBeenCalledTimes(2);
        expect(refetch).not.toHaveBeenCalled();
        expect(
          first.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas"]);
        expect(
          second.runSync(Effect.sync(() => Projects.rows().map((project) => project.name))),
        ).toEqual(["Atlas"]);

        yield* first.provide(Projects.refresh());

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
            yield* Effect.orDie(first.dispose);
            yield* Effect.orDie(second.dispose);
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
        const Projects = Collection.define<
          Project,
          string,
          ServerClientError | EffectInputCallbackError
        >({
          name: "Projects.sync.server",
          getKey: (project) => project.id,
          sync: { load },
        });

        yield* Projects.preload();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      }),
    );
  });

  it("backs a collection with a Resource ref", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const ProjectRows = Resource.define<void, ReadonlyArray<Project>>({
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

        yield* Projects.preload();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);

        yield* Projects.refresh();

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
        yield* runtime.provide(Projects.preload());
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
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
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
              yield* Projects.preload();
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
        .pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
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
        yield* runtime.provide(Projects.preload());
        yield* runtime.provide(Projects.refresh());
        yield* eventually(() => lifecycle.started === 1);

        yield* PubSub.publish(remote, [
          { _tag: "Upsert", value: { id: "atlas", name: "Atlas Live", archived: false } },
        ]);
        yield* eventually(() => names()[0] === "Atlas Live");

        yield* Effect.orDie(runtime.dispose);
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
    const state = () => runtime.runSync(Effect.sync(() => Projects.result().get()));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Projects.preload());
        yield* eventually(() => state()._tag === "Failure");
      }).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
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

  const makeProjects = (name: string) => {
    let rows: ReadonlyArray<Project> = [{ id: "atlas", name: "Atlas", archived: false }];
    const loads = { count: 0 };
    const Tag = Resource.tag(`${name}.tag`);
    const Family = Resource.define({
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
    const Projects = Collection.define<Project, string, never>({
      name: `${name}.collection`,
      getKey: (project) => project.id,
      sync: ref,
    });
    return {
      Tag,
      ref,
      Projects,
      loads,
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
            yield* fixture.Projects.preload();
            expect(names()).toEqual(["Atlas"]);
            expect(fixture.loads.count).toBe(1);

            fixture.setRows([{ id: "atlas", name: "Atlas Prime", archived: false }]);
            yield* Resource.invalidate(fixture.Tag);

            yield* eventually(() => names()[0] === "Atlas Prime");
            // The Resource reload fed the collection; the collection did not fetch again.
            expect(fixture.loads.count).toBe(2);
            expect(fixture.Projects.rows()).toMatchObject([{ id: "atlas", $synced: true }]);

            fixture.setRows([{ id: "lumen", name: "Lumen", archived: true }]);
            yield* Resource.refresh(fixture.ref);
            yield* eventually(() => names()[0] === "Lumen");
            expect(fixture.loads.count).toBe(3);
          }),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("keeps an Action's optimistic patch on top of followed snapshots until it settles", () => {
    const runtime = makeRuntime();
    const fixture = makeProjects("Projects.follow.optimistic");
    const rows = () => runtime.runSync(Effect.sync(() => fixture.Projects.rows()));

    return Effect.runPromise(
      runtime
        .provide(
          Effect.gen(function* () {
            yield* fixture.Projects.preload();
            const started = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const Rename = Action.define({
              name: "Projects.follow.optimistic.rename",
              optimistic: (input: { readonly name: string }, transaction) =>
                transaction.update(fixture.Projects, "atlas", { name: input.name }),
              run: (input: { readonly name: string }) =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                  fixture.setRows([{ id: "atlas", name: input.name, archived: true }]);
                }),
              // The Action writes nothing to the collection: it reloads the Resource.
              invalidates: () => [fixture.Tag],
            });
            const rename = Action.use(Rename, { runtime });
            const submission = yield* Effect.forkChild(rename.submit({ name: "Atlas Local" }));
            yield* Deferred.await(started);
            expect(rows()).toMatchObject([
              { name: "Atlas Local", archived: false, $synced: false },
            ]);

            fixture.setRows([{ id: "atlas", name: "Atlas Remote", archived: true }]);
            yield* Resource.invalidate(fixture.Tag);
            yield* eventually(() => fixture.loads.count === 2 && rows()[0]?.archived === true);
            // The followed snapshot rebases the pending patch instead of clobbering it.
            expect(rows()).toMatchObject([{ name: "Atlas Local", archived: true, $synced: false }]);

            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(submission);
            // The invalidation reload replaced the committed patch with the server's row.
            yield* eventually(() => fixture.loads.count === 3);
            expect(rows()).toMatchObject([{ name: "Atlas Local", archived: true, $synced: true }]);
          }),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );
  });

  it("patches rows and Resource entries in one submission, keeping the followed base synced", () => {
    const runtime = makeRuntime();
    const fixture = makeProjects("Projects.follow.optimistic-resources");
    const ProjectById = Resource.define<string, Project>({
      name: "Projects.follow.optimistic-resources.byId",
      load: (id: string) => Effect.succeed<Project>({ id, name: "Atlas", archived: false }),
    });
    const rows = () => runtime.runSync(Effect.sync(() => fixture.Projects.rows()));
    const detail = () => runtime.runSync(Resource.read(ProjectById("atlas")));
    const list = () => runtime.runSync(Resource.read(fixture.ref));

    return Effect.runPromise(
      runtime
        .provide(
          Effect.gen(function* () {
            yield* fixture.Projects.preload();
            yield* Resource.preload(ProjectById("atlas"));
            const release = yield* Deferred.make<void, string>();
            const Rename = Action.define({
              name: "Projects.follow.optimistic-resources.rename",
              optimistic: (input: { readonly name: string }, transaction) =>
                Effect.all([
                  transaction.update(fixture.Projects, "atlas", { name: input.name }),
                  transaction.set(ProjectById("atlas"), (project) => ({
                    ...project,
                    name: input.name,
                  })),
                  // The Resource the collection follows: its readers see the
                  // patch, but the rows sync from its synced value.
                  transaction.set(fixture.ref, (projects) =>
                    projects.map((project) => ({ ...project, archived: true })),
                  ),
                ]),
              run: (_input: { readonly name: string }) => Deferred.await(release),
            });
            const submission = yield* Effect.forkChild(
              Action.use(Rename, { runtime }).submit({ name: "Atlas Local" }),
            );
            yield* eventually(() => detail().name === "Atlas Local");
            expect(rows()).toMatchObject([
              { name: "Atlas Local", archived: false, $synced: false },
            ]);
            expect(list()).toMatchObject([{ name: "Atlas", archived: true }]);

            // A followed reload rebases the row layer; the list patch stays a
            // reader-only layer over the reloaded value.
            fixture.setRows([{ id: "atlas", name: "Atlas Remote", archived: false }]);
            yield* Resource.invalidate(fixture.Tag);
            yield* eventually(() => fixture.loads.count === 2);
            expect(list()).toMatchObject([{ name: "Atlas Remote", archived: true }]);
            expect(rows()).toMatchObject([
              { name: "Atlas Local", archived: false, $synced: false },
            ]);

            yield* Deferred.fail(release, "nope");
            yield* Fiber.await(submission);
            expect(detail().name).toBe("Atlas");
            expect(list()).toMatchObject([{ name: "Atlas Remote", archived: false }]);
            expect(rows()).toMatchObject([
              { name: "Atlas Remote", archived: false, $synced: true },
            ]);
          }),
        )
        .pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
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
            yield* fixture.Projects.preload();
            return {
              resources: yield* Resource.hydrationPayload([fixture.ref]),
              collection: yield* fixture.Projects.snapshot(),
            };
          }),
        );
        expect(fixture.loads.count).toBe(1);

        yield* client.provide(
          Effect.gen(function* () {
            yield* Resource.hydrate(resources);
            yield* fixture.Projects.hydrate(collection);
            yield* fixture.Projects.preload();
            yield* Effect.sleep("5 millis");
            expect(fixture.loads.count).toBe(1);
            expect(names()).toEqual(["Atlas"]);

            fixture.setRows([{ id: "atlas", name: "Atlas Prime", archived: false }]);
            yield* Resource.invalidate(fixture.Tag);
            yield* eventually(() => names()[0] === "Atlas Prime");
            expect(fixture.loads.count).toBe(2);
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.orDie(server.dispose);
            yield* Effect.orDie(client.dispose);
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
        yield* runtime.provide(Projects.preload());
        yield* runtime.provide(Projects.preload());
        yield* runtime.provide(Projects.refresh());
        yield* eventually(() => lifecycle.started === 1);

        yield* PubSub.publish(source, [{ id: "atlas", name: "Atlas Live", archived: false }]);
        yield* eventually(() => names()[0] === "Atlas Live");

        yield* Effect.orDie(runtime.dispose);
        expect(lifecycle).toEqual({ started: 1, stopped: 1 });
      }),
    );
  });
});
