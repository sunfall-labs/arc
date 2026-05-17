import { makeRuntime, runWithRuntime, type ReadableSignal } from "@sunfall/arc-core";
import {
  Collection,
  QueryEvaluationError,
  type CollectionLoadState,
  type CollectionRuntimeError,
} from "@sunfall/arc-db";
import { useCollection, useLiveQuery } from "@sunfall/arc-solid-db";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { makeSolidDbReactiveBinding } from "../src/shared.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

const makeDelayedCleanupRuntime = () => {
  const runtime = makeRuntime();
  let delayForks = false;
  const delayedRuntime = {
    ...runtime,
    runFork: ((
      effect: Effect.Effect<unknown, unknown, unknown>,
      options?: Parameters<typeof runtime.runFork>[1],
    ) =>
      runtime.runFork(
        (delayForks ? Effect.sleep("100 millis").pipe(Effect.andThen(effect)) : effect) as never,
        options,
      )) as typeof runtime.runFork,
  };

  return {
    runtime: delayedRuntime,
    delayForks: () => {
      delayForks = true;
    },
    disposeEffect: runtime.disposeEffect,
  };
};

describe("solid-db", () => {
  interface ProjectApi {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-solid-db/test/ProjectApi");

  interface ProjectMutationApi {
    readonly insert: (projects: ReadonlyArray<Project>) => Effect.Effect<void>;
    readonly update: (
      projects: ReadonlyArray<{ readonly key: string; readonly value: Project }>,
    ) => Effect.Effect<void>;
    readonly delete: (projects: ReadonlyArray<{ readonly key: string }>) => Effect.Effect<void>;
  }

  const ProjectMutationApi = Context.Service<ProjectMutationApi>(
    "@sunfall/arc-solid-db/test/ProjectMutationApi",
  );

  it("adapts collections and live queries to Solid accessors", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "SolidDb.projects",
          getKey: (project) => project.id,
          indexes: {
            active: (project) => project.active,
          },
          initialData: [
            { id: "atlas", name: "Atlas", active: true },
            { id: "lumen", name: "Lumen", active: false },
          ],
        });

        const handles = createRoot((rootDispose) => {
          dispose = rootDispose;
          return {
            projects: useCollection(Projects, { preload: false }),
            activeNames: useLiveQuery(
              (query) =>
                query
                  .from({ project: Projects })
                  .where(({ project }) => project.active)
                  .select(({ project }) => project.name)
                  .orderBy(({ project }) => project.name),
              { preload: false },
            ),
          };
        });

        yield* Effect.sleep("0 millis");

        expect(handles.projects.rows().map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
        expect(handles.projects.get("atlas")?.name).toBe("Atlas");
        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual([
          "atlas",
        ]);
        expect(handles.projects.firstByIndex("active", false)?.id).toBe("lumen");
        expect(handles.activeNames.data()).toEqual(["Atlas"]);

        yield* Projects.writeUpdateEffect("lumen", { active: true });

        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual([
          "atlas",
          "lumen",
        ]);
        expect(handles.activeNames.data()).toEqual(["Atlas", "Lumen"]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("disposes collection and live-query subscriptions with the Solid owner", () => {
    let dispose: (() => void) | undefined;
    let activeSubscriptions = 0;

    const trackSignalSubscriptions = <A>(signal: ReadableSignal<A>): ReadableSignal<A> => ({
      ...signal,
      get: () => signal.get(),
      subscribe: (listener) => {
        activeSubscriptions++;
        const unsubscribe = signal.subscribe(listener);
        return () => {
          activeSubscriptions--;
          unsubscribe();
        };
      },
    });

    const Projects = Collection.define<Project>({
      name: "SolidDb.cleanup.projects",
      getKey: (project) => project.id,
      indexes: {
        active: (project) => project.active,
      },
      initialData: [
        { id: "atlas", name: "Atlas", active: true },
        { id: "lumen", name: "Lumen", active: false },
      ],
    });

    const version = trackSignalSubscriptions(Projects.version());
    const state = trackSignalSubscriptions(Projects.state());
    const trackedProjects = Projects as typeof Projects & {
      version: () => ReadableSignal<number>;
      state: () => ReadableSignal<CollectionLoadState<CollectionRuntimeError<never>>>;
    };
    trackedProjects.version = () => version;
    trackedProjects.state = () => state;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        useCollection(Projects, { preload: false });
        useLiveQuery(
          (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.active)
              .select(({ project }) => project.name)
              .orderBy(({ project }) => project.name),
          { preload: false },
        );
      });

      expect(activeSubscriptions).toBe(4);
      dispose?.();
      dispose = undefined;
      expect(activeSubscriptions).toBe(0);
    } finally {
      dispose?.();
    }
  });

  it("exposes automatic preload failures through typed Solid accessors", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = { _tag: "ProjectLoadError" as const, message: "blocked" };
        const observedCollectionFailures: Array<unknown> = [];
        const observedLiveFailures: Array<unknown> = [];
        const Projects = Collection.define<Project, string, typeof failure>({
          name: "SolidDb.preload-failure.projects",
          getKey: (project) => project.id,
          load: () => Effect.fail(failure),
        });

        const handles = createRoot((rootDispose) => {
          dispose = rootDispose;
          return {
            projects: useCollection(Projects, {
              onPreloadFailure: (error) =>
                Effect.sync(() => {
                  observedCollectionFailures.push(error);
                }).pipe(Effect.andThen(Effect.fail("collection observer failed"))),
            }),
            activeNames: useLiveQuery(
              (query) =>
                query
                  .from({ project: Projects })
                  .where(({ project }) => project.active)
                  .select(({ project }) => project.name),
              {
                onPreloadFailure: (error) =>
                  Effect.sync(() => {
                    observedLiveFailures.push(error);
                  }).pipe(Effect.andThen(Effect.fail("live query observer failed"))),
              },
            ),
          };
        });

        yield* Effect.sleep("0 millis");

        expect(handles.projects.preloadFailure()).toEqual(failure);
        expect(handles.activeNames.preloadFailure()).toEqual(failure);
        expect(observedCollectionFailures).toEqual([failure]);
        expect(observedLiveFailures).toEqual([failure]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("ignores automatic preload failures from superseded DB generations after refetch", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const staleStarted = yield* Deferred.make<void>();
        const staleFailure = "stale-db-preload-failed" as const;
        const staleRelease = yield* Deferred.make<void, typeof staleFailure>();
        const observedFailures: Array<unknown> = [];
        const Projects = Collection.define<Project, string, typeof staleFailure>({
          name: "SolidDb.preload-superseded-db-generation.projects",
          getKey: (project) => project.id,
          load: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(staleStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(staleRelease);
              return [{ id: "atlas", name: "Atlas Slow", active: true }];
            }),
          refetch: () =>
            Effect.succeed<ReadonlyArray<Project>>([
              { id: "atlas", name: "Atlas Fresh", active: true },
            ]),
        });

        const handle = createRoot((rootDispose) => {
          dispose = rootDispose;
          return useCollection(Projects, {
            onPreloadFailure: (error) => observedFailures.push(error),
          });
        });

        yield* Effect.sleep("0 millis");
        yield* Deferred.await(staleStarted);
        yield* handle.refetchEffect();

        expect(handle.rows().map((project) => project.name)).toEqual(["Atlas Fresh"]);

        yield* Deferred.fail(staleRelease, staleFailure);
        yield* Effect.sleep("20 millis");

        expect(handle.preloadFailure()).toBeUndefined();
        expect(observedFailures).toEqual([]);
        expect(handle.rows().map((project) => project.name)).toEqual(["Atlas Fresh"]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("captures invalid live query automatic preload failures before source side effects", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        let projectLoads = 0;
        let taskLoads = 0;
        const Projects = Collection.define<Project>({
          name: "SolidDb.invalid-live-preload.projects",
          getKey: (project) => project.id,
          load: () =>
            Effect.sync(() => {
              projectLoads++;
              return [{ id: "atlas", name: "Atlas", active: true }];
            }),
        });
        const Tasks = Collection.define<{ readonly id: string; readonly projectId: string }>({
          name: "SolidDb.invalid-live-preload.tasks",
          getKey: (task) => task.id,
          load: () =>
            Effect.sync(() => {
              taskLoads++;
              return [{ id: "task-1", projectId: "atlas" }];
            }),
        });

        const handle = createRoot((rootDispose) => {
          dispose = rootDispose;
          return useLiveQuery((query) =>
            query
              .from({ project: Projects })
              .joinIndexed("task", Tasks, ({ project }) => project.id, "missing")
              .select(({ project }) => project.name),
          );
        });

        yield* Effect.sleep("0 millis");

        expect(handle.preloadFailure()).toBeInstanceOf(QueryEvaluationError);
        expect(handle.preloadFailure()).toMatchObject({
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason:
              'Join source "task" uses unknown index "missing" on collection "SolidDb.invalid-live-preload.tasks".',
          },
        });
        expect(projectLoads).toBe(0);
        expect(taskLoads).toBe(0);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("ignores preload failure observer throws after recording failures", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = { _tag: "ProjectLoadError" as const, message: "blocked" };
        const observedCollectionFailures: Array<unknown> = [];
        const observedLiveFailures: Array<unknown> = [];
        const Projects = Collection.define<Project, string, typeof failure>({
          name: "SolidDb.preload-observer-throw.projects",
          getKey: (project) => project.id,
          load: () => Effect.fail(failure),
        });

        const handles = createRoot((rootDispose) => {
          dispose = rootDispose;
          return {
            projects: useCollection(Projects, {
              onPreloadFailure: (error) => {
                observedCollectionFailures.push(error);
                throw new Error("collection observer failed");
              },
            }),
            activeNames: useLiveQuery(
              (query) =>
                query
                  .from({ project: Projects })
                  .where(({ project }) => project.active)
                  .select(({ project }) => project.name),
              {
                onPreloadFailure: (error) => {
                  observedLiveFailures.push(error);
                  throw new Error("live query observer failed");
                },
              },
            ),
          };
        });

        yield* Effect.sleep("0 millis");

        expect(handles.projects.preloadFailure()).toEqual(failure);
        expect(handles.activeNames.preloadFailure()).toEqual(failure);
        expect(observedCollectionFailures).toEqual([failure]);
        expect(observedLiveFailures).toEqual([failure]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("ignores stale automatic preload failures after sources change", () => {
    let dispose: (() => void) | undefined;
    let delayed: ReturnType<typeof makeDelayedCleanupRuntime> | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const staleRelease = yield* Deferred.make<void>();
        const staleFailure = "stale-preload-failed" as const;
        const observedFailures: Array<unknown> = [];
        delayed = makeDelayedCleanupRuntime();
        const runtime = delayed;
        const ActiveProjects = Collection.define<Project>({
          name: "SolidDb.preload-stale-source.active",
          getKey: (project) => project.id,
        });
        const ArchivedProjects = Collection.define<Project>({
          name: "SolidDb.preload-stale-source.archived",
          getKey: (project) => project.id,
        });
        let selectArchive: ((value: boolean) => boolean) | undefined;

        const handle = createRoot((rootDispose) => {
          dispose = rootDispose;
          const [archive, setArchive] = createSignal(false);
          selectArchive = setArchive;
          return makeSolidDbReactiveBinding<typeof staleFailure>({
            runtime: runtime.runtime,
            sources: () => (archive() ? [ArchivedProjects] : [ActiveProjects]),
            preloadEffect: Effect.suspend(() =>
              archive()
                ? Effect.void
                : Deferred.await(staleRelease).pipe(Effect.andThen(Effect.fail(staleFailure))),
            ),
            onPreloadFailure: (error) => observedFailures.push(error),
          });
        });

        yield* Effect.sleep("0 millis");
        runtime.delayForks();
        selectArchive?.(true);
        handle.refreshSources();
        yield* Deferred.succeed(staleRelease, undefined);
        yield* Effect.sleep("20 millis");

        expect(handle.preloadFailure()).toBeUndefined();
        expect(observedFailures).toEqual([]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(Effect.suspend(() => delayed?.disposeEffect ?? Effect.void)),
      ),
    );
  });

  it("interrupts automatic preload when the Solid owner is disposed", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        let started = false;
        let interrupted = false;
        const observedFailures: Array<unknown> = [];
        const Projects = Collection.define<Project>({
          name: "SolidDb.preload-cleanup.projects",
          getKey: (project) => project.id,
          load: () =>
            Effect.sync(() => {
              started = true;
            }).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
        });

        createRoot((rootDispose) => {
          dispose = rootDispose;
          useCollection(Projects, {
            onPreloadFailure: (error) => observedFailures.push(error),
          });
        });

        yield* Effect.sleep("0 millis");
        expect(started).toBe(true);

        dispose?.();
        dispose = undefined;
        yield* Effect.sleep("0 millis");

        expect(interrupted).toBe(true);
        expect(observedFailures).toEqual([]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("ignores stale automatic preload failures after owner disposal", () => {
    let dispose: (() => void) | undefined;
    let delayed: ReturnType<typeof makeDelayedCleanupRuntime> | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const staleRelease = yield* Deferred.make<void>();
        const staleFailure = "stale-unmount-preload-failed" as const;
        const observedFailures: Array<unknown> = [];
        delayed = makeDelayedCleanupRuntime();
        const runtime = delayed;

        createRoot((rootDispose) => {
          dispose = rootDispose;
          makeSolidDbReactiveBinding<typeof staleFailure>({
            runtime: runtime.runtime,
            sources: [],
            preloadEffect: Deferred.await(staleRelease).pipe(
              Effect.andThen(Effect.fail(staleFailure)),
            ),
            onPreloadFailure: (error) => observedFailures.push(error),
          });
        });

        yield* Effect.sleep("0 millis");
        runtime.delayForks();
        dispose?.();
        dispose = undefined;
        yield* Deferred.succeed(staleRelease, undefined);
        yield* Effect.sleep("20 millis");

        expect(observedFailures).toEqual([]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(Effect.suspend(() => delayed?.disposeEffect ?? Effect.void)),
      ),
    );
  });

  it("binds returned collection and live-query Effects to the Solid runtime", () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        list: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: "Atlas", active: true },
              { id: "lumen", name: "Lumen", active: true },
            ];
          }),
      }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project, string, never, ProjectApi>({
          name: "SolidDb.runtime-bound-effects.projects",
          getKey: (project) => project.id,
          load: () => ProjectApi.use((api) => api.list()),
        });

        const handles = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return {
              projects: useCollection(Projects, { preload: false }),
              names: useLiveQuery(
                (query) =>
                  query
                    .from({ project: Projects })
                    .select(({ project }) => project.name)
                    .orderBy(({ project }) => project.name),
                { preload: false },
              ),
            };
          }),
        );

        yield* handles.projects.preloadEffect();
        yield* handles.names.refetchEffect();
        yield* Effect.sleep("0 millis");

        expect(loads).toBe(2);
        expect(handles.projects.rows().map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });

  it("adapts collection mutations and pending mutations to the Solid runtime", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const releaseInsert = yield* Deferred.make<void>();
        const calls: Array<string> = [];
        const runtime = makeRuntime(
          Layer.succeed(ProjectMutationApi)({
            insert: (projects) =>
              Effect.sync(() => {
                calls.push(`insert:${projects.map((project) => project.id).join(",")}`);
              }).pipe(Effect.andThen(Deferred.await(releaseInsert))),
            update: (projects) =>
              Effect.sync(() => {
                calls.push(`update:${projects.map((project) => project.key).join(",")}`);
              }),
            delete: (projects) =>
              Effect.sync(() => {
                calls.push(`delete:${projects.map((project) => project.key).join(",")}`);
              }),
          }),
        );
        const Projects = Collection.define<Project, string, never, ProjectMutationApi>({
          name: "SolidDb.collection-adapter.projects",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", active: true }],
          onInsert: (projects) => ProjectMutationApi.use((api) => api.insert(projects)),
          onUpdate: (projects) => ProjectMutationApi.use((api) => api.update(projects)),
          onDelete: (projects) => ProjectMutationApi.use((api) => api.delete(projects)),
        });

        try {
          const projects = runWithRuntime(runtime, () =>
            createRoot((rootDispose) => {
              dispose = rootDispose;
              return useCollection(Projects, { preload: false });
            }),
          );

          const insert = Effect.runFork(
            projects.insertEffect({ id: "lumen", name: "Lumen", active: false }),
          );
          yield* Effect.sleep("0 millis");

          expect(projects.pendingMutations()).toHaveLength(1);
          expect(projects.rows().map((project) => project.id)).toEqual(["atlas", "lumen"]);

          yield* Deferred.succeed(releaseInsert, undefined);
          yield* Fiber.join(insert);

          expect(projects.pendingMutations()).toEqual([]);
          yield* projects.updateEffect("atlas", { name: "Atlas Prime" });
          yield* projects.deleteEffect("lumen");
          yield* projects.writeInsertEffect({ id: "orion", name: "Orion", active: true });
          yield* projects.writeUpdateEffect("orion", { active: false });
          yield* projects.writeDeleteEffect("orion");

          expect(yield* projects.flushPendingMutationsEffect()).toEqual([]);
          expect(calls).toEqual(["insert:lumen", "update:atlas", "delete:lumen"]);
          expect(projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
        } finally {
          dispose?.();
          yield* runtime.disposeEffect;
        }
      }),
    );
  });

  it("subscribes live query collections inside the explicit Solid runtime", () => {
    let dispose: (() => void) | undefined;
    const firstRuntime = makeRuntime();
    const secondRuntime = makeRuntime();
    let notifications = 0;
    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-collection-runtime.projects",
      getKey: (project) => project.id,
    });
    const ProjectCards = Collection.liveQuery<Project, string>({
      name: "SolidDb.live-query-collection-runtime.cards",
      getKey: (project) => project.id,
      query: (query) => query.from({ project: Projects }).select(({ project }) => project),
    });
    const trackSignalNotifications = <A>(signal: ReadableSignal<A>): ReadableSignal<A> => ({
      ...signal,
      get: () => signal.get(),
      subscribe: (listener) =>
        signal.subscribe(() => {
          notifications++;
          listener();
        }),
    });
    const originalVersion = ProjectCards.version;
    const originalState = ProjectCards.state;
    ProjectCards.version = () => trackSignalNotifications(originalVersion());
    ProjectCards.state = () => trackSignalNotifications(originalState());

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* firstRuntime.provide(
          Projects.writeInsertEffect({ id: "atlas", name: "Atlas", active: true }),
        );
        yield* secondRuntime.provide(
          Projects.writeInsertEffect({ id: "lumen", name: "Lumen", active: true }),
        );

        const cards = runWithRuntime(firstRuntime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useCollection(ProjectCards, { preload: false });
          }),
        );
        yield* Effect.sleep("0 millis");

        expect(cards.rows().map((project) => project.name)).toEqual(["Atlas"]);
        notifications = 0;

        yield* secondRuntime.provide(Projects.writeUpdateEffect("lumen", { name: "Lumen Prime" }));
        yield* Effect.sleep("0 millis");

        expect(notifications).toBe(0);
        expect(cards.rows().map((project) => project.name)).toEqual(["Atlas"]);

        yield* firstRuntime.provide(Projects.writeUpdateEffect("atlas", { name: "Atlas Prime" }));
        yield* Effect.sleep("0 millis");

        expect(notifications).toBeGreaterThan(0);
        expect(cards.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(firstRuntime.disposeEffect),
        Effect.ensuring(secondRuntime.disposeEffect),
      ),
    );
  });

  it("keeps live query collection Ready.updatedAt stable across Solid reads until output changes", () => {
    let dispose: (() => void) | undefined;
    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-collection-ready.projects",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", active: true }],
    });
    const ProjectCards = Collection.liveQuery<Project, string>({
      name: "SolidDb.live-query-collection-ready.cards",
      getKey: (project) => project.id,
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          name: project.name,
          active: true,
        })),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const cards = createRoot((rootDispose) => {
          dispose = rootDispose;
          return useCollection(ProjectCards, { preload: false });
        });
        const first = cards.state();
        const second = cards.state();

        expect(first).toMatchObject({ _tag: "Ready", waiting: false });
        expect(second).toMatchObject({ _tag: "Ready", waiting: false });
        if (first._tag !== "Ready" || second._tag !== "Ready") {
          expect.fail("Expected live query collection to be ready.");
        }
        expect(second.updatedAt).toBe(first.updatedAt);

        yield* Projects.writeUpdateEffect("atlas", { active: false });
        yield* Effect.sleep("0 millis");
        const unchanged = cards.state();
        if (unchanged._tag !== "Ready") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(unchanged.updatedAt).toBe(first.updatedAt);

        yield* Projects.writeUpdateEffect("atlas", { name: "Atlas Prime" });
        yield* Effect.sleep("0 millis");
        const changed = cards.state();
        if (changed._tag !== "Ready") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(changed.updatedAt).toBeGreaterThan(first.updatedAt);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("represents live query evaluation failures without throwing from accessors", () => {
    let dispose: (() => void) | undefined;

    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-evaluation-failure.projects",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", active: true }],
    });

    const handle = createRoot((rootDispose) => {
      dispose = rootDispose;
      return useLiveQuery(
        (query) =>
          query
            .from({ project: Projects })
            .where(() => {
              throw new Error("filter failed");
            })
            .select(({ project }) => project.name),
        { preload: false },
      );
    });

    try {
      expect(() => handle.data()).not.toThrow();
      expect(handle.state()).toMatchObject({
        _tag: "Failure",
        error: { _tag: "QueryEvaluationError", operation: "filter" },
        data: [],
      });
    } finally {
      dispose?.();
    }
  });

  it("rebuilds live queries when explicit Solid dependencies change", async () => {
    let dispose: (() => void) | undefined;
    let setOnlyActive: ((value: boolean) => boolean) | undefined;
    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-deps.projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", active: true },
        { id: "lumen", name: "Lumen", active: false },
      ],
    });

    const handle = createRoot((rootDispose) => {
      dispose = rootDispose;
      const [onlyActive, set] = createSignal(true);
      setOnlyActive = set;
      return useLiveQuery(
        (query) =>
          query
            .from({ project: Projects })
            .where(({ project }) => !onlyActive() || project.active)
            .select(({ project }) => project.name)
            .orderBy(({ project }) => project.name),
        {
          preload: false,
          deps: () => [onlyActive()],
        },
      );
    });

    try {
      expect(handle.data()).toEqual(["Atlas"]);
      setOnlyActive?.(false);
      await Effect.runPromise(Effect.sleep("0 millis"));
      expect(handle.data()).toEqual(["Atlas", "Lumen"]);
    } finally {
      dispose?.();
    }
  });

  it("preloads newly selected dynamic live-query sources", async () => {
    let dispose: (() => void) | undefined;
    let selectArchive: ((value: boolean) => boolean) | undefined;
    let activeLoads = 0;
    let archiveLoads = 0;
    const ActiveProjects = Collection.define<Project>({
      name: "SolidDb.live-query-dynamic-preload.active",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          activeLoads++;
          return [{ id: "atlas", name: "Atlas", active: true }];
        }),
    });
    const ArchivedProjects = Collection.define<Project>({
      name: "SolidDb.live-query-dynamic-preload.archived",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          archiveLoads++;
          return [{ id: "lumen", name: "Lumen", active: false }];
        }),
    });

    const handle = createRoot((rootDispose) => {
      dispose = rootDispose;
      const [archive, setArchive] = createSignal(false);
      selectArchive = setArchive;
      return useLiveQuery(
        (query) => {
          const source = archive() ? ArchivedProjects : ActiveProjects;
          return query.from({ project: source }).select(({ project }) => project.name);
        },
        {
          deps: () => [archive()],
        },
      );
    });

    try {
      await Effect.runPromise(Effect.sleep("0 millis"));
      expect(activeLoads).toBe(1);
      expect(handle.data()).toEqual(["Atlas"]);

      selectArchive?.(true);
      expect(handle.data()).toEqual(["Lumen"]);
      await Effect.runPromise(Effect.sleep("20 millis"));

      expect(archiveLoads).toBe(1);
      expect(handle.data()).toEqual(["Lumen"]);
    } finally {
      dispose?.();
    }
  });
});
