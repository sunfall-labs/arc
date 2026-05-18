// @vitest-environment happy-dom

import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  onDispose,
  Resource,
  route,
  Route,
  RouteNavigationError,
  RoutePreloadError,
  runWithRuntime,
} from "@sunfall/arc-core";
import type { JSX } from "solid-js";
import type { BrowserRouter, BrowserRouterState } from "../src/index.js";

vi.doMock("solid-js", () => import("solid-js/dist/solid.js"));
vi.doMock("solid-js/web", () => import("solid-js/web/dist/web.js"));

const { ErrorBoundary, Show, Suspense, createRoot, createSignal, onCleanup, sharedConfig } =
  await import("solid-js");
const { createComponent, render } = await import("solid-js/web");
const {
  createBrowserRouter,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RouterRouteNotRegistered,
  RuntimeProvider,
  useRouter,
} = await import("../src/index.js");
const { makeSolidRouteRenderScopeController } = await import("../src/route-render-scope.js");

describe("createBrowserRouter", () => {
  interface ProjectApi {
    readonly preload: (id: string) => Effect.Effect<void>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-solid/test/ProjectApi");

  it("runs route preload once per href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let preloads = 0;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/atlas",
            });
            expect(preloads).toBe(1);
          });

          yield* Effect.sync(() => {
            router.navigateHref("/projects/kepler");
          });
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/kepler",
            });
            expect(preloads).toBe(2);
          });
        }),
      ),
    ));

  it("disposes non-browser programmatic route preloads with the Solid owner", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
          Reflect.deleteProperty(globalThis, "window");
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (windowDescriptor === undefined) {
                Reflect.deleteProperty(globalThis, "window");
              } else {
                Object.defineProperty(globalThis, "window", windowDescriptor);
              }
            }),
          );

          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const started = yield* Deferred.make<void>();
          let releases = 0;
          const SlowRoute = route("/owner-cleanup-slow", {
            preload: () =>
              Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
                Effect.sync(() => {
                  releases++;
                }),
              ).pipe(Effect.andThen(Effect.never)),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof SlowRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([SlowRoute] as const, {
              history: makeMemoryBrowserHistoryAdapter({ initialHref: "/missing" }),
              initialHref: "/missing",
              runtime,
            });
          });

          router.navigateHref("/owner-cleanup-slow");
          yield* Deferred.await(started);
          yield* Effect.sync(dispose);
          yield* Effect.sleep("20 millis");

          expect(releases).toBe(1);
        }),
      ),
    ));

  it("keeps route preload failures typed in browser router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: () => Effect.fail("missing-project"),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            const state = router.state();
            expect(state._tag).toBe("Failure");
            const failure = state as Extract<
              BrowserRouterState<readonly [typeof ProjectRoute]>,
              { readonly _tag: "Failure" }
            >;
            expect(failure.error).toBeInstanceOf(RoutePreloadError);
            expect(failure.error).toMatchObject({
              path: "/projects/:id",
              href: "/projects/atlas",
              cause: "missing-project",
            });
            expect(failure.cause.reasons.find(Cause.isFailReason)?.error).toBe(failure.error);
          });
        }),
      ),
    ));

  it("keeps route match schema failures typed in browser router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/schema-projects/:id", {
            params: Schema.Struct({ id: Schema.Number }),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/schema-projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state();
              expect(state._tag).toBe("Failure");
              const failure = state as Extract<
                BrowserRouterState<readonly [typeof ProjectRoute]>,
                { readonly _tag: "Failure" }
              >;
              expect(failure.match).toBeUndefined();
              expect(failure.error).toBeInstanceOf(RouteNavigationError);
              expect(failure.error).toMatchObject({
                input: "/schema-projects/atlas",
              });
              expect(failure.cause.reasons.find(Cause.isFailReason)?.error).toBe(failure.error);
            }),
          );

          expect(() => router.navigateHref("/schema-projects/kepler")).not.toThrow();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state();
              expect(state._tag).toBe("Failure");
              const failure = state as Extract<
                BrowserRouterState<readonly [typeof ProjectRoute]>,
                { readonly _tag: "Failure" }
              >;
              expect(failure.error).toBeInstanceOf(RouteNavigationError);
              expect(failure.error).toMatchObject({
                input: "/schema-projects/kepler",
              });
            }),
          );
        }),
      ),
    ));

  it("matches static routes before dynamic routes when provider order is reversed", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/ordered-projects/:id", {});
          const ProjectSettingsRoute = route("/ordered-projects/settings", {});
          const routes = [ProjectRoute, ProjectSettingsRoute] as const;

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/ordered-projects/settings",
              runtime,
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state();
              expect(state._tag).toBe("Ready");
              if (state._tag === "Ready") {
                expect(state.match.route).toBe(ProjectSettingsRoute);
                expect(state.match.params).toEqual({});
              }
            }),
          );
        }),
      ),
    ));

  it("preloads shadowed hrefs with the same route match as navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(`project:${params.id}`);
              }),
          });
          const ProjectSettingsRoute = route("/projects/settings", {
            preload: () =>
              Effect.sync(() => {
                preloaded.push("settings");
              }),
          });
          const routes = [ProjectRoute, ProjectSettingsRoute] as const;

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/missing",
              runtime,
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preloadEffect(ProjectRoute, { params: { id: "settings" } });
          expect(preloaded).toEqual(["settings"]);

          router.navigateHref("/projects/settings");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state();
              expect(state._tag).toBe("Ready");
              if (state._tag === "Ready") {
                expect(state.match.route).toBe(ProjectSettingsRoute);
                expect(state.match.params).toEqual({});
              }
            }),
          );
          expect(preloaded).toEqual(["settings", "settings"]);
        }),
      ),
    ));

  it("retries the current href preload when navigating to the same href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          window.history.replaceState(null, "", "/projects/atlas");
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              window.history.replaceState(null, "", "/");
            }),
          );

          let attempts = 0;
          const ProjectRoute = route("/projects/:id", {
            preload: () =>
              Effect.gen(function* () {
                attempts++;
                if (attempts === 1) {
                  return yield* Effect.fail("offline");
                }
              }),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Failure",
                href: "/projects/atlas",
              });
              expect(attempts).toBe(1);
            }),
          );

          yield* Effect.sync(() => {
            router.navigateHref("/projects/atlas");
          });

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/projects/atlas",
              });
              expect(attempts).toBe(2);
            }),
          );
        }),
      ),
    ));

  it("binds public router preload Effects to the router runtime", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime(
            Layer.succeed(ProjectApi)({
              preload: (id) =>
                Effect.sync(() => {
                  preloaded.push(id);
                }),
            }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: ({ params }) => ProjectApi.use((api) => api.preload(params.id)),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/missing",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preloadEffect(ProjectRoute, { params: { id: "atlas" } });

          expect(preloaded).toEqual(["atlas"]);
        }),
      ),
    ));

  it("provides a Scope for public router preload Effects", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: () =>
              Effect.acquireRelease(
                Effect.sync(() => {
                  events.push("acquire");
                }),
                () =>
                  Effect.sync(() => {
                    events.push("release");
                  }),
              ),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/missing",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preloadEffect(ProjectRoute, { params: { id: "atlas" } });

          expect(events).toEqual(["acquire", "release"]);
        }),
      ),
    ));

  it("supports typed route path helpers for hrefs, matches, preloads, and navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          window.history.replaceState(null, "", "/");
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              window.history.replaceState(null, "", "/");
            }),
          );

          const ProjectsRoute = route("/path-helper-projects");
          const ProjectRoute = route("/path-helper-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });
          const routes = [ProjectsRoute, ProjectRoute] as const;
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/path-helper-projects/atlas",
              runtime,
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects/atlas",
              });
            }),
          );

          expect(router.hrefByPath("/path-helper-projects")).toBe("/path-helper-projects");
          expect(
            router.hrefByPath("/path-helper-projects/:id", {
              params: { id: "kepler" },
            }),
          ).toBe("/path-helper-projects/kepler");
          expect(router.matchByPath("/path-helper-projects/:id")?.params.id).toBe("atlas");
          expect(router.matchByPath("/path-helper-projects")).toBeUndefined();
          expect(preloaded).toEqual(["atlas"]);

          yield* router.preloadByPathEffect("/path-helper-projects/:id", {
            params: { id: "curie" },
          });
          expect(preloaded).toEqual(["atlas", "curie"]);

          router.navigateByPath(
            "/path-helper-projects/:id",
            {
              params: { id: "kepler" },
            },
            { replace: true },
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects/kepler",
              });
            }),
          );
          expect(router.matchByPath("/path-helper-projects/:id")?.params.id).toBe("kepler");

          router.navigateByPath("/path-helper-projects");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects",
              });
            }),
          );
          expect(router.matchByPath("/path-helper-projects")?.route).toBe(ProjectsRoute);
        }),
      ),
    ));

  it("rejects public preloads for routes outside router.routes before running preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/router-projects/:id");
          const OutsideRoute = route("/outside-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/missing",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const exit = yield* Effect.exit(
            // @ts-expect-error outside route intentionally violates the configured router tuple
            router.preloadEffect(OutsideRoute, { params: { id: "atlas" } }),
          );

          expect(preloaded).toEqual([]);
          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(
              RouteNavigationError,
            );
          }

          // @ts-expect-error outside route intentionally violates the configured router tuple
          router.navigate(OutsideRoute, { params: { id: "atlas" } });
          expect(preloaded).toEqual([]);
          const state = router.state();
          expect(state._tag).toBe("Failure");
          if (state._tag === "Failure") {
            expect(state.error).toBeInstanceOf(RouteNavigationError);
            expect((state.error as RouteNavigationError).cause).toBeInstanceOf(
              RouterRouteNotRegistered,
            );
          }

          const pathExit = yield* Effect.exit(
            // @ts-expect-error outside route path intentionally violates the configured router tuple
            router.preloadByPathEffect("/outside-projects/:id", { params: { id: "atlas" } }),
          );
          expect(preloaded).toEqual([]);
          expect(pathExit._tag).toBe("Failure");
          if (pathExit._tag === "Failure") {
            expect(pathExit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(
              RouteNavigationError,
            );
          }

          // @ts-expect-error outside route path intentionally violates the configured router tuple
          router.navigateByPath("/outside-projects/:id", { params: { id: "atlas" } });
          expect(preloaded).toEqual([]);
          const pathState = router.state();
          expect(pathState._tag).toBe("Failure");
          if (pathState._tag === "Failure") {
            expect(pathState.error).toBeInstanceOf(RouteNavigationError);
            expect((pathState.error as RouteNavigationError).cause).toBeInstanceOf(
              RouterRouteNotRegistered,
            );
          }
        }),
      ),
    ));

  it("RouterLink builds hrefs, preloads on hover, and navigates on plain clicks", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          const history = {
            ...makeMemoryBrowserHistoryAdapter({ initialHref: "/missing" }),
            createHref: (href: string) => `/project-docs${href}`,
          };
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/link-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const LinkView = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterLink, {
              route: ProjectRoute,
              options: { params: { id: "atlas" } },
              children: "Atlas",
            });
          };
          const container = document.createElement("div");
          document.body.append(container);
          yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                history,
                runtime,
                get children() {
                  return createComponent(LinkView, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          expect(anchor?.getAttribute("href")).toBe("/project-docs/link-projects/atlas");

          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.promise(() => vi.waitFor(() => expect(preloaded).toEqual(["atlas"])));

          anchor?.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              button: 0,
              cancelable: true,
              metaKey: true,
            }),
          );
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });

          const plainClick = new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true,
          });
          anchor?.dispatchEvent(plainClick);
          expect(plainClick.defaultPrevented).toBe(true);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router?.state()).toMatchObject({
                _tag: "Ready",
                href: "/link-projects/atlas",
              }),
            ),
          );
          expect(history.entries()).toEqual(["/missing", "/link-projects/atlas"]);
          expect(preloaded).toEqual(["atlas", "atlas"]);
        }),
      ),
    ));

  it("normalizes RouterLink download props before preload and click decisions", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/download-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const LinkView = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return [
              createComponent(RouterLink, {
                route: ProjectRoute,
                options: { params: { id: "atlas" } },
                download: false,
                "data-kind": "false-download",
                children: "False download",
              }),
              createComponent(RouterLink, {
                route: ProjectRoute,
                options: { params: { id: "curie" } },
                download: "project.csv",
                "data-kind": "real-download",
                children: "Real download",
              }),
            ] as unknown as JSX.Element;
          };
          const container = document.createElement("div");
          document.body.append(container);
          yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(LinkView, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const realDownload = container.querySelector('a[data-kind="real-download"]');
          realDownload?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          const realDownloadClick = new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true,
          });
          realDownload?.dispatchEvent(realDownloadClick);
          yield* Effect.sleep("20 millis");
          expect(preloaded).toEqual([]);
          expect(realDownloadClick.defaultPrevented).toBe(false);
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });

          const falseDownload = container.querySelector('a[data-kind="false-download"]');
          falseDownload?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.promise(() => vi.waitFor(() => expect(preloaded).toEqual(["atlas"])));

          const falseDownloadClick = new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true,
          });
          falseDownload?.dispatchEvent(falseDownloadClick);
          expect(falseDownloadClick.defaultPrevented).toBe(true);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router?.state()).toMatchObject({
                _tag: "Ready",
                href: "/download-projects/atlas",
              }),
            ),
          );
          expect(preloaded).toEqual(["atlas", "atlas"]);
        }),
      ),
    ));

  it("forwards RouterProvider history adapters to navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
          const initialWindowPathname = window.location.pathname;
          const HomeRoute = route("/", {
            component: () => {
              const element = document.createElement("h1");
              element.textContent = "Home";
              return element;
            },
          });
          const ProjectRoute = route("/provider-history/:id", {
            component: ({ params }) => {
              const element = document.createElement("h1");
              element.textContent = `Project ${params.id}`;
              return element;
            },
          });
          const container = document.createElement("div");
          let router: BrowserRouter<readonly [typeof HomeRoute, typeof ProjectRoute]> | undefined;
          const CaptureRouter = () => {
            router = useRouter<readonly [typeof HomeRoute, typeof ProjectRoute]>();
            return createComponent(RouterOutlet, {});
          };

          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [HomeRoute, ProjectRoute] as const,
                history,
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("Home")));

          expect(router).toBeDefined();
          router!.navigateHref("/provider-history/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/provider-history/atlas",
              }),
            ),
          );

          expect(history.entries()).toEqual(["/", "/provider-history/atlas"]);
          expect(window.location.pathname).toBe(initialWindowPathname);
        }),
      ),
    ));

  it("renders lazy route components after route preload loads the chunk", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let imports = 0;
          let renders = 0;
          const LazyProject = Route.lazyComponent(
            Effect.sync(() => {
              imports++;
              return {
                default: ({ params }: { readonly params: { readonly id: string } }) => {
                  renders++;
                  return `Project ${params.id}`;
                },
              };
            }),
          );
          const ProjectRoute = route("/lazy-solid-projects/:id", {
            component: LazyProject,
          });
          const match = ProjectRoute.match("/lazy-solid-projects/atlas");
          if (!match) {
            expect.fail("Expected lazy Solid route to match.");
          }
          yield* Route.preloadComponentEffect(match);
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/lazy-solid-projects/atlas",
                hydrating: true,
                runtime,
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(imports).toBe(1);
          expect(renders).toBe(1);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("Project atlas")),
          );
        }),
      ),
    ));

  it("publishes unloaded lazy route components as Solid route render suspensions", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const release = yield* Deferred.make<void>();
          let imports = 0;
          let renders = 0;
          const LazyProject = Route.lazyComponent(
            Effect.gen(function* () {
              imports++;
              yield* Deferred.await(release);
              return {
                default: ({ params }: { readonly params: { readonly id: string } }) => {
                  renders++;
                  return `Project ${params.id}`;
                },
              };
            }),
          );
          const ProjectRoute = route("/ready-lazy-solid-projects/:id", {
            component: LazyProject,
          });
          const match = ProjectRoute.match("/ready-lazy-solid-projects/atlas");
          if (!match) {
            expect.fail("Expected ready lazy Solid route to match.");
          }

          let node: (() => JSX.Element) | undefined;
          let suspension: (() => unknown) | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const [currentSuspension, setRenderSuspension] = createSignal<unknown>();
            makeSolidRouteRenderScopeController({
              initialInput: {
                state: {
                  _tag: "Ready",
                  href: "/ready-lazy-solid-projects/atlas",
                  match,
                },
                renderers: {},
              },
              runtime,
              setNode,
              setRenderError,
              setRenderSuspension,
            });
            node = currentNode;
            suspension = currentSuspension;
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(imports).toBe(1);
          expect(node?.()).toBeUndefined();
          expect(suspension?.()).toBeDefined();

          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(node?.()).toBe("Project atlas");
              expect(suspension?.()).toBeUndefined();
            }),
          );
          expect(imports).toBe(1);
          expect(renders).toBe(1);
        }),
      ),
    ));

  it("does not preload or trap RouterLink routes outside provider routes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/registered-link-projects/:id");
          const OutsideRoute = route("/outside-link-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });

          const container = document.createElement("div");
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const LinkView = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterLink, {
              // @ts-expect-error outside route intentionally violates the provider route tuple
              route: OutsideRoute,
              options: { params: { id: "atlas" } },
              children: "Atlas",
            });
          };
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(LinkView, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.sleep("20 millis");

          expect(preloaded).toEqual([]);
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });

          const plainClick = new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true,
          });
          anchor?.dispatchEvent(plainClick);

          expect(plainClick.defaultPrevented).toBe(false);
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });
        }),
      ),
    ));

  it("does not start RouterLink hover preloads when target disables router handling", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let starts = 0;
          const ProjectRoute = route("/hover-disabled-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }),
          });
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(RouterLink, {
                    route: ProjectRoute,
                    options: { params: { id: "atlas" } },
                    target: "_blank",
                    children: "Atlas",
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.sleep("20 millis");

          expect(starts).toBe(0);
        }),
      ),
    ));

  it("interrupts stale RouterLink hover preloads with the Solid owner", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let starts = 0;
          let finalizers = 0;
          const ProjectRoute = route("/hover-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers++;
                  }),
                ),
              ),
          });
          let hideLink = () => undefined;
          const LinkGate = () => {
            const [show, setShow] = createSignal(true);
            hideLink = () => setShow(false);
            return createComponent(Show, {
              get when() {
                return show();
              },
              get children() {
                return createComponent(RouterLink, {
                  route: ProjectRoute,
                  options: { params: { id: "atlas" } },
                  children: "Atlas",
                });
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(LinkGate, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));

          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(starts).toBe(2);
              expect(finalizers).toBe(1);
            }),
          );

          hideLink();
          yield* Effect.promise(() => vi.waitFor(() => expect(finalizers).toBe(2)));
        }),
      ),
    ));

  it("lets navigation join resource work started by an interrupted hover preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let loads = 0;
          const Project = Resource.family<string, { readonly id: string }>({
            name: "SolidRouter.hover-navigate-resource-owner",
            load: (id) =>
              Effect.gen(function* () {
                loads++;
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return { id };
              }),
          });
          const ProjectRoute = route("/hover-navigate-projects/:id", {
            preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
          });

          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          let hideLink = () => undefined;
          const LinkGate = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            const [show, setShow] = createSignal(true);
            hideLink = () => setShow(false);
            return createComponent(Show, {
              get when() {
                return show();
              },
              get children() {
                return createComponent(RouterLink, {
                  route: ProjectRoute,
                  options: { params: { id: "atlas" } },
                  children: "Atlas",
                });
              },
            });
          };

          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(LinkGate, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Deferred.await(started);

          hideLink();
          router!.navigateHref("/hover-navigate-projects/atlas");
          yield* Deferred.succeed(release, undefined);

          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router?.state()).toMatchObject({
                _tag: "Ready",
                href: "/hover-navigate-projects/atlas",
              }),
            ),
          );
          expect(loads).toBe(1);
          expect(runWithRuntime(runtime, () => Resource.status(Project("atlas"))._tag)).toBe(
            "Success",
          );
        }),
      ),
    ));

  it("keeps the initial outlet pending until preload succeeds", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const release = yield* Deferred.make<void>();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let renders = 0;
          const ProjectRoute = route("/projects/:id", {
            preload: () => Deferred.await(release),
            component: () => {
              renders++;
              return "project";
            },
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const CaptureRouter = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterOutlet, {
              pending: () => "pending",
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/projects/atlas",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router?.state()).toMatchObject({
              _tag: "Pending",
              href: "/projects/atlas",
            });
            expect(container.textContent).toBe("pending");
            expect(renders).toBe(0);
          });

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router?.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/atlas",
            });
            expect(renders).toBe(1);
          });
        }),
      ),
    ));

  it("rerenders pending outlet renderers without navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/renderer-pending/:id", {
            component: () => "project",
          });
          const routes = [ProjectRoute] as const;
          const match = Route.match(routes, "/renderer-pending/atlas");
          expect(match).toBeDefined();
          const state: Extract<BrowserRouterState<typeof routes>, { readonly _tag: "Pending" }> = {
            _tag: "Pending",
            href: "/renderer-pending/atlas",
            match: match!,
          };

          let node: (() => JSX.Element) | undefined;
          let update: ((renderer: () => JSX.Element) => void) | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: { pending: () => "pending-one" },
              },
              runtime,
              setNode,
              setRenderError,
            });
            node = currentNode;
            update = (pending) =>
              controller.update({
                state,
                renderers: { pending },
              });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("pending-one");
          update?.(() => "pending-two");
          yield* Effect.promise(() => vi.waitFor(() => expect(node?.()).toBe("pending-two")));
        }),
      ),
    ));

  it("waits for same-state renderer cleanup before rendering the replacement", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/renderer-cleanup/:id", {
            component: () => "project",
          });
          const routes = [ProjectRoute] as const;
          const match = Route.match(routes, "/renderer-cleanup/atlas");
          expect(match).toBeDefined();
          const state: Extract<BrowserRouterState<typeof routes>, { readonly _tag: "Pending" }> = {
            _tag: "Pending",
            href: "/renderer-cleanup/atlas",
            match: match!,
          };
          const events: Array<string> = [];
          const cleanupStarted = yield* Deferred.make<void>();
          const releaseCleanup = yield* Deferred.make<void>();

          let node: (() => JSX.Element) | undefined;
          let update: ((renderer: () => JSX.Element) => void) | undefined;
          let dispose: () => void = () => undefined;
          let disposeController: () => Effect.Effect<void> = () => Effect.void;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: {
                  pending: () => {
                    events.push("pending-one:setup");
                    onDispose(() =>
                      Effect.gen(function* () {
                        events.push("pending-one:cleanup-start");
                        yield* Deferred.succeed(cleanupStarted, undefined);
                        yield* Deferred.await(releaseCleanup);
                        events.push("pending-one:cleanup-done");
                      }),
                    );
                    return "pending-one";
                  },
                },
              },
              runtime,
              setNode,
              setRenderError,
            });
            disposeController = controller.disposeEffect;
            node = currentNode;
            update = (pending) =>
              controller.update({
                state,
                renderers: { pending },
              });
          });
          yield* Effect.addFinalizer(() => disposeController());
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("pending-one");
          update?.(() => {
            events.push(`pending-two:setup:${events.includes("pending-one:cleanup-start")}`);
            return "pending-two";
          });

          yield* Deferred.await(cleanupStarted);
          yield* Effect.sync(() => {
            expect(node?.()).toBeUndefined();
            expect(events).toEqual(["pending-one:setup", "pending-one:cleanup-start"]);
          });

          yield* Deferred.succeed(releaseCleanup, undefined);
          yield* Effect.promise(() => vi.waitFor(() => expect(node?.()).toBe("pending-two")));
          yield* Effect.sync(() => {
            expect(events).toEqual([
              "pending-one:setup",
              "pending-one:cleanup-start",
              "pending-one:cleanup-done",
              "pending-two:setup:true",
            ]);
          });
        }),
      ),
    ));

  it("waits for failed renderer cleanup before rendering a replacement", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/renderer-failed-cleanup/:id", {
            component: () => "project",
          });
          const routes = [ProjectRoute] as const;
          const match = Route.match(routes, "/renderer-failed-cleanup/atlas");
          expect(match).toBeDefined();
          const state: Extract<BrowserRouterState<typeof routes>, { readonly _tag: "Pending" }> = {
            _tag: "Pending",
            href: "/renderer-failed-cleanup/atlas",
            match: match!,
          };
          const renderError = new Error("pending renderer failed");
          const events: Array<string> = [];
          const cleanupStarted = yield* Deferred.make<void>();
          const releaseCleanup = yield* Deferred.make<void>();

          let node: (() => JSX.Element) | undefined;
          let update: ((renderer: () => JSX.Element) => void) | undefined;
          let dispose: () => void = () => undefined;
          let disposeController: () => Effect.Effect<void> = () => Effect.void;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: { pending: () => "pending-one" },
              },
              runtime,
              setNode,
              setRenderError,
            });
            disposeController = controller.disposeEffect;
            node = currentNode;
            update = (pending) =>
              controller.update({
                state,
                renderers: { pending },
              });
          });
          yield* Effect.addFinalizer(() => disposeController());
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("pending-one");
          update?.(() => {
            events.push("pending-failed:setup");
            onDispose(() =>
              Effect.gen(function* () {
                events.push("pending-failed:cleanup-start");
                yield* Deferred.succeed(cleanupStarted, undefined);
                yield* Deferred.await(releaseCleanup);
                events.push("pending-failed:cleanup-done");
              }),
            );
            throw renderError;
          });

          yield* Deferred.await(cleanupStarted);
          update?.(() => {
            events.push(`pending-two:setup:${events.includes("pending-failed:cleanup-done")}`);
            return "pending-two";
          });
          yield* Effect.sleep("20 millis");
          yield* Effect.sync(() => {
            expect(node?.()).toBeUndefined();
            expect(events).toEqual(["pending-failed:setup", "pending-failed:cleanup-start"]);
          });

          yield* Deferred.succeed(releaseCleanup, undefined);
          yield* Effect.promise(() => vi.waitFor(() => expect(node?.()).toBe("pending-two")));
          yield* Effect.sync(() => {
            expect(events).toEqual([
              "pending-failed:setup",
              "pending-failed:cleanup-start",
              "pending-failed:cleanup-done",
              "pending-two:setup:true",
            ]);
          });
        }),
      ),
    ));

  it("waits for initial failed renderer cleanup before rendering a replacement", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/renderer-initial-failed-cleanup/:id", {
            component: () => "project",
          });
          const routes = [ProjectRoute] as const;
          const match = Route.match(routes, "/renderer-initial-failed-cleanup/atlas");
          expect(match).toBeDefined();
          const state: Extract<BrowserRouterState<typeof routes>, { readonly _tag: "Pending" }> = {
            _tag: "Pending",
            href: "/renderer-initial-failed-cleanup/atlas",
            match: match!,
          };
          const renderError = new Error("initial pending renderer failed");
          const events: Array<string> = [];
          const cleanupStarted = yield* Deferred.make<void>();
          const releaseCleanup = yield* Deferred.make<void>();

          let node: (() => JSX.Element) | undefined;
          let update: ((renderer: () => JSX.Element) => void) | undefined;
          let dispose: () => void = () => undefined;
          let disposeController: () => Effect.Effect<void> = () => Effect.void;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: {
                  pending: () => {
                    events.push("initial-failed:setup");
                    onDispose(() =>
                      Effect.gen(function* () {
                        events.push("initial-failed:cleanup-start");
                        yield* Deferred.succeed(cleanupStarted, undefined);
                        yield* Deferred.await(releaseCleanup);
                        events.push("initial-failed:cleanup-done");
                      }),
                    );
                    throw renderError;
                  },
                },
              },
              runtime,
              setNode,
              setRenderError,
            });
            disposeController = controller.disposeEffect;
            node = currentNode;
            update = (pending) =>
              controller.update({
                state,
                renderers: { pending },
              });
          });
          yield* Effect.addFinalizer(() => disposeController());
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Deferred.await(cleanupStarted);
          update?.(() => {
            events.push(`pending-two:setup:${events.includes("initial-failed:cleanup-done")}`);
            return "pending-two";
          });
          yield* Effect.sleep("20 millis");
          yield* Effect.sync(() => {
            expect(node?.()).toBeUndefined();
            expect(events).toEqual(["initial-failed:setup", "initial-failed:cleanup-start"]);
          });

          yield* Deferred.succeed(releaseCleanup, undefined);
          yield* Effect.promise(() => vi.waitFor(() => expect(node?.()).toBe("pending-two")));
          yield* Effect.sync(() => {
            expect(events).toEqual([
              "initial-failed:setup",
              "initial-failed:cleanup-start",
              "initial-failed:cleanup-done",
              "pending-two:setup:true",
            ]);
          });
        }),
      ),
    ));

  it("exposes an awaitable route render dispose Effect", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/renderer-dispose-effect/:id", {
            component: () => "project",
          });
          const routes = [ProjectRoute] as const;
          const match = Route.match(routes, "/renderer-dispose-effect/atlas");
          expect(match).toBeDefined();
          const state: Extract<BrowserRouterState<typeof routes>, { readonly _tag: "Pending" }> = {
            _tag: "Pending",
            href: "/renderer-dispose-effect/atlas",
            match: match!,
          };
          const events: Array<string> = [];

          let dispose: () => void = () => undefined;
          let disposeController: () => Effect.Effect<void> = () => Effect.void;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: {
                  pending: () => {
                    events.push("pending:setup");
                    onDispose(() =>
                      Effect.sync(() => {
                        events.push("pending:cleanup");
                      }),
                    );
                    return "pending";
                  },
                },
              },
              runtime,
              setNode,
              setRenderError,
            });
            const controllerDisposeEffect: Effect.Effect<void> = controller.disposeEffect();
            void controllerDisposeEffect;
            disposeController = controller.disposeEffect;
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* disposeController();
          yield* Effect.sync(() => {
            expect(events).toEqual(["pending:setup", "pending:cleanup"]);
          });
        }),
      ),
    ));

  it("starts matched routes ready while Solid hydrates existing DOM", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const release = yield* Deferred.make<void>();
          const previousContext = sharedConfig.context;
          sharedConfig.context = {
            id: "",
            count: 0,
          };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              sharedConfig.context = previousContext;
            }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/hydrating-projects/:id", {
            preload: () => Deferred.await(release),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/hydrating-projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/hydrating-projects/atlas",
            });
          });

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/hydrating-projects/atlas",
            });
          });
        }),
      ),
    ));

  it("does not start route preload work during non-browser construction", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let preloads = 0;
          const runtime = makeRuntime();
          const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
          Reflect.deleteProperty(globalThis, "window");
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (windowDescriptor === undefined) {
                Reflect.deleteProperty(globalThis, "window");
              } else {
                Object.defineProperty(globalThis, "window", windowDescriptor);
              }
            }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/server-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/server-projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/server-projects/atlas",
            });
            expect(preloads).toBe(0);
          });
        }),
      ),
    ));

  it("keeps client-only initial navigation pending after Solid hydration globals remain", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const release = yield* Deferred.make<void>();
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          const previousHydration = hydrationGlobal._$HY;
          hydrationGlobal._$HY = {
            done: true,
          };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previousHydration === undefined) {
                delete hydrationGlobal._$HY;
              } else {
                hydrationGlobal._$HY = previousHydration;
              }
            }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/post-hydration-projects/:id", {
            preload: () => Deferred.await(release),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/post-hydration-projects/atlas",
                runtime,
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Pending",
              href: "/post-hydration-projects/atlas",
            });
          });

          yield* Deferred.succeed(release, undefined);
        }),
      ),
    ));

  it("renders pending fallbacks inside the router runtime and route scope", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const release = yield* Deferred.make<void>();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const ProjectById = Resource.family<string, { readonly id: string }>({
            name: "SolidRouter.pending-runtime-resource",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.prefetchEffect(ref));

          const ProjectRoute = route("/pending-runtime/:id", {
            preload: () => Deferred.await(release),
            component: () => "project",
          });
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/pending-runtime/atlas",
                runtime,
                pending: () => Resource.status(ref)._tag,
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("Success")),
          );
        }),
      ),
    ));

  it("disposes the previous route before rendering the next route", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const events: Array<string> = [];
          const OldRoute = route("/old", {
            component: () => {
              events.push("old:setup");
              onDispose(() => Effect.sync(() => events.push("old:cleanup")));
              const element = document.createElement("span");
              element.textContent = "old";
              return element;
            },
          });
          const NewRoute = route("/new", {
            component: () => {
              events.push("new:setup");
              onDispose(() => Effect.sync(() => events.push("new:cleanup")));
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            },
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, {});
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/old",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(container.textContent).toBe("old");
            expect(events).toEqual(["old:setup"]);
            expect(router).toBeDefined();
            router!.navigateHref("/new");
          });

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/new" })),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual(["old:setup", "old:cleanup", "new:setup"])),
          );
        }),
      ),
    ));

  it("rethrows route render thenables without scheduling a render failure", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const thenable = { then: () => undefined };
          const SuspendedRoute = route("/route-thenable", {
            component: () => {
              throw thenable;
            },
          });
          const match = SuspendedRoute.match("/route-thenable");
          if (!match) {
            expect.fail("Expected route to match.");
          }
          let nodeWrites = 0;
          let renderErrorWrites = 0;

          try {
            makeSolidRouteRenderScopeController({
              initialInput: {
                state: {
                  _tag: "Ready",
                  href: "/route-thenable",
                  match,
                },
                renderers: {},
              },
              runtime,
              setNode: () => {
                nodeWrites++;
                return undefined;
              },
              setRenderError: () => {
                renderErrorWrites++;
                return undefined;
              },
            });
            expect.fail("Expected route thenable to be rethrown.");
          } catch (error) {
            expect(error).toBe(thenable);
          }

          expect(nodeWrites).toBe(0);
          expect(renderErrorWrites).toBe(0);
        }),
      ),
    ));

  it("keeps route render thenables after navigation out of the host ErrorBoundary", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const thenable = new Promise<never>(() => undefined);
          const GoodRoute = route("/suspense-good", {
            component: () => undefined,
          });
          const SuspendedRoute = route("/suspense-route", {
            component: () => {
              throw thenable;
            },
          });
          const routes = [GoodRoute, SuspendedRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          let caught: unknown;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(Suspense, {
              fallback: "loading",
              get children() {
                return createComponent(ErrorBoundary, {
                  fallback: (error) => {
                    caught = error;
                    return "caught";
                  },
                  get children() {
                    return createComponent(RouterOutlet, {});
                  },
                });
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/suspense-good",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/suspense-good" })),
          );
          expect(container.textContent).toBe("");
          router!.navigateHref("/suspense-route");

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/suspense-route",
              });
              expect(caught).toBeUndefined();
            }),
          );
        }),
      ),
    ));

  it("publishes suspended route render outcomes from controller updates", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const thenable = { then: () => undefined };
          const GoodRoute = route("/controller-suspense-good", {
            component: () => "good",
          });
          const SuspendedRoute = route("/controller-suspense-route", {
            component: () => {
              throw thenable;
            },
          });
          const goodMatch = GoodRoute.match("/controller-suspense-good");
          const suspendedMatch = SuspendedRoute.match("/controller-suspense-route");
          if (!goodMatch || !suspendedMatch) {
            expect.fail("Expected routes to match.");
          }

          let node: (() => JSX.Element) | undefined;
          let suspension: (() => unknown) | undefined;
          let update: (() => void) | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const [currentSuspension, setRenderSuspension] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state: {
                  _tag: "Ready",
                  href: "/controller-suspense-good",
                  match: goodMatch,
                },
                renderers: {},
              },
              runtime,
              setNode,
              setRenderError,
              setRenderSuspension,
            });
            node = currentNode;
            suspension = currentSuspension;
            update = () =>
              controller.update({
                state: {
                  _tag: "Ready",
                  href: "/controller-suspense-route",
                  match: suspendedMatch,
                },
                renderers: {},
              });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("good");
          update?.();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(node?.()).toBeUndefined();
              expect(suspension?.()).toBe(thenable);
            }),
          );
        }),
      ),
    ));

  it("retries suspended route render outcomes when the thenable settles", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let shouldSuspend = true;
          let resumeSuspension: (() => void) | undefined;
          const thenable = {
            then: (resolve: () => void) => {
              resumeSuspension = resolve;
            },
          };
          const GoodRoute = route("/controller-retry-good", {
            component: () => "good",
          });
          const SuspendedRoute = route("/controller-retry-route", {
            component: () => {
              if (shouldSuspend) {
                throw thenable;
              }
              return "ready";
            },
          });
          const goodMatch = GoodRoute.match("/controller-retry-good");
          const suspendedMatch = SuspendedRoute.match("/controller-retry-route");
          if (!goodMatch || !suspendedMatch) {
            expect.fail("Expected routes to match.");
          }

          let node: (() => JSX.Element) | undefined;
          let suspension: (() => unknown) | undefined;
          let update: (() => void) | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const [currentSuspension, setRenderSuspension] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state: {
                  _tag: "Ready",
                  href: "/controller-retry-good",
                  match: goodMatch,
                },
                renderers: {},
              },
              runtime,
              setNode,
              setRenderError,
              setRenderSuspension,
            });
            node = currentNode;
            suspension = currentSuspension;
            update = () =>
              controller.update({
                state: {
                  _tag: "Ready",
                  href: "/controller-retry-route",
                  match: suspendedMatch,
                },
                renderers: {},
              });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("good");
          update?.();
          yield* Effect.promise(() => vi.waitFor(() => expect(suspension?.()).toBe(thenable)));

          shouldSuspend = false;
          resumeSuspension?.();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(suspension?.()).toBeUndefined();
              expect(node?.()).toBe("ready");
            }),
          );
        }),
      ),
    ));

  it("disposes suspended route frames when a newer controller update wins", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const events: Array<string> = [];
          const thenable = { then: () => undefined };
          const OldRoute = route("/suspense-cleanup-old", {
            component: () => "old",
          });
          const SuspendedRoute = route("/suspense-cleanup-pending", {
            component: () => {
              onCleanup(() => {
                events.push("suspended:cleanup");
              });
              throw thenable;
            },
          });
          const NewRoute = route("/suspense-cleanup-new", {
            component: () => "new",
          });
          const oldMatch = OldRoute.match("/suspense-cleanup-old");
          const suspendedMatch = SuspendedRoute.match("/suspense-cleanup-pending");
          const newMatch = NewRoute.match("/suspense-cleanup-new");
          if (!oldMatch || !suspendedMatch || !newMatch) {
            expect.fail("Expected routes to match.");
          }

          let node: (() => JSX.Element) | undefined;
          let suspension: (() => unknown) | undefined;
          let update:
            | ((
                href: string,
                match: typeof oldMatch | typeof suspendedMatch | typeof newMatch,
              ) => void)
            | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const [currentSuspension, setRenderSuspension] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state: {
                  _tag: "Ready",
                  href: "/suspense-cleanup-old",
                  match: oldMatch,
                },
                renderers: {},
              },
              runtime,
              setNode,
              setRenderError,
              setRenderSuspension,
            });
            node = currentNode;
            suspension = currentSuspension;
            update = (href, match) =>
              controller.update({
                state: {
                  _tag: "Ready",
                  href,
                  match,
                },
                renderers: {},
              });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("old");
          update?.("/suspense-cleanup-pending", suspendedMatch);
          yield* Effect.promise(() => vi.waitFor(() => expect(suspension?.()).toBe(thenable)));

          update?.("/suspense-cleanup-new", newMatch);
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(node?.()).toBe("new");
              expect(events).toEqual(["suspended:cleanup"]);
            }),
          );
        }),
      ),
    ));

  it("surfaces route render errors after navigation to the host ErrorBoundary", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const renderError = new Error("route render failed");
          const GoodRoute = route("/render-good", {
            component: () => "good",
          });
          const ThrowingRoute = route("/render-throw", {
            component: () => {
              throw renderError;
            },
          });
          const routes = [GoodRoute, ThrowingRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          let caught: unknown;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(ErrorBoundary, {
              fallback: (error) => {
                caught = error;
                return "caught";
              },
              get children() {
                return createComponent(RouterOutlet, {});
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/render-good",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("good")));
          router!.navigateHref("/render-throw");

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/render-throw",
              });
              expect(caught).toBe(renderError);
            }),
          );
        }),
      ),
    ));

  it("surfaces failed preload navigation without a failure renderer to the host ErrorBoundary", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const preloadFailure = "missing-project" as const;
          const GoodRoute = route("/preload-good", {
            component: () => "good",
          });
          const FailingRoute = route("/preload-fail", {
            preload: () => Effect.fail(preloadFailure),
            component: () => "never",
          });
          const routes = [GoodRoute, FailingRoute] as const;

          let router: BrowserRouter<typeof routes, RoutePreloadError> | undefined;
          let caught: unknown;
          const CaptureRouter = () => {
            router = useRouter<typeof routes, RoutePreloadError>();
            return createComponent(ErrorBoundary, {
              fallback: (error) => {
                caught = error;
                return "failed";
              },
              get children() {
                return createComponent(RouterOutlet, {});
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/preload-good",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("good")));
          router!.navigateHref("/preload-fail");

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router!.state();
              expect(state).toMatchObject({
                _tag: "Failure",
                href: "/preload-fail",
              });
              expect(state._tag === "Failure" ? state.error : undefined).toBeInstanceOf(
                RoutePreloadError,
              );
              expect(caught).toBeInstanceOf(Error);
              expect(caught instanceof Error ? caught.cause : undefined).toBe(
                state._tag === "Failure" ? state.cause : undefined,
              );
            }),
          );
        }),
      ),
    ));

  it("rerenders failure outlet renderers without navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const FailingRoute = route("/renderer-failure", {
            preload: () => Effect.fail("offline" as const),
            component: () => "never",
          });
          const routes = [FailingRoute] as const;
          type FailureState = Extract<
            BrowserRouterState<typeof routes, "offline">,
            { readonly _tag: "Failure" }
          >;
          const state: FailureState = {
            _tag: "Failure",
            href: "/renderer-failure",
            cause: Cause.fail("offline" as const),
            error: "offline",
          };

          let node: (() => JSX.Element) | undefined;
          let update: ((renderer: (state: FailureState) => JSX.Element) => void) | undefined;
          let dispose: () => void = () => undefined;
          createRoot((rootDispose) => {
            dispose = rootDispose;
            const [currentNode, setNode] = createSignal<JSX.Element>();
            const [, setRenderError] = createSignal<unknown>();
            const controller = makeSolidRouteRenderScopeController({
              initialInput: {
                state,
                renderers: { failure: () => "failure-one" },
              },
              runtime,
              setNode,
              setRenderError,
            });
            node = currentNode;
            update = (failure) =>
              controller.update({
                state,
                renderers: { failure },
              });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          expect(node?.()).toBe("failure-one");
          update?.(() => "failure-two");
          yield* Effect.promise(() => vi.waitFor(() => expect(node?.()).toBe("failure-two")));
        }),
      ),
    ));

  it("runs route UiScope finalizers in the router runtime", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const ProjectById = Resource.family<string, { readonly id: string }>({
            name: "SolidRouter.route-scope-runtime-disposal",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.prefetchEffect(ref));

          const OldRoute = route("/scope-old", {
            component: () => {
              onDispose(() => Resource.deleteEffect(ref));
              return "old";
            },
          });
          const NewRoute = route("/scope-new", {
            component: () => "new",
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, {});
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/scope-old",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("old")));

          expect(router).toBeDefined();
          router!.navigateHref("/scope-new");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/scope-new" })),
          );
          yield* Effect.sleep("20 millis");

          expect(runWithRuntime(runtime, () => Resource.status(ref)._tag)).toBe("Initial");
        }),
      ),
    ));

  it("runs Solid route cleanup in the router runtime despite nested providers", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const routerRuntime = makeRuntime();
          const nestedRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => routerRuntime.disposeEffect);
          yield* Effect.addFinalizer(() => nestedRuntime.disposeEffect);

          const ProjectById = Resource.family<string, { readonly id: string }>({
            name: "SolidRouter.solid-cleanup-runtime",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* routerRuntime.provide(Resource.prefetchEffect(ref));

          const cleanupStatuses: Array<string> = [];
          const OldRoute = route("/solid-cleanup-runtime-old", {
            component: () => {
              onCleanup(() => {
                cleanupStatuses.push(Resource.status(ref)._tag);
              });
              return "old";
            },
          });
          const NewRoute = route("/solid-cleanup-runtime-new", {
            component: () => "new",
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, {});
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/solid-cleanup-runtime-old",
                runtime: routerRuntime,
                get children() {
                  return createComponent(RuntimeProvider, {
                    runtime: nestedRuntime,
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("old")));
          router!.navigateHref("/solid-cleanup-runtime-new");

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/solid-cleanup-runtime-new",
              });
              expect(cleanupStatuses).toEqual(["Success"]);
            }),
          );
          expect(runWithRuntime(nestedRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
        }),
      ),
    ));

  it("runs the previous Solid route cleanup before the next route setup", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const events: Array<string> = [];
          const OldRoute = route("/solid-old", {
            component: () => {
              events.push("old:setup");
              onCleanup(() => {
                events.push("old:solid-cleanup");
              });
              const element = document.createElement("span");
              element.textContent = "old";
              return element;
            },
          });
          const NewRoute = route("/solid-new", {
            component: () => {
              events.push(`new:setup:${events.includes("old:solid-cleanup")}`);
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            },
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, {});
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/solid-old",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(events).toEqual(["old:setup"])));
          yield* Effect.sync(() => {
            router!.navigateHref("/solid-new");
          });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual(["old:setup", "old:solid-cleanup", "new:setup:true"]),
            ),
          );
        }),
      ),
    ));

  it("starts async route-scope finalizers before the next route setup", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const events: Array<string> = [];
          const release = yield* Deferred.make<void>();
          const OldRoute = route("/async-old", {
            component: () => {
              events.push("old:setup");
              onDispose(() =>
                Effect.gen(function* () {
                  events.push("old:scope-start");
                  yield* Deferred.await(release);
                  events.push("old:scope-done");
                }),
              );
              const element = document.createElement("span");
              element.textContent = "old";
              return element;
            },
          });
          const NewRoute = route("/async-new", {
            component: () => {
              events.push(`new:setup:${events.includes("old:scope-start")}`);
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            },
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, {});
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes,
                initialHref: "/async-old",
                runtime,
                get children() {
                  return createComponent(CaptureRouter, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(events).toEqual(["old:setup"])));
          yield* Effect.sync(() => {
            router!.navigateHref("/async-new");
          });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual(["old:setup", "old:scope-start", "new:setup:true"]),
            ),
          );
          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual([
                "old:setup",
                "old:scope-start",
                "new:setup:true",
                "old:scope-done",
              ]),
            ),
          );
        }),
      ),
    ));

  it("runs Solid route cleanup before scoped finalizers on outlet unmount", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const events: Array<string> = [];
          const RouteWithCleanup = route("/cleanup", {
            component: () => {
              events.push("setup");
              onCleanup(() => {
                events.push("solid-cleanup");
              });
              onDispose(() =>
                Effect.sync(() => {
                  events.push(`scope-cleanup:${events.includes("solid-cleanup")}`);
                }),
              );
              const element = document.createElement("span");
              element.textContent = "cleanup";
              return element;
            },
          });

          const dispose = createRoot((rootDispose) => {
            createComponent(RouterProvider, {
              routes: [RouteWithCleanup] as const,
              initialHref: "/cleanup",
              runtime,
            });
            return rootDispose;
          });

          yield* Effect.promise(() => vi.waitFor(() => expect(events).toEqual(["setup"])));
          yield* Effect.sync(dispose);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual(["setup", "solid-cleanup", "scope-cleanup:true"]),
            ),
          );
        }),
      ),
    ));

  it("renders route components with the router runtime despite nested providers", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const outerRuntime = makeRuntime();
          const innerRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => outerRuntime.disposeEffect);
          yield* Effect.addFinalizer(() => innerRuntime.disposeEffect);

          const ProjectById = Resource.family<string, Project>({
            name: "SolidRouter.runtime-owned-route-resource",
            load: (id) => Effect.succeed({ id, name: "Atlas" }),
          });
          const ref = ProjectById("atlas");
          let renderedStatus: string | undefined;
          const ProjectRoute = route("/runtime-projects/:id", {
            preload: () => Resource.prefetchEffect(ref),
            component: () => {
              const status = Resource.status(ref);
              renderedStatus = status._tag;
              const element = document.createElement("span");
              element.textContent = status._tag;
              return element;
            },
          });
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/runtime-projects/atlas",
                runtime: outerRuntime,
                get children() {
                  return createComponent(RuntimeProvider, {
                    runtime: innerRuntime,
                    get children() {
                      return createComponent(RouterOutlet, {});
                    },
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(renderedStatus).toBe("Success");
              expect(container.textContent).toBe("Success");
            }),
          );

          expect(runWithRuntime(innerRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
        }),
      ),
    ));
});
