import { Resource, Server, toEffect } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("Collection.syncOptions", () => {
  it("adapts generic sync loads, refetches, and mutation handlers", async () => {
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

    await Projects.preload();

    expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();

    await Projects.refetch();

    expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);

    await Projects.insert({ id: "lumen", name: "Lumen", archived: false });
    await Projects.update("atlas", { archived: true });
    await Projects.delete("lumen");

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
  });

  it("composes server sync adapters through the generic sync options seam", async () => {
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

    await Projects.preload();

    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
  });

  it("uses Effect resources as collection sync adapters", async () => {
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

    await Projects.preload();

    expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);

    await Projects.refetch();

    expect(Projects.rows().map((project) => project.id)).toEqual(["lumen"]);

    await Projects.update("lumen", { name: "Lumen Prime" });

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
  });

  it("uses query-client-shaped sources as collection sync adapters", async () => {
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

    await Projects.preload();

    expect(Projects.rows().map((project) => project.name)).toEqual(["Atlas"]);
    expect(fetches).toEqual([queryKey]);

    await Projects.refetch();

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

    await Projects.update("atlas", { archived: true });

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
  });

  it("subscribes scoped change-feed adapters into collection changes", async () => {
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

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
    })));

    expect(unsubscribed).toBe(1);
  });
});
