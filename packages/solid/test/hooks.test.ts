import { Action, makeRuntime, onDispose, Program, Resource, ResourceFailure, ResourcePending, ResourceStoreDisposeError, RuntimeDisposeError, runWithRuntime } from "@effect-ui/core";
import { Cause, Context, Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { createRoot, createSignal } from "solid-js";
import { createComponent } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { createComponentScope, RuntimeProvider, useAction, useProgram, useResource, useResourceSuspense, useRuntime, useRuntimeEffect, useSignal, useStream } from "../src/index.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@effect-ui/solid/test/ProjectApi");

const suppressHostThenableFailure = (value: unknown): void => {
  void Effect.runPromise(
    Effect.tryPromise({
      try: () => value as PromiseLike<unknown>,
      catch: () => undefined
    }).pipe(Effect.catch(() => Effect.void))
  );
};

describe("solid hooks", () => {
  it("binds returned resource Effects to the Solid runtime", () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
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
      name: "SolidHooks.runtime-bound-resource",
      load: (id) => ProjectApi.use((api) => api.get(id))
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const project = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useResource(ProjectById("atlas"));
          })
        );

        const prefetched = yield* project.prefetchEffect();
        const refreshed = yield* project.refreshEffect();

        expect(prefetched.name).toBe("Atlas");
        expect(refreshed.name).toBe("Atlas");
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("bridges same-ref delete and reload through Solid resource handles", () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
    let state: (() => { readonly _tag: string }) | undefined;
    let value: (() => Project | undefined) | undefined;
    let prefetchEffect: (() => Effect.Effect<Project, Resource.LoadError<never>>) | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "SolidHooks.resource-same-ref-reload",
      load: (id) =>
        Effect.sync(() => {
          loads++;
          return { id, name: `Atlas ${loads}` };
        })
    });
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const project = useResource(ref, { preload: false });
            state = project.state;
            value = project.value;
            prefetchEffect = project.prefetchEffect;
          })
        );

        expect(state?.()._tag).toBe("Initial");

        yield* prefetchEffect!();
        expect(value?.()).toEqual({ id: "atlas", name: "Atlas 1" });

        yield* runtime.provide(Resource.deleteEffect(ref));
        expect(state?.()._tag).toBe("Initial");

        yield* prefetchEffect!();
        expect(value?.()).toEqual({ id: "atlas", name: "Atlas 2" });
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("retains mounted resource values through gcFor", async () => {
    vi.useFakeTimers();
    let dispose: (() => void) | undefined;
    let value: (() => Project | undefined) | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "SolidHooks.resource-mounted-gc-retention",
      load: (id) => Effect.succeed({ id, name: "Atlas" }),
      policy: {
        gcFor: 10
      }
    });
    const ref = ProjectById("atlas");

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      runWithRuntime(runtime, () =>
        createRoot((rootDispose) => {
          dispose = rootDispose;
          const project = useResource(ref, { preload: false });
          value = project.value;
        })
      );

      expect(value?.()).toEqual({ id: "atlas", name: "Atlas" });

      await vi.advanceTimersByTimeAsync(11);

      expect(value?.()).toEqual({ id: "atlas", name: "Atlas" });
      expect((await Effect.runPromise(runtime.provide(Resource.statusEffect(ref))))._tag).toBe("Success");

      dispose?.();
      dispose = undefined;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(11);

      expect((await Effect.runPromise(runtime.provide(Resource.statusEffect(ref))))._tag).toBe("Initial");
    } finally {
      dispose?.();
      vi.useRealTimers();
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("surfaces automatic resource preload failures", () => {
    let dispose: (() => void) | undefined;
    const runtime = makeRuntime();
    const failure = { _tag: "SolidHooksPreloadFailed" } as const;
    let observed: typeof failure | undefined;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "SolidHooks.resource-preload-failure",
      load: () => Effect.fail(failure)
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const project = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useResource(ProjectById("atlas"), {
              onPreloadFailure: (error) => {
                observed = error;
              }
            });
          })
        );

        yield* Effect.sleep("20 millis");

        expect(project.preloadFailure()).toBe(failure);
        expect(observed).toBe(failure);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("keys automatic resource preload failures to the current ref", () => {
    let dispose: (() => void) | undefined;
    let setProjectId: ((id: string) => string) | undefined;
    const runtime = makeRuntime();
    const failure = { _tag: "SolidHooksPreloadFailedForRef" } as const;
    const ProjectById = Resource.family<string, Project, typeof failure>({
      name: "SolidHooks.resource-preload-failure-keyed",
      load: (id) =>
        id === "fail"
          ? Effect.fail(failure)
          : Effect.succeed({ id, name: "Atlas" })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ProjectById("atlas")));

        const project = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [projectId, setId] = createSignal("fail");
            setProjectId = setId;
            return useResource(() => ProjectById(projectId()));
          })
        );

        yield* Effect.sleep("20 millis");

        expect(project.preloadFailure()).toBe(failure);

        setProjectId?.("atlas");
        yield* Effect.sleep("20 millis");

        expect(project.value()).toEqual({ id: "atlas", name: "Atlas" });
        expect(project.preloadFailure()).toBeUndefined();
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("reads suspense resource status from the Solid runtime", () => {
    let dispose: (() => void) | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "SolidHooks.runtime-bound-suspense",
      load: (id) => Effect.succeed({ id, name: "Atlas" })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ProjectById("atlas")));

        const value = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const readProject = useResourceSuspense(ProjectById("atlas"));
            return readProject();
          })
        );

        expect(value).toEqual({ id: "atlas", name: "Atlas" });
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("throws ResourceFailure from suspense accessors when a refresh fails with stale data", () => {
    let dispose: (() => void) | undefined;
    let fail = false;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project, string>({
      name: "SolidHooks.suspense-stale-failure",
      load: (id) =>
        fail
          ? Effect.fail("offline")
          : Effect.succeed({ id, name: "Atlas" })
    });
    const ref = ProjectById("atlas");

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));

        const readProject = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useResourceSuspense(ref);
          })
        );

        expect(readProject()).toEqual({ id: "atlas", name: "Atlas" });

        fail = true;
        yield* Effect.flip(runtime.provide(Resource.refreshEffect(ref)));

        try {
          readProject();
          expect.fail("Expected stale failed suspense read to throw ResourceFailure");
        } catch (error) {
          expect(error).toBeInstanceOf(ResourceFailure);
          expect(error).toMatchObject({
            error: "offline",
            previous: { id: "atlas", name: "Atlas" }
          });
        }
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("detaches pending suspense preload work on component cleanup", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let dispose: (() => void) | undefined;
        let thrown: unknown;
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const ProjectById = Resource.family<string, Project>({
          name: "SolidHooks.suspense-cleanup",
          load: (id) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              Effect.as({ id, name: "Atlas" })
            )
        });

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const readProject = useResourceSuspense(ProjectById("atlas"));
            try {
              readProject();
            } catch (error) {
              thrown = error;
              suppressHostThenableFailure(error);
            }
          })
        );

        expect(thrown).toBeInstanceOf(Promise);
        yield* Deferred.await(started);
        dispose?.();
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
        let dispose: (() => void) | undefined;
        let readProject: (() => Project) | undefined;
        let setProjectId: ((id: string) => string) | undefined;
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const ProjectById = Resource.family<string, Project>({
          name: "SolidHooks.suspense-ref-change",
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

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [projectId, setId] = createSignal("slow");
            setProjectId = setId;
            readProject = useResourceSuspense(() => ProjectById(projectId()));
            try {
              readProject();
            } catch (error) {
              suppressHostThenableFailure(error);
            }
          })
        );

        yield* Deferred.await(started);
        setProjectId?.("fast");
        expect(readProject?.()).toEqual({ id: "fast", name: "Fast" });
        const interruptedBeforeRuntimeDispose = yield* Deferred.await(interrupted).pipe(
          Effect.as(true),
          Effect.timeout("200 millis"),
          Effect.catch(() => Effect.succeed(false))
        );

        expect(interruptedBeforeRuntimeDispose).toBe(false);
        dispose?.();
        yield* runtime.disposeEffect;
        yield* Deferred.await(interrupted);
      })
    ));

  it("creates an owned runtime for default RuntimeProvider instances", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let dispose: (() => void) | undefined;
        let firstRuntime: ReturnType<typeof useRuntime> | undefined;
        let secondRuntime: ReturnType<typeof useRuntime> | undefined;
        const ProjectById = Resource.family<string, Project>({
          name: "SolidHooks.default-provider-runtime",
          load: (id) => Effect.succeed({ id, name: "Atlas" })
        });
        const ref = ProjectById("atlas");

        createRoot((rootDispose) => {
          dispose = rootDispose;
          createComponent(RuntimeProvider, {
            get children() {
              firstRuntime = useRuntime();
              return undefined;
            }
          });
          createComponent(RuntimeProvider, {
            get children() {
              secondRuntime = useRuntime();
              return undefined;
            }
          });
        });

        expect(firstRuntime).toBeDefined();
        expect(secondRuntime).toBeDefined();
        expect(firstRuntime).not.toBe(secondRuntime);

        yield* firstRuntime!.provide(Resource.prefetchEffect(ref));

        expect(runWithRuntime(firstRuntime!, () => Resource.status(ref)._tag)).toBe("Success");
        expect(runWithRuntime(secondRuntime!, () => Resource.status(ref)._tag)).toBe("Initial");
        dispose?.();
      })
    ));

  it("reports provider-owned Solid runtime disposal failures to Effect observers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const observed = yield* Deferred.make<unknown>();
        let dispose: (() => void) | undefined;

        createRoot((rootDispose) => {
          dispose = rootDispose;
          createComponent(RuntimeProvider, {
            onDisposeFailure: (error) => Deferred.succeed(observed, error),
            get children() {
              const runtime = useRuntime();
              runtime.resourceStore.moduleRegistry.register(Symbol("solid-provider-dispose-failure"), {
                disposeEffect: Effect.fail("solid dispose failed")
              });
              return undefined;
            }
          });
        });

        dispose?.();
        const error = yield* Deferred.await(observed).pipe(Effect.timeout("1 second"));
        expect(error).toBeInstanceOf(RuntimeDisposeError);
        if (error instanceof RuntimeDisposeError) {
          expect(error.phase).toBe("resource-store");
          const storeError = error.cause.reasons.find(Cause.isFailReason)?.error;
          expect(storeError).toBeInstanceOf(ResourceStoreDisposeError);
          if (storeError instanceof ResourceStoreDisposeError) {
            expect(storeError.cause.reasons.find(Cause.isFailReason)?.error).toBe("solid dispose failed");
          }
        }
      })
    ));

  it("binds service-backed streams to the Solid runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let dispose: (() => void) | undefined;
        const emitted = yield* Deferred.make<void>();
        const runtime = makeRuntime(
          Layer.succeed(ProjectApi)({
            get: (id) => Effect.succeed({ id, name: "Atlas" })
          })
        );

        const name = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            return useStream(
              Stream.fromEffect(ProjectApi.use((api) => api.get("atlas")).pipe(
                Effect.map((project) => project.name),
                Effect.tap(() => Deferred.succeed(emitted, undefined))
              )),
              "loading"
            );
          })
        );

        yield* Deferred.await(emitted);
        expect(name()).toBe("Atlas");
        dispose?.();
        yield* runtime.disposeEffect;
      })
    ));

  it("forks fire-and-forget Effects with the Solid runtime", async () => {
    let dispose: (() => void) | undefined;
    const runtime = makeRuntime(
      Layer.succeed(ProjectApi)({
        get: (id) => Effect.succeed({ id, name: "Atlas" })
      })
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const runEffect = useRuntimeEffect();
            return runEffect(ProjectApi.use((api) => api.get("atlas")));
          })
        );
        const project = yield* Fiber.join(fiber);

        expect(project).toEqual({ id: "atlas", name: "Atlas" });
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("exposes Effect UI Programs as Solid accessors bound to the runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let dispose: (() => void) | undefined;
        let program: ReturnType<typeof useProgram<{ readonly name: string }, { readonly _tag: "Load" } | { readonly _tag: "Loaded"; readonly project: Project }, never, ProjectApi>> | undefined;
        const loaded = yield* Deferred.make<void>();
        const runtime = makeRuntime(
          Layer.succeed(ProjectApi)({
            get: (id) => Effect.succeed({ id, name: "Atlas" })
          })
        );
        const definition = Program.define<
          { readonly name: string },
          { readonly _tag: "Load" } | { readonly _tag: "Loaded"; readonly project: Project },
          never,
          ProjectApi
        >({
          initial: { name: "idle" },
          update: (model, message) => {
            switch (message._tag) {
              case "Load":
                return Program.next(
                  model,
                  Program.command(
                    ProjectApi.use((api) =>
                      api.get("atlas").pipe(
                        Effect.map((project) => ({ _tag: "Loaded", project }) as const)
                      )
                    )
                  )
                );
              case "Loaded":
                return Program.next(
                  { name: message.project.name },
                  Program.effect(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid))
                );
            }
          }
        });

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            program = useProgram(definition);
          })
        );

        expect(program?.model()).toEqual({ name: "idle" });
        yield* program!.dispatchEffect({ _tag: "Load" });
        yield* Deferred.await(loaded);
        expect(program?.model()).toEqual({ name: "Atlas" });
        expect(program?.timeline().map((event) => event._tag)).toContain("Message");
        program!.clearTimeline();
        expect(program?.timeline()).toEqual([]);
        expect(program?.model()).toEqual({ name: "Atlas" });

        dispose?.();
        yield* runtime.disposeEffect;
      })
    ));

  it("resets active Solid action submissions on owner cleanup", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let dispose: (() => void) | undefined;
        let action: ReturnType<typeof useAction<void, void, never, never>> | undefined;
        const runtime = makeRuntime();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const Save = Action.define({
          name: "SolidHooks.action-owner-cleanup-reset",
          run: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Effect.never;
            }).pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
            )
        });

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            action = useAction(Save);
          })
        );

        runtime.runFork(action!.submitEffect(undefined).pipe(Effect.exit));
        yield* Deferred.await(started);
        dispose?.();
        yield* Deferred.await(interrupted);
        yield* runtime.disposeEffect;
      })
    ));

  it("bridges Solid action state through accessors", () =>
    {
      const runtime = makeRuntime();
      let dispose: (() => void) | undefined;
      let action: ReturnType<typeof useAction<string, string, never, never>> | undefined;
      const release = Effect.runSync(Deferred.make<void>());
      const Save = Action.define<string, string>({
        name: "SolidHooks.action-accessor-state",
        run: (input) =>
          Deferred.await(release).pipe(
            Effect.as(`saved:${input}`)
          )
      });
      return Effect.runPromise(
        Effect.gen(function* () {
          runWithRuntime(runtime, () =>
            createRoot((rootDispose) => {
              dispose = rootDispose;
              action = useAction(Save);
            })
          );

          yield* Effect.sleep(0);
          expect(action?.state()._tag).toBe("Idle");

          const fiber = runtime.runFork(action!.submitEffect("atlas"));
          yield* Effect.sleep(0);
          expect(action?.state()._tag).toBe("Pending");
          yield* Deferred.succeed(release, undefined);
          const saved = yield* Fiber.join(fiber);

          expect(saved).toBe("saved:atlas");
          expect(action?.state()._tag).toBe("Success");
          expect(action?.instance.state.get()._tag).toBe("Success");
        }).pipe(
          Effect.ensuring(Effect.sync(() => dispose?.())),
          Effect.ensuring(runtime.disposeEffect)
        )
      );
    });

  it("interrupts useRuntimeEffect fibers on component cleanup", async () => {
    let dispose: (() => void) | undefined;
    const runtime = makeRuntime();

    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const runEffect = useRuntimeEffect();
            runEffect(
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Effect.never;
              }).pipe(
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
              )
            );
          })
        );

        yield* Deferred.await(started);
        dispose?.();
        yield* Deferred.await(interrupted);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("disposes component scopes through the owning Solid runtime", async () => {
    let dispose: (() => void) | undefined;
    let loads = 0;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "SolidHooks.component-scope-runtime-disposal",
      load: (id) =>
        Effect.sync(() => {
          loads++;
          return { id, name: "Atlas" };
        })
    });
    const ref = ProjectById("atlas");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));
        expect(runWithRuntime(runtime, () => Resource.status(ref)._tag)).toBe("Success");

        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            createComponentScope(() => {
              onDispose(() => Resource.deleteEffect(ref));
            });
          })
        );

        dispose?.();
        yield* Effect.sleep("20 millis");

        expect(() => runWithRuntime(runtime, () => Resource.read(ref))).toThrow(ResourcePending);
        yield* runtime.provide(Resource.prefetchEffect(ref));
        expect(loads).toBe(2);
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

  it("bridges deleted resource signal updates through Solid accessors", async () => {
    let dispose: (() => void) | undefined;
    let state: (() => { readonly _tag: string }) | undefined;
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, Project>({
      name: "SolidHooks.resource-delete-state",
      load: (id) => Effect.succeed({ id, name: "Atlas" })
    });
    const ref = ProjectById("atlas");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.prefetchEffect(ref));
        runWithRuntime(runtime, () =>
          createRoot((rootDispose) => {
            dispose = rootDispose;
            state = useSignal(Resource.result(ref));
          })
        );
        expect(state?.()._tag).toBe("Success");

        yield* runtime.provide(Resource.deleteEffect(ref));
        expect(state?.()._tag).toBe("Initial");
      }).pipe(
        Effect.ensuring(Effect.sync(() => dispose?.())),
        Effect.ensuring(runtime.disposeEffect)
      )
    );
  });

});
