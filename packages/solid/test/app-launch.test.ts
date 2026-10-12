// `App.launch` (from @sunfall/arc-start) in Solid's browser build: it restores
// the server's hydration payload and hydrates the server-rendered root.
import {
  Action,
  ActionQueued,
  ActionTransport,
  makeRuntime,
  Resource,
  Route,
  ServerTransportError,
} from "@sunfall/arc-core";
import { App, StartRootMissing } from "@sunfall/arc-start";
import { createComponent } from "@solidjs/web";
import { Context, Effect, Exit, Fiber, Layer, Option, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it, vi } from "vitest";
import { Component, RouterProvider } from "../src/index.js";
import { createHydrationScript, createStartHydrationPayload } from "../../start/src/hydration.js";
import { ssrApp, ssrMarkup } from "./component-ssr-fixture.js";

describe("App.launch", () => {
  it("hydrates the server-rendered root from the document's payload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { App: Card, ProjectById, events } = ssrApp();
          const Root = Component.define("Root", function* (props: App.RootProps) {
            const Page = yield* Card;
            return () => createComponent(Page, { id: props.href.split("/").pop() ?? "" });
          });
          const app = App.define({ root: Root, routes: [] as const });

          // What the server sends: the rendered root plus Start's payload script.
          const server = makeRuntime();
          yield* Effect.addFinalizer(() => server.dispose.pipe(Effect.orDie));
          yield* server.provide(Resource.preload(ProjectById("atlas")));
          const resources = yield* server.provide(
            Resource.hydrationPayload([ProjectById("atlas")]),
          );
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          document.body.innerHTML = `<div id="root">${ssrMarkup}</div>${createHydrationScript(
            createStartHydrationPayload(resources),
          )}`;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              document.body.innerHTML = "";
            }),
          );
          const root = document.getElementById("root")!;
          const serverText = root.firstChild;
          expect(events.loads).toBe(1);

          const fiber = Effect.runFork(App.launch(app, { href: "/projects/atlas" }));
          yield* Effect.yieldNow;
          expect(root.textContent).toBe(ssrMarkup);
          expect(root.firstChild).toBe(serverText);
          // One client setup, no reload, no Loading flash.
          expect(events).toMatchObject({ setups: 1, loads: 1, fallbacks: 0 });

          yield* Fiber.interrupt(fiber);
          // Interrupting disposes the tree and the runtime (and its Layer).
          expect(events.released).toBe(1);
        }),
      ),
    ));

  it("re-applies a pending durable submission's Resource patch after hydration", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { App: Card, ProjectById, events } = ssrApp();
          const Rename = Action.define({
            name: `AppLaunch.durable-resource-patch.${ProjectById.family.options.name}`,
            input: Schema.Struct({ id: Schema.String }),
            durable: { maxAge: "1 hour" },
            optimistic: ({ id }, transaction) =>
              transaction.set(ProjectById(id), (name) => `${name} (renamed)`),
            run: ({ id }) => Effect.succeed(id),
          });
          const Root = Component.define("Root", function* (props: App.RootProps) {
            const Page = yield* Card;
            return () => createComponent(Page, { id: props.href.split("/").pop() ?? "" });
          });
          // The browser's storage, shared by the previous page and the reload.
          const storage = Context.get(
            yield* Layer.build(KeyValueStore.layerMemory),
            KeyValueStore.KeyValueStore,
          );
          const storageLayer = Layer.succeed(KeyValueStore.KeyValueStore)(storage);

          // The previous page queued the rename while offline.
          const previous = makeRuntime(
            Layer.mergeAll(
              Layer.succeed(ActionTransport)({
                submit: () =>
                  Option.some(
                    Effect.fail(
                      new ServerTransportError({ reason: "Network", message: "offline" }),
                    ),
                  ),
              }),
              Action.outboxLayer({ retry: Schedule.recurs(0) }).pipe(Layer.provide(storageLayer)),
            ),
          );
          const queued = yield* Effect.flip(
            Action.use(Rename, { runtime: previous }).submit({ id: "atlas" }),
          );
          expect(queued).toBeInstanceOf(ActionQueued);
          yield* previous.dispose;

          // The reload's document: the server never saw the rename.
          const server = makeRuntime();
          yield* Effect.addFinalizer(() => server.dispose.pipe(Effect.orDie));
          yield* server.provide(Resource.preload(ProjectById("atlas")));
          const resources = yield* server.provide(
            Resource.hydrationPayload([ProjectById("atlas")]),
          );
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          document.body.innerHTML = `<div id="root">${ssrMarkup}</div>${createHydrationScript(
            createStartHydrationPayload(resources),
          )}`;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              document.body.innerHTML = "";
            }),
          );
          const root = document.getElementById("root")!;

          const app = App.define({
            root: Root,
            routes: [] as const,
            actions: [Rename],
            client: storageLayer,
          });
          const fiber = Effect.runFork(
            App.launch(app, {
              href: "/projects/atlas",
              outbox: { retry: Schedule.recurs(0) },
              // Still offline: the replay fails retryably, so the patch stays.
              transport: { fetch: () => Effect.succeed(new Response("", { status: 503 })) },
            }),
          );
          // Restoring after hydration patches the hydrated entry. Restoring
          // first would find it unloaded and patch nothing.
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(root.textContent).toBe("Hello atlas: Project atlas (renamed)")),
          );
          expect(events).toMatchObject({ loads: 1, fallbacks: 0 });

          yield* Fiber.interrupt(fiber);
        }),
      ),
    ));

  it("loads a code-split route component before hydrating, so the first pass matches the server", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let imports = 0;
          const renders: Array<string> = [];
          const ProjectRoute = Route.define("/split-projects/:id");
          const ProjectPage = (props: Route.Props<typeof ProjectRoute>) => {
            renders.push(props.params.id);
            return `Project ${props.params.id}`;
          };
          const warnings: Array<string> = [];
          const warn = vi.spyOn(console, "warn").mockImplementation((...args: Array<unknown>) => {
            warnings.push(args.map(String).join(" "));
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => warn.mockRestore()));
          // What Start's code splitting makes of `Route.withComponent(ProjectRoute, ProjectPage)`.
          const LazyProjectPage = Route.lazyComponent(
            Effect.promise(
              () =>
                new Promise<{ readonly ProjectPage: typeof ProjectPage }>((resolve) => {
                  imports++;
                  setTimeout(() => resolve({ ProjectPage }), 5);
                }),
            ),
            "ProjectPage",
          );
          const routes = [Route.withComponent(ProjectRoute, LazyProjectPage)] as const;
          const Root = Component.define("Root", function* (props: App.RootProps) {
            const router = yield* Component.router(routes, { initialHref: props.href });
            return () => createComponent(RouterProvider, { router });
          });
          // The app lists the route without its component, as file routes do.
          const app = App.define({ root: Root, routes: [ProjectRoute] as const });

          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          document.body.innerHTML = `<div id="root">Project atlas</div>${createHydrationScript(
            createStartHydrationPayload({ resources: [] }),
          )}`;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              document.body.innerHTML = "";
            }),
          );
          const root = document.getElementById("root")!;
          const serverText = root.firstChild;

          const fiber = Effect.runFork(App.launch(app, { href: "/split-projects/atlas" }));
          yield* Effect.promise(() => vi.waitFor(() => expect(imports).toBe(1)));
          yield* Effect.sleep("20 millis");
          expect(root.textContent).toBe("Project atlas");
          expect(root.firstChild).toBe(serverText);
          expect(imports).toBe(1);
          // The page rendered once, in the hydration pass: no async read deferred
          // the mount, and no server node went unclaimed.
          expect(renders).toHaveLength(1);
          expect(warnings).toEqual([]);

          yield* Fiber.interrupt(fiber);
        }),
      ),
    ));

  it("fails with StartRootMissing when the document has no app root", () =>
    Effect.gen(function* () {
      const Root = Component.define("Root", function* () {
        yield* Effect.void;
        return () => "root";
      });
      const exit = yield* Effect.exit(
        App.launch(App.define({ root: Root, routes: [] as const }), { href: "/" }),
      );
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        _tag: "Some",
        value: expect.any(StartRootMissing),
      });
    }).pipe(Effect.runPromise));
});
