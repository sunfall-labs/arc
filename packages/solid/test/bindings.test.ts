import {
  Action,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Program,
  Resource,
  ResourceFailure,
  Route,
} from "@sunfall/arc-core";
import {
  Cause,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { AsyncResult } from "effect/reactivity";
import { createComponent, Errored, Loading, render } from "@solidjs/web";
import { createContext, createRoot, flush, NotReadyError, useContext } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Component, RouterProvider } from "../src/index.js";
import { bindInInstance } from "./instance-harness.js";

interface Project {
  readonly id: string;
  readonly name: string;
}

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project>;
}

const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-solid/test/bindings/ProjectApi");

const ProjectApiLive = Layer.succeed(ProjectApi)({
  get: (id) => Effect.succeed({ id, name: "Atlas" }),
});

const waitForText = (container: Element, text: string) =>
  Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe(text)));

describe("Component bindings", () => {
  describe("resource", () => {
    it("reads cached values synchronously", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const ProjectById = Resource.define<string, Project>({
            name: "SolidBindings.sync-read",
            load: (id) => Effect.succeed({ id, name: "Atlas" }),
          });
          yield* runtime.provide(Resource.preload(ProjectById("atlas")));

          let dispose: (() => void) | undefined;
          const value = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(runtime, Component.resource(ProjectById))("atlas");
          });
          expect(value).toEqual({ id: "atlas", name: "Atlas" });
          dispose?.();
          yield* runtime.dispose;
        }),
      ));

    it("keeps serving the stale value when a refresh fails and reports it as status", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let fail = false;
          const runtime = makeRuntime();
          const ProjectById = Resource.define<string, Project, string>({
            name: "SolidBindings.stale-failure",
            error: Schema.String,
            load: (id) => (fail ? Effect.fail("offline") : Effect.succeed({ id, name: "Atlas" })),
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.preload(ref));

          let dispose: (() => void) | undefined;
          const project = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(runtime, Component.resource(ProjectById));
          });
          expect(project("atlas")).toEqual({ id: "atlas", name: "Atlas" });
          expect(project.waiting("atlas")).toBe(false);
          expect(project.failure("atlas")).toBeUndefined();

          fail = true;
          yield* Effect.flip(runtime.provide(Resource.refresh(ref)));
          flush();

          expect(project("atlas")).toEqual({ id: "atlas", name: "Atlas" });
          const failure = project.failure("atlas");
          expect(failure === undefined ? undefined : Cause.squash(failure)).toBe("offline");
          dispose?.();
          yield* runtime.dispose;
        }),
      ));

    it("throws a first-load failure as ResourceFailure", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const ProjectById = Resource.define<string, Project, string>({
            name: "SolidBindings.first-failure",
            load: () => Effect.fail("offline"),
          });
          yield* Effect.flip(runtime.provide(Resource.preload(ProjectById("atlas"))));

          let dispose: (() => void) | undefined;
          const project = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(runtime, Component.resource(ProjectById));
          });
          let thrown: unknown;
          try {
            project("atlas");
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(ResourceFailure);
          expect(
            AsyncResult.error((thrown as ResourceFailure<string, Project, string>).result),
          ).toEqual(Option.some("offline"));
          dispose?.();
          yield* runtime.dispose;
        }),
      ));

    it("keeps content mounted across refreshes, with value-free status chrome", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            let version = 0;
            const release = yield* Deferred.make<void>();
            const ProjectById = Resource.define<string, string>({
              name: "SolidBindings.refresh-mounted",
              load: (id) =>
                Effect.suspend(() =>
                  version === 0
                    ? Effect.succeed(`${id} v${version++}`)
                    : Effect.as(Deferred.await(release), `${id} v${version++}`),
                ),
            });
            const ref = ProjectById("atlas");
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
            const Card = Component.define("Card", function* () {
              const project = yield* Component.resource(ProjectById);
              return () => [
                (() => project("atlas")) as never,
                (() => (project.waiting("atlas") ? " refreshing" : "")) as never,
              ];
            }).pipe(Component.loading(() => "loading"));

            const container = document.createElement("div");
            yield* Component.mount(Card, container, { runtime });
            yield* waitForText(container, "atlas v0");
            const content = container.firstChild;

            runtime.runFork(Resource.refresh(ref));
            yield* waitForText(container, "atlas v0 refreshing");
            yield* Deferred.succeed(release, undefined);
            yield* waitForText(container, "atlas v1");
            // The same node stayed mounted through the refresh.
            expect(container.firstChild).toBe(content);
          }),
        ),
      ));

    it("retains mounted resource values through gcFor", async () => {
      vi.useFakeTimers();
      let dispose: (() => void) | undefined;
      const runtime = makeRuntime();
      const ProjectById = Resource.define<string, Project>({
        name: "SolidBindings.mounted-gc-retention",
        load: (id) => Effect.succeed({ id, name: "Atlas" }),
        policy: { gcFor: 10 },
      });
      const ref = ProjectById("atlas");
      const status = async () =>
        (await Effect.runPromise(runtime.provide(Resource.status(ref)))).result._tag;

      try {
        await Effect.runPromise(runtime.provide(Resource.preload(ref)));
        const project = createRoot((rootDispose) => {
          dispose = rootDispose;
          return bindInInstance(runtime, Component.resource(ProjectById));
        });
        createRoot(() => project("atlas"));
        await vi.advanceTimersByTimeAsync(11);
        expect(await status()).toBe("Success");

        dispose?.();
        dispose = undefined;
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(11);
        expect(await status()).toBe("Initial");
      } finally {
        dispose?.();
        vi.useRealTimers();
        await Effect.runPromise(Effect.orDie(runtime.dispose));
      }
    });

    it("detaches pending preload work when the instance is disposed", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let dispose: (() => void) | undefined;
          let thrown: unknown;
          const runtime = makeRuntime();
          const started = yield* Deferred.make<void>();
          const interrupted = yield* Deferred.make<void>();
          const ProjectById = Resource.define<string, Project>({
            name: "SolidBindings.pending-cleanup",
            load: (id) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }).pipe(
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                Effect.as({ id, name: "Atlas" }),
              ),
          });

          createRoot((rootDispose) => {
            dispose = rootDispose;
            const project = bindInInstance(runtime, Component.resource(ProjectById));
            try {
              project("atlas");
            } catch (error) {
              thrown = error;
            }
          });

          // Solid 2 suspends through its own not-ready signal, never a thrown Promise.
          expect(thrown).toBeInstanceOf(NotReadyError);
          yield* Deferred.await(started);
          dispose?.();
          // The load itself belongs to the runtime: disposal only detaches the read.
          const interruptedBeforeRuntimeDispose = yield* Deferred.await(interrupted).pipe(
            Effect.as(true),
            Effect.timeout("200 millis"),
            Effect.catch(() => Effect.succeed(false)),
          );
          expect(interruptedBeforeRuntimeDispose).toBe(false);
          yield* runtime.dispose;
          yield* Deferred.await(interrupted);
        }),
      ));
  });

  describe("action", () => {
    it("bridges action state through accessors", () => {
      const runtime = makeRuntime();
      let dispose: (() => void) | undefined;
      const release = Effect.runSync(Deferred.make<void>());
      const Save = Action.define<string, string>({
        name: "SolidBindings.action-accessor-state",
        run: (input) => Deferred.await(release).pipe(Effect.as(`saved:${input}`)),
      });
      return Effect.runPromise(
        Effect.gen(function* () {
          const action = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(runtime, Component.action(Save));
          });

          expect(action.result()._tag).toBe("Initial");
          expect(action.input()).toEqual(Option.none());

          const submission = yield* Effect.forkChild(action.submit("atlas"));
          yield* Effect.sleep(0);
          expect(action.result().waiting).toBe(true);
          expect(action.input()).toEqual(Option.some("atlas"));
          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(action.result()).toMatchObject({
                _tag: "Success",
                value: "saved:atlas",
                waiting: false,
              }),
            ),
          );

          expect(yield* Fiber.join(submission)).toBe("saved:atlas");
          expect(yield* action.submit("kepler")).toBe("saved:kepler");
          yield* action.reset();
          expect(action.result()._tag).toBe("Initial");
        }).pipe(
          Effect.ensuring(Effect.sync(() => dispose?.())),
          Effect.ensuring(Effect.orDie(runtime.dispose)),
        ),
      );
    });

    it("submits with the setup's services and interrupts submissions on unmount", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let dispose: (() => void) | undefined;
          const started = yield* Deferred.make<string>();
          const interrupted = yield* Deferred.make<void>();
          const runtime = makeRuntime(ProjectApiLive);
          const Save = Action.define({
            name: "SolidBindings.action-unmount",
            run: (id: string) =>
              ProjectApi.use((api) => api.get(id)).pipe(
                Effect.tap((project) => Deferred.succeed(started, project.name)),
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              ),
          });

          // Handlers submit through `Component.callback`, in the instance's Scope.
          const submit = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(
              runtime,
              Effect.gen(function* () {
                const action = yield* Component.action(Save);
                return yield* Component.callback("save", (id: string) =>
                  action.submit(id).pipe(Effect.ignore),
                );
              }),
            );
          });
          submit("atlas");
          expect(yield* Deferred.await(started)).toBe("Atlas");
          dispose?.();
          yield* Deferred.await(interrupted);
          yield* runtime.dispose;
        }),
      ));
  });

  describe("program, stream, and callback", () => {
    it("starts Programs with the runtime's services and stops them on unmount", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let dispose: (() => void) | undefined;
          const loaded = yield* Deferred.make<void>();
          const runtime = makeRuntime(ProjectApiLive);
          type Message =
            | { readonly _tag: "Load" }
            | { readonly _tag: "Loaded"; readonly project: Project };
          const definition = Program.define<{ readonly name: string }, Message, never, ProjectApi>({
            initial: { name: "idle" },
            on: {
              Load: (model) =>
                Program.next(
                  model,
                  Program.emit(
                    ProjectApi.use((api) =>
                      api
                        .get("atlas")
                        .pipe(Effect.map((project) => ({ _tag: "Loaded", project }) as const)),
                    ),
                  ),
                ),
              Loaded: (_model, message) =>
                Program.next(
                  { name: message.project.name },
                  Program.emit(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid)),
                ),
            },
          });

          const program = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(runtime, Component.program(definition));
          });

          expect(program.model()).toEqual({ name: "idle" });
          yield* program.dispatch({ _tag: "Load" });
          yield* Deferred.await(loaded);
          flush();
          expect(program.model()).toEqual({ name: "Atlas" });

          dispose?.();
          yield* Effect.sleep(0);
          const exit = yield* Effect.exit(program.dispatch({ _tag: "Load" }));
          expect(Exit.isFailure(exit)).toBe(true);
          yield* runtime.dispose;
        }),
      ));

    it("runs service-backed streams for the instance", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let dispose: (() => void) | undefined;
          const emitted = yield* Deferred.make<void>();
          const runtime = makeRuntime(ProjectApiLive);

          const name = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(
              runtime,
              Component.stream(
                "projectName",
                Stream.fromEffect(
                  ProjectApi.use((api) => api.get("atlas")).pipe(
                    Effect.map((project) => project.name),
                    Effect.tap(() => Deferred.succeed(emitted, undefined)),
                  ),
                ),
                "loading",
              ),
            );
          });

          yield* Deferred.await(emitted);
          expect(name()).toBe("Atlas");
          dispose?.();
          yield* runtime.dispose;
        }),
      ));

    it("runs callbacks with the setup's services and interrupts them on unmount", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          let dispose: (() => void) | undefined;
          const started = yield* Deferred.make<string>();
          const interrupted = yield* Deferred.make<void>();
          const runtime = makeRuntime(ProjectApiLive);

          const open = createRoot((rootDispose) => {
            dispose = rootDispose;
            return bindInInstance(
              runtime,
              Component.callback("open", (id: string) =>
                ProjectApi.use((api) => api.get(id)).pipe(
                  Effect.tap((project) => Deferred.succeed(started, project.name)),
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                ),
              ),
            );
          });

          open("atlas");
          expect(yield* Deferred.await(started)).toBe("Atlas");
          dispose?.();
          yield* Deferred.await(interrupted);
          yield* runtime.dispose;
        }),
      ));
  });

  describe("setup", () => {
    it("suspends instances while a provided Layer builds, building it once per runtime", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Deferred.make<void>();
            let builds = 0;
            const SlowApi = Layer.effect(
              ProjectApi,
              Effect.andThen(Deferred.await(gate), () => {
                builds++;
                return Effect.succeed({ get: (id: string) => Effect.succeed({ id, name: id }) });
              }),
            );
            const Card = Component.define("Card", function* (props: { readonly id: string }) {
              const api = yield* ProjectApi;
              const project = yield* api.get(props.id);
              return () => `${project.name};`;
            });
            const App = Component.define("App", function* () {
              const Inner = yield* Card;
              return () => [Inner({ id: "a" }), Inner({ id: "b" })];
            }).pipe(
              Component.provide(SlowApi),
              Component.loading(() => "loading"),
            );

            const container = document.createElement("div");
            yield* Component.mount(App, container);
            yield* waitForText(container, "loading");
            yield* Deferred.succeed(gate, undefined);
            yield* waitForText(container, "a;b;");
            expect(builds).toBe(1);
          }),
        ),
      ));

    it("runs every setup step under the instance's Solid owner, even after async steps", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const Theme = createContext("light");
            const gate = yield* Deferred.make<void>();
            const Card = Component.define("Card", function* () {
              const before = useContext(Theme);
              yield* Deferred.await(gate);
              const after = useContext(Theme);
              return () => `${before}/${after}`;
            });
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
            const Embedded = Component.embed(Card, runtime);

            const container = document.createElement("div");
            const dispose = render(
              () =>
                createComponent(Theme, {
                  value: "dark",
                  get children() {
                    return createComponent(Loading, {
                      fallback: "loading",
                      get children() {
                        return createComponent(Embedded, {});
                      },
                    });
                  },
                }),
              container,
            );
            yield* Effect.addFinalizer(() => Effect.sync(dispose));
            yield* waitForText(container, "loading");
            yield* Deferred.succeed(gate, undefined);
            yield* waitForText(container, "dark/dark");
          }),
        ),
      ));
  });

  describe("router and boundaries", () => {
    it("renders typed Component route views with the router's setup context", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const ProjectRoute = Route.define("/component-routes/:id", {
              preload: ({ params }) => ProjectApi.use((api) => api.get(params.id)),
            });
            const ProjectView = Component.define(
              "ProjectView",
              function* (props: Route.Props<typeof ProjectRoute>) {
                const api = yield* ProjectApi;
                const project = yield* api.get(props.params.id);
                return () => `project:${project.name}`;
              },
            );
            const routes = [Route.withComponent(ProjectRoute, ProjectView)] as const;
            const App = Component.define("App", function* () {
              const router = yield* Component.router(routes, {
                history: makeMemoryBrowserHistoryAdapter({
                  initialHref: "/component-routes/atlas",
                }),
              });
              return () => createComponent(RouterProvider<typeof routes>, { router });
            }).pipe(Component.provide(ProjectApiLive));

            const container = document.createElement("div");
            yield* Component.mount(App, container);
            yield* waitForText(container, "project:Atlas");
          }),
        ),
      ));

    it("handles every typed failure with catchAll and rethrows defects", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
            const Typed = Component.define("Typed", function* () {
              yield* Effect.fail(new Missing({ id: "atlas" }));
              return () => "never";
            }).pipe(Component.catchAll((error) => `missing ${error.id}`));
            const Defect = Component.define("Defect", function* () {
              yield* Effect.die(new Error("bug"));
              return () => "never";
            }).pipe(Component.catchAll(() => "typed"));
            const App = Component.define("App", function* () {
              const TypedView = yield* Typed;
              const DefectView = yield* Defect;
              return () => [
                TypedView({}),
                createComponent(Errored, {
                  fallback: () => " defect",
                  get children() {
                    return DefectView({});
                  },
                }),
              ];
            });

            const container = document.createElement("div");
            yield* Component.mount(App, container);
            yield* waitForText(container, "missing atlas defect");
          }),
        ),
      ));
  });
});
