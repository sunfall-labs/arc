import { EffectInputCallbackError, Resource, Server, makeRuntime, toEffect } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect, Option, PubSub } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeCollectionChangeFeedDispatcherEffect } from "../src/change-feed-dispatcher.js";
import { subscribeCollectionChangeFeedRuntimeEffect } from "../src/collection-change-feed-runtime.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("Collection.syncOptions", () => {
  it("adapts generic sync loads, refetches, and mutation handlers", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const inserts: Array<Collection.SyncInsertPayload<Project, string>> = [];
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
        const deletes: Array<Collection.SyncDeletePayload<Project, string>> = [];
        const load = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas", archived: false }
          ])
        );
        const refetch = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Prime", archived: false }
          ])
        );
        const Projects = Collection.define(Collection.syncOptions<Project>({
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
              })
          }
        }));

        expect(Collection.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.generic",
              sync: { adapter: "generic-test" }
            })
          ])
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
              mutations: [{ _tag: "Insert", key: "lumen" }]
            }
          }
        ]);
        expect(updates).toMatchObject([
          {
            updates: [
              {
                key: "atlas",
                previous: { id: "atlas", name: "Atlas Prime", archived: false },
                value: { id: "atlas", name: "Atlas Prime", archived: true },
                changes: { archived: true }
              }
            ]
          }
        ]);
        expect(deletes).toMatchObject([
          {
            deletes: [
              {
                key: "lumen",
                previous: { id: "lumen", name: "Lumen", archived: false }
              }
            ]
          }
        ]);
      })
    );
  });

  it("keeps synchronous sync adapter throws in the Effect error channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loadFailure = new Error("load exploded");
        const insertFailure = new Error("insert exploded");
        const LoadProjects = Collection.define(Collection.syncOptions<Project, string, Error>({
          name: "Projects.sync.throw.load",
          getKey: (project) => project.id,
          sync: {
            name: "throwing-load",
            load: () => {
              throw loadFailure;
            }
          }
        }));
        const InsertProjects = Collection.define(Collection.syncOptions<Project, string, Error>({
          name: "Projects.sync.throw.insert",
          getKey: (project) => project.id,
          sync: {
            name: "throwing-insert",
            insert: () => {
              throw insertFailure;
            }
          }
        }));

        const loadError = yield* Effect.flip(LoadProjects.preloadEffect());
        const insertError = yield* Effect.flip(
          InsertProjects.insertEffect({ id: "atlas", name: "Atlas", archived: false })
        );

        expect(loadError).toBeInstanceOf(EffectInputCallbackError);
        expect((loadError as EffectInputCallbackError).cause).toBe(loadFailure);
        expect(insertError).toBeInstanceOf(EffectInputCallbackError);
        expect((insertError as EffectInputCallbackError).cause).toBe(insertFailure);
        expect(InsertProjects.pendingMutations()).toEqual([]);
        expect(InsertProjects.rows()).toEqual([]);
      })
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
          loaded: [
            { id: "atlas", name: "Atlas", archived: false }
          ],
          refreshed: [
            { id: "atlas", name: "Atlas Prime", archived: false }
          ],
          load(this: MethodSyncAdapter) {
            return this.loaded;
          },
          refetch(this: MethodSyncAdapter) {
            return this.refreshed;
          }
        };
        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.method-receiver",
          getKey: (project) => project.id,
          sync
        }));

        yield* Projects.preloadEffect();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);

        yield* Projects.refetchEffect();
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
      })
    ));

  it("keeps first load versus refetch selection local to each runtime", () => {
    const first = makeRuntime();
    const second = makeRuntime();

    return Effect.runPromise(
      Effect.gen(function* () {
        const load = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas", archived: false }
          ])
        );
        const refetch = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas Prime", archived: false }
          ])
        );
        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.runtime-local-load",
          getKey: (project) => project.id,
          sync: {
            name: "runtime-local-load",
            load,
            refetch
          }
        }));

        yield* first.provide(Projects.preloadEffect());
        yield* second.provide(Projects.preloadEffect());

        expect(load).toHaveBeenCalledTimes(2);
        expect(refetch).not.toHaveBeenCalled();
        expect(first.runSync(Effect.sync(() => Projects.rows().map((project) => project.name)))).toEqual(["Atlas"]);
        expect(second.runSync(Effect.sync(() => Projects.rows().map((project) => project.name)))).toEqual(["Atlas"]);

        yield* first.provide(Projects.refetchEffect());

        expect(load).toHaveBeenCalledTimes(2);
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(first.runSync(Effect.sync(() => Projects.rows().map((project) => project.name)))).toEqual(["Atlas Prime"]);
        expect(second.runSync(Effect.sync(() => Projects.rows().map((project) => project.name)))).toEqual(["Atlas"]);
      }).pipe(
        Effect.ensuring(Effect.gen(function* () {
          yield* first.disposeEffect;
          yield* second.disposeEffect;
        }))
      )
    );
  });

  it("composes server sync adapters through the generic sync options seam", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const load = Server.fn<void, ReadonlyArray<Project>>(
          "Projects.sync.server.load",
          {
            handler: () =>
              Effect.succeed<ReadonlyArray<Project>>([
                { id: "atlas", name: "Atlas", archived: false }
              ])
          }
        );
        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.server",
          getKey: (project) => project.id,
          sync: Collection.serverSyncAdapter<Project>({
            name: "Projects.sync.server",
            getKey: (project) => project.id,
            load
          })
        }));

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      })
    );
  });

  it("uses Effect resources as collection sync adapters", () => {
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
            })
        });
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.resource",
          getKey: (project) => project.id,
          sync: Collection.resourceSyncAdapter({
            ref: ProjectRows(undefined),
            update: (payload) =>
              Effect.sync(() => {
                updates.push(payload);
              })
          })
        }));

        expect(Collection.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.resource",
              sync: { adapter: "resource:Projects.sync.resource.rows" }
            })
          ])
        );

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);

        yield* Projects.refetchEffect();

        expect(Projects.rows().map((project) => project.id)).toEqual(["lumen"]);

        yield* Projects.updateEffect("lumen", { name: "Lumen Prime" });

        expect(updates).toMatchObject([
          {
            updates: [
              {
                key: "lumen",
                previous: { id: "lumen", name: "Lumen", archived: true },
                value: { id: "lumen", name: "Lumen Prime", archived: true },
                changes: { name: "Lumen Prime" }
              }
            ]
          }
        ]);
      })
    );
  });

  it("uses query-client-shaped sources as collection sync adapters", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const queryKey = ["projects", "list"] as const;
        let rows: ReadonlyArray<Project> = [
          { id: "atlas", name: "Atlas", archived: false }
        ];
        const fetches: Array<ReadonlyArray<unknown>> = [];
        const invalidations: Array<ReadonlyArray<unknown>> = [];
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];

        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.query",
          getKey: (project) => project.id,
          sync: Collection.querySyncAdapter({
            name: "tanstack-query:projects",
            queryKey,
            queryFn: () => rows,
            queryClient: {
              fetchQuery: ({ queryKey, queryFn }) => {
                fetches.push(queryKey);
                return queryFn();
              },
              invalidateQueries: ({ queryKey }) => {
                invalidations.push(queryKey);
                rows = [{ id: "atlas", name: "Atlas Prime", archived: false }];
              }
            },
            update: (payload) =>
              Effect.sync(() => {
                updates.push(payload);
              })
          })
        }));

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(fetches).toEqual([queryKey]);

        yield* Projects.refetchEffect();

        expect(invalidations).toEqual([queryKey]);
        expect(fetches).toEqual([queryKey, queryKey]);
        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
        expect(Collection.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.query",
              sync: { adapter: "tanstack-query:projects" }
            })
          ])
        );

        yield* Projects.updateEffect("atlas", { archived: true });

        expect(invalidations).toEqual([queryKey, queryKey]);
        expect(updates).toMatchObject([
          {
            updates: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas Prime", archived: true },
                changes: { archived: true }
              }
            ]
          }
        ]);
      })
    );
  });

  it("owns query sync keys after adapter construction", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const filter = { archived: false };
        const queryKey: Array<unknown> = ["projects", filter];
        const fetches: Array<ReadonlyArray<unknown>> = [];
        const invalidations: Array<ReadonlyArray<unknown>> = [];

        const sync = Collection.querySyncAdapter<Project>({
          queryKey,
          queryFn: () => [{ id: "atlas", name: "Atlas", archived: false }],
          queryClient: {
            fetchQuery: ({ queryKey, queryFn }) => {
              fetches.push(queryKey);
              return queryFn();
            },
            invalidateQueries: ({ queryKey }) => {
              invalidations.push(queryKey);
            }
          }
        });

        queryKey[0] = "mutated";
        queryKey.push("later");
        filter.archived = true;

        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.query-key-owned",
          getKey: (project) => project.id,
          sync
        }));

        expect(Collection.diagnostics().collections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "Projects.sync.query-key-owned",
              sync: { adapter: "query:projects" }
            })
          ])
        );

        yield* Projects.preloadEffect();
        yield* Projects.refetchEffect();

        expect(fetches).toEqual([
          ["projects", { archived: false }],
          ["projects", { archived: false }]
        ]);
        expect(invalidations).toEqual([
          ["projects", { archived: false }]
        ]);
      })
    );
  });

  it("preserves query sync receivers for method-style queryFn callbacks", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        interface MethodQueryOptions extends Collection.QuerySyncAdapterOptions<Project> {
          readonly rows: ReadonlyArray<Project>;
        }

        const queryKey = ["projects", "method-query-fn"] as const;
        const options: MethodQueryOptions = {
          name: "method-query-fn",
          queryKey,
          rows: [
            { id: "atlas", name: "Atlas", archived: false }
          ],
          queryFn(this: MethodQueryOptions) {
            return this.rows;
          },
          queryClient: {
            fetchQuery: ({ queryFn }) => queryFn()
          }
        };
        const Projects = Collection.define(Collection.syncOptions<Project>({
          name: "Projects.sync.query-method-receiver",
          getKey: (project) => project.id,
          sync: Collection.querySyncAdapter(options)
        }));

        yield* Projects.preloadEffect();

        expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
      })
    );
  });

  it("uses best-effort query-sync mutation invalidation by default", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const queryKey = ["projects", "invalidate-fails"] as const;
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
        const Projects = Collection.define(Collection.syncOptions<Project, string, string>({
          name: "Projects.sync.query-invalidate-fails",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ],
          sync: Collection.querySyncAdapter({
            queryKey,
            queryFn: () => [{ id: "atlas", name: "Atlas", archived: false }],
            queryClient: {
              fetchQuery: ({ queryFn }) => queryFn(),
              invalidateQueries: () => Effect.fail("invalidate failed")
            },
            update: (payload) =>
              Effect.sync(() => {
                updates.push(payload);
              })
          })
        }));

        yield* Projects.updateEffect("atlas", { archived: true });

        expect(updates).toHaveLength(1);
        expect(Projects.pendingMutations()).toEqual([]);
        expect(Projects.get("atlas")).toMatchObject({
          archived: true,
          $synced: true
        });
      })
    );
  });

  it("rolls back query-sync mutations when rollback-on-failure invalidation fails", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const queryKey = ["projects", "rollback-invalidate-fails"] as const;
        const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
        const Projects = Collection.define(Collection.syncOptions<Project, string, string>({
          name: "Projects.sync.query-rollback-invalidate-fails",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ],
          sync: Collection.querySyncAdapter({
            queryKey,
            queryFn: () => [{ id: "atlas", name: "Atlas", archived: false }],
            mutationInvalidation: "rollback-on-failure",
            queryClient: {
              fetchQuery: ({ queryFn }) => queryFn(),
              invalidateQueries: () => Effect.fail("invalidate failed")
            },
            update: (payload) =>
              Effect.sync(() => {
                updates.push(payload);
              })
          })
        }));

        const failure = yield* Effect.flip(Projects.updateEffect("atlas", { archived: true }));

        expect(failure).toBe("invalidate failed");
        expect(updates).toHaveLength(1);
        expect(Projects.pendingMutations()).toEqual([]);
        expect(Projects.get("atlas")).toMatchObject({
          archived: false,
          $synced: true
        });
      })
    );
  });

  it("subscribes scoped change-feed adapters into collection changes", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync.feed",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false },
            { id: "lumen", name: "Lumen", archived: false }
          ]
        });
        let emit!: Collection.ChangeFeedContext<Project>["emit"];
        let unsubscribed = 0;
        const feed: Collection.ChangeFeedAdapter<Project> = {
          name: "projects-feed",
          subscribe: (context) => {
            expect(context.collection).toBe("Projects.sync.feed");
            emit = context.emit;
            return () =>
              Effect.sync(() => {
                unsubscribed++;
              });
          }
        };

        yield* Effect.scoped(Effect.gen(function* () {
          yield* Collection.subscribeChangesEffect(Projects, feed);
          yield* toEffect(emit([
            { _tag: "Upsert", value: { id: "atlas", name: "Atlas Prime", archived: false } },
            { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } },
            { _tag: "Delete", key: "lumen" }
          ], { origin: "remote", synced: true }));

          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "orion"]);
          expect(Projects.get("atlas")).toMatchObject({
            name: "Atlas Prime",
            $origin: "remote",
            $synced: true
          });
        }));

        expect(unsubscribed).toBe(1);
      })
    );
  });

  it("publishes change-feed unsubscribe failures before swallowing them", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const unsubscribeFailure = new Error("unsubscribe exploded");
          const Projects = Collection.define<Project>({
            name: "Projects.sync.feed-unsubscribe-failure",
            getKey: (project) => project.id
          });
          const feed: Collection.ChangeFeedAdapter<Project> = {
            name: "projects-unsubscribe-failure-feed",
            subscribe: () => () => {
              throw unsubscribeFailure;
            }
          };

          const subscription = yield* Collection.subscribeEventsEffect();
          yield* Effect.scoped(Collection.subscribeChangesEffect(Projects, feed));

          const event = yield* PubSub.take(subscription).pipe(
            Effect.timeoutOption("20 millis")
          );

          expect(Option.isSome(event)).toBe(true);
          expect(event.value).toMatchObject({
            _tag: "CollectionChangeFeedFailure",
            collection: "Projects.sync.feed-unsubscribe-failure"
          });
          expect(event.value.error).toBeInstanceOf(EffectInputCallbackError);
          expect((event.value.error as EffectInputCallbackError).cause).toBe(unsubscribeFailure);
        })
      )
    ));

  it("publishes change-feed unsubscribe defects before swallowing them", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Projects = Collection.define<Project>({
            name: "Projects.sync.feed-unsubscribe-defect",
            getKey: (project) => project.id
          });
          const feed: Collection.ChangeFeedAdapter<Project> = {
            name: "projects-unsubscribe-defect-feed",
            subscribe: () => ({
              unsubscribe: () => Effect.die("cleanup-defect")
            })
          };

          const subscription = yield* Collection.subscribeEventsEffect();
          yield* Effect.scoped(Collection.subscribeChangesEffect(Projects, feed));

          const event = yield* PubSub.take(subscription).pipe(
            Effect.timeoutOption("20 millis")
          );

          expect(Option.isSome(event)).toBe(true);
          expect(event.value).toMatchObject({
            _tag: "CollectionChangeFeedFailure",
            collection: "Projects.sync.feed-unsubscribe-defect"
          });
          expect(String(event.value.error)).toContain("cleanup-defect");
        })
      )
    ));

  it("binds Effect change-feed emitters to the subscribed Collection store", () => {
    const first = makeRuntime();
    const second = makeRuntime();

    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync.feed-runtime-local",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ]
        });
        let emit!: Collection.ChangeFeedContext<Project>["emit"];
        const feed: Collection.ChangeFeedAdapter<Project> = {
          name: "projects-runtime-local-feed",
          subscribe: (context) => {
            emit = context.emit;
          }
        };

        yield* Effect.scoped(Effect.gen(function* () {
          yield* first.provide(Collection.subscribeChangesEffect(Projects, feed));
          yield* second.provide(toEffect(emit([
            { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } }
          ], { origin: "remote", synced: true })));

          expect(first.runSync(Effect.sync(() => Projects.rows().map((project) => project.id)))).toEqual([
            "atlas",
            "orion"
          ]);
          expect(second.runSync(Effect.sync(() => Projects.rows().map((project) => project.id)))).toEqual([
            "atlas"
          ]);
        }));
      }).pipe(
        Effect.ensuring(Effect.gen(function* () {
          yield* first.disposeEffect;
          yield* second.disposeEffect;
        }))
      )
    );
  });

  it("lets host-callback change-feed adapters emit without running Effects themselves", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync.feed-host-callback",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ]
        });
        let emitChanges!: Collection.ChangeFeedContext<Project>["emitChanges"];
        let unsubscribed = 0;
        const feed: Collection.ChangeFeedAdapter<Project> = {
          name: "projects-host-feed",
          subscribe: (context) => {
            emitChanges = context.emitChanges;
            return () =>
              Effect.sync(() => {
                unsubscribed++;
              });
          }
        };

        yield* Effect.scoped(Effect.gen(function* () {
          yield* Collection.subscribeChangesEffect(Projects, feed);
          emitChanges([
            { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } }
          ], { origin: "remote", synced: true });

          yield* Effect.sleep("0 millis");

          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas", "orion"]);
          expect(Projects.get("orion")).toMatchObject({
            name: "Orion",
            $origin: "remote",
            $synced: true
          });
        }));

        expect(unsubscribed).toBe(1);
      })
    );
  });

  it("publishes meaningful host-callback change-feed defect failures", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const defect = new Error("change feed apply defect");
          const failures: unknown[] = [];
          let emitChanges!: Collection.ChangeFeedContext<Project>["emitChanges"];

          yield* subscribeCollectionChangeFeedRuntimeEffect<Project, string, never, never>({
            collection: "Projects.sync.feed-host-callback-defect",
            adapter: {
              name: "projects-host-feed-defect",
              subscribe: (context) => {
                emitChanges = context.emitChanges;
              }
            },
            applyChanges: () => Effect.die(defect),
            publishFailure: (error) =>
              Effect.sync(() => {
                failures.push(error);
              })
          });

          emitChanges([
            { _tag: "Upsert", value: { id: "orion", name: "Orion", archived: true } }
          ]);
          yield* Effect.sleep("0 millis");

          expect(failures).toEqual([defect]);
        })
      )
    ));

  it("drops host-callback change-feed emissions after dispatcher shutdown", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* makeCollectionChangeFeedDispatcherEffect<Project, string>();

        expect(dispatcher.emitChanges([
          { _tag: "Upsert", value: { id: "atlas", name: "Atlas", archived: false } }
        ])).toBe(true);

        const first = yield* dispatcher.takeEffect();
        expect(first.changes).toMatchObject([
          { _tag: "Upsert", value: { id: "atlas" } }
        ]);

        yield* dispatcher.shutdownEffect();

        expect(dispatcher.emitChanges([
          { _tag: "Upsert", value: { id: "late", name: "Late", archived: true } }
        ])).toBe(false);
      })
    ));

  it("ignores late host-callback change-feed emissions after subscription scope release", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync.feed-late-host-callback",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ]
        });
        let emitChanges!: Collection.ChangeFeedContext<Project>["emitChanges"];
        const feed: Collection.ChangeFeedAdapter<Project> = {
          name: "projects-late-host-feed",
          subscribe: (context) => {
            emitChanges = context.emitChanges;
          }
        };

        yield* Effect.scoped(Collection.subscribeChangesEffect(Projects, feed));

        emitChanges([
          { _tag: "Upsert", value: { id: "late", name: "Late", archived: true } }
        ]);
        yield* Effect.sleep("0 millis");

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      })
    ));

  it("ignores late direct change-feed emissions after subscription scope release", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.sync.feed-late-direct",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", archived: false }
          ]
        });
        let emit!: Collection.ChangeFeedContext<Project>["emit"];
        const feed: Collection.ChangeFeedAdapter<Project> = {
          name: "projects-late-direct-feed",
          subscribe: (context) => {
            emit = context.emit;
          }
        };

        yield* Effect.scoped(Collection.subscribeChangesEffect(Projects, feed));

        yield* toEffect(emit([
          { _tag: "Upsert", value: { id: "late", name: "Late", archived: true } }
        ]));
        yield* Effect.sleep("0 millis");

        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      })
    ));
});
