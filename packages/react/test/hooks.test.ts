import { Action, makeRuntime, Program, Resource, Signal } from "@effect-ui/core";
import { Window } from "happy-dom";
import { Context, Deferred, Effect, Fiber, Layer, Scope, Stream } from "effect";
import { Suspense, act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeProvider,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
  useRuntime,
  useRuntimeEffect,
  useSignal,
  type ResourceHandle
} from "../src/index.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@effect-ui/react/test/ProjectApi");

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
  f: (root: Root, container: HTMLElement) => Promise<void> | void
): Promise<void> => {
  const cleanupDom = installDom();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await f(root, container);
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

const suppressHostThenableFailure = (value: unknown): void => {
  void Effect.runPromise(
    Effect.tryPromise({
      try: () => value as PromiseLike<unknown>,
      catch: () => undefined
    }).pipe(Effect.catch(() => Effect.void))
  );
};

describe("react hooks", () => {
  it("bridges Effect UI signals through React external-store subscriptions", async () => {
    const count = Signal.make(0);
    const seen: number[] = [];

    function Counter() {
      seen.push(useSignal(count));
      return null;
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(Counter));
      });

      expect(seen.at(-1)).toBe(0);

      await act(async () => {
        count.set(1);
      });

      expect(seen.at(-1)).toBe(1);
    });
  });

  it("binds returned resource Effects to the React runtime", async () => {
    let loads = 0;
    let project: ResourceHandle<string, Project, never, ProjectApi> | undefined;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) =>
          Effect.sync(() => {
            loads++;
            return { id, name: id === "atlas" ? "Atlas" : id };
          })
      })
    );
    const ProjectById = Resource.family<string, Project, never, ProjectApi>({
      name: "ReactHooks.runtime-bound-resource",
      load: (id) => ProjectApi.use((api) => api.get(id))
    });

    function Capture() {
      project = useResource(ProjectById("atlas"));
      return null;
    }

    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          withReactRoot(async (root) => {
            await act(async () => {
              root.render(
                createElement(
                  RuntimeProvider,
                  { runtime },
                  createElement(Capture)
                )
              );
            });

            const prefetched = await Effect.runPromise(project!.prefetchEffect());
            const refreshed = await Effect.runPromise(project!.refreshEffect());

            expect(prefetched.name).toBe("Atlas");
            expect(refreshed.name).toBe("Atlas");
            expect(loads).toBeGreaterThan(0);
          }),
        catch: (error) => error
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  it("bridges same-ref delete and reload through React resource handles", async () => {
    let loads = 0;
    let project: ResourceHandle<string, Project, never> | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ReactHooks.resource-same-ref-reload",
      load: (id) =>
        Effect.sync(() => {
          loads++;
          return { id, name: `Atlas ${loads}` };
        })
    });
    const ref = ProjectById("atlas");

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          project = useResource(ref, { preload: false });
          return null;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        expect(project?.state._tag).toBe("Initial");

        await act(async () => {
          await Effect.runPromise(project!.prefetchEffect());
        });
        await flushReact();

        expect(project?.value).toEqual({ id: "atlas", name: "Atlas 1" });

        await act(async () => {
          await Effect.runPromise(runtime.provide(Resource.deleteEffect(ref)));
        });
        await flushReact();

        expect(project?.state._tag).toBe("Initial");

        await act(async () => {
          await Effect.runPromise(project!.prefetchEffect());
        });
        await flushReact();

        expect(project?.value).toEqual({ id: "atlas", name: "Atlas 2" });
        expect(loads).toBe(2);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("retains mounted resource values through gcFor", async () => {
    vi.useFakeTimers();
    let project: ResourceHandle<string, Project, never> | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ReactHooks.resource-mounted-gc-retention",
      load: (id) => Effect.succeed({ id, name: "Atlas" }),
      policy: {
        gcFor: 10
      }
    });
    const ref = ProjectById("atlas");

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      await withReactRoot(async (root) => {
        function Capture() {
          project = useResource(ref, { preload: false });
          return null;
        }

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
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(project?.value).toEqual({ id: "atlas", name: "Atlas" });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(11);
        });

        expect(project?.value).toEqual({ id: "atlas", name: "Atlas" });
        expect((await Effect.runPromise(runtime.provide(Resource.statusEffect(ref))))._tag).toBe("Success");
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(11);

      expect((await Effect.runPromise(runtime.provide(Resource.statusEffect(ref))))._tag).toBe("Initial");
    } finally {
      vi.useRealTimers();
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("surfaces automatic resource preload failures", async () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ReactHooksPreloadFailed" } as const;
    let observed: typeof failure | undefined;
    let project: ResourceHandle<string, Project, typeof failure> | undefined;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ReactHooks.resource-preload-failure",
      load: () => Effect.fail(failure)
    });

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          project = useResource(ProjectById("atlas"), {
            onPreloadFailure: (error) => {
              observed = error;
            }
          });
          return null;
        }

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
          await Effect.runPromise(Effect.sleep("20 millis"));
        });

        expect(project?.preloadFailure).toBe(failure);
        expect(observed).toBe(failure);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("uses the latest resource preload failure observer for in-flight preloads", async () => {
    const runtime = makeRuntime();
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const failure = { _tag: "ReactHooksPreloadObserverChanged" } as const;
    const observed: Array<"first" | "second"> = [];
    let setObserverVersion: ((version: "first" | "second") => void) | undefined;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ReactHooks.resource-preload-latest-observer",
      load: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.flatMap(() => Deferred.await(release)),
          Effect.flatMap(() => Effect.fail(failure))
        )
    });

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          const [version, setVersion] = useState<"first" | "second">("first");
          setObserverVersion = setVersion;
          useResource(ProjectById("atlas"), {
            onPreloadFailure: () => {
              observed.push(version);
            }
          });
          return null;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout("1 second")));

        await act(async () => {
          setObserverVersion?.("second");
        });
        await flushReact();

        await act(async () => {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Effect.sleep("20 millis"));
        });

        expect(observed).toEqual(["second"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keys automatic resource preload failures to the current ref", async () => {
    const runtime = makeRuntime();
    const failure = { _tag: "ReactHooksPreloadFailedForRef" } as const;
    let project: ResourceHandle<string, Project, typeof failure> | undefined;
    let setProjectId: ((id: string) => void) | undefined;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "ReactHooks.resource-preload-failure-keyed",
      load: (id) =>
        id === "fail"
          ? Effect.fail(failure)
          : Effect.succeed({ id, name: "Atlas" })
    });

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ProjectById("atlas"))));

      await withReactRoot(async (root) => {
        function Capture() {
          const [id, setId] = useState("fail");
          setProjectId = setId;
          project = useResource(ProjectById(id));
          return null;
        }

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
          await Effect.runPromise(Effect.sleep("20 millis"));
        });

        expect(project?.preloadFailure).toBe(failure);

        await act(async () => {
          setProjectId?.("atlas");
        });
        await flushReact();

        expect(project?.value).toEqual({ id: "atlas", name: "Atlas" });
        expect(project?.preloadFailure).toBeUndefined();
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps React action submissions stable across rerenders", async () => {
    const runtime = makeRuntime();
    const started = await Effect.runPromise(Deferred.make<void>());
    const interrupted = await Effect.runPromise(Deferred.make<void>());
    let action: ReturnType<typeof useAction<string, string, never, never>> | undefined;
    let rerender: (() => void) | undefined;
    const Save = Action.define({
      name: "ReactHooks.action-stable-rerender",
      policy: { concurrency: "latest" },
      run: (value: string) =>
        value === "first"
          ? Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
            )
          : Effect.succeed(value)
    });

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          const [, setTick] = useState(0);
          rerender = () => setTick((tick) => tick + 1);
          action = useAction(Save);
          return null;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        const first = runtime.runFork(action!.submitEffect("first").pipe(Effect.exit));
        await Effect.runPromise(Deferred.await(started));
        const before = action;

        await act(async () => {
          rerender?.();
        });
        expect(action).toBe(before);

        await Effect.runPromise(action!.submitEffect("second"));
        await Effect.runPromise(Deferred.await(interrupted));
        expect(await Effect.runPromise(Fiber.join(first).pipe(Effect.exit))).toMatchObject({
          _tag: "Failure"
        });
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("bridges React action state and invalidation plans through React values", async () => {
    const runtime = makeRuntime();
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const ProjectById = Resource.family<string, Project>({
      name: "ReactHooks.action-state-project",
      load: (id) => Effect.succeed({ id, name: id })
    });
    const Save = Action.define<string, string>({
      name: "ReactHooks.action-state-values",
      run: (value) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return value.toUpperCase();
        }),
      invalidates: (value) => [ProjectById(value)]
    });
    let action: ReturnType<typeof useAction<string, string, never, never>> | undefined;

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ProjectById("ATLAS"))));

      await withReactRoot(async (root, container) => {
        function Capture() {
          action = useAction(Save);
          return createElement(
            "span",
            null,
            `${action.state._tag}:${action.invalidationPlan?.entries.length ?? 0}`
          );
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });
        expect(container.textContent).toBe("Idle:0");

        let fiber: Fiber.Fiber<unknown, unknown> | undefined;
        await act(async () => {
          fiber = runtime.runFork(action!.submitEffect("ATLAS").pipe(Effect.exit));
          await Effect.runPromise(Deferred.await(started));
        });
        expect(container.textContent).toBe("Pending:0");

        await act(async () => {
          await Effect.runPromise(Deferred.succeed(release, undefined));
          await Effect.runPromise(Fiber.join(fiber!));
        });

        expect(action?.state._tag).toBe("Success");
        expect(action?.invalidationPlan?.entries).toHaveLength(1);
        expect(container.textContent).toBe("Success:1");
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("resets active React action submissions on unmount", async () => {
    const runtime = makeRuntime();
    const started = await Effect.runPromise(Deferred.make<void>());
    const interrupted = await Effect.runPromise(Deferred.make<void>());
    let action: ReturnType<typeof useAction<void, void, never, never>> | undefined;
    const Save = Action.define({
      name: "ReactHooks.action-unmount-reset",
      run: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }).pipe(
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
        )
    });

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          action = useAction(Save);
          return null;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        runtime.runFork(action!.submitEffect(undefined).pipe(Effect.exit));
        await Effect.runPromise(Deferred.await(started));

        await act(async () => {
          root.unmount();
        });

        await Effect.runPromise(Deferred.await(interrupted));
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("restarts React Programs when the definition changes", async () => {
    const runtime = makeRuntime();
    type Model = { readonly name: string };
    type Message = "go";
    const First = Program.define<Model, Message>({
      initial: { name: "first-idle" },
      update: () => Program.next({ name: "first" })
    });
    const Second = Program.define<Model, Message>({
      initial: { name: "second-idle" },
      update: () => Program.next({ name: "second" })
    });
    let program: ReturnType<typeof useProgram<Model, Message>> | undefined;
    let useSecond: (() => void) | undefined;

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          const [definition, setDefinition] = useState(First);
          useSecond = () => setDefinition(Second);
          program = useProgram(definition);
          return null;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(Capture)
            )
          );
        });

        expect(program?.model).toEqual({ name: "first-idle" });
        await act(async () => {
          await Effect.runPromise(program!.dispatchEffect("go"));
        });
        expect(program?.model).toEqual({ name: "first" });
        expect(program?.timeline.map((event) => event._tag)).toContain("Message");

        await act(async () => {
          program!.clearTimeline();
        });
        expect(program?.timeline).toEqual([]);
        expect(program?.model).toEqual({ name: "first" });

        await act(async () => {
          useSecond?.();
        });
        await flushReact();
        expect(program?.model).toEqual({ name: "second-idle" });

        await act(async () => {
          await Effect.runPromise(program!.dispatchEffect("go"));
        });
        expect(program?.model).toEqual({ name: "second" });
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not start React Programs for suspended render work", async () => {
    const runtime = makeRuntime();
    let starts = 0;
    const suspended = {
      then: () => undefined
    } satisfies PromiseLike<void>;
    const SuspendedProgram = Program.define<number, "tick">({
      initial: 0,
      update: (model) => Program.next(model + 1),
      subscriptions: () =>
        Program.subscription(
          Stream.fromEffect(
            Effect.sync(() => {
              starts++;
              return "tick" as const;
            })
          )
        )
    });

    try {
      await withReactRoot(async (root) => {
        function Capture() {
          useProgram(SuspendedProgram);
          throw suspended;
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(
                Suspense,
                { fallback: createElement("span", null, "loading") },
                createElement(Capture)
              )
            )
          );
        });

        await act(async () => {
          await Effect.runPromise(Effect.sleep("20 millis"));
        });

        expect(starts).toBe(0);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("reads suspense resource status from the React runtime", async () => {
    let project: Project | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "ReactHooks.runtime-bound-suspense",
      load: (id) => Effect.succeed({ id, name: "Atlas" })
    });
    const ref = ProjectById("atlas");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));
        yield* Effect.tryPromise({
          try: () =>
            withReactRoot(async (root) => {
              function Capture() {
                project = useResourceSuspense(ref);
                return null;
              }

              await act(async () => {
                root.render(
                  createElement(
                    RuntimeProvider,
                    { runtime },
                    createElement(Capture)
                  )
                );
              });

              expect(project).toEqual({ id: "atlas", name: "Atlas" });
            }),
          catch: (error) => error
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  it("loads unprefetched scoped suspense resources with the default preload", async () => {
    let project: Project | undefined;
    let releases = 0;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project, never, Scope.Scope>({
      name: "ReactHooks.suspense-default-scoped",
      load: (id) =>
        Effect.acquireRelease(
          Effect.succeed({ id, name: "Atlas" }),
          () => Effect.sync(() => {
            releases++;
          })
        )
    });

    try {
      await withReactRoot(async (root, container) => {
        function Capture() {
          project = useResourceSuspense(ProjectById("atlas"));
          return createElement("span", null, project.name);
        }

        await act(async () => {
          root.render(
            createElement(
              RuntimeProvider,
              { runtime },
              createElement(
                Suspense,
                { fallback: createElement("span", null, "loading") },
                createElement(Capture)
              )
            )
          );
        });
        await flushReact();

        expect(project).toEqual({ id: "atlas", name: "Atlas" });
        expect(container.textContent).toBe("Atlas");
        expect(releases).toBe(1);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("detaches pending suspense preload work on component cleanup", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let thrown: unknown;
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const ProjectById = Resource.family<string, Project>({
          name: "ReactHooks.suspense-cleanup",
          load: (id) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              Effect.as({ id, name: "Atlas" })
            )
        });

        yield* Effect.tryPromise({
          try: () =>
            withReactRoot(async (root) => {
              function Capture() {
                try {
                  useResourceSuspense(ProjectById("atlas"));
                } catch (error) {
                  thrown = error;
                  suppressHostThenableFailure(error);
                }
                return null;
              }

              await act(async () => {
                root.render(
                  createElement(
                    RuntimeProvider,
                    { runtime },
                    createElement(Capture)
                  )
                );
              });

              expect(thrown).toBeInstanceOf(Promise);
              await Effect.runPromise(Deferred.await(started));
            }),
          catch: (error) => error
        });

        const interruptedBeforeRuntimeDispose = yield* Deferred.await(interrupted).pipe(
          Effect.as(true),
          Effect.timeout("200 millis"),
          Effect.catch(() => Effect.succeed(false))
        );

        expect(interruptedBeforeRuntimeDispose).toBe(false);
        yield* runtime.disposeEffect;
        yield* Deferred.await(interrupted);
      })
    ));

  it("detaches stale suspense preload work when the ref changes to a loaded resource", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let project: Project | undefined;
        let setProjectId: ((id: string) => void) | undefined;
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const ProjectById = Resource.family<string, Project>({
          name: "ReactHooks.suspense-ref-change",
          load: (id) =>
            id === "slow"
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }).pipe(
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                  Effect.as({ id, name: "Slow" })
                )
              : Effect.succeed({ id, name: "Fast" })
        });

        yield* runtime.provide(Resource.prefetchEffect(ProjectById("fast")));

        yield* Effect.tryPromise({
          try: () =>
            withReactRoot(async (root) => {
              function Capture() {
                const [projectId, setId] = useState("slow");
                setProjectId = setId;
                try {
                  project = useResourceSuspense(ProjectById(projectId));
                } catch (error) {
                  suppressHostThenableFailure(error);
                }
                return null;
              }

              await act(async () => {
                root.render(
                  createElement(
                    RuntimeProvider,
                    { runtime },
                    createElement(Capture)
                  )
                );
              });

              await Effect.runPromise(Deferred.await(started));
              await act(async () => {
                setProjectId?.("fast");
              });
              await flushReact();
              expect(project).toEqual({ id: "fast", name: "Fast" });
            }),
          catch: (error) => error
        });

        const interruptedBeforeRuntimeDispose = yield* Deferred.await(interrupted).pipe(
          Effect.as(true),
          Effect.timeout("200 millis"),
          Effect.catch(() => Effect.succeed(false))
        );

        expect(interruptedBeforeRuntimeDispose).toBe(false);
        yield* runtime.disposeEffect;
        yield* Deferred.await(interrupted);
      })
    ));

  it("interrupts useRuntimeEffect fibers on component cleanup", async () => {
    const runtime = makeRuntime();

    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();

        yield* Effect.tryPromise({
          try: () =>
            withReactRoot(async (root) => {
              function Worker() {
                const run = useRuntimeEffect();
                useEffect(() => {
                  run(
                    Effect.gen(function* () {
                      yield* Deferred.succeed(started, undefined);
                      return yield* Effect.never;
                    }).pipe(
                      Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
                    )
                  );
                }, [run]);
                return null;
              }

              await act(async () => {
                root.render(
                  createElement(
                    RuntimeProvider,
                    { runtime },
                    createElement(Worker)
                  )
                );
              });

              await Effect.runPromise(Deferred.await(started));

              await act(async () => {
                root.unmount();
              });

              await Effect.runPromise(Deferred.await(interrupted));
            }),
          catch: (error) => error
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  it("keeps component scopes usable when the React runtime changes", async () => {
    const runtimeA = makeRuntime();
    const runtimeB = makeRuntime();
    const seen: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            withReactRoot(async (root) => {
              let switchRuntime: (() => void) | undefined;

              function Worker(props: { readonly label: string }) {
                const run = useRuntimeEffect();
                useEffect(() => {
                  run(Effect.sync(() => {
                    seen.push(props.label);
                  }));
                }, [run, props.label]);
                return null;
              }

              function App() {
                const [runtime, setRuntime] = useState(runtimeA);
                switchRuntime = () => setRuntime(runtimeB);
                const label = runtime === runtimeA ? "Alpha" : "Beta";
                return createElement(
                  RuntimeProvider,
                  { runtime },
                  createElement(Worker, { label })
                );
              }

              await act(async () => {
                root.render(createElement(App));
              });
              await flushReact();

              await act(async () => {
                switchRuntime?.();
              });
              await flushReact();

              expect(seen).toContain("Beta");
            }),
          catch: (error) => error
        });
      }).pipe(
        Effect.ensuring(runtimeA.disposeEffect),
        Effect.ensuring(runtimeB.disposeEffect)
      )
    );
  });

  it("recreates provider-owned React runtimes when the source changes", async () => {
    const sourceA = Layer.succeed(ProjectApi)({
      get: (id) => Effect.succeed({ id, name: "Alpha" })
    });
    const sourceB = Layer.succeed(ProjectApi)({
      get: (id) => Effect.succeed({ id, name: "Beta" })
    });
    const seen: string[] = [];

    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          withReactRoot(async (root) => {
            let switchSource: (() => void) | undefined;

            function Worker(props: { readonly label: string }) {
              const run = useRuntimeEffect();
              useEffect(() => {
                run(
                  ProjectApi.use((api) =>
                    api.get("atlas").pipe(
                      Effect.map((project) => {
                        seen.push(`${props.label}:${project.name}`);
                      })
                    )
                  )
                );
              }, [run, props.label]);
              return null;
            }

            function App() {
              const [source, setSource] = useState(sourceA);
              switchSource = () => setSource(sourceB);
              const label = source === sourceA ? "First" : "Second";
              return createElement(
                RuntimeProvider,
                { source },
                createElement(Worker, { label })
              );
            }

            await act(async () => {
              root.render(createElement(App));
            });
            await flushReact();

            await act(async () => {
              switchSource?.();
            });
            await flushReact();

            expect(seen).toContain("First:Alpha");
            expect(seen).toContain("Second:Beta");
          }),
        catch: (error) => error
      })
    );
  });

  it("reports provider-owned React runtime disposal failures to Effect observers", async () => {
    const observed = await Effect.runPromise(Deferred.make<unknown>());
    const cleanupDom = installDom();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Worker() {
      const runtime = useRuntime();
      useEffect(() => {
        runtime.resourceStore.moduleRegistry.register(Symbol("react-provider-dispose-failure"), {
          disposeEffect: Effect.fail("react dispose failed")
        });
      }, [runtime]);
      return null;
    }

    try {
      await act(async () => {
        root.render(createElement(
          RuntimeProvider,
          {
            onDisposeFailure: (error) => Deferred.succeed(observed, error)
          },
          createElement(Worker)
        ));
      });
      await flushReact();

      await act(async () => {
        root.unmount();
      });

      await expect(Effect.runPromise(
        Deferred.await(observed).pipe(Effect.timeout("1 second"))
      )).resolves.toBe("react dispose failed");
    } finally {
      cleanupDom();
    }
  });

  it("does not dispose a provider-owned React runtime when only the disposal observer changes", async () => {
    let setObserverVersion: ((version: number) => void) | undefined;
    let disposeCount = 0;

    function Worker() {
      const runtime = useRuntime();
      useEffect(() => {
        runtime.resourceStore.moduleRegistry.register(Symbol("react-provider-dispose-count"), {
          disposeEffect: Effect.sync(() => {
            disposeCount++;
          })
        });
      }, [runtime]);
      return null;
    }

    function App() {
      const [version, setVersion] = useState(0);
      setObserverVersion = setVersion;
      return createElement(
        RuntimeProvider,
        {
          onDisposeFailure: () => Effect.sync(() => {
            void version;
          })
        },
        createElement(Worker)
      );
    }

    await withReactRoot(async (root) => {
      await act(async () => {
        root.render(createElement(App));
      });
      await flushReact();

      await act(async () => {
        setObserverVersion?.(1);
      });
      await flushReact();

      expect(disposeCount).toBe(0);
    });

    await Effect.runPromise(Effect.sleep("20 millis"));
    expect(disposeCount).toBe(1);
  });
});
