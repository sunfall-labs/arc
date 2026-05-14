import { makeResourceStore, makeRuntime, read, ResourceStore, runWithRuntime } from "@effect-ui/core";
import { Collection, CollectionRowNotFound, Query, UnknownCollectionIndex, and, eq, gt } from "@effect-ui/db";
import { Deferred, Effect, PubSub, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

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

interface TaggedTask extends Task {
  readonly tags: ReadonlyArray<string>;
}

interface RankedProject {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked" | "queued";
  readonly progress: number;
}

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

    expect(Collection.definitions().get("Projects.collection-diagnostics")).toBe(Projects);
    expect(Collection.diagnostics().collections).toEqual(
      expect.arrayContaining([
        {
          name: "Projects.collection-diagnostics",
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
        }
      ])
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

  it("keeps collection rows isolated by Effect UI runtime", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.runtime-isolation",
      getKey: (project) => project.id
    });

    try {
      await first.runPromise(Projects.writeInsertEffect({
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

    expect(firstSnapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
    expect(secondSnapshot.rows).toEqual([]);
  });

  it("publishes collection events through the active Collection store", async () => {
    const runtime = makeRuntime();
    const Projects = Collection.define<Project>({
      name: "Projects.collection-store-events",
      getKey: (project) => project.id
    });

    try {
      const events = await runtime.runPromise(
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
      await first.runPromise(Projects.writeInsertEffect([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]));
      await second.runPromise(Projects.writeInsertEffect({
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

      await first.runPromise(Projects.writeUpdateEffect("lumen", { status: "active", progress: 66 }));

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
      await first.runPromise(Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }, { origin: "local", synced: false }));

      const snapshot = await first.runPromise(Projects.snapshotEffect());

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

      await second.runPromise(Projects.hydrateEffect(snapshot));

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

  it("persists and restores collection snapshots through a storage adapter", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const storage = Collection.memoryStorage();
    const Projects = Collection.define<Project>({
      name: "Projects.persist-restore",
      getKey: (project) => project.id
    });

    try {
      await first.runPromise(Projects.writeInsertEffect([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]));
      await first.runPromise(Projects.persistEffect(storage, { key: "projects-cache" }));

      expect(storage.values.has("projects-cache")).toBe(true);

      await second.runPromise(Projects.restoreEffect(storage, { key: "projects-cache" }));

      expect(runWithRuntime(second, () => Projects.rows().map((project) => project.name).sort())).toEqual([
        "Atlas",
        "Lumen"
      ]);
    } finally {
      await Effect.runPromise(first.disposeEffect);
      await Effect.runPromise(second.disposeEffect);
    }
  });

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
      const update = Effect.runPromise(Projects.updateEffect("atlas", { progress: 80 }));
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
      await second.runPromise(Projects.restoreEffect(storage, { key: "pending-projects-cache" }));

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
      await update;

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

  it("flushes restored pending update mutations through the handler", async () => {
    const first = makeRuntime();
    const second = makeRuntime();
    const release = Effect.runSync(Deferred.make<void>());
    const storage = Collection.memoryStorage();
    const persisted: Array<Project> = [];
    const handledTransactions: Array<string> = [];
    let update: Promise<unknown> | undefined;
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
      update = first.runPromise(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      await first.runPromise(Projects.persistEffect(storage, { key: "pending-flush-success-cache" }));
      await second.runPromise(Projects.restoreEffect(storage, { key: "pending-flush-success-cache" }));

      const flushed = await second.runPromise(Projects.flushPendingMutationsEffect());

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
      await update;
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
    let update: Promise<unknown> | undefined;
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
      update = first.runPromise(Projects.updateEffect("atlas", { progress: 80 }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      await first.runPromise(Projects.persistEffect(storage, { key: "pending-flush-failure-cache" }));
      await second.runPromise(Projects.restoreEffect(storage, { key: "pending-flush-failure-cache" }));

      await expect(second.runPromise(Projects.flushPendingMutationsEffect())).rejects.toBe("offline");

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
      await update;
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
      await first.runPromise(Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        status: "active",
        progress: 72
      }));
      await first.runPromise(Tasks.writeInsertEffect({
        id: "t1",
        projectId: "atlas",
        title: "Retry workflow",
        done: false
      }));

      const payload = await first.runPromise(Collection.dehydrateEffect([Projects, Tasks]));

      await second.runPromise(Collection.hydratePayloadEffect([Projects, Tasks], payload));

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

  it("fails typed updates when the row is missing", async () => {
    const Projects = Collection.define<Project>({
      name: "Projects.missing-row",
      getKey: (project) => project.id
    });

    await expect(Effect.runPromise(Projects.updateEffect("missing", { progress: 80 }))).rejects.toBeInstanceOf(CollectionRowNotFound);
  });
});

describe("Query", () => {
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

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { id: "lumen-2" }));

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
});
