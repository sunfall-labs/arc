import { Action, makeRuntime, Program, Resource, Signal } from "@effect-ui/core";
import { Window } from "happy-dom";
import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect";
import { Suspense, act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  RuntimeProvider,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
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
});
