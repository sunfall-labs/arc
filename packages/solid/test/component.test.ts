import { makeRuntime, Resource } from "@sunfall/arc-core";
import { Context, Data, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { createComponent, Loading, render, type JSX } from "@solidjs/web";
import { describe, expect, it, vi } from "vitest";
import { Component, RuntimeProvider } from "../src/index.js";

class ProjectApi extends Context.Service<
  ProjectApi,
  { readonly get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden> }
>()("@sunfall/arc-solid/test/Component/ProjectApi") {}
class ProjectNotFound extends Data.TaggedError("ProjectNotFound")<{ readonly id: string }> {}
class Forbidden extends Data.TaggedError("Forbidden")<{}> {}

/** A reactive text child, as JSX compiles `{project(id)}`. */
const reactive = (read: () => string): JSX.Element => read as unknown as JSX.Element;

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
              Component.catchTags({
                ProjectNotFound: () => "gone",
                Forbidden: () => "no",
                EffectInputCallbackError: () => "callback",
              }),
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
                EffectInputCallbackError: () => "callback",
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
          Component.catchTags({
            ProjectNotFound: () => "gone",
            Forbidden: () => "no",
            EffectInputCallbackError: () => "callback",
          }),
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
});
