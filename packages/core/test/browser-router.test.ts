import { Cause, Context, Deferred, Effect, Fiber, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  browserRouteRenderDecision,
  browserRouteRenderIdentity,
  browserRouteRenderKey,
  browserRouterInitialMatchedState,
  createBrowserRouterHostController,
  createBrowserRouterKernel,
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  isPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  makeWindowBrowserHistoryAdapter,
  opensOutsideRouter,
  route,
  Route,
  type BrowserHistoryWindow,
  type BrowserHistoryAdapter,
  RouteNavigationError,
  RouterRouteNotRegistered,
  RoutePreloadError,
} from "../src/index.js";

describe("browser router kernel", () => {
  interface ProjectApi {
    readonly preload: (id: string) => Effect.Effect<void>;
  }

  const ProjectApi = Context.Service<ProjectApi>("@sunfall/arc-core/test/BrowserRouterProjectApi");

  it("shares router link click and preload decisions across framework adapters", () => {
    const plainClick = {
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as const;

    expect(isPlainLeftClick(plainClick)).toBe(true);
    expect(
      isPlainLeftClick({
        button: 0,
        metaKey: true,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(opensOutsideRouter("_blank", undefined)).toBe(true);
    expect(opensOutsideRouter("_self", undefined)).toBe(false);
    expect(opensOutsideRouter(undefined, false)).toBe(false);
    expect(opensOutsideRouter(undefined, null)).toBe(false);
    expect(opensOutsideRouter(undefined, "")).toBe(true);
    expect(opensOutsideRouter(undefined, true)).toBe(true);
    expect(
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: true,
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Preload" });
    expect(
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: false,
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Ignore", reason: "preload-disabled" });
    expect(
      browserRouterLinkPreloadDecision({
        defaultPrevented: true,
        preload: true,
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Ignore", reason: "default-prevented" });
    expect(
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: true,
        canHandleRoute: true,
        target: "_blank",
      }),
    ).toEqual({ _tag: "Ignore", reason: "browser-handled" });
    expect(
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: true,
        canHandleRoute: false,
      }),
    ).toEqual({ _tag: "Ignore", reason: "outside-router" });
    expect(
      browserRouterLinkPreloadIdentity({
        href: "/projects/atlas",
        preload: true,
        canHandleRoute: true,
      }),
    ).toEqual({
      key: "/projects/atlas\u0000true\u0000true\u0000\u0000",
      enabled: true,
    });
    expect(
      browserRouterLinkPreloadIdentity({
        href: "/projects/atlas",
        preload: true,
        canHandleRoute: true,
        download: false,
      }),
    ).toEqual({
      key: "/projects/atlas\u0000true\u0000true\u0000\u0000",
      enabled: true,
    });
    expect(
      browserRouterLinkPreloadIdentity({
        href: "/projects/atlas",
        preload: true,
        canHandleRoute: true,
        target: "_blank",
      }),
    ).toEqual({
      key: "/projects/atlas\u0000true\u0000true\u0000_blank\u0000",
      enabled: false,
    });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Navigate", href: "/projects/atlas" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        replace: true,
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Navigate", href: "/projects/atlas", options: { replace: true } });
    expect(
      browserRouterLinkClickDecision({
        event: { ...plainClick, defaultPrevented: true },
        href: "/projects/atlas",
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Ignore", reason: "default-prevented" });
    expect(
      browserRouterLinkClickDecision({
        event: { ...plainClick, metaKey: true },
        href: "/projects/atlas",
        canHandleRoute: true,
      }),
    ).toEqual({ _tag: "Ignore", reason: "non-plain-click" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: true,
        download: false,
      }),
    ).toEqual({ _tag: "Navigate", href: "/projects/atlas" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: true,
        download: null,
      }),
    ).toEqual({ _tag: "Navigate", href: "/projects/atlas" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: true,
        download: "",
      }),
    ).toEqual({ _tag: "Ignore", reason: "browser-handled" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: true,
        download: true,
      }),
    ).toEqual({ _tag: "Ignore", reason: "browser-handled" });
    expect(
      browserRouterLinkClickDecision({
        event: plainClick,
        href: "/projects/atlas",
        canHandleRoute: false,
      }),
    ).toEqual({ _tag: "Ignore", reason: "outside-router" });
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
      match: projectMatch,
    } as const;
    const readyDecision = browserRouteRenderDecision(ready);

    expect(browserRouteRenderKey(ready)).toBe("Ready:/render-projects/atlas:/render-projects/:id");
    expect(
      browserRouteRenderIdentity({
        state: ready,
        renderers: {},
        defaults: {
          pending: () => undefined,
          failure: () => undefined,
          notFound: () => undefined,
        },
      }),
    ).toBe(
      browserRouteRenderIdentity({
        state: ready,
        renderers: {},
        defaults: {
          pending: () => undefined,
          failure: () => undefined,
          notFound: () => undefined,
        },
      }),
    );
    expect(readyDecision).toMatchObject({
      _tag: "Ready",
      component,
      props: {
        params: { id: "atlas" },
        search: {},
      },
    });

    const emptyDecision = browserRouteRenderDecision({
      _tag: "Ready",
      href: "/empty-render-route",
      match: emptyMatch,
    });
    expect(emptyDecision).toMatchObject({ _tag: "Empty" });

    const notFound = {
      _tag: "NotFound",
      href: "/missing",
    } as const;
    const notFoundRenderer = () => undefined;
    const nextNotFoundRenderer = () => undefined;
    expect(browserRouteRenderDecision(notFound)).toMatchObject({ _tag: "NotFound" });
    expect(
      browserRouteRenderIdentity({
        state: notFound,
        renderers: { notFound: notFoundRenderer },
        defaults: {
          pending: () => undefined,
          failure: () => undefined,
          notFound: () => undefined,
        },
      }),
    ).not.toBe(
      browserRouteRenderIdentity({
        state: notFound,
        renderers: { notFound: nextNotFoundRenderer },
        defaults: {
          pending: () => undefined,
          failure: () => undefined,
          notFound: () => undefined,
        },
      }),
    );
  });

  it("preloads lazy route component chunks with route preload work", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const component = () => undefined;
        let imports = 0;
        const lazyComponent = Route.lazyComponent(
          Effect.sync(() => {
            imports++;
            return { default: component };
          }),
        );
        const Project = route("/lazy-components/:id", {
          component: lazyComponent,
        });
        const router = createBrowserRouterKernel([Project] as const, {
          runtime: makeRuntime(),
          initialHref: "/lazy-components/atlas",
        });

        yield* router.preloadEffect(Project, { params: { id: "atlas" } });
        yield* router.preloadEffect(Project, { params: { id: "atlas" } });

        expect(imports).toBe(1);
        expect(Route.readComponent(lazyComponent)).toBe(component);
      }),
    ));

  it("forks lazy route component pending work for framework Suspense adapters", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const release = yield* Deferred.make<void>();
          const component = () => undefined;
          let imports = 0;
          const lazyComponent = Route.lazyComponent(
            Effect.gen(function* () {
              imports++;
              yield* Deferred.await(release);
              return { default: component };
            }),
          );

          let thrown: unknown;
          try {
            Route.readComponent(lazyComponent);
          } catch (error) {
            thrown = error;
          }

          const firstFiber = Route.forkLazyComponentSuspense(thrown, runtime);
          const secondFiber = Route.forkLazyComponentSuspense(thrown, runtime);
          expect(firstFiber).toBeDefined();
          expect(secondFiber).toBeDefined();
          expect(
            Route.forkLazyComponentSuspense(new Error("not lazy pending"), runtime),
          ).toBeUndefined();
          expect(imports).toBe(1);

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(firstFiber!);
          yield* Fiber.join(secondFiber!);
          expect(Route.readComponent(lazyComponent)).toBe(component);
        }),
      ),
    ));

  it("does not fork lazy route component Suspense work after load failure", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const lazyComponent = Route.lazyComponent(
            Effect.fail(new Error("chunk failed")) as Effect.Effect<
              Route.LazyComponentModule<() => undefined>,
              unknown
            >,
          );

          let pending: unknown;
          try {
            Route.readComponent(lazyComponent);
          } catch (error) {
            pending = error;
          }

          const fiber = Route.forkLazyComponentSuspense(pending, runtime);
          expect(fiber).toBeDefined();
          yield* Effect.exit(Fiber.join(fiber!));

          let failed: unknown;
          try {
            Route.readComponent(lazyComponent);
          } catch (error) {
            failed = error;
          }
          expect(Route.forkLazyComponentSuspense(failed, runtime)).toBeUndefined();
        }),
      ),
    ));

  it("shares initial matched state policy across framework adapters", () => {
    const Project = route("/initial-projects/:id");
    const routes = [Project] as const;
    const match = Project.match("/initial-projects/atlas");
    expect(match).toBeDefined();

    expect(
      browserRouterInitialMatchedState({
        href: "/initial-projects/atlas",
        match: match!,
        host: "server",
      }),
    ).toMatchObject({ _tag: "Ready" });
    expect(
      browserRouterInitialMatchedState({
        href: "/initial-projects/atlas",
        match: match!,
        host: "browser",
        hydrating: true,
      }),
    ).toMatchObject({ _tag: "Ready" });
    expect(
      browserRouterInitialMatchedState<typeof routes>({
        href: "/initial-projects/atlas",
        match: match!,
        host: "browser",
      }),
    ).toMatchObject({ _tag: "Pending" });
  });

  it("maps router hrefs through the history adapter for browser-visible anchors", () => {
    const Project = route("/browser-href-projects/:id");
    const memory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
    const history: BrowserHistoryAdapter = {
      ...memory,
      createHref: (href) => `/project-docs${href}`,
    };
    const router = createBrowserRouterHostController([Project] as const, {
      history,
      runtime: makeRuntime(),
    });
    const href = router.href(Project, { params: { id: "atlas" } });

    expect(href).toBe("/browser-href-projects/atlas");
    expect(router.createHref(href)).toBe("/project-docs/browser-href-projects/atlas");
    router.navigate(Project, { params: { id: "atlas" } });
    expect(memory.entries()).toEqual(["/", "/browser-href-projects/atlas"]);
    router.dispose();
  });

  it("does not re-preload an initial Ready hydration state when host listening starts", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let preloads = 0;
          const Project = route("/hydrated-router", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/hydrated-router" });
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime,
            initialMatchedState: (href, match) => ({ _tag: "Ready", href, match }),
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.start();
          yield* Effect.sleep("10 millis");

          expect(router.state.get()).toMatchObject({
            _tag: "Ready",
            href: "/hydrated-router",
          });
          expect(preloads).toBe(0);
        }),
      ),
    ));

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
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push(current);
                  }),
                ),
              );
            },
          });

          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1])));

          preloader.preload();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(starts).toEqual([1, 2]);
              expect(finalizers).toEqual([1]);
            }),
          );

          enabled = false;
          preloader.preload();
          expect(starts).toEqual([1, 2]);

          yield* preloader.interruptEffect();
          expect(finalizers).toEqual([1, 2]);
        }),
      ),
    ));

  it("captures router link hover preload owners before queued sync interruptions execute", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const baseRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => baseRuntime.disposeEffect);
          const queuedInterrupts: Array<Effect.Effect<void>> = [];
          let queueNextInterrupt = false;
          const runtime: typeof baseRuntime = {
            ...baseRuntime,
            runFork: <A, E, R>(
              effect: Effect.Effect<A, E, R>,
              options?: Effect.RunOptions,
            ): Fiber.Fiber<A, E> => {
              if (queueNextInterrupt) {
                queueNextInterrupt = false;
                queuedInterrupts.push(effect as Effect.Effect<void>);
                return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
              }
              return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
            },
          };
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime,
            enabled: () => true,
            preloadEffect: () => {
              const current = ++revision;
              return Effect.sync(() => {
                starts.push(current);
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push(current);
                  }),
                ),
              );
            },
          });

          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1])));

          queueNextInterrupt = true;
          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1, 2])));
          expect(queuedInterrupts).toHaveLength(1);

          yield* queuedInterrupts[0]!;
          expect(finalizers).toEqual([1]);

          yield* preloader.interruptEffect();
          expect(finalizers).toEqual([1, 2]);
        }),
      ),
    ));

  it("swallows router link hover preload defects", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const baseRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => baseRuntime.disposeEffect);
          let preloadFiber: Fiber.Fiber<void, unknown> | undefined;
          const runtime: typeof baseRuntime = {
            ...baseRuntime,
            runFork: (effect, options) => {
              const fiber = baseRuntime.runFork(effect, options);
              preloadFiber = fiber as Fiber.Fiber<void, unknown>;
              return fiber;
            },
          };
          const preloader = makeBrowserRouterLinkPreloader({
            runtime,
            enabled: () => true,
            preloadEffect: () => Effect.die("link preload defect"),
          });

          preloader.preload();

          if (preloadFiber === undefined) {
            expect.fail("Expected hover preload to fork.");
          }
          const exit = yield* Effect.exit(Fiber.join(preloadFiber));
          expect(exit._tag).toBe("Success");
        }),
      ),
    ));

  it("interrupts router link hover preloads when the target changes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime,
            enabled: () => true,
            preloadEffect: () => {
              const current = ++revision;
              return Effect.sync(() => {
                starts.push(current);
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push(current);
                  }),
                ),
              );
            },
          });

          preloader.bindPreloadIdentity({ key: "/projects/atlas", enabled: true });
          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1])));

          preloader.bindPreloadIdentity({ key: "/projects/curie", enabled: true });
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(starts).toEqual([1]);
              expect(finalizers).toEqual([1]);
            }),
          );

          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1, 2])));
          preloader.bindPreloadIdentity({ key: "/projects/curie", enabled: true });
          yield* Effect.sleep("20 millis");
          expect(finalizers).toEqual([1]);
        }),
      ),
    ));

  it("interrupts router link hover preloads when preload identity becomes disabled", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime,
            enabled: () => true,
            preloadEffect: () => {
              const current = ++revision;
              return Effect.sync(() => {
                starts.push(current);
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push(current);
                  }),
                ),
              );
            },
          });

          preloader.bindPreloadIdentity({ key: "/projects/atlas|preload", enabled: true });
          preloader.preload();
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual([1])));

          preloader.bindPreloadIdentity({ key: "/projects/atlas|preload", enabled: false });
          yield* Effect.promise(() => vi.waitFor(() => expect(finalizers).toEqual([1])));

          preloader.preload();
          yield* Effect.sleep("20 millis");
          expect(starts).toEqual([1]);
        }),
      ),
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
        },
      },
      history: {
        pushState: (_data, _unused, url) => {
          href = String(url);
          pushes.push(href);
        },
        replaceState: (_data, _unused, url) => {
          href = String(url);
          replaces.push(href);
        },
      },
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
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
    expect(history.commit("/initial")).toBe("/initial");
    expect(history.entries()).toEqual(["/initial"]);
    expect(history.commit("/next")).toBe("/next");
    expect(history.commit("/replacement", { replace: true })).toBe("/replacement");
    expect(externalHrefs).toEqual([]);
    history.externalNavigate("/external");
    expect(externalHrefs).toEqual(["/external"]);
    expect(history.entries()).toEqual(["/initial", "/replacement", "/external"]);
  });

  it("retries same-href preloads through memory history without pushing an entry", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let attempts = 0;
          const Project = route("/memory-retry", {
            preload: () =>
              Effect.gen(function* () {
                attempts++;
                if (attempts === 1) {
                  return yield* Effect.fail("offline");
                }
              }),
          });
          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/memory-retry" });
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.start();
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Failure",
                href: "/memory-retry",
              });
              expect(attempts).toBe(1);
            }),
          );

          router.navigateHref("/memory-retry");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/memory-retry",
              });
              expect(attempts).toBe(2);
            }),
          );
          expect(history.entries()).toEqual(["/memory-retry"]);
        }),
      ),
    ));

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
            },
          };
          const externalNavigate = (nextHref: string): void => {
            href = nextHref;
            entries.push(href);
            listeners.forEach((listener) => listener(href));
          };

          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime,
          });
          const stop = router.start();
          const secondStop = router.start();

          expect(listens).toBe(1);
          secondStop();
          expect(stops).toBe(0);

          router.navigate(Project, { params: { id: "lumen" } });
          expect(entries).toEqual(["/host-projects/atlas", "/host-projects/lumen"]);
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/lumen",
          });

          router.navigateByPath(
            "/host-projects/:id",
            { params: { id: "orion" } },
            { replace: true },
          );
          expect(entries).toEqual(["/host-projects/atlas", "/host-projects/orion"]);

          externalNavigate("/host-projects/vega");
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/vega",
          });

          stop();
          expect(stops).toBe(1);
          externalNavigate("/host-projects/ignored");
          expect(router.state.get()).toMatchObject({
            href: "/host-projects/vega",
          });
        }),
      ),
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
              }),
          });
          const ProjectSettings = route("/projects/settings", {
            preload: () =>
              Effect.sync(() => {
                preloaded.push("settings");
              }),
          });
          const routes = [Project, ProjectSettings] as const;
          const router = createBrowserRouterKernel(routes, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          yield* router.preloadEffect(Project, { params: { id: "settings" } });
          expect(preloaded).toEqual(["settings"]);

          router.navigateHref("/projects/settings");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/projects/settings",
              });
            }),
          );
          expect(router.matchByPath("/projects/settings")?.route).toBe(ProjectSettings);
          expect(preloaded).toEqual(["settings", "settings"]);
        }),
      ),
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
              }),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/retry-projects/atlas",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/retry-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Failure",
                href: "/retry-projects/atlas",
              });
              expect(attempts).toBe(1);
            }),
          );

          router.navigateHref("/retry-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/retry-projects/atlas",
              });
              expect(attempts).toBe(2);
            }),
          );
        }),
      ),
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
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers++;
                  }),
                ),
              ),
          });
          const Fast = route("/fast");
          const router = createBrowserRouterKernel([Slow, Fast] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));
          router.navigateHref("/fast");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(finalizers).toBe(1);
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/fast",
              });
            }),
          );
        }),
      ),
    ));

  it("captures navigation preload owners before queued sync disposal executes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const baseRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => baseRuntime.disposeEffect);
          const queuedDisposals: Array<Effect.Effect<void>> = [];
          let queueNextDisposal = false;
          const runtime: typeof baseRuntime = {
            ...baseRuntime,
            runFork: <A, E, R>(
              effect: Effect.Effect<A, E, R>,
              options?: Effect.RunOptions,
            ): Fiber.Fiber<A, E> => {
              if (queueNextDisposal) {
                queueNextDisposal = false;
                queuedDisposals.push(effect as Effect.Effect<void>);
                return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
              }
              return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
            },
          };
          const starts: Array<string> = [];
          const finalizers: Array<string> = [];
          const Slow = route("/queued-owner-slow", {
            preload: () =>
              Effect.sync(() => {
                starts.push("slow");
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push("slow");
                  }),
                ),
              ),
          });
          const Next = route("/queued-owner-next", {
            preload: () =>
              Effect.sync(() => {
                starts.push("next");
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push("next");
                  }),
                ),
              ),
          });
          const router = createBrowserRouterKernel([Slow, Next] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/queued-owner-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual(["slow"])));

          queueNextDisposal = true;
          router.navigateHref("/queued-owner-next");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual(["slow", "next"])));
          expect(queuedDisposals).toHaveLength(1);

          yield* queuedDisposals[0]!;
          expect(finalizers).toEqual(["slow"]);

          yield* router.disposeEffect();
          expect(finalizers).toEqual(["slow", "next"]);
        }),
      ),
    ));

  it("outside-route navigate interrupts active navigation preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const release = yield* Deferred.make<void>();
          let starts = 0;
          let finalizers = 0;
          const Slow = route("/outside-route-slow", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers++;
                  }),
                ),
              ),
          });
          const Outside = route("/outside-route-target");
          const router = createBrowserRouterKernel([Slow] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/outside-route-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));

          // @ts-expect-error outside route intentionally violates the configured router tuple
          router.navigate(Outside, router.navigateHref);
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(finalizers).toBe(1);
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeInstanceOf(RouteNavigationError);
                expect((state.error as RouteNavigationError).cause).toBeInstanceOf(
                  RouterRouteNotRegistered,
                );
              }
            }),
          );

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");
          expect(router.state.get()._tag).toBe("Failure");
        }),
      ),
    ));

  it("outside-path navigate interrupts active navigation preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const release = yield* Deferred.make<void>();
          let starts = 0;
          let finalizers = 0;
          const Slow = route("/outside-path-slow", {
            preload: () =>
              Effect.sync(() => {
                starts++;
              }).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers++;
                  }),
                ),
              ),
          });
          const router = createBrowserRouterKernel([Slow] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/outside-path-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));

          // @ts-expect-error outside path intentionally violates the configured router tuple
          router.navigateByPath("/outside-path-target", router.navigateHref);
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(finalizers).toBe(1);
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeInstanceOf(RouteNavigationError);
                expect((state.error as RouteNavigationError).cause).toBeInstanceOf(
                  RouterRouteNotRegistered,
                );
              }
            }),
          );

          yield* Deferred.succeed(release, undefined);
          yield* Effect.sleep("20 millis");
          expect(router.state.get()._tag).toBe("Failure");
        }),
      ),
    ));

  it("disposeEffect interrupts current navigation preload before completing", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          let starts = 0;
          let finalizers = 0;
          const Slow = route("/dispose-slow", {
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
          const router = createBrowserRouterKernel([Slow] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/dispose-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));

          yield* router.disposeEffect();
          expect(finalizers).toBe(1);
        }),
      ),
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
              }),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          const preloadExit = yield* Effect.exit(
            // @ts-expect-error outside route intentionally violates the configured router tuple
            router.preloadEffect(Outside, { params: { id: "atlas" } }),
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
            expect((state.error as RouteNavigationError).cause).toBeInstanceOf(
              RouterRouteNotRegistered,
            );
          }
        }),
      ),
    ));

  it("keeps typed preload failures in router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/failure-projects/:id", {
            preload: () => Effect.fail("missing-project"),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/failure-projects/atlas",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

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
                  cause: "missing-project",
                });
                expect(state.cause.reasons.find(Cause.isFailReason)?.error).toBe(state.error);
              }
            }),
          );
        }),
      ),
    ));

  it("keeps erased Promise-shaped preload failures in router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/promise-failure-projects/:id", {
            preload: () => Promise.resolve(undefined) as never,
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/promise-failure-projects/atlas",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          router.navigateHref("/promise-failure-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeInstanceOf(RoutePreloadError);
                expect((state.error as RoutePreloadError).cause).toBeInstanceOf(
                  EffectInputCallbackError,
                );
                expect(
                  ((state.error as RoutePreloadError).cause as EffectInputCallbackError).cause,
                ).toBeInstanceOf(EffectInputPromiseRejected);
              }
            }),
          );
        }),
      ),
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
                }),
            }),
          );
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const Project = route("/path-projects/:id", {
            preload: ({ params }) => ProjectApi.use((api) => api.preload(params.id)),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/missing",
            runtime,
          });
          yield* Effect.addFinalizer(() => router.disposeEffect());

          expect(
            router.hrefByPath("/path-projects/:id", {
              params: { id: "atlas" },
            }),
          ).toBe("/path-projects/atlas");
          yield* router.preloadByPathEffect("/path-projects/:id", {
            params: { id: "atlas" },
          });

          expect(preloaded).toEqual(["atlas"]);
        }),
      ),
    ));
});
