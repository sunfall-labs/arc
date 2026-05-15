import { makeRuntime, type ReadableSignal } from "@effect-ui/core";
import { Collection, type CollectionLoadState, type CollectionRuntimeError } from "@effect-ui/db";
import { Window } from "happy-dom";
import { Deferred, Effect } from "effect";
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
          ? Effect.sleep("100 millis").pipe(Effect.andThen(effect as Effect.Effect<unknown, unknown, unknown>))
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
        onPreloadFailure: (error) => observedCollectionFailures.push(error)
      });
      activeNames = useLiveQuery((query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.active)
          .select(({ project }) => project.name),
        {
          onPreloadFailure: (error) => observedLiveFailures.push(error)
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
