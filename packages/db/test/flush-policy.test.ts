import { makeRuntime, runWithRuntime } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { flushCollectionsPendingMutationsEffect } from "../src/flush-policy.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly done: boolean;
}

const pendingProjectSnapshot = (collection: string): Collection.Snapshot<Project, string> => ({
  name: collection,
  rows: [
    {
      key: "atlas",
      value: { id: "atlas", name: "Atlas", progress: 80 },
      synced: false,
      origin: "local"
    }
  ],
  pendingMutations: [
    {
      transaction: {
        id: `${collection}:tx`,
        collection,
        mutations: [
          {
            _tag: "Update",
            key: "atlas",
            previous: { id: "atlas", name: "Atlas", progress: 72 },
            value: { id: "atlas", name: "Atlas", progress: 80 },
            changes: { progress: 80 }
          }
        ]
      },
      rollbackRows: [
        {
          key: "atlas",
          row: {
            key: "atlas",
            value: { id: "atlas", name: "Atlas", progress: 72 },
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
});

describe("flushCollectionsPendingMutationsEffect", () => {
  it("flushes pending mutations across multiple collections", async () => {
    const runtime = makeRuntime();
    const persistedProjects: Array<Project> = [];
    const persistedTasks: Array<Task> = [];
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.flush-policy.multi",
      getKey: (project) => project.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedProjects.push(...updates.map((update) => update.value));
        })
    });
    const Tasks = Collection.define<Task, string, never>({
      name: "Tasks.flush-policy.multi",
      getKey: (task) => task.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedTasks.push(...updates.map((update) => update.value));
        })
    });

    try {
      await runtime.runPromise(Projects.hydrateEffect({
        name: Projects.name,
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Atlas", progress: 80 },
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "project-tx",
              collection: Projects.name,
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous: { id: "atlas", name: "Atlas", progress: 72 },
                  value: { id: "atlas", name: "Atlas", progress: 80 },
                  changes: { progress: 80 }
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", progress: 72 },
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
      await runtime.runPromise(Tasks.hydrateEffect({
        name: Tasks.name,
        rows: [
          {
            key: "t1",
            value: { id: "t1", projectId: "atlas", title: "Sync queue", done: true },
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "task-tx",
              collection: Tasks.name,
              mutations: [
                {
                  _tag: "Update",
                  key: "t1",
                  previous: { id: "t1", projectId: "atlas", title: "Sync queue", done: false },
                  value: { id: "t1", projectId: "atlas", title: "Sync queue", done: true },
                  changes: { done: true }
                }
              ]
            },
            rollbackRows: [
              {
                key: "t1",
                row: {
                  key: "t1",
                  value: { id: "t1", projectId: "atlas", title: "Sync queue", done: false },
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

      const results = await runtime.runPromise(
        flushCollectionsPendingMutationsEffect([Projects, Tasks])
      );

      expect(results).toMatchObject([
        {
          _tag: "Flushed",
          collection: Projects.name,
          transactions: [{ id: "project-tx", collection: Projects.name }]
        },
        {
          _tag: "Flushed",
          collection: Tasks.name,
          transactions: [{ id: "task-tx", collection: Tasks.name }]
        }
      ]);
      expect(persistedProjects).toEqual([
        { id: "atlas", name: "Atlas", progress: 80 }
      ]);
      expect(persistedTasks).toEqual([
        { id: "t1", projectId: "atlas", title: "Sync queue", done: true }
      ]);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Tasks.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true
      });
      expect(runWithRuntime(runtime, () => Tasks.get("t1"))).toMatchObject({
        done: true,
        $synced: true
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("skips collections matched by the skip predicate", async () => {
    const runtime = makeRuntime();
    const persistedProjects: Array<Project> = [];
    const persistedTasks: Array<Task> = [];
    const skipChecks: Array<string> = [];
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.flush-policy.skip",
      getKey: (project) => project.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedProjects.push(...updates.map((update) => update.value));
        })
    });
    const Tasks = Collection.define<Task, string, never>({
      name: "Tasks.flush-policy.skip",
      getKey: (task) => task.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedTasks.push(...updates.map((update) => update.value));
        })
    });

    try {
      await runtime.runPromise(Projects.hydrateEffect({
        name: Projects.name,
        rows: [
          {
            key: "atlas",
            value: { id: "atlas", name: "Atlas", progress: 80 },
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "project-skip-tx",
              collection: Projects.name,
              mutations: [
                {
                  _tag: "Update",
                  key: "atlas",
                  previous: { id: "atlas", name: "Atlas", progress: 72 },
                  value: { id: "atlas", name: "Atlas", progress: 80 },
                  changes: { progress: 80 }
                }
              ]
            },
            rollbackRows: [
              {
                key: "atlas",
                row: {
                  key: "atlas",
                  value: { id: "atlas", name: "Atlas", progress: 72 },
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
      await runtime.runPromise(Tasks.hydrateEffect({
        name: Tasks.name,
        rows: [
          {
            key: "t1",
            value: { id: "t1", projectId: "atlas", title: "Sync queue", done: true },
            synced: false,
            origin: "local"
          }
        ],
        pendingMutations: [
          {
            transaction: {
              id: "task-skip-tx",
              collection: Tasks.name,
              mutations: [
                {
                  _tag: "Update",
                  key: "t1",
                  previous: { id: "t1", projectId: "atlas", title: "Sync queue", done: false },
                  value: { id: "t1", projectId: "atlas", title: "Sync queue", done: true },
                  changes: { done: true }
                }
              ]
            },
            rollbackRows: [
              {
                key: "t1",
                row: {
                  key: "t1",
                  value: { id: "t1", projectId: "atlas", title: "Sync queue", done: false },
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

      const results = await runtime.runPromise(
        flushCollectionsPendingMutationsEffect([Projects, Tasks], {
          skip: ({ collection }) =>
            Effect.sync(() => {
              skipChecks.push(collection.name);
              return collection.name === Tasks.name;
            })
        })
      );

      expect(results).toMatchObject([
        {
          _tag: "Flushed",
          collection: Projects.name,
          transactions: [{ id: "project-skip-tx", collection: Projects.name }]
        },
        {
          _tag: "Skipped",
          collection: Tasks.name,
          transactions: []
        }
      ]);
      expect(skipChecks).toEqual([Projects.name, Tasks.name]);
      expect(persistedProjects).toEqual([
        { id: "atlas", name: "Atlas", progress: 80 }
      ]);
      expect(persistedTasks).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
      expect(runWithRuntime(runtime, () => Tasks.pendingMutations())).toMatchObject([
        {
          transaction: { id: "task-skip-tx", collection: Tasks.name },
          attempts: 0
        }
      ]);
      expect(runWithRuntime(runtime, () => Tasks.get("t1"))).toMatchObject({
        done: true,
        $synced: false
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("flushes pending mutations through a background sync adapter", async () => {
    const runtime = makeRuntime();
    const persistedProjects: Array<Project> = [];
    const adapterContexts: Array<Collection.BackgroundSyncAdapterContext> = [];
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.background-sync.flush",
      getKey: (project) => project.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedProjects.push(...updates.map((update) => update.value));
        })
    });

    try {
      await runtime.runPromise(Projects.hydrateEffect(pendingProjectSnapshot(Projects.name)));

      const result = await runtime.runPromise(
        Collection.backgroundSyncPendingMutationsEffect([Projects], {
          trigger: "online",
          adapter: {
            name: "test-online",
            shouldFlush: (context) =>
              Effect.sync(() => {
                adapterContexts.push(context);
                return true;
              })
          }
        })
      );

      expect(result).toMatchObject({
        _tag: "Flushed",
        trigger: "online",
        adapter: "test-online",
        pending: [
          {
            collection: Projects.name,
            transactions: [{ id: `${Projects.name}:tx`, collection: Projects.name }]
          }
        ],
        results: [
          {
            _tag: "Flushed",
            collection: Projects.name,
            transactions: [{ id: `${Projects.name}:tx`, collection: Projects.name }]
          }
        ]
      });
      expect(adapterContexts).toMatchObject([
        {
          trigger: "online",
          collections: [Projects.name],
          pending: [
            {
              collection: Projects.name,
              transactions: [{ id: `${Projects.name}:tx`, collection: Projects.name }]
            }
          ]
        }
      ]);
      expect(persistedProjects).toEqual([
        { id: "atlas", name: "Atlas", progress: 80 }
      ]);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toEqual([]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("defers background sync when the adapter is not ready", async () => {
    const runtime = makeRuntime();
    const persistedProjects: Array<Project> = [];
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.background-sync.defer",
      getKey: (project) => project.id,
      onUpdate: (updates) =>
        Effect.sync(() => {
          persistedProjects.push(...updates.map((update) => update.value));
        })
    });

    try {
      await runtime.runPromise(Projects.hydrateEffect(pendingProjectSnapshot(Projects.name)));

      const result = await runtime.runPromise(
        Collection.backgroundSyncPendingMutationsEffect([Projects], {
          trigger: "visibility",
          adapter: {
            name: "test-hidden",
            shouldFlush: () => Effect.succeed(false)
          }
        })
      );

      expect(result).toMatchObject({
        _tag: "Deferred",
        trigger: "visibility",
        adapter: "test-hidden",
        pending: [
          {
            collection: Projects.name,
            transactions: [{ id: `${Projects.name}:tx`, collection: Projects.name }]
          }
        ],
        results: []
      });
      expect(persistedProjects).toEqual([]);
      expect(runWithRuntime(runtime, () => Projects.pendingMutations())).toMatchObject([
        {
          transaction: { id: `${Projects.name}:tx`, collection: Projects.name },
          attempts: 0
        }
      ]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps background sync idle when no collections have pending mutations", async () => {
    const runtime = makeRuntime();
    let adapterChecks = 0;
    const Projects = Collection.define<Project, string, never>({
      name: "Projects.background-sync.idle",
      getKey: (project) => project.id
    });

    try {
      const result = await runtime.runPromise(
        Collection.backgroundSyncPendingMutationsEffect([Projects], {
          adapter: {
            name: "test-idle",
            shouldFlush: () =>
              Effect.sync(() => {
                adapterChecks++;
                return true;
              })
          }
        })
      );

      expect(result).toEqual({
        _tag: "Idle",
        trigger: "manual",
        pending: [
          {
            collection: Projects.name,
            transactions: []
          }
        ],
        results: []
      });
      expect(adapterChecks).toBe(0);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });
});
