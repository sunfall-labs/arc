import {
  Action,
  makeRuntime,
  Resource,
  ResourceFailure,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import { type ResourceUiInput } from "@sunfall/arc-core/internal";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Scope,
} from "effect";
import { AsyncResult } from "effect/reactivity";
import { createComponent, Errored, Loading, render, Show } from "@solidjs/web";
import { createSignal, resetErrorHalt, type Accessor } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Component } from "../src/index.js";
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

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden>;
}
const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-solid/test/Component/ProjectApi");
class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: Schema.String,
}) {}
class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

const waitForText = (container: Element, text: string) =>
  Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe(text)));

const projectApi = (get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden>) =>
  Layer.succeed(ProjectApi, { get });

let familyId = 0;
const projectFamily = () =>
  Resource.define({
    name: `SolidComponent.ProjectById.${familyId++}`,
    error: Schema.Union([ProjectNotFound, Forbidden]),
    load: (id: string) => ProjectApi.use((api) => api.get(id)),
  });

describe("Component", () => {
  it("mounts a provided component and disposes it with the mount Scope", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const container = document.createElement("div");
        const events: Array<string> = [];
        const Greeting = Component.define(
          "Greeting",
          function* (props: { readonly greeting: string }) {
            const api = yield* ProjectApi;
            yield* Effect.addFinalizer(() => Effect.sync(() => events.push("setup finalized")));
            const name = yield* api.get("atlas").pipe(Effect.orDie);
            return () => `${props.greeting} ${name}`;
          },
        );
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
        // Disposing the tree closed the instance Scope.
        expect(events).toEqual(["setup finalized"]);
      }),
    ));

  it("runs setup and render once per instance, with that instance's props", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let setups = 0;
          let renders = 0;
          const finalized: Array<string> = [];
          const Counter = Component.define(
            "Counter",
            function* (props: { readonly label: string }) {
              const setup = ++setups;
              yield* Effect.addFinalizer(() => Effect.sync(() => finalized.push(props.label)));
              return () => {
                renders++;
                return `${props.label}:${setup};`;
              };
            },
          );
          const [showSecond, setShowSecond] = createSignal(true);
          const Twice = Component.define("Twice", function* () {
            const Inner = yield* Counter;
            return () => [
              Inner({ label: "a" }),
              createComponent(Show, {
                get when() {
                  return showSecond();
                },
                children: () => Inner({ label: "b" }),
              }),
            ];
          });

          const container = document.createElement("div");
          yield* Component.mount(Twice, container);
          expect(container.textContent).toBe("a:1;b:2;");
          expect(setups).toBe(2);
          expect(renders).toBe(2);

          // Disposing one instance closes only its Scope.
          setShowSecond(false);
          yield* waitForText(container, "a:1;");
          expect(finalized).toEqual(["b"]);
          setShowSecond(true);
          yield* waitForText(container, "a:1;b:3;");
        }),
      ),
    ));

  it("keeps an instance (one setup, one reader binding) while its first read suspends", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          let setups = 0;
          const ProjectById = projectFamily();
          const Card = Component.define("Card", function* (props: { readonly id: string }) {
            setups++;
            const project = yield* Component.resource(ProjectById);
            return () => project(props.id);
          });
          const [selected] = createSignal<string | undefined>("atlas");
          // `<Show>` with function children around a `<Loading>`: once the
          // first read settles, only the instance's render retries.
          const Page = Component.define("Page", function* () {
            const Inner = yield* Card.pipe(Component.catchAll(() => "failed"));
            return () =>
              createComponent(Show, {
                get when() {
                  return selected();
                },
                children: (id: Accessor<unknown>) =>
                  createComponent(Loading, {
                    fallback: "loading",
                    get children() {
                      return Inner({ id: String(id()) });
                    },
                  }),
              });
          });
          const App = Page.pipe(
            Component.provide(
              projectApi((id) => Deferred.await(release).pipe(Effect.as(id.toUpperCase()))),
            ),
          );
          const createdBefore = bindings.created;

          const container = document.createElement("div");
          yield* Component.mount(App, container);
          yield* waitForText(container, "loading");
          expect(setups).toBe(1);

          yield* Deferred.succeed(release, undefined);
          yield* waitForText(container, "ATLAS");
          expect(setups).toBe(1);
          expect(bindings.created - createdBefore).toBe(1);
        }),
      ),
    ));

  it("reads rows by key and index, following optimistic row patches", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Row = Schema.Struct({ id: Schema.String, status: Schema.String });
          const Rows = Resource.define({
            name: `Component.rows.${++familyId}`,
            input: Schema.Literal("all"),
            output: Schema.Array(Row),
            rows: { key: (row) => row.id, indexes: { status: (row) => row.status } },
            load: () =>
              Effect.succeed([
                { id: "a", status: "open" },
                { id: "b", status: "done" },
              ]),
          });
          const Close = Action.define({
            name: `Component.rows.close.${familyId}`,
            optimistic: (id: string, transaction) =>
              transaction.update(Rows("all"), id, { status: "done" }),
            run: () => Effect.never,
          });
          const List = Component.define("RowsList", function* () {
            const rows = yield* Component.resource(Rows);
            return () => [
              (() =>
                rows
                  .index("all", "status", "open")
                  .map((row) => row.id)
                  .join()) as never,
              (() => `|${rows.get("all", "b")?.status}`) as never,
              // Lookups return the rows `rows(input)` renders, not copies.
              (() =>
                rows.get("all", "a") === rows("all")[0] &&
                rows.index("all", "status", "done").every((row) => rows("all").includes(row))
                  ? ""
                  : "|mismatch") as never,
            ];
          });
          const runtime = makeRuntime();
          const container = document.createElement("div");
          yield* Component.mount(List, container, { runtime });
          yield* waitForText(container, "a|done");

          runtime.runFork(Action.use(Close, { runtime }).submit("a"));
          yield* waitForText(container, "|done");
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
          const Card = Component.define("Card", function* (props: { readonly id: string }) {
            const project = yield* Component.resource(ProjectById);
            return () => reactive(() => project(props.id));
          });
          const App = Component.define("App", function* () {
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
          const Card = Component.define("Card", function* (props: { readonly id: string }) {
            const project = yield* Component.resource(ProjectById);
            return () => reactive(() => project(props.id));
          });
          const App = Component.define("App", function* () {
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
          const Guarded = Component.define("Guarded", function* () {
            yield* Effect.fail<Forbidden | ProjectNotFound>(new Forbidden());
            return () => "secret";
          });
          const Page = Component.define("Page", function* () {
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
        const App = Component.define("App", function* () {
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

  it("interrupts a pending setup when the mount is interrupted and reruns it on remount", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<string> = [];
          const gate = yield* Deferred.make<void>();
          let setups = 0;
          const Slow = Component.define("Slow", function* () {
            setups++;
            yield* Effect.addFinalizer(() => Effect.sync(() => events.push("finalized")));
            yield* Deferred.await(gate);
            return () => "ready";
          });
          const shared = makeRuntime();
          yield* Effect.addFinalizer(() => shared.dispose.pipe(Effect.orDie));

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

  it("embeds into a Solid tree on a runtime, suspending while setup runs", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          const Slow = Component.define("Slow", function* (props: { readonly label: string }) {
            yield* Deferred.await(gate);
            return () => `embedded ${props.label}`;
          });
          const Embedded = Component.embed(Slow, runtime);

          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(Loading, {
                fallback: "waiting",
                get children() {
                  return createComponent(Embedded, { label: "atlas" });
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
          const Broken = Resource.define({
            name: `SolidComponent.Broken.${familyId++}`,
            error: ProjectNotFound,
            load: (_id: string): Effect.Effect<string, ProjectNotFound> => {
              throw new Error("callback bug");
            },
          });
          const Card = Component.define("Card", function* () {
            const project = yield* Component.resource(Broken);
            return () => reactive(() => project("atlas"));
          });
          const App = Component.define("App", function* () {
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
        const Greeting = Component.define("Greeting", function* (props: { readonly name: string }) {
          yield* Effect.addFinalizer(() => Effect.sync(() => events.push("setup finalized")));
          return () => `Hello ${props.name}`;
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
          const ProjectName = Resource.define({
            name: "test/Component/hostRuntime/ProjectName",
            error: Schema.Union([ProjectNotFound, Forbidden]),
            load: (id: string) => ProjectApi.use((api) => api.get(id)),
          });
          const App = Component.define(
            "HostServicesApp",
            function* (props: { readonly id: string }) {
              const api = yield* ProjectApi;
              const prefix = yield* api.get("prefix");
              const name = yield* Component.resource(ProjectName);
              return () => `${prefix}:${name(props.id)}`;
            },
          ).pipe(Component.catchTags({ ProjectNotFound: () => "missing", Forbidden: () => "no" }));
          const runtime = makeRuntime(
            Layer.succeed(ProjectApi, { get: (id: string) => Effect.succeed(id.toUpperCase()) }),
          );
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));

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
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          yield* runtime.provide(Resource.preload(ProjectById("atlas")));

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
          yield* Effect.addFinalizer(() => server.dispose.pipe(Effect.orDie));
          yield* server.provide(Resource.preload(ProjectById("atlas")));
          const encoded = yield* server.provide(
            Effect.flatMap(
              Resource.hydrationPayload([ProjectById("atlas")]),
              Resource.encodeHydrationPayload,
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
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          yield* runtime.provide(
            Effect.flatMap(Resource.decodeHydrationPayload(encoded), Resource.hydrate),
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
          const Card = Component.define("Card", function* () {
            const project = yield* Component.resource(ProjectById);
            return () =>
              createComponent(Show, {
                get when() {
                  return shown();
                },
                children: () => reactive(() => project("atlas")),
              });
          });
          const App = Component.define("App", function* () {
            const Loaded = yield* Card.pipe(
              Component.catchTags({ ProjectNotFound: () => "gone", Forbidden: () => "no" }),
              Component.loading(() => "loading"),
            );
            return () => Loaded({});
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
          const Throws = Component.define("Throws", function* () {
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
