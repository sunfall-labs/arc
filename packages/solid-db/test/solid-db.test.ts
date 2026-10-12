import { Action, makeRuntime, runWithRuntime } from "@sunfall/arc-core";
import { currentOrDefaultRuntime } from "@sunfall/arc-core/internal";
import { Collection, QueryEvaluationError } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import { SolidDb } from "@sunfall/arc-solid-db";
import { Cause, Context, Data, Deferred, Effect, Fiber, Layer, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { bindInInstance } from "./instance-harness.js";

// Test shims: bind collections and live queries in a fresh Component instance
// on the runtime of the enclosing `withRuntimeContext(...)` call.
let currentTestRuntime: object | undefined;
const withRuntimeContext = <A>(runtime: object, f: () => A): A => {
  const previous = currentTestRuntime;
  currentTestRuntime = runtime;
  try {
    return f();
  } finally {
    currentTestRuntime = previous;
  }
};
const testRuntime = () => {
  if (currentTestRuntime === undefined) {
    throw new Error("Bind inside withRuntimeContext(...)");
  }
  return currentTestRuntime as Parameters<typeof bindInInstance>[0];
};
const useCollection = <A extends object, K extends Collection.Key, E = never, R = never>(
  definition: Collection.Definition<A, K, E, R>,
  options?: Parameters<typeof SolidDb.collection<A, K, E, R>>[1],
) => bindInInstance(testRuntime(), SolidDb.collection(definition, options));
const useLiveQuery = <T, E = never, R = never>(
  input: Parameters<typeof SolidDb.liveQuery<T, E, R>>[0],
  options?: Parameters<typeof SolidDb.liveQuery<T, E, R>>[1],
) => bindInInstance(testRuntime(), SolidDb.liveQuery(input, options));

interface Project {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

/** Flattens an `AsyncResult` into matchable facts: tag, waiting, value/timestamp, typed error, and previous success value. */
const asyncResultFacts = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  switch (result._tag) {
    case "Initial":
      return { _tag: result._tag, waiting: result.waiting };
    case "Success":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        value: result.value,
        timestamp: result.timestamp,
      };
    case "Failure":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        error: Option.getOrUndefined(AsyncResult.error(result)),
        previous: Option.getOrUndefined(AsyncResult.value(result)),
        cause: result.cause,
      };
  }
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

        const handles = createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
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
          }),
        );

        yield* Effect.sleep("0 millis");

        expect(handles.projects.rows().map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
        expect(handles.projects.get("atlas")?.name).toBe("Atlas");
        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual([
          "atlas",
        ]);
        expect(handles.projects.index("active", false)[0]?.id).toBe("lumen");
        expect(handles.activeNames.rows()).toEqual(["Atlas"]);

        yield* Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { active: true } }]);

        expect(handles.projects.index("active", true).map((project) => project.id)).toEqual([
          "atlas",
          "lumen",
        ]);
        expect(handles.activeNames.rows()).toEqual(["Atlas", "Lumen"]);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("tracks collection reads natively and releases them with the Solid owner", async () => {
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
    const listeners = () =>
      (Projects.version() as unknown as { readonly listeners: Set<unknown> }).listeners.size;
    const rendered: string[] = [];

    const dispose = createRoot((rootDispose) =>
      withRuntimeContext(currentOrDefaultRuntime(), () => {
        const projects = useCollection(Projects, { preload: false });
        const activeNames = useLiveQuery(
          (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.active)
              .select(({ project }) => project.name)
              .orderBy(({ project }) => project.name),
          { preload: false },
        );
        createEffect(
          () => `${projects.rows().length}:${activeNames.rows().join(",")}`,
          (value) => {
            rendered.push(value);
          },
        );
        return rootDispose;
      }),
    );
    flush();
    const whileRendered = listeners();

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { active: true } }]),
    );
    flush();
    dispose();
    flush();
    await Promise.resolve();

    expect({ rendered, whileRendered: whileRendered > 0, afterDispose: listeners() }).toEqual({
      rendered: ["2:Atlas", "2:Atlas,Lumen"],
      whileRendered: true,
      afterDispose: 0,
    });
  });

  it("throws a never-loaded collection's typed load failure from its rows and reports it as failure()", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const failure = { _tag: "ProjectLoadError" as const, message: "blocked" };
        const Projects = Collection.define<Project, string, typeof failure>({
          name: "SolidDb.preload-failure.projects",
          getKey: (project) => project.id,
          sync: {
            load: () => Effect.fail(failure),
          },
        });

        const handles = createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
            dispose = rootDispose;
            return {
              projects: useCollection(Projects),
              activeNames: useLiveQuery((query) =>
                query
                  .from({ project: Projects })
                  .where(({ project }) => project.active)
                  .select(({ project }) => project.name),
              ),
            };
          }),
        );

        yield* Effect.sleep("0 millis");

        expect(Cause.squash(handles.projects.failure()!)).toEqual(failure);
        expect(Cause.squash(handles.activeNames.failure()!)).toEqual(failure);
        expect(handles.projects.waiting()).toBe(false);
        // The rows cannot render: the read throws the typed failure to <Errored>.
        expect(() => handles.projects.rows()).toThrow(expect.objectContaining(failure));
        expect(() => handles.projects.get("atlas")).toThrow(expect.objectContaining(failure));
        expect(() => handles.activeNames.rows()).toThrow(expect.objectContaining(failure));
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("hands a never-loaded collection's typed failure to catchTags, and refresh failures to failure()", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          class ProjectsUnavailable extends Data.TaggedError("ProjectsUnavailable")<{}> {}
          let fail = true;
          const Projects = Collection.define<Project, string, ProjectsUnavailable>({
            name: "SolidDb.render-failure.projects",
            getKey: (project) => project.id,
            sync: {
              load: () =>
                fail
                  ? Effect.fail(new ProjectsUnavailable())
                  : Effect.succeed([{ id: "atlas", name: "Atlas", active: true }]),
            },
          });
          const List = Component.define("List", function* () {
            const projects = yield* SolidDb.collection(Projects);
            return (() =>
              `${projects
                .rows()
                .map((project) => project.name)
                .join(",")}|${projects.failure() === undefined ? "ok" : "stale"}`) as never;
          });
          // The load error joined List's E: the boundary must handle it.
          const App = List.pipe(Component.catchTags({ ProjectsUnavailable: () => "unavailable" }));
          const container = document.createElement("div");
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          yield* Component.mount(App, container, { runtime });

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("unavailable")),
          );

          fail = false;
          yield* runtime.provide(Projects.refresh());
          fail = true;
          yield* runtime.provide(Projects.refresh()).pipe(Effect.ignore);
          // Rows loaded once, so a failed refresh keeps them and reports failure().
          expect(runWithRuntime(runtime, () => Projects.rows().map((row) => row.id))).toEqual([
            "atlas",
          ]);
        }),
      ),
    ));

  it("reports no failure once a refresh supersedes a failing preload", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        const staleStarted = yield* Deferred.make<void>();
        const staleFailure = "stale-db-preload-failed" as const;
        const staleRelease = yield* Deferred.make<void, typeof staleFailure>();
        const Projects = Collection.define<Project, string, typeof staleFailure>({
          name: "SolidDb.preload-superseded-db-generation.projects",
          getKey: (project) => project.id,
          sync: {
            load: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(staleStarted, undefined).pipe(Effect.ignore);
                yield* Deferred.await(staleRelease);
                return [{ id: "atlas", name: "Atlas Slow", active: true }];
              }),
            refresh: () =>
              Effect.succeed<ReadonlyArray<Project>>([
                { id: "atlas", name: "Atlas Fresh", active: true },
              ]),
          },
        });

        const handle = createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
            dispose = rootDispose;
            return useCollection(Projects);
          }),
        );

        yield* Effect.sleep("0 millis");
        yield* Deferred.await(staleStarted);
        yield* Projects.refresh();

        expect(handle.rows().map((project) => project.name)).toEqual(["Atlas Fresh"]);

        yield* Deferred.fail(staleRelease, staleFailure);
        yield* Effect.sleep("20 millis");

        expect(handle.failure()).toBeUndefined();
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
          sync: {
            load: () =>
              Effect.sync(() => {
                projectLoads++;
                return [{ id: "atlas", name: "Atlas", active: true }];
              }),
          },
        });
        const Tasks = Collection.define<{ readonly id: string; readonly projectId: string }>({
          name: "SolidDb.invalid-live-preload.tasks",
          getKey: (task) => task.id,
          sync: {
            load: () =>
              Effect.sync(() => {
                taskLoads++;
                return [{ id: "task-1", projectId: "atlas" }];
              }),
          },
        });

        const handle = createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
            dispose = rootDispose;
            return useLiveQuery((query) =>
              query
                .from({ project: Projects })
                .joinIndexed("task", Tasks, ({ project }) => project.id, "missing")
                .select(({ project }) => project.name),
            );
          }),
        );

        yield* Effect.sleep("0 millis");

        // An invalid query plan is a defect: it is not part of the binding's E.
        expect(Cause.hasDies(handle.failure()!)).toBe(true);
        expect(Cause.squash(handle.failure()!)).toBeInstanceOf(QueryEvaluationError);
        expect(Cause.squash(handle.failure()!)).toMatchObject({
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

  it("interrupts automatic preload when the Solid owner is disposed", () => {
    let dispose: (() => void) | undefined;

    return Effect.runPromise(
      Effect.gen(function* () {
        let started = false;
        let interrupted = false;
        const Projects = Collection.define<Project>({
          name: "SolidDb.preload-cleanup.projects",
          getKey: (project) => project.id,
          sync: {
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
          },
        });

        createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
            dispose = rootDispose;
            useCollection(Projects);
          }),
        );

        yield* Effect.sleep("0 millis");
        expect(started).toBe(true);

        dispose?.();
        dispose = undefined;
        yield* Effect.sleep("0 millis");

        expect(interrupted).toBe(true);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
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
          sync: {
            load: () => ProjectApi.use((api) => api.list()),
          },
        });

        const handles = runWithRuntime(runtime, () =>
          createRoot((rootDispose) =>
            withRuntimeContext(runtime, () => {
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
          ),
        );

        yield* runtime.provide(Projects.preload());
        yield* handles.names.refresh();
        yield* Effect.sleep("0 millis");

        expect(loads).toBe(2);
        expect(handles.projects.rows().map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(Effect.orDie(runtime.dispose)),
      ),
    );
  });

  it("reads an Action's optimistic rows through the Solid handle until it settles", () => {
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
        const Projects = Collection.define<Project>({
          name: "SolidDb.collection-adapter.projects",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", active: true }],
        });
        const InsertProject = Action.define({
          name: "SolidDb.collection-adapter.insert",
          optimistic: (project: Project, transaction) => transaction.insert(Projects, project),
          run: (project: Project) => ProjectMutationApi.use((api) => api.insert([project])),
        });
        const RenameProject = Action.define({
          name: "SolidDb.collection-adapter.rename",
          optimistic: (input: { readonly id: string; readonly name: string }, transaction) =>
            transaction.update(Projects, input.id, { name: input.name }),
          run: (input: { readonly id: string; readonly name: string }) =>
            ProjectMutationApi.use((api) =>
              api.update([{ key: input.id, value: { ...input, active: true } }]),
            ),
        });
        const DeleteProject = Action.define({
          name: "SolidDb.collection-adapter.delete",
          optimistic: (id: string, transaction) => transaction.delete(Projects, id),
          run: (id: string) => ProjectMutationApi.use((api) => api.delete([{ key: id }])),
        });

        try {
          const projects = runWithRuntime(runtime, () =>
            createRoot((rootDispose) =>
              withRuntimeContext(runtime, () => {
                dispose = rootDispose;
                return useCollection(Projects, { preload: false });
              }),
            ),
          );

          const insert = runtime.runFork(
            Action.use(InsertProject, { runtime }).submit({
              id: "lumen",
              name: "Lumen",
              active: false,
            }),
          );
          yield* Effect.sleep("0 millis");

          expect(projects.rows().map((project) => [project.id, project.$synced])).toEqual([
            ["atlas", true],
            ["lumen", false],
          ]);

          yield* Deferred.succeed(releaseInsert, undefined);
          yield* Fiber.join(insert);

          expect(projects.get("lumen")?.$synced).toBe(true);
          yield* Action.use(RenameProject, { runtime }).submit({
            id: "atlas",
            name: "Atlas Prime",
          });
          yield* Action.use(DeleteProject, { runtime }).submit("lumen");
          yield* runtime.provide(
            Projects.applyChanges([
              { _tag: "Upsert", value: { id: "orion", name: "Orion", active: true } },
              { _tag: "Update", key: "orion", changes: { active: false } },
            ]),
          );
          yield* runtime.provide(Projects.applyChanges([{ _tag: "Delete", key: "orion" }]));

          expect(calls).toEqual(["insert:lumen", "update:atlas", "delete:lumen"]);
          expect(projects.rows().map((project) => project.name)).toEqual(["Atlas Prime"]);
        } finally {
          dispose?.();
          yield* runtime.dispose;
        }
      }),
    );
  });

  it("tracks live query collections inside the explicit Solid runtime only", () => {
    let dispose: (() => void) | undefined;
    const firstRuntime = makeRuntime();
    const secondRuntime = makeRuntime();
    const rendered: string[] = [];
    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-collection-runtime.projects",
      getKey: (project) => project.id,
    });
    const ProjectCards = Collection.liveQuery<Project, string>({
      name: "SolidDb.live-query-collection-runtime.cards",
      getKey: (project) => project.id,
      query: (query) => query.from({ project: Projects }).select(({ project }) => project),
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* firstRuntime.provide(
          Projects.applyChanges([
            { _tag: "Upsert", value: { id: "atlas", name: "Atlas", active: true } },
          ]),
        );
        yield* secondRuntime.provide(
          Projects.applyChanges([
            { _tag: "Upsert", value: { id: "lumen", name: "Lumen", active: true } },
          ]),
        );

        runWithRuntime(firstRuntime, () =>
          createRoot((rootDispose) =>
            withRuntimeContext(firstRuntime, () => {
              dispose = rootDispose;
              const cards = useCollection(ProjectCards, { preload: false });
              createEffect(
                () =>
                  cards
                    .rows()
                    .map((project) => project.name)
                    .join(","),
                (names) => {
                  rendered.push(names);
                },
              );
            }),
          ),
        );
        flush();

        yield* secondRuntime.provide(
          Projects.applyChanges([
            { _tag: "Update", key: "lumen", changes: { name: "Lumen Prime" } },
          ]),
        );
        yield* Effect.sleep("0 millis");
        flush();
        const afterOtherRuntime = [...rendered];

        yield* firstRuntime.provide(
          Projects.applyChanges([
            { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
          ]),
        );
        yield* Effect.sleep("0 millis");
        flush();

        expect({ afterOtherRuntime, rendered }).toEqual({
          afterOtherRuntime: ["Atlas"],
          rendered: ["Atlas", "Atlas Prime"],
        });
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(Effect.orDie(firstRuntime.dispose)),
        Effect.ensuring(Effect.orDie(secondRuntime.dispose)),
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
        const cards = createRoot((rootDispose) =>
          withRuntimeContext(currentOrDefaultRuntime(), () => {
            dispose = rootDispose;
            return useCollection(ProjectCards, { preload: false });
          }),
        );
        // The stable result identity belongs to the definition; the handle projects it.
        const result = () => ProjectCards.result().get();
        expect(cards.waiting()).toBe(false);
        const first = result();
        const second = result();

        expect(asyncResultFacts(first)).toMatchObject({ _tag: "Success", waiting: false });
        expect(asyncResultFacts(second)).toMatchObject({ _tag: "Success", waiting: false });
        if (first._tag !== "Success" || second._tag !== "Success") {
          expect.fail("Expected live query collection to be ready.");
        }
        expect(second.timestamp).toBe(first.timestamp);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { active: false } },
        ]);
        yield* Effect.sleep("0 millis");
        const unchanged = result();
        if (unchanged._tag !== "Success") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(unchanged.timestamp).toBe(first.timestamp);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
        ]);
        yield* Effect.sleep("0 millis");
        const changed = result();
        if (changed._tag !== "Success") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(changed.timestamp).toBeGreaterThan(first.timestamp);
      }).pipe(Effect.ensuring(Effect.sync(() => dispose?.()))),
    );
  });

  it("reports live query evaluation failures as defects without throwing over the last good rows", () => {
    let dispose: (() => void) | undefined;

    const Projects = Collection.define<Project>({
      name: "SolidDb.live-query-evaluation-failure.projects",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", active: true }],
    });

    const handle = createRoot((rootDispose) =>
      withRuntimeContext(currentOrDefaultRuntime(), () => {
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
      }),
    );

    try {
      expect(() => handle.rows()).not.toThrow();
      expect(Cause.hasDies(handle.failure()!)).toBe(true);
      expect(Cause.squash(handle.failure()!)).toMatchObject({
        _tag: "QueryEvaluationError",
        operation: "filter",
      });
    } finally {
      dispose?.();
    }
  });

  it("rebuilds live queries when a signal read by the query factory changes", async () => {
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

    const handle = createRoot((rootDispose) =>
      withRuntimeContext(currentOrDefaultRuntime(), () => {
        dispose = rootDispose;
        const [onlyActive, set] = createSignal(true);
        setOnlyActive = set;
        return useLiveQuery(
          (query) => {
            // Read in the factory body: the tracked factory re-runs when it changes.
            const activeOnly = onlyActive();
            return query
              .from({ project: Projects })
              .where(({ project }) => !activeOnly || project.active)
              .select(({ project }) => project.name)
              .orderBy(({ project }) => project.name);
          },
          { preload: false },
        );
      }),
    );

    try {
      expect(handle.rows()).toEqual(["Atlas"]);
      setOnlyActive?.(false);
      flush();
      expect(handle.rows()).toEqual(["Atlas", "Lumen"]);
      setOnlyActive?.(true);
      flush();
      expect(handle.rows()).toEqual(["Atlas"]);
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
      sync: {
        load: () =>
          Effect.sync(() => {
            activeLoads++;
            return [{ id: "atlas", name: "Atlas", active: true }];
          }),
      },
    });
    const ArchivedProjects = Collection.define<Project>({
      name: "SolidDb.live-query-dynamic-preload.archived",
      getKey: (project) => project.id,
      sync: {
        load: () =>
          Effect.sync(() => {
            archiveLoads++;
            return [{ id: "lumen", name: "Lumen", active: false }];
          }),
      },
    });

    const handle = createRoot((rootDispose) =>
      withRuntimeContext(currentOrDefaultRuntime(), () => {
        dispose = rootDispose;
        const [archive, setArchive] = createSignal(false);
        selectArchive = setArchive;
        return useLiveQuery((query) => {
          const source = archive() ? ArchivedProjects : ActiveProjects;
          return query.from({ project: source }).select(({ project }) => project.name);
        });
      }),
    );

    try {
      await Effect.runPromise(Effect.sleep("0 millis"));
      expect(activeLoads).toBe(1);
      expect(handle.rows()).toEqual(["Atlas"]);

      selectArchive?.(true);
      flush();
      expect(handle.rows()).toEqual(["Lumen"]);
      await Effect.runPromise(Effect.sleep("20 millis"));

      expect(archiveLoads).toBe(1);
      expect(handle.rows()).toEqual(["Lumen"]);
    } finally {
      dispose?.();
    }
  });
});
