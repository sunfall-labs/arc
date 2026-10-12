// @vitest-environment happy-dom
import { Resource, createBrowserRouterHostController, makeRuntime, Route } from "@sunfall/arc-core";
import { eraseRuntime } from "@sunfall/arc-core/internal";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { createHydrationScriptSync } from "../src/hydration.js";
import {
  makeStartStaticHistoryAdapter,
  StartStaticNavigationHydrationError,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  type StartStaticHistoryWindow,
  withStartStaticBasePath,
} from "../src/index.js";

const asHistoryWindow = (window: Window): StartStaticHistoryWindow =>
  window as unknown as StartStaticHistoryWindow;

const parseHtmlDocument = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

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
    expect(
      stripStartStaticBasePath("/project-docs/docs/getting-started/?tab=install", "/project-docs/"),
    ).toBe("/docs/getting-started?tab=install");
    expect(stripStartStaticBasePath("/project-docs/", "/project-docs/")).toBe("/");
    expect(stripStartStaticBasePath("/docs/getting-started/", "/")).toBe("/docs/getting-started");
  });

  it("creates a base-path aware browser history adapter", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/projects/1" });
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: ["Start.Static.Project.initial-handoff"],
          });
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
              new Response("<!doctype html><html></html>"),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            hydratedHrefs: "/projects/1",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });

          yield* history.prepareHref!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(0);

          yield* history.prepareHref!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("hydrates target static documents before route preload runs", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.define({
            name: "Start.Static.Project.router-navigation",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.preload(ProjectById(params.id)),
          });
          const routes = [ProjectRoute] as const;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/" });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScriptSync({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  timestamp: 1,
                },
              },
            ],
          })}</body></html>`;
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(html),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });
          const router = createBrowserRouterHostController(routes, {
            history,
            initialHref: "/",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigate(ProjectRoute, { params: { id: "1" } });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/projects/1",
              }),
            ),
          );
          const project = yield* runtime.provide(Resource.preload(ref));

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(String(fetch.mock.calls[0]?.[0])).toBe("https://docs.test/app/projects/1");
          expect(window.location.pathname).toBe("/app/projects/1");
          expect(project).toEqual({ id: "1", name: "Hydrated project" });
        }),
      ),
    ));

  it("publishes the target match only after its static document hydrated", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.define({
            name: "Start.Static.Project.leave-not-found",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = Route.define("/projects/:id", {
            params: Schema.Struct({ id: Schema.Literals(["1"]) }),
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.preload(ProjectById(params.id)),
          });
          const routes = [ProjectRoute] as const;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/projects/unknown" });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScriptSync({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  timestamp: 1,
                },
              },
            ],
          })}</body></html>`;
          let respond: (response: Response) => void = () => undefined;
          const fetch = vi.fn(
            (_input: RequestInfo | URL, _init?: RequestInit) =>
              new Promise<Response>((resolve) => {
                respond = resolve;
              }),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });
          // Params the route schema rejects identify no page.
          const router = createBrowserRouterHostController(routes, {
            history,
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());
          expect(router.state.get()).toEqual({ _tag: "NotFound", href: "/projects/unknown" });

          // What UI rendered for the published match would read at that moment.
          const published: string[] = [];
          const unsubscribe = router.state.subscribe(() => {
            const state = router.state.get();
            if (state._tag === "Pending" || state._tag === "Ready") {
              const status = Effect.runSync(runtime.provide(Resource.status(ref)));
              published.push(`${state._tag}:${status.result._tag}`);
            }
          });
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

          router.navigate(ProjectRoute, { params: { id: "1" } });
          yield* Effect.promise(() => vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)));
          // While the host prepares the href, the router stays where it was.
          expect(router.state.get()).toEqual({ _tag: "NotFound", href: "/projects/unknown" });

          respond(new Response(html));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router.state.get()._tag).toBe("Ready")),
          );
          expect(published).toEqual(["Pending:Success", "Ready:Success"]);
        }),
      ),
    ));

  it("rebases static document hydration timestamps so repeated hover preloads stay cacheable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(120_000);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const ProjectById = Resource.define({
              name: "Start.Static.Project.fresh-static-preparation",
              load: (
                _id: string,
              ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
                Effect.fail(new Error("static host has no RPC loader")),
              policy: {
                staleFor: "1 minute",
              },
            });
            const ProjectRoute = Route.define("/projects/:id", {
              preloadResources: [ProjectById],
              preload: ({ params }) => Resource.preload(ProjectById(params.id)),
            });
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
            const window = new Window({ url: "https://docs.test/app/" });
            const ref = ProjectById("1");
            const html = `<!doctype html><html><body>${createHydrationScriptSync({
              resources: [
                {
                  name: ref.family.options.name,
                  key: ref.key,
                  input: "1",
                  state: {
                    _tag: "Success",
                    waiting: false,
                    value: { id: "1", name: "Hydrated project" },
                    timestamp: 0,
                  },
                },
              ],
            })}</body></html>`;
            const fetch = vi.fn(
              async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(html),
            );
            const history = makeStartStaticHistoryAdapter({
              runtime,
              routes: [ProjectRoute] as const,
              basePath: "/app/",
              getWindow: () => asHistoryWindow(window),
              fetch,
              parseDocument: parseHtmlDocument,
            });

            yield* history.prepareHref!("/projects/1");
            yield* history.prepareHref!("/projects/1");
            const status = yield* runtime.provide(Resource.status(ref));

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(status.result).toMatchObject({ _tag: "Success", timestamp: 120_000 });
            expect(status.isStale).toBe(false);
          }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces, caches, and survives interrupted target static document hydration per href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/" });
          const ProjectById = Resource.define({
            name: "Start.Static.Project.coalesced",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.preload(ProjectById(params.id)),
          });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScriptSync({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  timestamp: Date.now(),
                },
              },
            ],
          })}</body></html>`;
          const fetchStarted = yield* Deferred.make<void>();
          const releaseFetch = yield* Deferred.make<void>();
          const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
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
            parseDocument: parseHtmlDocument,
          });

          const first = Effect.runFork(history.prepareHref!("/projects/1"));
          yield* Deferred.await(fetchStarted);
          yield* Fiber.interrupt(first);
          const second = Effect.runPromise(history.prepareHref!("/projects/1"));
          yield* Effect.sleep("10 millis");

          expect(fetch).toHaveBeenCalledTimes(1);

          yield* Deferred.succeed(releaseFetch, undefined);
          yield* Effect.promise(() => second);
          yield* history.prepareHref!("/projects/1");

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
            const ProjectById = Resource.define({
              name: "Start.Static.Project.stale-resource",
              load: (
                _id: string,
              ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
                Effect.fail(new Error("static host has no RPC loader")),
              policy: {
                staleFor: 10,
              },
            });
            const ProjectRoute = Route.define("/projects/:id", {
              preloadResources: [ProjectById],
              preload: ({ params }) => Resource.preload(ProjectById(params.id)),
            });
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
            const window = new Window({ url: "https://docs.test/app/" });
            const ref = ProjectById("1");
            const html = (): string =>
              `<!doctype html><html><body>${createHydrationScriptSync({
                resources: [
                  {
                    name: ref.family.options.name,
                    key: ref.key,
                    input: "1",
                    state: {
                      _tag: "Success",
                      waiting: false,
                      value: { id: "1", name: "Hydrated project" },
                      timestamp: Date.now(),
                    },
                  },
                ],
              })}</body></html>`;
            const fetch = vi.fn(
              async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(html()),
            );
            const history = makeStartStaticHistoryAdapter({
              runtime,
              routes: [ProjectRoute] as const,
              basePath: "/app/",
              getWindow: () => asHistoryWindow(window),
              fetch,
              parseDocument: parseHtmlDocument,
            });

            yield* history.prepareHref!("/projects/1");
            yield* history.prepareHref!("/projects/1");
            expect(fetch).toHaveBeenCalledTimes(1);

            yield* Effect.promise(() => vi.advanceTimersByTimeAsync(11));
            yield* history.prepareHref!("/projects/1");
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
          const ProjectById = Resource.define({
            name: "Start.Static.Project.deleted-resource",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static host has no RPC loader")),
          });
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: [ProjectById],
            preload: ({ params }) => Resource.preload(ProjectById(params.id)),
          });
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/" });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScriptSync({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  timestamp: 1,
                },
              },
            ],
          })}</body></html>`;
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(html),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });

          yield* history.prepareHref!("/projects/1");
          yield* history.prepareHref!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);

          yield* runtime.provide(Resource.evict(ref));
          yield* Effect.promise(() =>
            vi.waitFor(async () => {
              await Effect.runPromise(history.prepareHref!("/projects/1"));
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: ["Start.Static.Project.environment"],
          });
          const window = new Window({ url: "https://docs.test/app/" });
          let windowLike: StartStaticHistoryWindow | undefined;
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
              new Response("<!doctype html><html></html>"),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => windowLike,
            fetch,
            parseDocument: parseHtmlDocument,
          });

          yield* history.prepareHref!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(0);

          windowLike = asHistoryWindow(window);
          yield* history.prepareHref!("/projects/1");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("hydrates preload-declared routes and skips routes without preload work", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/" });
          const PlainRoute = Route.define("/plain");
          const DeclaredRoute = Route.define("/declared", {
            preloadResources: ["Start.Static.Resource.projects"],
          });
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
              new Response("<!doctype html><html></html>"),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [PlainRoute, DeclaredRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });

          yield* history.prepareHref!("/plain");
          expect(fetch).toHaveBeenCalledTimes(0);

          yield* history.prepareHref!("/declared");
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("fails with a typed hydration error when the target document request is not ok", async () => {
    const runtime = makeRuntime();
    try {
      const ProjectRoute = Route.define("/projects/:id", {
        preloadResources: ["Start.Static.Project.http-status"],
      });
      const window = new Window({ url: "https://docs.test/app/" });
      const history = makeStartStaticHistoryAdapter({
        runtime,
        routes: [ProjectRoute] as const,
        basePath: "/app/",
        getWindow: () => asHistoryWindow(window),
        fetch: vi.fn(async () => new Response("unavailable", { status: 503 })),
        parseDocument: parseHtmlDocument,
      });

      const exit = await Effect.runPromiseExit(history.prepareHref!("/projects/1"));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(StartStaticNavigationHydrationError);
        expect(error).toMatchObject({
          href: "/projects/1",
          browserHref: "/app/projects/1",
          reason: "HttpStatus",
          status: 503,
        });
      }
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("settles as not found when the host answers a missing page with its 404 page", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const ProjectRoute = Route.define("/projects/:id", {
            preloadResources: ["Start.Static.Project.not-prerendered"],
          });
          const window = new Window({ url: "https://docs.test/app/" });
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
              new Response("<!doctype html><html><main>Page not found</main></html>", {
                status: 404,
              }),
          );
          const history = makeStartStaticHistoryAdapter({
            runtime,
            routes: [ProjectRoute] as const,
            basePath: "/app/",
            getWindow: () => asHistoryWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });

          // The router settles as not found instead of running route preload.
          expect(yield* history.prepareHref!("/projects/missing")).toEqual({ _tag: "NotFound" });
          expect(yield* history.prepareHref!("/projects/missing")).toEqual({ _tag: "NotFound" });
          expect(fetch).toHaveBeenCalledTimes(1);
        }),
      ),
    ));
});
