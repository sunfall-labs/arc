// @vitest-environment happy-dom

import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeMemoryBrowserHistoryAdapter, makeRuntime, onDispose, Resource, route, RouteNavigationError, RoutePreloadError, runWithRuntime } from "@effect-ui/core";
import type { BrowserRouter, BrowserRouterState } from "../src/index.js";

vi.doMock("solid-js", () => import("solid-js/dist/solid.js"));
vi.doMock("solid-js/web", () => import("solid-js/web/dist/web.js"));

const { Show, createRoot, createSignal, onCleanup, sharedConfig } = await import("solid-js");
const { createComponent, render } = await import("solid-js/web");
const { createBrowserRouter, RouterLink, RouterOutlet, RouterProvider, RouterRouteNotRegistered, RuntimeProvider, useRouter } = await import("../src/index.js");

describe("createBrowserRouter", () => {
  interface ProjectApi {
    readonly preload: (id: string) => Effect.Effect<void>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@effect-ui/solid/test/ProjectApi");

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
              })
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/atlas"
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
              href: "/projects/kepler"
            });
            expect(preloads).toBe(2);
          });
        })
      )
    ));

  it("keeps route preload failures typed in browser router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: () => Effect.fail("missing-project")
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/projects/atlas",
              runtime
            });
          });
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
              cause: "missing-project"
            });
            expect(failure.cause.reasons.find(Cause.isFailReason)?.error).toBe(failure.error);
          });
        })
      )
    ));

  it("keeps route match schema failures typed in browser router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/schema-projects/:id", {
            params: Schema.Struct({ id: Schema.Number })
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/schema-projects/atlas",
              runtime
            });
          });
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
                input: "/schema-projects/atlas"
              });
              expect(failure.cause.reasons.find(Cause.isFailReason)?.error).toBe(failure.error);
            })
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
                input: "/schema-projects/kepler"
              });
            })
          );
        })
      )
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
              runtime
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
            })
          );
        })
      )
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
              })
          });
          const ProjectSettingsRoute = route("/projects/settings", {
            preload: () =>
              Effect.sync(() => {
                preloaded.push("settings");
              })
          });
          const routes = [ProjectRoute, ProjectSettingsRoute] as const;

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/missing",
              runtime
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
            })
          );
          expect(preloaded).toEqual(["settings", "settings"]);
        })
      )
    ));

  it("retries the current href preload when navigating to the same href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          window.history.replaceState(null, "", "/projects/atlas");
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          yield* Effect.addFinalizer(() => Effect.sync(() => {
            window.history.replaceState(null, "", "/");
          }));

          let attempts = 0;
          const ProjectRoute = route("/projects/:id", {
            preload: () =>
              Effect.gen(function* () {
                attempts++;
                if (attempts === 1) {
                  return yield* Effect.fail("offline");
                }
              })
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Failure",
                href: "/projects/atlas"
              });
              expect(attempts).toBe(1);
            })
          );

          yield* Effect.sync(() => {
            router.navigateHref("/projects/atlas");
          });

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/projects/atlas"
              });
              expect(attempts).toBe(2);
            })
          );
        })
      )
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
                })
            })
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: ({ params }) => ProjectApi.use((api) => api.preload(params.id))
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/missing",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preloadEffect(ProjectRoute, { params: { id: "atlas" } });

          expect(preloaded).toEqual(["atlas"]);
        })
      )
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
                  })
              )
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/missing",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preloadEffect(ProjectRoute, { params: { id: "atlas" } });

          expect(events).toEqual(["acquire", "release"]);
        })
      )
    ));

  it("supports typed route path helpers for hrefs, matches, preloads, and navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          window.history.replaceState(null, "", "/");
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          yield* Effect.addFinalizer(() => Effect.sync(() => {
            window.history.replaceState(null, "", "/");
          }));

          const ProjectsRoute = route("/path-helper-projects");
          const ProjectRoute = route("/path-helper-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              })
          });
          const routes = [ProjectsRoute, ProjectRoute] as const;
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/path-helper-projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects/atlas"
              });
            })
          );

          expect(router.hrefByPath("/path-helper-projects")).toBe("/path-helper-projects");
          expect(router.hrefByPath("/path-helper-projects/:id", {
            params: { id: "kepler" }
          })).toBe("/path-helper-projects/kepler");
          expect(router.matchByPath("/path-helper-projects/:id")?.params.id).toBe("atlas");
          expect(router.matchByPath("/path-helper-projects")).toBeUndefined();
          expect(preloaded).toEqual(["atlas"]);

          yield* router.preloadByPathEffect("/path-helper-projects/:id", {
            params: { id: "curie" }
          });
          expect(preloaded).toEqual(["atlas", "curie"]);

          router.navigateByPath("/path-helper-projects/:id", {
            params: { id: "kepler" }
          }, { replace: true });
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects/kepler"
              });
            })
          );
          expect(router.matchByPath("/path-helper-projects/:id")?.params.id).toBe("kepler");

          router.navigateByPath("/path-helper-projects");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects"
              });
            })
          );
          expect(router.matchByPath("/path-helper-projects")?.route).toBe(ProjectsRoute);
        })
      )
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
              })
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/missing",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const exit = yield* Effect.exit(
            (router.preloadEffect as any)(OutsideRoute, { params: { id: "atlas" } })
          );

          expect(preloaded).toEqual([]);
          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(RouteNavigationError);
          }

          (router.navigate as any)(OutsideRoute, { params: { id: "atlas" } });
          expect(preloaded).toEqual([]);
          const state = router.state();
          expect(state._tag).toBe("Failure");
          if (state._tag === "Failure") {
            expect(state.error).toBeInstanceOf(RouteNavigationError);
            expect((state.error as RouteNavigationError).cause).toBeInstanceOf(RouterRouteNotRegistered);
          }

          const pathExit = yield* Effect.exit(
            (router.preloadByPathEffect as any)("/outside-projects/:id", { params: { id: "atlas" } })
          );
          expect(preloaded).toEqual([]);
          expect(pathExit._tag).toBe("Failure");
          if (pathExit._tag === "Failure") {
            expect(pathExit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(RouteNavigationError);
          }

          (router.navigateByPath as any)("/outside-projects/:id", { params: { id: "atlas" } });
          expect(preloaded).toEqual([]);
          const pathState = router.state();
          expect(pathState._tag).toBe("Failure");
          if (pathState._tag === "Failure") {
            expect(pathState.error).toBeInstanceOf(RouteNavigationError);
            expect((pathState.error as RouteNavigationError).cause).toBeInstanceOf(RouterRouteNotRegistered);
          }
        })
      )
    ));

  it("RouterLink builds hrefs, preloads on hover, and navigates on plain clicks", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/link-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              })
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const LinkView = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterLink, {
              route: ProjectRoute,
              options: { params: { id: "atlas" } },
              children: "Atlas"
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
                  return createComponent(LinkView, {});
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          expect(anchor?.getAttribute("href")).toBe("/link-projects/atlas");

          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(preloaded).toEqual(["atlas"]))
          );

          anchor?.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true,
            metaKey: true
          }));
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });

          const plainClick = new MouseEvent("click", {
            bubbles: true,
            button: 0,
            cancelable: true
          });
          anchor?.dispatchEvent(plainClick);
          expect(plainClick.defaultPrevented).toBe(true);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router?.state()).toMatchObject({
              _tag: "Ready",
              href: "/link-projects/atlas"
            }))
          );
          expect(preloaded).toEqual(["atlas", "atlas"]);
        })
      )
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
            }
          });
          const ProjectRoute = route("/provider-history/:id", {
            component: ({ params }) => {
              const element = document.createElement("h1");
              element.textContent = `Project ${params.id}`;
              return element;
            }
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("Home"))
          );

          expect(router).toBeDefined();
          router!.navigateHref("/provider-history/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/provider-history/atlas"
              })
            )
          );

          expect(history.entries()).toEqual(["/", "/provider-history/atlas"]);
          expect(window.location.pathname).toBe(initialWindowPathname);
        })
      )
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
              })
          });

          const container = document.createElement("div");
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const LinkView = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterLink, {
              route: OutsideRoute as any,
              options: { params: { id: "atlas" } },
              children: "Atlas"
            } as any);
          };
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/missing",
                runtime,
                get children() {
                  return createComponent(LinkView, {});
                }
              }),
            container
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
            cancelable: true
          });
          anchor?.dispatchEvent(plainClick);

          expect(plainClick.defaultPrevented).toBe(false);
          expect(router?.state()).toMatchObject({ _tag: "NotFound", href: "/missing" });
        })
      )
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
                Effect.ensuring(Effect.sync(() => {
                  finalizers++;
                }))
              )
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
                  children: "Atlas"
                });
              }
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
                }
              }),
            container
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
            })
          );

          hideLink();
          yield* Effect.promise(() => vi.waitFor(() => expect(finalizers).toBe(2)));
        })
      )
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
              })
          });
          const ProjectRoute = route("/hover-navigate-projects/:id", {
            preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
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
                  children: "Atlas"
                });
              }
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const anchor = container.querySelector("a");
          anchor?.dispatchEvent(new MouseEvent("mouseenter", { cancelable: true }));
          yield* Deferred.await(started);

          hideLink();
          router!.navigateHref("/hover-navigate-projects/atlas");
          yield* Deferred.succeed(release, undefined);

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router?.state()).toMatchObject({
              _tag: "Ready",
              href: "/hover-navigate-projects/atlas"
            }))
          );
          expect(loads).toBe(1);
          expect(runWithRuntime(runtime, () => Resource.status(Project("atlas"))._tag)).toBe("Success");
        })
      )
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
            }
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const CaptureRouter = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterOutlet, {
              pending: () => "pending"
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router?.state()).toMatchObject({
              _tag: "Pending",
              href: "/projects/atlas"
            });
            expect(container.textContent).toBe("pending");
            expect(renders).toBe(0);
          });

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router?.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/atlas"
            });
            expect(renders).toBe(1);
          });
        })
      )
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
            count: 0
          };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              sharedConfig.context = previousContext;
            })
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/hydrating-projects/:id", {
            preload: () => Deferred.await(release)
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/hydrating-projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/hydrating-projects/atlas"
            });
          });

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/hydrating-projects/atlas"
            });
          });
        })
      )
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
            done: true
          };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previousHydration === undefined) {
                delete hydrationGlobal._$HY;
              } else {
                hydrationGlobal._$HY = previousHydration;
              }
            })
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/post-hydration-projects/:id", {
            preload: () => Deferred.await(release)
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/post-hydration-projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Pending",
              href: "/post-hydration-projects/atlas"
            });
          });

          yield* Deferred.succeed(release, undefined);
        })
      )
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
            load: (id) => Effect.succeed({ id })
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.prefetchEffect(ref));

          const ProjectRoute = route("/pending-runtime/:id", {
            preload: () => Deferred.await(release),
            component: () => "project"
          });
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RouterProvider, {
                routes: [ProjectRoute] as const,
                initialHref: "/pending-runtime/atlas",
                runtime,
                pending: () => Resource.status(ref)._tag
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("Success"))
          );
        })
      )
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
            }
          });
          const NewRoute = route("/new", {
            component: () => {
              events.push("new:setup");
              onDispose(() => Effect.sync(() => events.push("new:cleanup")));
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            }
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(container.textContent).toBe("old");
            expect(events).toEqual(["old:setup"]);
            expect(router).toBeDefined();
            router!.navigateHref("/new");
          });

          yield* Effect.promise(() => vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/new" })));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual(["old:setup", "old:cleanup", "new:setup"]))
          );
        })
      )
    ));

  it("runs route UiScope finalizers in the router runtime", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const ProjectById = Resource.family<string, { readonly id: string }>({
            name: "SolidRouter.route-scope-runtime-disposal",
            load: (id) => Effect.succeed({ id })
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.prefetchEffect(ref));

          const OldRoute = route("/scope-old", {
            component: () => {
              onDispose(() => Resource.deleteEffect(ref));
              return "old";
            }
          });
          const NewRoute = route("/scope-new", {
            component: () => "new"
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("old")));

          expect(router).toBeDefined();
          router!.navigateHref("/scope-new");
          yield* Effect.promise(() => vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/scope-new" })));
          yield* Effect.sleep("20 millis");

          expect(runWithRuntime(runtime, () => Resource.status(ref)._tag)).toBe("Initial");
        })
      )
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
            load: (id) => Effect.succeed({ id })
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
            }
          });
          const NewRoute = route("/solid-cleanup-runtime-new", {
            component: () => "new"
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
                    }
                  });
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe("old")));
          router!.navigateHref("/solid-cleanup-runtime-new");

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router!.state()).toMatchObject({
                _tag: "Ready",
                href: "/solid-cleanup-runtime-new"
              });
              expect(cleanupStatuses).toEqual(["Success"]);
            })
          );
          expect(runWithRuntime(nestedRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
        })
      )
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
            }
          });
          const NewRoute = route("/solid-new", {
            component: () => {
              events.push(`new:setup:${events.includes("old:solid-cleanup")}`);
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            }
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual(["old:setup"]))
          );
          yield* Effect.sync(() => {
            router!.navigateHref("/solid-new");
          });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual([
                "old:setup",
                "old:solid-cleanup",
                "new:setup:true"
              ])
            )
          );
        })
      )
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
                })
              );
              const element = document.createElement("span");
              element.textContent = "old";
              return element;
            }
          });
          const NewRoute = route("/async-new", {
            component: () => {
              events.push(`new:setup:${events.includes("old:scope-start")}`);
              const element = document.createElement("span");
              element.textContent = "new";
              return element;
            }
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
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual(["old:setup"]))
          );
          yield* Effect.sync(() => {
            router!.navigateHref("/async-new");
          });
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual([
              "old:setup",
              "old:scope-start",
              "new:setup:true"
            ]))
          );
          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual([
                "old:setup",
                "old:scope-start",
                "new:setup:true",
                "old:scope-done",
              ])
            )
          );
        })
      )
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
              onDispose(() => Effect.sync(() => {
                events.push(`scope-cleanup:${events.includes("solid-cleanup")}`);
              }));
              const element = document.createElement("span");
              element.textContent = "cleanup";
              return element;
            }
          });

          const dispose = createRoot((rootDispose) => {
            createComponent(RouterProvider, {
                routes: [RouteWithCleanup] as const,
                initialHref: "/cleanup",
                runtime
              });
            return rootDispose;
          });

          yield* Effect.promise(() => vi.waitFor(() => expect(events).toEqual(["setup"])));
          yield* Effect.sync(dispose);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual([
                "setup",
                "solid-cleanup",
                "scope-cleanup:true"
              ])
            )
          );
        })
      )
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
            load: (id) => Effect.succeed({ id, name: "Atlas" })
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
            }
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
                    }
                  });
                }
              }),
            container
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(renderedStatus).toBe("Success");
              expect(container.textContent).toBe("Success");
            })
          );

          expect(runWithRuntime(innerRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
        })
      )
    ));
});
