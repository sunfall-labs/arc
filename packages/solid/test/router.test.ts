// @vitest-environment happy-dom

import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  RouteNavigationError,
  RoutePreloadError,
  RouterRouteNotRegistered,
  runWithRuntime,
  Signal,
  type BrowserRouterState,
} from "@sunfall/arc-core";
import { eraseRuntime, onDispose } from "@sunfall/arc-core/internal";
import type { JSX } from "@solidjs/web";
import type { AnySunfallArcRuntime, BrowserHistoryAdapter } from "@sunfall/arc-core";
import type { BrowserRouter, RouterOutletProps, RouterProviderProps } from "../src/index.js";

const { Errored, Loading, Show, children, createRoot, createSignal, getOwner, onCleanup } =
  await import("solid-js");

/** Reads rendered output the way DOM insertion would; Solid 2 evaluates children lazily. */
const resolveRendered = (element: unknown): unknown => children(() => element as never)();
const { createComponent, hydrate, render } = await import("@solidjs/web");
const {
  Component,
  RouterLink,
  RouterOutlet,
  RouterProvider: BoundRouterProvider,
  useRouter,
} = await import("../src/index.js");
const { createContext, useContext } = await import("solid-js");

// Test shims: the runtime + routes provider pair these tests were written
// against, rebuilt on `Component.router(...)` (the router is created in a
// Component instance on the shim runtime) and `RouterProvider`.
const ShimRuntime = createContext<AnySunfallArcRuntime<never> | null>(null);
const RuntimeProvider = (props: {
  readonly runtime: object;
  readonly children?: JSX.Element;
}): JSX.Element =>
  createComponent(ShimRuntime, {
    get value() {
      return props.runtime as AnySunfallArcRuntime<never>;
    },
    get children() {
      return props.children;
    },
  });
const RouterProvider = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
>(
  props: Omit<RouterOutletProps<Routes, never>, "router"> & {
    readonly routes: Routes;
    readonly initialHref?: string;
    readonly hydrating?: boolean;
    readonly history?: BrowserHistoryAdapter;
    readonly children?: JSX.Element;
  },
): JSX.Element => {
  const runtime = useContext(ShimRuntime);
  if (runtime === null) {
    throw new Error("RouterProvider shim needs a RuntimeProvider shim");
  }
  const Tree = Component.define("RouterTree", function* () {
    const router = yield* Component.router(props.routes, {
      ...(props.initialHref === undefined ? {} : { initialHref: props.initialHref }),
      ...(props.hydrating === undefined ? {} : { hydrating: props.hydrating }),
      ...(props.history === undefined ? {} : { history: props.history }),
    });
    return () =>
      createComponent(BoundRouterProvider<Routes, never>, {
        router,
        get children() {
          return (
            props.children ??
            createComponent(RouterOutlet<Routes, never>, {
              router,
              get pending() {
                return props.pending;
              },
              get failure() {
                return props.failure;
              },
              get notFound() {
                return props.notFound;
              },
            } as RouterOutletProps<Routes, never>)
          );
        },
      } as RouterProviderProps<Routes, never>);
  }) as unknown as Parameters<typeof Component.embed<{}>>[0];
  return createComponent(Component.embed(Tree, runtime), {});
};
const { createBrowserRouter } = await import("../src/router.js");
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/projects/:id", {
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
                runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const started = yield* Deferred.make<void>();
          let releases = 0;
          const SlowRoute = Route.define("/owner-cleanup-slow", {
            preload: () =>
              Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
                Effect.sync(() => {
                  releases++;
                }),
              ).pipe(Effect.andThen(Effect.never), Effect.asVoid, Effect.scoped),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof SlowRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([SlowRoute] as const, {
              history: makeMemoryBrowserHistoryAdapter({ initialHref: "/missing" }),
              initialHref: "/missing",
              runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/projects/:id", {
            preload: () => Effect.fail("missing-project").pipe(Effect.asVoid),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/projects/atlas",
                runtime: eraseRuntime(runtime),
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
              // Without an `error` schema only the failure `_tag` is kept.
              cause: { _tag: "RoutePreloadUntypedFailure" },
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/schema-projects/:id", {
            params: Schema.Struct({ id: Schema.Number }),
          });

          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/schema-projects/atlas",
                runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/ordered-projects/:id", {});
          const ProjectSettingsRoute = Route.define("/ordered-projects/settings", {});
          const routes = [ProjectRoute, ProjectSettingsRoute] as const;

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<typeof routes> => {
            dispose = rootDispose;
            return createBrowserRouter(routes, {
              initialHref: "/ordered-projects/settings",
              runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(`project:${params.id}`);
              }),
          });
          const ProjectSettingsRoute = Route.define("/projects/settings", {
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
              runtime: eraseRuntime(runtime),
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preload(ProjectRoute, { params: { id: "settings" } });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              window.history.replaceState(null, "", "/");
            }),
          );

          let attempts = 0;
          const ProjectRoute = Route.define("/projects/:id", {
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
                runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/projects/:id", {
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

          yield* router.preload(ProjectRoute, { params: { id: "atlas" } });

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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/projects/:id", {
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
                runtime: eraseRuntime(runtime),
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* router.preload(ProjectRoute, { params: { id: "atlas" } });

          expect(events).toEqual(["acquire", "release"]);
        }),
      ),
    ));

  it("supports typed definition-based hrefs, matches, preloads, and navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          window.history.replaceState(null, "", "/");
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              window.history.replaceState(null, "", "/");
            }),
          );

          const ProjectsRoute = Route.define("/path-helper-projects");
          const ProjectRoute = Route.define("/path-helper-projects/:id", {
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
              runtime: eraseRuntime(runtime),
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

          expect(router.href(ProjectsRoute)).toBe("/path-helper-projects");
          expect(router.href(ProjectRoute, { params: { id: "kepler" } })).toBe(
            "/path-helper-projects/kepler",
          );
          expect(router.match()?.route).toBe(ProjectRoute);
          expect(router.match()?.params).toEqual({ id: "atlas" });
          expect(preloaded).toEqual(["atlas"]);

          yield* router.preload(ProjectRoute, { params: { id: "curie" } });
          expect(preloaded).toEqual(["atlas", "curie"]);

          router.navigate(ProjectRoute, { params: { id: "kepler" } }, { replace: true });
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects/kepler",
              });
            }),
          );
          expect(router.match()?.params).toEqual({ id: "kepler" });

          router.navigate(ProjectsRoute);
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state()).toMatchObject({
                _tag: "Ready",
                href: "/path-helper-projects",
              });
            }),
          );
          expect(router.match()?.route).toBe(ProjectsRoute);
        }),
      ),
    ));

  it("rejects public preloads for routes outside router.routes before running preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: Array<string> = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/router-projects/:id");
          const OutsideRoute = Route.define("/outside-projects/:id", {
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
                runtime: eraseRuntime(runtime),
              });
            },
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          const exit = yield* Effect.exit(
            // @ts-expect-error outside route intentionally violates the configured router tuple
            router.preload(OutsideRoute, { params: { id: "atlas" } }),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/link-projects/:id", {
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
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    history,
                    get children() {
                      return createComponent(LinkView, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/download-projects/:id", {
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
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/missing",
                    get children() {
                      return createComponent(LinkView, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
          const initialWindowPathname = window.location.pathname;
          const HomeRoute = Route.withComponent(Route.define("/"), () => {
            const element = document.createElement("h1");
            element.textContent = "Home";
            return element;
          });
          const ProjectRoute = Route.withComponent(
            Route.define("/provider-history/:id"),
            ({ params }: { readonly params: { readonly id: string } }) => {
              const element = document.createElement("h1");
              element.textContent = `Project ${params.id}`;
              return element;
            },
          );
          const container = document.createElement("div");
          let router: BrowserRouter<readonly [typeof HomeRoute, typeof ProjectRoute]> | undefined;
          const CaptureRouter = () => {
            router = useRouter<readonly [typeof HomeRoute, typeof ProjectRoute]>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };

          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [HomeRoute, ProjectRoute] as const,
                    history,
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

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
          const ProjectRoute = Route.withComponent(
            Route.define("/lazy-solid-projects/:id"),
            LazyProject,
          );
          const match = ProjectRoute.match("/lazy-solid-projects/atlas");
          if (!match) {
            expect.fail("Expected lazy Solid route to match.");
          }
          yield* Route.preloadComponent(match);
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/lazy-solid-projects/atlas",
                    hydrating: true,
                  });
                },
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

  it("suspends the nearest Loading boundary while an unloaded lazy route component loads", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

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
          const ProjectRoute = Route.withComponent(
            Route.define("/ready-lazy-solid-projects/:id"),
            LazyProject,
          );
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(Loading, {
                fallback: "loading",
                get children() {
                  return createComponent(RuntimeProvider, {
                    runtime: eraseRuntime(runtime),
                    get children() {
                      return createComponent(RouterProvider, {
                        routes: [ProjectRoute] as const,
                        initialHref: "/ready-lazy-solid-projects/atlas",
                        hydrating: true,
                      });
                    },
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("loading")),
          );
          expect(imports).toBe(1);
          expect(renders).toBe(0);

          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("Project atlas")),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/registered-link-projects/:id");
          const OutsideRoute = Route.define("/outside-link-projects/:id", {
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
              // OutsideRoute is intentionally absent from the provider route tuple.
              route: OutsideRoute,
              options: { params: { id: "atlas" } },
              children: "Atlas",
            });
          };
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/missing",
                    get children() {
                      return createComponent(LinkView, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let starts = 0;
          const ProjectRoute = Route.define("/hover-disabled-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }),
          });
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/missing",
                    get children() {
                      return createComponent(RouterLink, {
                        route: ProjectRoute,
                        options: { params: { id: "atlas" } },
                        target: "_blank",
                        children: "Atlas",
                      });
                    },
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let starts = 0;
          let finalizers = 0;
          const ProjectRoute = Route.define("/hover-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.asVoid,
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers++;
                  }),
                ),
              ),
          });
          let hideLink: () => void = () => undefined;
          const LinkGate = () => {
            const [show, setShow] = createSignal(true);
            hideLink = () => {
              setShow(false);
            };
            return createComponent(Show<boolean>, {
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
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/missing",
                    get children() {
                      return createComponent(LinkGate, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let loads = 0;
          const Project = Resource.define<string, { readonly id: string }>({
            name: "SolidRouter.hover-navigate-resource-owner",
            load: (id) =>
              Effect.gen(function* () {
                loads++;
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return { id };
              }),
          });
          const ProjectRoute = Route.define("/hover-navigate-projects/:id", {
            preload: ({ params }) => Resource.preload(Project(params.id)),
          });

          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          let hideLink: () => void = () => undefined;
          const LinkGate = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            const [show, setShow] = createSignal(true);
            hideLink = () => {
              setShow(false);
            };
            return createComponent(Show<boolean>, {
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
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/missing",
                    get children() {
                      return createComponent(LinkGate, {});
                    },
                  });
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
          expect(
            runWithRuntime(
              runtime,
              () => Effect.runSync(Resource.status(Project("atlas"))).result._tag,
            ),
          ).toBe("Success");
        }),
      ),
    ));

  it("keeps the initial outlet pending until preload succeeds", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          const release = yield* Deferred.make<void>();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let renders = 0;
          const ProjectRoute = Route.withComponent(
            Route.define("/projects/:id", {
              preload: () => Deferred.await(release),
            }),
            () => {
              renders++;
              return "project";
            },
          );
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const CaptureRouter = () => {
            router = useRouter<readonly [typeof ProjectRoute]>();
            return createComponent(RouterOutlet, {
              router: router!,
              pending: () => "pending",
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/projects/atlas",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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

  it("mounts the outlet without strict untracked-read warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = makeRuntime();
    const HomeRoute = Route.withComponent(Route.define("/"), () => "home");
    const container = document.createElement("div");
    const dispose = render(
      () =>
        createComponent(RuntimeProvider, {
          runtime: eraseRuntime(runtime),
          get children() {
            return createComponent(RouterProvider, {
              routes: [HomeRoute] as const,
              initialHref: "/",
              get children() {
                return createComponent(RouterOutlet, {
                  router: useRouter(),
                  pending: () => "pending",
                });
              },
            });
          },
        }),
      container,
    );
    try {
      const strictReads = warn.mock.calls.filter((call) =>
        String(call[0]).includes("STRICT_READ_UNTRACKED"),
      );
      expect(strictReads).toEqual([]);
    } finally {
      dispose();
      warn.mockRestore();
      await Effect.runPromise(Effect.orDie(runtime.dispose));
    }
  });

  it("renders a route component with props mapped from the route props", async () => {
    const runtime = makeRuntime();
    const ProjectView = (props: { readonly id: string; readonly tab: string }) =>
      `project ${props.id} ${props.tab}`;
    const ProjectRoute = Route.withComponent(
      Route.define("/mapped-projects/:id"),
      ProjectView,
      ({ params, match }) => ({ id: params.id, tab: match.pathname }),
    );
    const container = document.createElement("div");
    const dispose = render(
      () =>
        createComponent(RuntimeProvider, {
          runtime: eraseRuntime(runtime),
          get children() {
            return createComponent(RouterProvider, {
              routes: [ProjectRoute] as const,
              initialHref: "/mapped-projects/atlas",
              get children() {
                return createComponent(RouterOutlet, { router: useRouter() });
              },
            });
          },
        }),
      container,
    );
    try {
      await vi.waitFor(() => {
        expect(container.textContent).toBe("project atlas /mapped-projects/atlas");
      });
    } finally {
      dispose();
      await Effect.runPromise(Effect.orDie(runtime.dispose));
    }
  });

  it("rerenders pending outlet renderers without navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.withComponent(
            Route.define("/renderer-pending/:id"),
            () => "project",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderError = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
              initialInput: {
                state,
                renderers: { pending: () => "pending-one" },
              },
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError,
            });
            node = () => currentNode.get();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.withComponent(
            Route.define("/renderer-cleanup/:id"),
            () => "project",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderError = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
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
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError,
            });
            disposeController = controller.dispose;
            node = () => currentNode.get();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.withComponent(
            Route.define("/renderer-failed-cleanup/:id"),
            () => "project",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderErrorSignal = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
              initialInput: {
                state,
                renderers: { pending: () => "pending-one" },
              },
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError: renderErrorSignal,
            });
            disposeController = controller.dispose;
            node = () => currentNode.get();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.withComponent(
            Route.define("/renderer-initial-failed-cleanup/:id"),
            () => "project",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderErrorSignal = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
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
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError: renderErrorSignal,
            });
            disposeController = controller.dispose;
            node = () => currentNode.get();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.withComponent(
            Route.define("/renderer-dispose-effect/:id"),
            () => "project",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderError = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
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
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError,
            });
            const controllerDisposeEffect: Effect.Effect<void> = controller.dispose();
            void controllerDisposeEffect;
            disposeController = controller.dispose;
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
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
            }),
          );
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/hydrating-projects/:id", {
            preload: () => Deferred.await(release),
          });
          let router: BrowserRouter<readonly [typeof ProjectRoute]> | undefined;
          const dispose = hydrate(() => {
            router = createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/hydrating-projects/atlas",
              runtime: eraseRuntime(runtime),
            });
            return undefined;
          }, document.createElement("div"));
          const hydratedRouter = router;
          if (hydratedRouter === undefined) {
            expect.fail("Expected the router to be created during hydration.");
          }
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sync(() => {
            expect(hydratedRouter.state()).toMatchObject({
              _tag: "Ready",
              href: "/hydrating-projects/atlas",
            });
          });

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(hydratedRouter.state()).toMatchObject({
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/server-projects/:id", {
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
                runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const ProjectRoute = Route.define("/post-hydration-projects/:id", {
            preload: () => Deferred.await(release),
          });
          let dispose: () => void = () => undefined;
          const router = createRoot(
            (rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
              dispose = rootDispose;
              return createBrowserRouter([ProjectRoute] as const, {
                initialHref: "/post-hydration-projects/atlas",
                runtime: eraseRuntime(runtime),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const ProjectById = Resource.define<string, { readonly id: string }>({
            name: "SolidRouter.pending-runtime-resource",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.preload(ref));

          const ProjectRoute = Route.withComponent(
            Route.define("/pending-runtime/:id", {
              preload: () => Deferred.await(release),
            }),
            () => "project",
          );
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/pending-runtime/atlas",
                    pending: () => Effect.runSync(Resource.status(ref)).result._tag,
                  });
                },
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const events: Array<string> = [];
          const OldRoute = Route.withComponent(Route.define("/old"), () => {
            events.push("old:setup");
            onDispose(() => Effect.sync(() => events.push("old:cleanup")));
            const element = document.createElement("span");
            element.textContent = "old";
            return element;
          });
          const NewRoute = Route.withComponent(Route.define("/new"), () => {
            events.push("new:setup");
            onDispose(() => Effect.sync(() => events.push("new:cleanup")));
            const element = document.createElement("span");
            element.textContent = "new";
            return element;
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/old",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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

  it("surfaces route render errors after navigation to the host ErrorBoundary", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const renderError = new Error("route render failed");
          const GoodRoute = Route.withComponent(Route.define("/render-good"), () => "good");
          const ThrowingRoute = Route.withComponent(Route.define("/render-throw"), () => {
            throw renderError;
          });
          const routes = [GoodRoute, ThrowingRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          let caught: unknown;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(Errored, {
              fallback: (error) => {
                caught = error();
                return "caught";
              },
              get children() {
                return createComponent(RouterOutlet, { router: useRouter() });
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/render-good",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const preloadFailure = "missing-project" as const;
          const GoodRoute = Route.withComponent(Route.define("/preload-good"), () => "good");
          const FailingRoute = Route.withComponent(
            Route.define("/preload-fail", {
              preload: () => Effect.fail(preloadFailure).pipe(Effect.asVoid),
            }),
            () => "never",
          );
          const routes = [GoodRoute, FailingRoute] as const;

          let router: BrowserRouter<typeof routes, RoutePreloadError> | undefined;
          let caught: unknown;
          const CaptureRouter = () => {
            router = useRouter<typeof routes, RoutePreloadError>();
            return createComponent(Errored, {
              fallback: (error) => {
                caught = error();
                return "failed";
              },
              get children() {
                return createComponent(RouterOutlet, { router: useRouter() });
              },
            });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/preload-good",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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
              // Solid 2's Errored passes the thrown value through: the router's typed Cause.
              expect(caught).toBe(state._tag === "Failure" ? state.cause : undefined);
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const FailingRoute = Route.withComponent(
            Route.define("/renderer-failure", {
              preload: () => Effect.fail("offline" as const).pipe(Effect.asVoid),
            }),
            () => "never",
          );
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
            const currentNode = Signal.make<JSX.Element>(undefined);
            const renderError = Signal.make<unknown>(undefined);
            const controller = makeSolidRouteRenderScopeController<typeof routes, "offline">({
              owner: getOwner(),
              initialInput: {
                state,
                renderers: { failure: () => "failure-one" },
              },
              runtime: eraseRuntime(runtime),
              node: currentNode,
              renderError,
            });
            node = () => currentNode.get();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const ProjectById = Resource.define<string, { readonly id: string }>({
            name: "SolidRouter.route-scope-runtime-disposal",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* runtime.provide(Resource.preload(ref));

          const OldRoute = Route.withComponent(Route.define("/scope-old"), () => {
            onDispose(() => Resource.evict(ref));
            return "old";
          });
          const NewRoute = Route.withComponent(Route.define("/scope-new"), () => "new");
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/scope-old",
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

          expect(router).toBeDefined();
          router!.navigateHref("/scope-new");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router!.state()).toMatchObject({ href: "/scope-new" })),
          );
          yield* Effect.sleep("20 millis");

          expect(
            runWithRuntime(runtime, () => Effect.runSync(Resource.status(ref)).result._tag),
          ).toBe("Initial");
        }),
      ),
    ));

  it("runs Solid route cleanup in the router runtime despite nested providers", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const routerRuntime = makeRuntime();
          const nestedRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(routerRuntime.dispose));
          yield* Effect.addFinalizer(() => Effect.orDie(nestedRuntime.dispose));

          const ProjectById = Resource.define<string, { readonly id: string }>({
            name: "SolidRouter.solid-cleanup-runtime",
            load: (id) => Effect.succeed({ id }),
          });
          const ref = ProjectById("atlas");
          yield* routerRuntime.provide(Resource.preload(ref));

          const cleanupStatuses: Array<string> = [];
          const OldRoute = Route.withComponent(Route.define("/solid-cleanup-runtime-old"), () => {
            onCleanup(() => {
              cleanupStatuses.push(Effect.runSync(Resource.status(ref)).result._tag);
            });
            return "old";
          });
          const NewRoute = Route.withComponent(
            Route.define("/solid-cleanup-runtime-new"),
            () => "new",
          );
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(routerRuntime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/solid-cleanup-runtime-old",
                    get children() {
                      return createComponent(RuntimeProvider, {
                        runtime: nestedRuntime,
                        get children() {
                          return createComponent(CaptureRouter, {});
                        },
                      });
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
          expect(
            runWithRuntime(nestedRuntime, () => Effect.runSync(Resource.status(ref)).result._tag),
          ).toBe("Initial");
        }),
      ),
    ));

  it("runs the previous Solid route cleanup before the next route setup", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const events: Array<string> = [];
          const OldRoute = Route.withComponent(Route.define("/solid-old"), () => {
            events.push("old:setup");
            onCleanup(() => {
              events.push("old:solid-cleanup");
            });
            const element = document.createElement("span");
            element.textContent = "old";
            return element;
          });
          const NewRoute = Route.withComponent(Route.define("/solid-new"), () => {
            events.push(`new:setup:${events.includes("old:solid-cleanup")}`);
            const element = document.createElement("span");
            element.textContent = "new";
            return element;
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/solid-old",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
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

  it("finishes async route-scope finalizers before the next route setup", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const events: Array<string> = [];
          const release = yield* Deferred.make<void>();
          const OldRoute = Route.withComponent(Route.define("/async-old"), () => {
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
          });
          const NewRoute = Route.withComponent(Route.define("/async-new"), () => {
            events.push(`new:setup:${events.includes("old:scope-start")}`);
            const element = document.createElement("span");
            element.textContent = "new";
            return element;
          });
          const routes = [OldRoute, NewRoute] as const;

          let router: BrowserRouter<typeof routes> | undefined;
          const CaptureRouter = () => {
            router = useRouter<typeof routes>();
            return createComponent(RouterOutlet, { router: useRouter() });
          };
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes,
                    initialHref: "/async-old",
                    get children() {
                      return createComponent(CaptureRouter, {});
                    },
                  });
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.promise(() => vi.waitFor(() => expect(events).toEqual(["old:setup"])));
          yield* Effect.sync(() => {
            router!.navigateHref("/async-new");
          });
          // Release before acquire: the next route waits for the previous route's
          // scope finalizers to finish, matching the controller's transition rule.
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(events).toEqual(["old:setup", "old:scope-start"])),
          );
          yield* Deferred.succeed(release, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(events).toEqual([
                "old:setup",
                "old:scope-start",
                "old:scope-done",
                "new:setup:true",
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const events: Array<string> = [];
          const RouteWithCleanup = Route.withComponent(Route.define("/cleanup"), () => {
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
          });

          const dispose = createRoot((rootDispose) => {
            resolveRendered(
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(runtime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [RouteWithCleanup] as const,
                    initialHref: "/cleanup",
                  });
                },
              }),
            );
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
          yield* Effect.addFinalizer(() => Effect.orDie(outerRuntime.dispose));
          yield* Effect.addFinalizer(() => Effect.orDie(innerRuntime.dispose));

          const ProjectById = Resource.define<
            string,
            { readonly id: string; readonly name: string }
          >({
            name: "SolidRouter.runtime-owned-route-resource",
            load: (id) => Effect.succeed({ id, name: "Atlas" }),
          });
          const ref = ProjectById("atlas");
          let renderedStatus: string | undefined;
          const ProjectRoute = Route.withComponent(
            Route.define("/runtime-projects/:id", {
              preload: () => Resource.preload(ref),
            }),
            () => {
              const status = Effect.runSync(Resource.status(ref)).result;
              renderedStatus = status._tag;
              const element = document.createElement("span");
              element.textContent = status._tag;
              return element;
            },
          );
          const container = document.createElement("div");
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime: eraseRuntime(outerRuntime),
                get children() {
                  return createComponent(RouterProvider, {
                    routes: [ProjectRoute] as const,
                    initialHref: "/runtime-projects/atlas",
                    get children() {
                      return createComponent(RuntimeProvider, {
                        runtime: innerRuntime,
                        get children() {
                          return createComponent(RouterOutlet, { router: useRouter() });
                        },
                      });
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

          expect(
            runWithRuntime(innerRuntime, () => Effect.runSync(Resource.status(ref)).result._tag),
          ).toBe("Initial");
        }),
      ),
    ));
});
