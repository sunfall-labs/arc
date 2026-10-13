// `App.launch` (from @sunfall/arc-start) in Solid's browser build: it restores
// the server's hydration payload and hydrates the server-rendered root.
import {
  Action,
  ActionQueued,
  ActionTransport,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  ActionTransportError,
} from "@sunfall/arc-core";
import { App, StartRootMissing } from "@sunfall/arc-start";
import { createComponent } from "@solidjs/web";
import { Context, Effect, Exit, Fiber, Layer, Option, Schedule, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it, vi } from "vitest";
import { Component, RouterProvider } from "../src/index.js";
import {
  createHydrationScriptSync,
  createStartHydrationPayload,
} from "../../start/src/hydration.js";
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
          document.body.innerHTML = `<div id="root">${ssrMarkup}</div>${createHydrationScriptSync(
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
                      new ActionTransportError({ reason: "Network", message: "offline" }),
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
          document.body.innerHTML = `<div id="root">${ssrMarkup}</div>${createHydrationScriptSync(
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
            client: Layer.mergeAll(
              storageLayer,
              // Still offline: the replay fails retryably, so the patch stays.
              Layer.succeed(HttpClient.HttpClient)(
                HttpClient.make((request) =>
                  Effect.succeed(
                    HttpClientResponse.fromWeb(request, new Response("", { status: 503 })),
                  ),
                ),
              ),
            ),
          });
          const fiber = Effect.runFork(
            App.launch(app, {
              href: "/projects/atlas",
              outbox: { retry: Schedule.recurs(0) },
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
          document.body.innerHTML = `<div id="root">Project atlas</div>${createHydrationScriptSync(
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

  it("keeps document.title and the head's meta tags in step with client navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectName = Resource.define({
            name: "AppLaunch.head.projectName",
            input: Schema.String,
            output: Schema.String,
            load: (id) => Effect.succeed(id === "atlas" ? "Atlas" : "Curie"),
          });
          const ProjectRoute = Route.define("/head-projects/:id", {
            params: Schema.Struct({ id: Schema.String }),
            preload: ({ params }) => Resource.preload(ProjectName(params.id)),
            head: ({ params, read }) => ({
              title: read(ProjectName(params.id)),
              description: `Project ${params.id}`,
            }),
          });
          const routes = [ProjectRoute] as const;
          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/head-projects/atlas" });
          const Root = Component.define("Root", function* (props: App.RootProps) {
            yield* Component.router(routes, { initialHref: props.href, history });
            return () => "app";
          });
          const app = App.define({
            root: Root,
            routes,
            head: (page) => ({
              ...page,
              title: page.title === undefined ? "Projects" : `${page.title} · Projects`,
            }),
          });

          // What the server sends for /head-projects/atlas.
          const server = makeRuntime();
          yield* Effect.addFinalizer(() => server.dispose.pipe(Effect.orDie));
          yield* server.provide(Resource.preload(ProjectName("atlas")));
          const resources = yield* server.provide(
            Resource.hydrationPayload([ProjectName("atlas")]),
          );
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          document.head.innerHTML =
            '<meta name="description" content="Project atlas" data-arc-head="" /><title>Atlas · Projects</title>';
          document.body.innerHTML = `<div id="root">app</div>${createHydrationScriptSync(
            createStartHydrationPayload(resources),
          )}`;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              document.head.innerHTML = "";
              document.body.innerHTML = "";
            }),
          );
          const description = () =>
            Array.from(document.head.querySelectorAll("meta[data-arc-head]")).map((meta) =>
              meta.getAttribute("content"),
            );

          const fiber = Effect.runFork(App.launch(app, { href: "/head-projects/atlas" }));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(document.getElementById("root")?.textContent).toBe("app")),
          );
          expect(document.title).toBe("Atlas · Projects");
          expect(description()).toEqual(["Project atlas"]);

          history.externalNavigate("/head-projects/curie");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(document.title).toBe("Curie · Projects")),
          );
          expect(description()).toEqual(["Project curie"]);

          yield* Fiber.interrupt(fiber);
        }),
      ),
    ));

  it("fails with StartRootMissing when the document has no app root, and logs it", () =>
    Effect.gen(function* () {
      const logged: Array<string> = [];
      const spies = (["log", "error", "warn"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: Array<unknown>) => {
          logged.push(args.map(String).join(" "));
        }),
      );
      const Root = Component.define("Root", function* () {
        yield* Effect.void;
        return () => "root";
      });
      const exit = yield* Effect.exit(
        App.launch(App.define({ root: Root, routes: [] as const }), { href: "/" }),
      );
      spies.forEach((spy) => spy.mockRestore());
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        _tag: "Some",
        value: expect.any(StartRootMissing),
      });
      // `Effect.runFork(App.launch(app))` observes nothing, so the failure is logged.
      expect(logged.join("\n")).toContain("App.launch failed");
    }).pipe(Effect.runPromise));
});
