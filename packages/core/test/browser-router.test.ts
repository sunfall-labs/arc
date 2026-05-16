import { Cause, Context, Deferred, Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouteRenderDecision,
  browserRouteRenderKey,
  createBrowserRouterHostController,
  createBrowserRouterKernel,
  isPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  makeWindowBrowserHistoryAdapter,
  opensOutsideRouter,
  route,
  type BrowserHistoryWindow,
  type BrowserHistoryAdapter,
  RouteNavigationError,
  RouterRouteNotRegistered,
  RoutePreloadError
} from "../src/index.js";

describe("browser router kernel", () => {
  interface ProjectApi {
    readonly preload: (id: string) => Effect.Effect<void>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@effect-ui/core/test/BrowserRouterProjectApi");

  it("shares router link click and preload decisions across framework adapters", () => {
    const plainClick = {
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false
    } as const;

    expect(isPlainLeftClick(plainClick)).toBe(true);
    expect(isPlainLeftClick({
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false
    })).toBe(false);
    expect(opensOutsideRouter("_blank", undefined)).toBe(true);
    expect(opensOutsideRouter("_self", undefined)).toBe(false);
    expect(opensOutsideRouter(undefined, "")).toBe(true);
    expect(browserRouterLinkPreloadDecision({
      defaultPrevented: false,
      preload: true,
      canHandleRoute: true
    })).toEqual({ _tag: "Preload" });
    expect(browserRouterLinkPreloadDecision({
      defaultPrevented: false,
      preload: false,
      canHandleRoute: true
    })).toEqual({ _tag: "Ignore", reason: "preload-disabled" });
    expect(browserRouterLinkPreloadDecision({
      defaultPrevented: true,
      preload: true,
      canHandleRoute: true
    })).toEqual({ _tag: "Ignore", reason: "default-prevented" });
    expect(browserRouterLinkPreloadDecision({
      defaultPrevented: false,
      preload: true,
      canHandleRoute: true,
      target: "_blank"
    })).toEqual({ _tag: "Ignore", reason: "browser-handled" });
    expect(browserRouterLinkPreloadDecision({
      defaultPrevented: false,
      preload: true,
      canHandleRoute: false
    })).toEqual({ _tag: "Ignore", reason: "outside-router" });
    expect(browserRouterLinkClickDecision({
      event: plainClick,
      href: "/projects/atlas",
      canHandleRoute: true
    })).toEqual({ _tag: "Navigate", href: "/projects/atlas" });
    expect(browserRouterLinkClickDecision({
      event: plainClick,
      href: "/projects/atlas",
      replace: true,
      canHandleRoute: true
    })).toEqual({ _tag: "Navigate", href: "/projects/atlas", options: { replace: true } });
    expect(browserRouterLinkClickDecision({
      event: { ...plainClick, defaultPrevented: true },
      href: "/projects/atlas",
      canHandleRoute: true
    })).toEqual({ _tag: "Ignore", reason: "default-prevented" });
    expect(browserRouterLinkClickDecision({
      event: { ...plainClick, metaKey: true },
      href: "/projects/atlas",
      canHandleRoute: true
    })).toEqual({ _tag: "Ignore", reason: "non-plain-click" });
    expect(browserRouterLinkClickDecision({
      event: plainClick,
      href: "/projects/atlas",
      canHandleRoute: true,
      download: ""
    })).toEqual({ _tag: "Ignore", reason: "browser-handled" });
    expect(browserRouterLinkClickDecision({
      event: plainClick,
      href: "/projects/atlas",
      canHandleRoute: false
    })).toEqual({ _tag: "Ignore", reason: "outside-router" });
  });

  it("shares route render decisions across framework adapters", () => {
    const component = () => undefined;
    const Project = route("/render-projects/:id", { component });
    const Empty = route("/empty-render-route");
    const projectMatch = Project.match("/render-projects/atlas");
    const emptyMatch = Empty.match("/empty-render-route");

    if (!projectMatch || !emptyMatch) {
      expect.fail("Expected test routes to match.");
    }

    const ready = {
      _tag: "Ready",
      href: "/render-projects/atlas",
      match: projectMatch
    } as const;
    const readyDecision = browserRouteRenderDecision(ready);

    expect(browserRouteRenderKey(ready)).toBe("Ready:/render-projects/atlas:/render-projects/:id");
    expect(readyDecision).toMatchObject({
      _tag: "Ready",
      component,
      props: {
        params: { id: "atlas" },
        search: {}
      }
    });

    const emptyDecision = browserRouteRenderDecision({
      _tag: "Ready",
      href: "/empty-render-route",
      match: emptyMatch
    });
    expect(emptyDecision).toMatchObject({ _tag: "Empty" });

    expect(browserRouteRenderDecision({
      _tag: "NotFound",
      href: "/missing"
    })).toMatchObject({ _tag: "NotFound" });
  });

  it("shares router link hover preload interruption across framework adapters", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let enabled = true;
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime,
            enabled: () => enabled,
            preloadEffect: () => {
              const current = ++revision;
              return Effect.sync(() => {
                starts.push(current);
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Effect.sync(() => {
                  finalizers.push(current);
                }))
              );
            }
          });

          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1])));

          preloader.preload();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(starts).toEqual([1, 2]);
              expect(finalizers).toEqual([1]);
            })
          );

          enabled = false;
          preloader.preload();
          expect(starts).toEqual([1, 2]);

          preloader.interrupt();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(finalizers).toEqual([1, 2]);
            })
          );
        })
      )
    ));

  it("centralizes browser history adapter commit and popstate policy", () => {
    let href = "/initial";
    const pushes: string[] = [];
    const replaces: string[] = [];
    const listeners = new Set<() => void>();
    const path = (): string => href.split("?")[0] ?? "/";
    const search = (): string => {
      const index = href.indexOf("?");
      return index >= 0 ? href.slice(index) : "";
    };
    const windowLike: BrowserHistoryWindow = {
      location: {
        get pathname() {
          return path();
        },
        get search() {
          return search();
        }
      },
      history: {
        pushState: (_data, _unused, url) => {
          href = String(url);
          pushes.push(href);
        },
        replaceState: (_data, _unused, url) => {
          href = String(url);
          replaces.push(href);
        }
      },
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      }
    };
    const history = makeWindowBrowserHistoryAdapter(() => windowLike);
    const externalHrefs: string[] = [];
    const stop = history.listen((nextHref) => {
      externalHrefs.push(nextHref);
    });

    expect(history.currentHref()).toBe("/initial");
    expect(history.commit("/initial")).toBe("/initial");
    expect(pushes).toEqual([]);
    expect(history.commit("/next?tab=activity")).toBe("/next?tab=activity");
    expect(pushes).toEqual(["/next?tab=activity"]);
    expect(history.commit("/replacement", { replace: true })).toBe("/replacement");
    expect(replaces).toEqual(["/replacement"]);

    href = "/external?from=pop";
    listeners.forEach((listener) => listener());
    expect(externalHrefs).toEqual(["/external?from=pop"]);
    stop();
    href = "/ignored";
    listeners.forEach((listener) => listener());
    expect(externalHrefs).toEqual(["/external?from=pop"]);
  });

  it("provides a memory browser history adapter for router tests", () => {
    const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/initial" });
    const externalHrefs: string[] = [];
    history.listen((href) => {
      externalHrefs.push(href);
    });

    expect(history.currentHref()).toBe("/initial");
    expect(history.commit("/next")).toBe("/next");
    expect(history.commit("/replacement", { replace: true })).toBe("/replacement");
    expect(externalHrefs).toEqual([]);
    history.externalNavigate("/external");
    expect(externalHrefs).toEqual(["/external"]);
    expect(history.entries()).toEqual(["/initial", "/replacement", "/external"]);
  });

  it("centralizes host controller start, navigation, replace, and disposal policy", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/host-projects/:id");
          let href = "/host-projects/atlas";
          let listens = 0;
          let stops = 0;
          const entries = [href];
          const listeners = new Set<(nextHref: string) => void>();
          const history: BrowserHistoryAdapter = {
            currentHref: () => href,
            listen: (onChange: (nextHref: string) => void) => {
              listens++;
              listeners.add(onChange);
              return () => {
                stops++;
                listeners.delete(onChange);
              };
            },
            commit: (nextHref: string, options = {}) => {
              href = nextHref;
              if (options.replace) {
                entries[entries.length - 1] = href;
              } else {
                entries.push(href);
              }
              return href;
            }
          };
          const externalNavigate = (nextHref: string): void => {
            href = nextHref;
            entries.push(href);
            listeners.forEach((listener) => listener(href));
          };

          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime
          });
          const stop = router.start();
          const secondStop = router.start();

          expect(listens).toBe(1);
          secondStop();
          expect(stops).toBe(0);

          router.navigate(Project, { params: { id: "lumen" } });
          expect(entries).toEqual(["/host-projects/atlas", "/host-projects/lumen"]);
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/lumen"
          });

          router.navigateByPath("/host-projects/:id", { params: { id: "orion" } }, { replace: true });
          expect(entries).toEqual(["/host-projects/atlas", "/host-projects/orion"]);

          externalNavigate("/host-projects/vega");
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/vega"
          });

          stop();
          expect(stops).toBe(1);
          externalNavigate("/host-projects/ignored");
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/vega"
          });
        })
      )
    ));

  it("preloads shadowed hrefs with the same route match as navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: string[] = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(`project:${params.id}`);
              })
          });
          const ProjectSettings = route("/projects/settings", {
            preload: () =>
              Effect.sync(() => {
                preloaded.push("settings");
              })
          });
          const routes = [Project, ProjectSettings] as const;
          const router = createBrowserRouterKernel(routes, {
            initialHref: "/missing",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          yield* router.preloadEffect(Project, { params: { id: "settings" } });
          expect(preloaded).toEqual(["settings"]);

          router.navigateHref("/projects/settings");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/projects/settings"
              });
            })
          );
          expect(router.matchByPath("/projects/settings")?.route).toBe(ProjectSettings);
          expect(preloaded).toEqual(["settings", "settings"]);
        })
      )
    ));

  it("retries the current href preload when navigating to the same href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let attempts = 0;
          const Project = route("/retry-projects/:id", {
            preload: () =>
              Effect.gen(function* () {
                attempts++;
                if (attempts === 1) {
                  return yield* Effect.fail("offline");
                }
              })
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/retry-projects/atlas",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          router.navigateHref("/retry-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Failure",
                href: "/retry-projects/atlas"
              });
              expect(attempts).toBe(1);
            })
          );

          router.navigateHref("/retry-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/retry-projects/atlas"
              });
              expect(attempts).toBe(2);
            })
          );
        })
      )
    ));

  it("interrupts stale navigation preloads", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let starts = 0;
          let finalizers = 0;
          const Slow = route("/slow", {
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
          const Fast = route("/fast");
          const router = createBrowserRouterKernel([Slow, Fast] as const, {
            initialHref: "/missing",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          router.navigateHref("/slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));
          router.navigateHref("/fast");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(finalizers).toBe(1);
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/fast"
              });
            })
          );
        })
      )
    ));

  it("rejects routes outside router.routes before running preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: string[] = [];
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/router-projects/:id");
          const Outside = route("/outside-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              })
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/missing",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          const preloadExit = yield* Effect.exit(
            // @ts-expect-error outside route intentionally violates the configured router tuple
            router.preloadEffect(Outside, { params: { id: "atlas" } })
          );
          expect(preloaded).toEqual([]);
          expect(preloadExit._tag).toBe("Failure");
          if (preloadExit._tag === "Failure") {
            const error = preloadExit.cause.reasons.find(Cause.isFailReason)?.error;
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect((error as RouteNavigationError).cause).toBeInstanceOf(RouterRouteNotRegistered);
          }

          // @ts-expect-error outside route intentionally violates the configured router tuple
          router.navigate(Outside, router.navigateHref, { params: { id: "atlas" } });
          expect(preloaded).toEqual([]);
          const state = router.state.get();
          expect(state._tag).toBe("Failure");
          if (state._tag === "Failure") {
            expect(state.error).toBeInstanceOf(RouteNavigationError);
            expect((state.error as RouteNavigationError).cause).toBeInstanceOf(RouterRouteNotRegistered);
          }
        })
      )
    ));

  it("keeps typed preload failures in router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/failure-projects/:id", {
            preload: () => Effect.fail("missing-project")
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/failure-projects/atlas",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          router.navigateHref("/failure-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeInstanceOf(RoutePreloadError);
                expect(state.error).toMatchObject({
                  path: "/failure-projects/:id",
                  href: "/failure-projects/atlas",
                  cause: "missing-project"
                });
                expect(state.cause.reasons.find(Cause.isFailReason)?.error).toBe(state.error);
              }
            })
          );
        })
      )
    ));

  it("binds public preloadByPathEffect to the router runtime", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const preloaded: string[] = [];
          const runtime = makeRuntime(
            Layer.succeed(ProjectApi)({
              preload: (id) =>
                Effect.sync(() => {
                  preloaded.push(id);
                })
            })
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/path-projects/:id", {
            preload: ({ params }) => ProjectApi.use((api) => api.preload(params.id))
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/missing",
            runtime
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => router.dispose()));

          expect(router.hrefByPath("/path-projects/:id", {
            params: { id: "atlas" }
          })).toBe("/path-projects/atlas");
          yield* router.preloadByPathEffect("/path-projects/:id", {
            params: { id: "atlas" }
          });

          expect(preloaded).toEqual(["atlas"]);
        })
      )
    ));
});
