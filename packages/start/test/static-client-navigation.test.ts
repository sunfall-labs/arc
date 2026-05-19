import { Resource, createBrowserRouterHostController, makeRuntime, route } from "@sunfall/arc-core";
import { Deferred, Effect, Fiber } from "effect";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import {
  createHydrationScript,
  makeStartStaticHistoryAdapter,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  type StartStaticHistoryWindow,
  withStartStaticBasePath,
} from "../src/index.js";

const asHistoryWindow = (window: Window): StartStaticHistoryWindow =>
  window as unknown as StartStaticHistoryWindow;

const parseWithWindow =
  (window: Window) =>
  (html: string): Document =>
    new window.DOMParser().parseFromString(html, "text/html");

describe("Start static client navigation", () => {
  it("normalizes static base paths and maps router hrefs", () => {
    expect(normalizeStartStaticBasePath("project-docs")).toBe("/project-docs/");
    expect(normalizeStartStaticBasePath("/project-docs")).toBe("/project-docs/");
    expect(withStartStaticBasePath("/", "/project-docs/")).toBe("/project-docs/");
    expect(withStartStaticBasePath("/docs/getting-started", "/project-docs/")).toBe(
      "/project-docs/docs/getting-started",
    );
    expect(
      stripStartStaticBasePath("/project-docs/docs/getting-started?tab=install", "/project-docs/"),
    ).toBe("/docs/getting-started?tab=install");
  });

  it("creates a base-path aware browser history adapter", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({
            url: "https://docs.test/project-docs/docs/getting-started?tab=install",
          });
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [],
            basePath: "/project-docs/",
            getWindow: () => asHistoryWindow(window),
          });

          expect(history.currentHref()).toBe("/docs/getting-started?tab=install");
          expect(history.createHref?.("/cookbook")).toBe("/project-docs/cookbook");
          expect(history.commit("/cookbook", { replace: true })).toBe("/cookbook");
          expect(window.location.pathname).toBe("/project-docs/cookbook");
        }),
      ),
    ));

  it("consumes exact already-hydrated hrefs once before fetching static documents", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/projects/1" });
          const ProjectRoute = route("/projects/:id", {
            preloadResources: ["Start.Static.Project.initial-handoff"],
          });
          const fetch = vi.fn(async () => new Response("<!doctype html><html></html>"));
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            hydratedHrefs: "/projects/1",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });

          yield* history.prepareHrefEffect!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(0);

          yield* history.prepareHrefEffect!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("hydrates target static documents before route preload runs", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.family({
            name: "Start.Static.Project.router-navigation",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = route("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
          });
          const routes = [ProjectRoute] as const;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/" });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScript({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  updatedAt: 1,
                },
              },
            ],
          })}</body></html>`;
          const fetch = vi.fn(async () => new Response(html));
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });
          const router = createBrowserRouterHostController(routes, {
            history,
            initialHref: "/",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigate(ProjectRoute, { params: { id: "1" } });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/projects/1",
              }),
            ),
          );
          const project = yield* runtime.provide(Resource.prefetchEffect(ref));

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(String(fetch.mock.calls[0]?.[0])).toBe("https://docs.test/app/projects/1");
          expect(window.location.pathname).toBe("/app/projects/1");
          expect(project).toEqual({ id: "1", name: "Hydrated project" });
        }),
      ),
    ));

  it("coalesces, caches, and survives interrupted target static document hydration per href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/" });
          const ProjectById = Resource.family({
            name: "Start.Static.Project.coalesced",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = route("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
          });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScript({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  updatedAt: Date.now(),
                },
              },
            ],
          })}</body></html>`;
          const fetchStarted = yield* Deferred.make<void>();
          const releaseFetch = yield* Deferred.make<void>();
          const fetch = vi.fn(async () => {
            Effect.runSync(Deferred.succeed(fetchStarted, undefined));
            await Effect.runPromise(Deferred.await(releaseFetch));
            return new Response(html);
          });
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });

          const first = Effect.runFork(history.prepareHrefEffect!("/projects/1"));
          yield* Deferred.await(fetchStarted);
          yield* Fiber.interrupt(first);
          const second = Effect.runPromise(history.prepareHrefEffect!("/projects/1"));
          yield* Effect.sleep("10 millis");

          expect(fetch).toHaveBeenCalledTimes(1);

          yield* Deferred.succeed(releaseFetch, undefined);
          yield* Effect.promise(() => second);
          yield* history.prepareHrefEffect!("/projects/1");

          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("revalidates prepared static hrefs after hydrated resources become stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const ProjectById = Resource.family({
              name: "Start.Static.Project.stale-resource",
              load: (
                _id: string,
              ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
                Effect.fail(new Error("static host has no RPC loader")),
              policy: {
                staleFor: 10,
              },
            });
            const ProjectRoute = route("/projects/:id", {
              preloadResources: [ProjectById],
              preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
            });
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => runtime.disposeEffect);
            const window = new Window({ url: "https://docs.test/app/" });
            const ref = ProjectById("1");
            const html = (): string =>
              `<!doctype html><html><body>${createHydrationScript({
                resources: [
                  {
                    name: ref.family.options.name,
                    key: ref.key,
                    input: "1",
                    state: {
                      _tag: "Success",
                      waiting: false,
                      value: { id: "1", name: "Hydrated project" },
                      updatedAt: Date.now(),
                    },
                  },
                ],
              })}</body></html>`;
            const fetch = vi.fn(async () => new Response(html()));
            const history = makeStartStaticHistoryAdapter({
              runtime,
              routes: [ProjectRoute] as const,
              basePath: "/app/",
              getWindow: () => asHistoryWindow(window),
              fetch,
              parseDocument: parseWithWindow(window),
            });

            yield* history.prepareHrefEffect!("/projects/1");
            yield* history.prepareHrefEffect!("/projects/1");
            expect(fetch).toHaveBeenCalledTimes(1);

            yield* Effect.promise(() => vi.advanceTimersByTimeAsync(11));
            yield* history.prepareHrefEffect!("/projects/1");
            expect(fetch).toHaveBeenCalledTimes(2);
          }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("revalidates prepared static hrefs after hydrated resources are deleted", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.family({
            name: "Start.Static.Project.deleted-resource",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = route("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
          });
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/" });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScript({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  updatedAt: 1,
                },
              },
            ],
          })}</body></html>`;
          const fetch = vi.fn(async () => new Response(html));
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });

          yield* history.prepareHrefEffect!("/projects/1");
          yield* history.prepareHrefEffect!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);

          yield* runtime.provide(Resource.deleteEffect(ref));
          yield* Effect.promise(() =>
            vi.waitFor(async () => {
              await Effect.runPromise(history.prepareHrefEffect!("/projects/1"));
              expect(fetch).toHaveBeenCalledTimes(2);
            }),
          );
        }),
      ),
    ));

  it("does not cache environment-unavailable static document preparation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const ProjectRoute = route("/projects/:id", {
            preloadResources: ["Start.Static.Project.environment"],
          });
          const window = new Window({ url: "https://docs.test/app/" });
          let windowLike: StartStaticHistoryWindow | undefined;
          const fetch = vi.fn(async () => new Response("<!doctype html><html></html>"));
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => windowLike,
            fetch,
            parseDocument: parseWithWindow(window),
          });

          yield* history.prepareHrefEffect!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(0);

          windowLike = asHistoryWindow(window);
          yield* history.prepareHrefEffect!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("hydrates collection-declared routes and skips routes without preload work", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/" });
          const PlainRoute = route("/plain");
          const CollectionRoute = route("/collections", {
            preloadCollections: ["Start.Static.Collection.projects"],
          });
          const fetch = vi.fn(async () => new Response("<!doctype html><html></html>"));
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [PlainRoute, CollectionRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });

          yield* history.prepareHrefEffect!("/plain");
          expect(fetch).toHaveBeenCalledTimes(0);

          yield* history.prepareHrefEffect!("/collections");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));
});
