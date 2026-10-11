import {
  makeRuntime,
  Resource,
  ResourceFailure,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import { type ResourceUiInput } from "@sunfall/arc-core/internal";
import { Cause, Context, Data, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createComponent, Errored, Loading, render, Show } from "@solidjs/web";
import { createSignal, resetErrorHalt } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Component, RuntimeProvider } from "../src/index.js";
import { reactive, ssrApp, ssrMarkup } from "./component-ssr-fixture.js";

// Counts reader bindings Components create, to observe binding reuse.
const bindings = vi.hoisted(() => ({ created: 0 }));
vi.mock("../src/resource-binding.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/resource-binding.js")>();
  return {
    ...actual,
    createResourceSuspense: <I, A, E, R, ER>(
      runtime: AnySunfallArcRuntime<ER>,
      ref: ResourceUiInput<I, A, E, R>,
    ) => {
      bindings.created++;
      return actual.createResourceSuspense(runtime, ref);
    },
  };
});

class ProjectApi extends Context.Service<
  ProjectApi,
  { readonly get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden> }
>()("@sunfall/arc-solid/test/Component/ProjectApi") {}
class ProjectNotFound extends Data.TaggedError("ProjectNotFound")<{ readonly id: string }> {}
class Forbidden extends Data.TaggedError("Forbidden")<{}> {}

const waitForText = (container: Element, text: string) =>
  Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe(text)));

const projectApi = (get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden>) =>
  Layer.succeed(ProjectApi, { get });

let familyId = 0;
const projectFamily = () =>
  Resource.family({
    name: `SolidComponent.ProjectById.${familyId++}`,
    load: (id: string) => ProjectApi.use((api) => api.get(id)),
  });

describe("Component", () => {
  it("mounts a provided component and disposes it with the mount Scope", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const container = document.createElement("div");
        const events: Array<string> = [];
        const Greeting = Component.make("Greeting", function* () {
          const api = yield* ProjectApi;
          yield* Effect.addFinalizer(() => Effect.sync(() => events.push("setup finalized")));
          const name = yield* api.get("atlas").pipe(Effect.orDie);
          return (props: { readonly greeting: string }) => `${props.greeting} ${name}`;
        });
        const App = Greeting.pipe(
          Component.provide(projectApi((id) => Effect.succeed(id.toUpperCase()))),
        );

        const scope = yield* Scope.make();
        yield* Component.mount(App, container, { props: { greeting: "Hello" } }).pipe(
          Scope.provide(scope),
        );
        expect(container.textContent).toBe("Hello ATLAS");
        expect(events).toEqual([]);

        yield* Scope.close(scope, Exit.void);
        expect(container.textContent).toBe("");
        // The mount owned its runtime, so runtime disposal closed the setup Scope.
        expect(events).toEqual(["setup finalized"]);
      }),
    ));

  it("runs setup once per runtime and render once per instance", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let setups = 0;
          let renders = 0;
          const Counter = Component.make("Counter", function* () {
            yield* Effect.sync(() => setups++);
            return () => {
              renders++;
              return `setups:${setups}`;
            };
          });
          const Twice = Component.make("Twice", function* () {
            const Inner = yield* Counter;
            return () => [Inner({}), Inner({})];
          });

          const shared = makeRuntime();
          yield* Effect.addFinalizer(() => shared.disposeEffect.pipe(Effect.orDie));
          const first = document.createElement("div");
          const second = document.createElement("div");
          yield* Component.mount(Twice, first, { runtime: shared });
          yield* Component.mount(Twice, second, { runtime: shared });
          expect(first.textContent).toBe("setups:1setups:1");
          expect(second.textContent).toBe("setups:1setups:1");
          expect(setups).toBe(1);
          expect(renders).toBe(4);

          const third = document.createElement("div");
          yield* Component.mount(Twice, third);
          expect(setups).toBe(2);
        }),
      ),
    ));

  it("suspends the nearest Loading boundary while a resource is pending", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          let loads = 0;
          const ProjectById = projectFamily();
          const Card = Component.make("Card", function* () {
            const project = yield* Component.resource(ProjectById);
            return (props: { readonly id: string }) => reactive(() => project(props.id));
          });
          const App = Component.make("App", function* () {
            const Loaded = yield* Card.pipe(
              Component.catchTags({ ProjectNotFound: () => "gone", Forbidden: () => "no" }),
              Component.loading(() => "loading"),
            );
            return () => Loaded({ id: "atlas" });
          }).pipe(
            Component.provide(
              projectApi((id) =>
                Effect.andThen(
                  Deferred.await(release),
                  Effect.sync(() => {
                    loads++;
                    return `Project ${id}`;
                  }),
                ),
              ),
            ),
          );

          const container = document.createElement("div");
          yield* Component.mount(App, container);
          yield* waitForText(container, "loading");

          yield* Deferred.succeed(release, undefined);
          yield* waitForText(container, "Project atlas");
          expect(loads).toBe(1);
        }),
      ),
    ));

  it("recovers typed resource failures by the ResourceFailure's inner tag", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = projectFamily();
          const Card = Component.make("Card", function* () {
            const project = yield* Component.resource(ProjectById);
            return (props: { readonly id: string }) => reactive(() => project(props.id));
          });
          const App = Component.make("App", function* () {
            const Safe = yield* Card.pipe(
              Component.catchTags({
                ProjectNotFound: (error) => `missing ${error.id}`,
                Forbidden: () => "no",
              }),
              Component.loading(() => "loading"),
            );
            return () => Safe({ id: "atlas" });
          }).pipe(Component.provide(projectApi((id) => Effect.fail(new ProjectNotFound({ id })))));

          const container = document.createElement("div");
          yield* Component.mount(App, container);
          yield* waitForText(container, "missing atlas");
        }),
      ),
    ));

  it("renders setup failures to boundaries and propagates unmatched tags outward", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Guarded = Component.make("Guarded", function* () {
            yield* Effect.fail<Forbidden | ProjectNotFound>(new Forbidden());
            return () => "secret";
          });
          const Page = Component.make("Page", function* () {
            // Handles only ProjectNotFound: Forbidden passes through this boundary.
            const Inner = yield* Guarded.pipe(
              Component.catchTags({ ProjectNotFound: () => "inner" }),
            );
            return () => ["page:", Inner({})];
          });
          const App = Page.pipe(Component.catchTags({ Forbidden: () => "outer forbidden" }));

          const container = document.createElement("div");
          yield* Component.mount(App, container);
          yield* waitForText(container, "outer forbidden");
        }),
      ),
    ));

  it("provides scoped Layers for the runtime lifetime and to resource loads", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: Array<string> = [];
        const ProjectById = projectFamily();
        const ScopedApi = Layer.effect(
          ProjectApi,
          Effect.acquireRelease(
            Effect.sync(() => {
              events.push("acquired");
              return { get: (id: string) => Effect.succeed(`Scoped ${id}`) };
            }),
            () => Effect.sync(() => events.push("released")),
          ),
        );
        const App = Component.make("App", function* () {
          const project = yield* Component.resource(ProjectById);
          return () => reactive(() => project("atlas"));
        }).pipe(
          Component.catchTags({ ProjectNotFound: () => "gone", Forbidden: () => "no" }),
          Component.loading(() => "loading"),
          Component.provide(ScopedApi),
        );

        const container = document.createElement("div");
        const scope = yield* Scope.make();
        yield* Component.mount(App, container).pipe(Scope.provide(scope));
        yield* waitForText(container, "Scoped atlas");
        expect(events).toEqual(["acquired"]);

        yield* Scope.close(scope, Exit.void);
        expect(events).toEqual(["acquired", "released"]);
        expect(container.textContent).toBe("");
      }),
    ));

  it("interrupts a pending setup when the mount is interrupted and reruns it later", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<string> = [];
          const gate = yield* Deferred.make<void>();
          let setups = 0;
          const Slow = Component.make("Slow", function* () {
            setups++;
            yield* Effect.addFinalizer(() => Effect.sync(() => events.push("finalized")));
            yield* Deferred.await(gate);
            return () => "ready";
          });
          const shared = makeRuntime();
          yield* Effect.addFinalizer(() => shared.disposeEffect.pipe(Effect.orDie));

          const container = document.createElement("div");
          const mounting = yield* Effect.forkChild(
            Effect.scoped(
              Effect.andThen(Component.mount(Slow, container, { runtime: shared }), Effect.never),
            ),
          );
          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(mounting);
          expect(events).toEqual(["finalized"]);
          expect(container.textContent).toBe("");

          yield* Deferred.succeed(gate, undefined);
          yield* Component.mount(Slow, container, { runtime: shared });
          expect(setups).toBe(2);
          expect(container.textContent).toBe("ready");
        }),
      ),
    ));

  it("embeds into an existing RuntimeProvider tree, suspending while setup runs", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect.pipe(Effect.orDie));
          const Slow = Component.make("Slow", function* () {
            yield* Deferred.await(gate);
            return (props: { readonly label: string }) => `embedded ${props.label}`;
          });
          const Embedded = Component.embed(Slow);

          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime,
                get children() {
                  return createComponent(Loading, {
                    fallback: "waiting",
                    get children() {
                      return createComponent(Embedded, { label: "atlas" });
                    },
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          yield* waitForText(container, "waiting");

          yield* Deferred.succeed(gate, undefined);
          yield* waitForText(container, "embedded atlas");
        }),
      ),
    ));

  it("treats a throwing load callback as a defect that no typed handler matches", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Broken = Resource.family({
            name: `SolidComponent.Broken.${familyId++}`,
            load: (_id: string): Effect.Effect<string, ProjectNotFound> => {
              throw new Error("callback bug");
            },
          });
          const Card = Component.make("Card", function* () {
            const project = yield* Component.resource(Broken);
            return () => reactive(() => project("atlas"));
          });
          const App = Component.make("App", function* () {
            // Only the typed load error needs a handler; the callback bug is not typed.
            const Safe = yield* Card.pipe(
              Component.catchTags({ ProjectNotFound: () => "gone" }),
              Component.loading(() => "loading"),
            );
            return () =>
              createComponent(Errored, {
                fallback: (error) => {
                  const thrown = error();
                  return thrown instanceof ResourceFailure &&
                    Option.isNone(AsyncResult.error(thrown.result)) &&
                    Cause.findDefect(thrown.result.cause) !== undefined
                    ? "defect"
                    : "typed";
                },
                get children() {
                  return Safe({});
                },
              });
          });

          const container = document.createElement("div");
          yield* Component.mount(App, container);
          yield* waitForText(container, "defect");
        }),
      ),
    ));

  it("launches until interrupted, then disposes the tree and its owned runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: Array<string> = [];
        const Greeting = Component.make("Greeting", function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => events.push("setup finalized")));
          return (props: { readonly name: string }) => `Hello ${props.name}`;
        });
        const container = document.createElement("div");

        const app = Effect.runFork(
          Component.launch(Greeting, container, { props: { name: "Arc" } }),
        );
        yield* waitForText(container, "Hello Arc");
        expect(events).toEqual([]);

        yield* Fiber.interrupt(app);
        expect(container.textContent).toBe("");
        expect(events).toEqual(["setup finalized"]);
      }),
    ));

  it("satisfies unprovided services from the host runtime", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectName = Resource.family({
            name: "test/Component/hostRuntime/ProjectName",
            load: (id: string) => ProjectApi.use((api) => api.get(id)),
          });
          const App = Component.make("HostServicesApp", function* () {
            const api = yield* ProjectApi;
            const prefix = yield* api.get("prefix");
            const name = yield* Component.resource(ProjectName);
            return (props: { readonly id: string }) => `${prefix}:${name(props.id)}`;
          }).pipe(Component.catchTags({ ProjectNotFound: () => "missing", Forbidden: () => "no" }));
          const runtime = makeRuntime(
            Layer.succeed(ProjectApi, { get: (id: string) => Effect.succeed(id.toUpperCase()) }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect.pipe(Effect.orDie));

          const container = document.createElement("div");
          yield* Component.mount(App, container, { runtime, props: { id: "atlas" } });
          yield* waitForText(container, "PREFIX:ATLAS");
        }),
      ),
    ));

  it("renders preloaded resources synchronously, without a Loading flash", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { App, ProjectById, events } = ssrApp();
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect.pipe(Effect.orDie));
          yield* runtime.provide(Resource.prefetchEffect(ProjectById("atlas")));

          const container = document.createElement("div");
          yield* Component.mount(App, container, { runtime, props: { id: "atlas" } });
          expect(container.textContent).toBe(ssrMarkup);
          expect(events).toMatchObject({ setups: 1, loads: 1, fallbacks: 0 });
        }),
      ),
    ));

  it("hydrates server markup from a Resource snapshot without re-running work", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { App, ProjectById, events } = ssrApp();
          // The server side: load in a request runtime and serialize its snapshot.
          const server = makeRuntime();
          yield* Effect.addFinalizer(() => server.disposeEffect.pipe(Effect.orDie));
          yield* server.provide(Resource.prefetchEffect(ProjectById("atlas")));
          const encoded = yield* server.provide(
            Effect.flatMap(
              Resource.hydrationPayloadEffect([ProjectById("atlas")]),
              Resource.encodeHydrationPayloadEffect,
            ),
          );
          expect(events.loads).toBe(1);

          // The client side: restore the snapshot, then hydrate the server markup.
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
            }),
          );
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect.pipe(Effect.orDie));
          yield* runtime.provide(
            Effect.flatMap(Resource.decodeHydrationPayloadEffect(encoded), Resource.hydrateEffect),
          );
          const container = document.createElement("div");
          container.innerHTML = ssrMarkup;
          const serverText = container.firstChild;

          yield* Component.mount(App, container, {
            runtime,
            props: { id: "atlas" },
            hydrate: true,
          });
          expect(container.textContent).toBe(ssrMarkup);
          expect(container.firstChild).toBe(serverText);
          // One client setup, no reload, no Loading flash.
          expect(events).toMatchObject({ setups: 1, loads: 1, fallbacks: 0 });
        }),
      ),
    ));

  it("keeps a reader binding through suspense and releases it once unobserved", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          const ProjectById = projectFamily();
          const [shown, setShown] = createSignal(true);
          const Card = Component.make("Card", function* () {
            const project = yield* Component.resource(ProjectById);
            return () => reactive(() => project("atlas"));
          });
          const App = Component.make("App", function* () {
            const Loaded = yield* Card.pipe(
              Component.catchTags({ ProjectNotFound: () => "gone", Forbidden: () => "no" }),
              Component.loading(() => "loading"),
            );
            return () =>
              createComponent(Show, {
                get when() {
                  return shown();
                },
                children: () => Loaded({}),
              });
          }).pipe(
            Component.provide(
              projectApi((id) => Effect.as(Deferred.await(release), `Project ${id}`)),
            ),
          );

          const container = document.createElement("div");
          const before = bindings.created;
          yield* Component.mount(App, container);
          yield* waitForText(container, "loading");
          expect(bindings.created).toBe(before + 1);

          // The suspended read dropped its claim when Solid aborted the run; it
          // re-acquires the same binding once the value settles.
          yield* Deferred.succeed(release, undefined);
          yield* waitForText(container, "Project atlas");
          expect(bindings.created).toBe(before + 1);

          // Unmounting the only reader releases the binding, so showing it again rebinds.
          setShown(false);
          yield* waitForText(container, "");
          yield* Effect.sleep("1 millis");
          setShown(true);
          yield* waitForText(container, "Project atlas");
          expect(bindings.created).toBe(before + 2);
        }),
      ),
    ));

  it("releases a partial mount and its owned runtime when render throws", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // An uncaught render error halts Solid's reactive system; restore it for later tests.
          yield* Effect.addFinalizer(() => Effect.sync(resetErrorHalt));
          const events: Array<string> = [];
          const Throws = Component.make("Throws", function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => events.push("setup finalized")));
            return (): string => {
              throw new Error("render bug");
            };
          });
          const container = document.createElement("div");

          // The caller's Scope stays open: the failed mount must not hold resources until it closes.
          const exit = yield* Effect.exit(Component.mount(Throws, container));
          expect(Exit.hasDies(exit)).toBe(true);
          expect(container.textContent).toBe("");
          expect(events).toEqual(["setup finalized"]);
        }),
      ),
    ));
});
