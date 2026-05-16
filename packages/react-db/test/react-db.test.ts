import { makeRuntime, type ReadableSignal } from "@effect-ui/core";
import { Collection, type CollectionLoadState, type CollectionRuntimeError } from "@effect-ui/db";
import { RuntimeProvider } from "@effect-ui/react";
import { Window } from "happy-dom";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useCollection, useLiveQuery, type CollectionHandle, type LiveQueryHandle } from "../src/index.js";
import { useReactDbReactiveBinding } from "../src/shared.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

const installDom = (): (() => void) => {
  const window = new Window();
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT"
  ] as const;
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const setGlobal = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  };

  setGlobal("window", window);
  setGlobal("document", window.document);
  setGlobal("navigator", window.navigator);
  setGlobal("HTMLElement", window.HTMLElement);
  setGlobal("Node", window.Node);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
    window.close();
  };
};

const withReactRoot = async (
  f: (root: Root) => Promise<void> | void
): Promise<void> => {
  const cleanupDom = installDom();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await f(root);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanupDom();
  }
};

const flushReact = async (): Promise<void> => {
  await act(async () => {
    await Effect.runPromise(Effect.sleep(0));
  });
};

const flushReactFor = async (duration: string): Promise<void> => {
  await act(async () => {
    await Effect.runPromise(Effect.sleep(duration));
  });
};

const makeDelayedCleanupRuntime = () => {
  const runtime = makeRuntime();
  let delayForks = false;
  const delayedRuntime = {
    ...runtime,
    runFork: ((
      effect: Effect.Effect<unknown, unknown, unknown>,
      options?: Parameters<typeof runtime.runFork>[1]
    ) =>
      runtime.runFork(
        (delayForks
          ? Effect.sleep("100 millis").pipe(Effect.andThen(effect))
          : effect) as never,
        options
      )) as typeof runtime.runFork
  };

  return {
    runtime: delayedRuntime,
    delayForks: () => {
      delayForks = true;
    },
    disposeEffect: runtime.disposeEffect
  };
};

describe("react-db", () => {
  interface ProjectApi {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@effect-ui/react-db/test/ProjectApi");

  interface ProjectMutationApi {
    readonly insert: (projects: ReadonlyArray<Project>) => Effect.Effect<void>;
    readonly update: (projects: ReadonlyArray<{ readonly key: string; readonly value: Project }>) => Effect.Effect<void>;
    readonly delete: (projects: ReadonlyArray<{ readonly key: string }>) => Effect.Effect<void>;
  }

  const ProjectMutationApi = Context.Service<ProjectMutationApi>("@effect-ui/react-db/test/ProjectMutationApi");

  it("adapts collections and live queries to React values", async () => {
    let projects: CollectionHandle<Project, string> | undefined;
    let activeNames: LiveQueryHandle<string> | undefined;
    const Projects = Collection.define<Project>({
      name: "ReactDb.projects",
      getKey: (project) => project.id,
      indexes: {
        active: (project) => project.active
      },
      initialData: [
        { id: "atlas", name: "Atlas", active: true },
        { id: "lumen", name: "Lumen", active: false }
      ]
    });

    function Capture() {
      projects = useCollection(Projects, { preload: false });
      activeNames = useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.active)
          .select(({ project }) => project.name)
          .orderBy(({ project }) => project.name),
        { preload: false }
      );
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Capture));
      });
      await flushReact();

      expect(projects!.rows.map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
      expect(projects!.get("atlas")?.name).toBe("Atlas");
      expect(projects!.index("active", true).map((project) => project.id)).toEqual(["atlas"]);
      expect(projects!.firstByIndex("active", false)?.id).toBe("lumen");
      expect(activeNames!.data).toEqual(["Atlas"]);

      await act(async () => {
        await Effect.runPromise(Projects.writeUpdateEffect("lumen", { active: true }));
      });
      await flushReact();

      expect(projects!.index("active", true).map((project) => project.id)).toEqual(["atlas", "lumen"]);
      expect(activeNames!.data).toEqual(["Atlas", "Lumen"]);
    });
  });

  it("disposes collection and live-query subscriptions with the React component", async () => {
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
      }
    });

    const Projects = Collection.define<Project>({
      name: "ReactDb.cleanup.projects",
      getKey: (project) => project.id,
      indexes: {
        active: (project) => project.active
      },
      initialData: [
        { id: "atlas", name: "Atlas", active: true },
        { id: "lumen", name: "Lumen", active: false }
      ]
    });

    const version = trackSignalSubscriptions(Projects.version());
    const state = trackSignalSubscriptions(Projects.state());
    const trackedProjects = Projects as typeof Projects & {
      version: () => ReadableSignal<number>;
      state: () => ReadableSignal<CollectionLoadState<CollectionRuntimeError<never>>>;
    };
    trackedProjects.version = () => version;
    trackedProjects.state = () => state;

    function Capture() {
      useCollection(Projects, { preload: false });
      useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.active)
          .select(({ project }) => project.name),
        { preload: false }
      );
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Capture));
      });
      await flushReact();

      expect(activeSubscriptions).toBe(4);

      await act(async () => {
        root.unmount();
      });

      expect(activeSubscriptions).toBe(0);
    });
  });

  it("exposes automatic preload failures through typed React values", async () => {
    const failure = { _tag: "ProjectLoadError" as const, message: "blocked" };
    const observedCollectionFailures: Array<unknown> = [];
    const observedLiveFailures: Array<unknown> = [];
    let projects: CollectionHandle<Project, string, typeof failure> | undefined;
    let activeNames: LiveQueryHandle<string, typeof failure> | undefined;
    const Projects = Collection.define<Project, string, typeof failure>({
      name: "ReactDb.preload-failure.projects",
      getKey: (project) => project.id,
      load: () => Effect.fail(failure)
    });

    function Capture() {
      projects = useCollection(Projects, {
        onPreloadFailure: (error) =>
          Effect.sync(() => {
            observedCollectionFailures.push(error);
          }).pipe(Effect.andThen(Effect.fail("collection observer failed")))
      });
      activeNames = useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.active)
          .select(({ project }) => project.name),
        {
          onPreloadFailure: (error) =>
            Effect.sync(() => {
              observedLiveFailures.push(error);
            }).pipe(Effect.andThen(Effect.fail("live query observer failed")))
        }
      );
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Capture));
      });
      await flushReact();

      expect(projects!.preloadFailure).toEqual(failure);
      expect(activeNames!.preloadFailure).toEqual(failure);
      expect(observedCollectionFailures).toEqual([failure]);
      expect(observedLiveFailures).toEqual([failure]);
    });
  });

  it("ignores automatic preload failures from superseded DB generations after refetch", async () => {
    const staleStarted = Effect.runSync(Deferred.make<void>());
    const staleFailure = "stale-db-preload-failed" as const;
    const staleRelease = Effect.runSync(Deferred.make<void, typeof staleFailure>());
    const observedFailures: Array<unknown> = [];
    let projects: CollectionHandle<Project, string, typeof staleFailure> | undefined;
    const Projects = Collection.define<Project, string, typeof staleFailure>({
      name: "ReactDb.preload-superseded-db-generation.projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(staleStarted, undefined).pipe(Effect.ignore);
          yield* Deferred.await(staleRelease);
          return [{ id: "atlas", name: "Atlas Slow", active: true }];
        }),
      refetch: () =>
        Effect.succeed<ReadonlyArray<Project>>([
          { id: "atlas", name: "Atlas Fresh", active: true }
        ])
    });

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(() => {
          projects = useCollection(Projects, {
            onPreloadFailure: (error) => observedFailures.push(error)
          });
          return null;
        }));
      });
      await flushReact();
      await Effect.runPromise(Deferred.await(staleStarted));

      await act(async () => {
        await Effect.runPromise(projects!.refetchEffect());
      });
      await flushReact();

      expect(projects!.rows.map((project) => project.name)).toEqual(["Atlas Fresh"]);

      Effect.runSync(Deferred.fail(staleRelease, staleFailure));
      await flushReactFor("20 millis");

      expect(projects!.preloadFailure).toBeUndefined();
      expect(observedFailures).toEqual([]);
      expect(projects!.rows.map((project) => project.name)).toEqual(["Atlas Fresh"]);
    });
  });

  it("ignores stale automatic preload failures after the preload effect changes", async () => {
    const staleRelease = Effect.runSync(Deferred.make<void>());
    const staleFailure = "stale-preload-failed" as const;
    const observedFailures: Array<unknown> = [];
    const delayed = makeDelayedCleanupRuntime();
    let preloadFailure: unknown;

    function Capture(props: { readonly preloadEffect: Effect.Effect<void, typeof staleFailure> }) {
      const binding = useReactDbReactiveBinding<typeof staleFailure>({
        runtime: delayed.runtime,
        sources: [],
        preloadEffect: props.preloadEffect,
        onPreloadFailure: (error) => observedFailures.push(error)
      });
      preloadFailure = binding.preloadFailure;
      return null;
    }

    try {
      await withReactRoot(async (root) => {
        await act(async () => {
          root.render(createElement(Capture, {
            preloadEffect: Deferred.await(staleRelease).pipe(
              Effect.andThen(Effect.fail(staleFailure))
            )
          }));
        });
        await flushReact();

        delayed.delayForks();
        await act(async () => {
          root.render(createElement(Capture, { preloadEffect: Effect.void }));
        });
        Effect.runSync(Deferred.succeed(staleRelease, undefined));
        await flushReactFor("20 millis");

        expect(preloadFailure).toBeUndefined();
        expect(observedFailures).toEqual([]);
      });
    } finally {
      await Effect.runPromise(delayed.disposeEffect);
    }
  });

  it("ignores stale automatic preload failures after unmount", async () => {
    const staleRelease = Effect.runSync(Deferred.make<void>());
    const staleFailure = "stale-unmount-preload-failed" as const;
    const observedFailures: Array<unknown> = [];
    const delayed = makeDelayedCleanupRuntime();

    function Capture() {
      useReactDbReactiveBinding<typeof staleFailure>({
        runtime: delayed.runtime,
        sources: [],
        preloadEffect: Deferred.await(staleRelease).pipe(
          Effect.andThen(Effect.fail(staleFailure))
        ),
        onPreloadFailure: (error) => observedFailures.push(error)
      });
      return null;
    }

    try {
      await withReactRoot(async (root) => {
        await act(async () => {
          root.render(createElement(Capture));
        });
        await flushReact();

        delayed.delayForks();
        await act(async () => {
          root.unmount();
        });
        Effect.runSync(Deferred.succeed(staleRelease, undefined));
        await flushReactFor("20 millis");

        expect(observedFailures).toEqual([]);
      });
    } finally {
      await Effect.runPromise(delayed.disposeEffect);
    }
  });

  it("binds returned collection and live-query Effects to the React runtime", async () => {
    let handles: {
      readonly projects: CollectionHandle<Project, string>;
      readonly names: LiveQueryHandle<string>;
    } | undefined;
    let loads = 0;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        list: () =>
          Effect.sync(() => {
            loads++;
            return [
              { id: "atlas", name: "Atlas", active: true },
              { id: "lumen", name: "Lumen", active: true }
            ];
          })
      })
    );
    const Projects = Collection.define<Project, string, never, ProjectApi>({
      name: "ReactDb.runtime-bound-effects.projects",
      getKey: (project) => project.id,
      load: () => ProjectApi.use((api) => api.list())
    });

    function Capture() {
      handles = {
        projects: useCollection(Projects, { preload: false }),
        names: useLiveQuery((query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => project.name)
            .orderBy(({ project }) => project.name),
          { preload: false }
        )
      };
      return null;
    }

    try {
      await withReactRoot(async (root) => {
        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        await act(async () => {
          await Effect.runPromise(handles!.projects.preloadEffect());
          await Effect.runPromise(handles!.names.refetchEffect());
        });
        await flushReact();

        expect(loads).toBe(2);
        expect(handles!.projects.rows.map((project) => project.name)).toEqual(["Atlas", "Lumen"]);
        expect(handles!.names.data).toEqual(["Atlas", "Lumen"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("adapts collection mutations and pending mutations to the React runtime", async () => {
    let projects: CollectionHandle<Project, string> | undefined;
    const releaseInsert = Effect.runSync(Deferred.make<void>());
    const calls: Array<string> = [];
    const runtime = makeRuntime(
      Layer.succeed(ProjectMutationApi)({
        insert: (inserted) =>
          Effect.sync(() => {
            calls.push(`insert:${inserted.map((project) => project.id).join(",")}`);
          }).pipe(Effect.andThen(Deferred.await(releaseInsert))),
        update: (updated) =>
          Effect.sync(() => {
            calls.push(`update:${updated.map((project) => project.key).join(",")}`);
          }),
        delete: (deleted) =>
          Effect.sync(() => {
            calls.push(`delete:${deleted.map((project) => project.key).join(",")}`);
          })
      })
    );
    const Projects = Collection.define<Project, string, never, ProjectMutationApi>({
      name: "ReactDb.collection-adapter.projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", active: true }
      ],
      onInsert: (inserted) => ProjectMutationApi.use((api) => api.insert(inserted)),
      onUpdate: (updated) => ProjectMutationApi.use((api) => api.update(updated)),
      onDelete: (deleted) => ProjectMutationApi.use((api) => api.delete(deleted))
    });

    function Capture() {
      projects = useCollection(Projects, { preload: false });
      return null;
    }

    try {
      await withReactRoot(async (root) => {
        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        const insert = await act(async () => {
          const fiber = Effect.runFork(projects!.insertEffect({
            id: "lumen",
            name: "Lumen",
            active: false
          }));
          await Effect.runPromise(Effect.sleep(0));
          return fiber;
        });

        expect(projects!.pendingMutations).toHaveLength(1);
        expect(projects!.rows.map((project) => project.id)).toEqual(["atlas", "lumen"]);

        await act(async () => {
          Effect.runSync(Deferred.succeed(releaseInsert, undefined));
          await Effect.runPromise(Fiber.join(insert));
        });
        await flushReact();

        expect(projects!.pendingMutations).toEqual([]);

        await act(async () => {
          await Effect.runPromise(projects!.updateEffect("atlas", { name: "Atlas Prime" }));
          await Effect.runPromise(projects!.deleteEffect("lumen"));
          await Effect.runPromise(projects!.writeInsertEffect({ id: "orion", name: "Orion", active: true }));
          await Effect.runPromise(projects!.writeUpdateEffect("orion", { active: false }));
          await Effect.runPromise(projects!.writeDeleteEffect("orion"));
          await expect(Effect.runPromise(projects!.flushPendingMutationsEffect())).resolves.toEqual([]);
        });
        await flushReact();

        expect(calls).toEqual(["insert:lumen", "update:atlas", "delete:lumen"]);
        expect(projects!.rows.map((project) => project.name)).toEqual(["Atlas Prime"]);
      });
    } finally {
      Effect.runSync(Deferred.succeed(releaseInsert, undefined));
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("subscribes live query collections inside the explicit React runtime", async () => {
    let cards: CollectionHandle<Project, string> | undefined;
    const firstRuntime = makeRuntime();
    const secondRuntime = makeRuntime();
    let notifications = 0;
    const Projects = Collection.define<Project>({
      name: "ReactDb.live-query-collection-runtime.projects",
      getKey: (project) => project.id
    });
    const ProjectCards = Collection.liveQuery<Project, string>({
      name: "ReactDb.live-query-collection-runtime.cards",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => project)
    });
    const trackSignalNotifications = <A>(signal: ReadableSignal<A>): ReadableSignal<A> => ({
      ...signal,
      get: () => signal.get(),
      subscribe: (listener) =>
        signal.subscribe(() => {
          notifications++;
          listener();
        })
    });
    const originalVersion = ProjectCards.version;
    const originalState = ProjectCards.state;
    ProjectCards.version = () => trackSignalNotifications(originalVersion());
    ProjectCards.state = () => trackSignalNotifications(originalState());

    function Capture() {
      cards = useCollection(ProjectCards, { preload: false });
      return null;
    }

    try {
      await Effect.runPromise(firstRuntime.provide(Projects.writeInsertEffect({
        id: "atlas",
        name: "Atlas",
        active: true
      })));
      await Effect.runPromise(secondRuntime.provide(Projects.writeInsertEffect({
        id: "lumen",
        name: "Lumen",
        active: true
      })));

      await withReactRoot(async (root) => {
        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime: firstRuntime },
              createElement(Capture)
            )
          );
        });
        await flushReact();

        expect(cards!.rows.map((project) => project.name)).toEqual(["Atlas"]);
        notifications = 0;

        await act(async () => {
          await Effect.runPromise(secondRuntime.provide(
            Projects.writeUpdateEffect("lumen", { name: "Lumen Prime" })
          ));
        });
        await flushReact();

        expect(notifications).toBe(0);
        expect(cards!.rows.map((project) => project.name)).toEqual(["Atlas"]);

        await act(async () => {
          await Effect.runPromise(firstRuntime.provide(
            Projects.writeUpdateEffect("atlas", { name: "Atlas Prime" })
          ));
        });
        await flushReact();

        expect(notifications).toBeGreaterThan(0);
        expect(cards!.rows.map((project) => project.name)).toEqual(["Atlas Prime"]);
      });
    } finally {
      await Effect.runPromise(firstRuntime.disposeEffect);
      await Effect.runPromise(secondRuntime.disposeEffect);
    }
  });

  it("rebuilds live queries when React deps change", async () => {
    let activeNames: LiveQueryHandle<string> | undefined;
    let setOnlyActive: ((value: boolean) => void) | undefined;
    const Projects = Collection.define<Project>({
      name: "ReactDb.live-query-deps.projects",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", active: true },
        { id: "lumen", name: "Lumen", active: false }
      ]
    });

    function Capture() {
      const [onlyActive, set] = useState(true);
      setOnlyActive = set;
      activeNames = useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => !onlyActive || project.active)
          .select(({ project }) => project.name)
          .orderBy(({ project }) => project.name),
        {
          preload: false,
          deps: [onlyActive]
        }
      );
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Capture));
      });
      await flushReact();

      expect(activeNames!.data).toEqual(["Atlas"]);

      await act(async () => {
        setOnlyActive?.(false);
      });
      await flushReact();

      expect(activeNames!.data).toEqual(["Atlas", "Lumen"]);
    });
  });

  it("preloads newly selected dynamic live-query sources", async () => {
    let names: LiveQueryHandle<string> | undefined;
    let selectArchive: ((value: boolean) => void) | undefined;
    let activeLoads = 0;
    let archiveLoads = 0;
    const ActiveProjects = Collection.define<Project>({
      name: "ReactDb.live-query-dynamic-preload.active",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          activeLoads++;
          return [{ id: "atlas", name: "Atlas", active: true }];
        })
    });
    const ArchivedProjects = Collection.define<Project>({
      name: "ReactDb.live-query-dynamic-preload.archived",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          archiveLoads++;
          return [{ id: "lumen", name: "Lumen", active: false }];
        })
    });

    function Capture() {
      const [archive, setArchive] = useState(false);
      selectArchive = setArchive;
      names = useLiveQuery((query) => {
        const source = archive ? ArchivedProjects : ActiveProjects;
        return query
          .from({ project: source })
          .select(({ project }) => project.name);
      }, {
        deps: [archive]
      });
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Capture));
      });
      await flushReact();

      expect(activeLoads).toBe(1);
      expect(names!.data).toEqual(["Atlas"]);

      await act(async () => {
        selectArchive?.(true);
      });
      await flushReact();

      expect(archiveLoads).toBe(1);
      expect(names!.data).toEqual(["Lumen"]);
    });
  });
});
