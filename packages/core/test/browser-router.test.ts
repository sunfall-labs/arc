import { Cause, Context, Deferred, Effect, Fiber, Schema } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createBrowserRouterHostController,
  EffectInputPromiseRejected,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Route,
  type BrowserHistoryWindow,
  type BrowserHistoryAdapter,
  RouteNavigationError,
  RouterRouteNotRegistered,
  RoutePreloadError,
} from "../src/index.js";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  browserRouteRenderDecision,
  browserRouteRenderIdentity,
  browserRouteRenderKey,
  browserRouterInitialMatchedState,
  createBrowserRouterKernel,
  eraseRuntime,
  isPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  makeWindowBrowserHistoryAdapter,
  opensOutsideRouter,
} from "../src/internal.js";

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
    const Project = Route.withComponent(Route.define("/render-projects/:id"), component);
    const Empty = Route.define("/empty-render-route");
    const projectMatch = Route.match([Project], "/render-projects/atlas");
    const emptyMatch = Route.match([Empty], "/empty-render-route");

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

    // `Route.withComponent(route, component, props)` maps the route props.
    const MappedProject = Route.withComponent(
      Route.define("/mapped-render-projects/:id"),
      (props: { readonly projectId: string }) => props.projectId,
      ({ params }) => ({ projectId: params.id }),
    );
    const mappedMatch = Route.match([MappedProject], "/mapped-render-projects/atlas")!;
    expect(
      browserRouteRenderDecision({
        _tag: "Ready",
        href: "/mapped-render-projects/atlas",
        match: mappedMatch,
      }),
    ).toMatchObject({ _tag: "Ready", props: { projectId: "atlas" } });

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
        const Project = Route.withComponent(Route.define("/lazy-components/:id"), lazyComponent);
        const router = createBrowserRouterKernel([Project] as const, {
          runtime: eraseRuntime(makeRuntime()),
          initialHref: "/lazy-components/atlas",
        });

        yield* router.preload(Project, { params: { id: "atlas" } });
        yield* router.preload(Project, { params: { id: "atlas" } });

        expect(imports).toBe(1);
        expect(Route.readComponent(lazyComponent)).toBe(component);
      }),
    ));

  it("preloads the lazy component a withComponent copy attaches from the source route's match", () =>
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
        // File routes carry no component; the app attaches it to a copy.
        const Project = Route.define("/attached-lazy-components/:id");
        const Unrelated = Route.define("/unattached-components/:id");
        Route.withComponent(
          Route.withComponent(Project, () => "eager"),
          lazyComponent,
        );

        const unrelated = Route.match([Unrelated], "/unattached-components/atlas");
        const project = Route.match([Project], "/attached-lazy-components/atlas");
        if (unrelated === undefined || project === undefined) {
          return expect.fail("expected both routes to match");
        }
        yield* Route.preloadComponent(unrelated);
        expect(imports).toBe(0);
        yield* Route.preloadComponent(project);
        expect(imports).toBe(1);
        expect(Route.readComponent(lazyComponent)).toBe(component);
      }),
    ));

  it("forks lazy route component pending work for framework Suspense adapters", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
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

          const firstFiber = Route.forkLazyComponentSuspense(thrown, eraseRuntime(runtime));
          const secondFiber = Route.forkLazyComponentSuspense(thrown, eraseRuntime(runtime));
          expect(firstFiber).toBeDefined();
          expect(secondFiber).toBeDefined();
          expect(
            Route.forkLazyComponentSuspense(new Error("not lazy pending"), eraseRuntime(runtime)),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
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

          const fiber = Route.forkLazyComponentSuspense(pending, eraseRuntime(runtime));
          expect(fiber).toBeDefined();
          yield* Effect.exit(Fiber.join(fiber!));

          let failed: unknown;
          try {
            Route.readComponent(lazyComponent);
          } catch (error) {
            failed = error;
          }
          expect(Route.forkLazyComponentSuspense(failed, eraseRuntime(runtime))).toBeUndefined();
        }),
      ),
    ));

  it("shares initial matched state policy across framework adapters", () => {
    const Project = Route.define("/initial-projects/:id");
    const routes = [Project] as const;
    const match = Route.match([Project], "/initial-projects/atlas");
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
    const Project = Route.define("/browser-href-projects/:id");
    const memory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
    const history: BrowserHistoryAdapter = {
      ...memory,
      createHref: (href) => `/project-docs${href}`,
    };
    const router = createBrowserRouterHostController([Project] as const, {
      history,
      runtime: eraseRuntime(makeRuntime()),
    });
    const href = router.href(Project, { params: { id: "atlas" } });

    expect(href).toBe("/browser-href-projects/atlas");
    expect(router.createHref(href)).toBe("/project-docs/browser-href-projects/atlas");
    router.navigate(Project, { params: { id: "atlas" } });
    expect(memory.entries()).toEqual(["/", "/browser-href-projects/atlas"]);
    Effect.runSync(router.dispose());
  });

  it("prepares router hrefs before route preload and navigation", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const events: string[] = [];
          const Project = Route.define("/prepared-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                events.push(`preload:${params.id}`);
              }),
          });
          const memory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
          const history: BrowserHistoryAdapter = {
            ...memory,
            prepareHref: (href) =>
              Effect.sync(() => {
                events.push(`prepare:${href}`);
              }),
          };
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          yield* router.preload(Project, { params: { id: "atlas" } });
          expect(events).toEqual(["prepare:/prepared-projects/atlas", "preload:atlas"]);

          router.navigate(Project, { params: { id: "curie" } });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({
                _tag: "Ready",
                href: "/prepared-projects/curie",
              }),
            ),
          );

          expect(events).toEqual([
            "prepare:/prepared-projects/atlas",
            "preload:atlas",
            "prepare:/prepared-projects/curie",
            "preload:curie",
          ]);
          expect(memory.entries()).toEqual(["/", "/prepared-projects/curie"]);
        }),
      ),
    ));

  it("fails navigation without running route preload when href preparation fails", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const preparationFailure = new Error("static hydration missing");
          let preloads = 0;
          const Project = Route.define("/prepare-failure-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          const history: BrowserHistoryAdapter = {
            ...makeMemoryBrowserHistoryAdapter({ initialHref: "/" }),
            prepareHref: () => Effect.fail(preparationFailure),
          };
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          const preloadExit = yield* Effect.exit(
            router.preload(Project, { params: { id: "atlas" } }),
          );
          expect(preloads).toBe(0);
          expect(preloadExit._tag).toBe("Failure");
          if (preloadExit._tag === "Failure") {
            const error = preloadExit.cause.reasons.find(Cause.isFailReason)?.error;
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect((error as RouteNavigationError).cause).toBe(preparationFailure);
          }

          router.navigate(Project, { params: { id: "atlas" } });
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeInstanceOf(RouteNavigationError);
                expect((state.error as RouteNavigationError).cause).toBe(preparationFailure);
              }
            }),
          );
          expect(preloads).toBe(0);
        }),
      ),
    ));

  it("settles as not found without route preload when href preparation finds no page", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let preloads = 0;
          const Project = Route.define("/unpublished-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          const history: BrowserHistoryAdapter = {
            ...makeMemoryBrowserHistoryAdapter({ initialHref: "/" }),
            prepareHref: () => Effect.succeed({ _tag: "NotFound" } as const),
          };
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigate(Project, { params: { id: "atlas" } });
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toEqual({
                _tag: "NotFound",
                href: "/unpublished-projects/atlas",
              }),
            ),
          );
          yield* router.preload(Project, { params: { id: "curie" } });
          expect(preloads).toBe(0);
        }),
      ),
    ));

  it("hydrates a not-found document as NotFound at a matching href without preloading", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let preloads = 0;
          const Project = Route.define("/static-projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          yield* runtime.provide(Route.hydrateNotFound());
          const router = createBrowserRouterHostController([Project] as const, {
            history: makeMemoryBrowserHistoryAdapter({ initialHref: "/static-projects/missing" }),
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());
          const stop = router.start();

          expect(router.state.get()).toEqual({
            _tag: "NotFound",
            href: "/static-projects/missing",
          });
          yield* Effect.yieldNow;
          expect(preloads).toBe(0);
          stop();
        }),
      ),
    ));

  it("does not re-preload an initial Ready hydration state when host listening starts", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let preloads = 0;
          const Project = Route.define("/hydrated-router", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              }),
          });
          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/hydrated-router" });
          const router = createBrowserRouterHostController([Project] as const, {
            history,
            runtime: eraseRuntime(runtime),
            initialMatchedState: (href, match) => ({ _tag: "Ready", href, match }),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let enabled = true;
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime: eraseRuntime(runtime),
            enabled: () => enabled,
            preload: () => {
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

          yield* preloader.interrupt();
          expect(finalizers).toEqual([1, 2]);
        }),
      ),
    ));

  it("captures router link hover preload owners before queued sync interruptions execute", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const baseRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(baseRuntime.dispose));
          const queuedInterrupts: Array<Effect.Effect<void, unknown>> = [];
          let queueNextInterrupt = false;
          const runtime: typeof baseRuntime = {
            ...baseRuntime,
            runFork: <A, E, R>(
              effect: Effect.Effect<A, E, R>,
              options?: Effect.RunOptions,
            ): Fiber.Fiber<A, E> => {
              if (queueNextInterrupt) {
                queueNextInterrupt = false;
                queuedInterrupts.push(Effect.asVoid(effect as Effect.Effect<A, E, never>));
                return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
              }
              return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
            },
          };
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime: eraseRuntime(runtime),
            enabled: () => true,
            preload: () => {
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

          yield* preloader.interrupt();
          expect(finalizers).toEqual([1, 2]);
        }),
      ),
    ));

  it("swallows router link hover preload defects", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const baseRuntime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(baseRuntime.dispose));
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
            runtime: eraseRuntime(runtime),
            enabled: () => true,
            preload: () => Effect.die("link preload defect"),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime: eraseRuntime(runtime),
            enabled: () => true,
            preload: () => {
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const starts: Array<number> = [];
          const finalizers: Array<number> = [];
          let revision = 0;
          const preloader = makeBrowserRouterLinkPreloader({
            runtime: eraseRuntime(runtime),
            enabled: () => true,
            preload: () => {
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let attempts = 0;
          const Project = Route.define("/memory-retry", {
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
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/host-projects/:id");
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
            runtime: eraseRuntime(runtime),
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

          router.navigate(Project, { params: { id: "orion" } }, { replace: true });
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(`project:${params.id}`);
              }),
          });
          const ProjectSettings = Route.define("/projects/settings", {
            preload: () =>
              Effect.sync(() => {
                preloaded.push("settings");
              }),
          });
          const routes = [Project, ProjectSettings] as const;
          const router = createBrowserRouterKernel(routes, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          yield* router.preload(Project, { params: { id: "settings" } });
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
          expect(router.match.get()?.route).toBe(ProjectSettings);
          expect(preloaded).toEqual(["settings", "settings"]);
        }),
      ),
    ));

  it("retries the current href preload when navigating to the same href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let attempts = 0;
          const Project = Route.define("/retry-projects/:id", {
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
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let starts = 0;
          let finalizers = 0;
          const Slow = Route.define("/slow", {
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
          const Fast = Route.define("/fast");
          const router = createBrowserRouterKernel([Slow, Fast] as const, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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
          yield* Effect.addFinalizer(() => Effect.orDie(baseRuntime.dispose));
          const queuedDisposals: Array<Effect.Effect<void, unknown>> = [];
          let queueNextDisposal = false;
          const runtime: typeof baseRuntime = {
            ...baseRuntime,
            runFork: <A, E, R>(
              effect: Effect.Effect<A, E, R>,
              options?: Effect.RunOptions,
            ): Fiber.Fiber<A, E> => {
              if (queueNextDisposal) {
                queueNextDisposal = false;
                queuedDisposals.push(Effect.asVoid(effect as Effect.Effect<A, E, never>));
                return baseRuntime.runFork(Effect.never as Effect.Effect<A, E, never>, options);
              }
              return baseRuntime.runFork(effect as Effect.Effect<A, E, never>, options);
            },
          };
          const starts: Array<string> = [];
          const finalizers: Array<string> = [];
          const Slow = Route.define("/queued-owner-slow", {
            preload: () =>
              Effect.sync(() => {
                starts.push("slow");
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.asVoid,
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push("slow");
                  }),
                ),
              ),
          });
          const Next = Route.define("/queued-owner-next", {
            preload: () =>
              Effect.sync(() => {
                starts.push("next");
              }).pipe(
                Effect.andThen(Effect.never),
                Effect.asVoid,
                Effect.ensuring(
                  Effect.sync(() => {
                    finalizers.push("next");
                  }),
                ),
              ),
          });
          const router = createBrowserRouterKernel([Slow, Next] as const, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigateHref("/queued-owner-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual(["slow"])));

          queueNextDisposal = true;
          router.navigateHref("/queued-owner-next");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toEqual(["slow", "next"])));
          expect(queuedDisposals).toHaveLength(1);

          yield* queuedDisposals[0]!;
          expect(finalizers).toEqual(["slow"]);

          yield* router.dispose();
          expect(finalizers).toEqual(["slow", "next"]);
        }),
      ),
    ));

  it("outside-route navigate interrupts active navigation preload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const release = yield* Deferred.make<void>();
          let starts = 0;
          let finalizers = 0;
          const Slow = Route.define("/outside-route-slow", {
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
          const Outside = Route.define("/outside-route-target");
          const router = createBrowserRouterKernel([Slow] as const, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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

  it("dispose interrupts current navigation preload before completing", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          let starts = 0;
          let finalizers = 0;
          const Slow = Route.define("/dispose-slow", {
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
          const router = createBrowserRouterKernel([Slow] as const, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigateHref("/dispose-slow");
          yield* Effect.promise(() => vi.waitFor(() => expect(starts).toBe(1)));

          yield* router.dispose();
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/router-projects/:id");
          const Outside = Route.define("/outside-projects/:id", {
            preload: ({ params }) =>
              Effect.sync(() => {
                preloaded.push(params.id);
              }),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/missing",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          const preloadExit = yield* Effect.exit(
            // @ts-expect-error outside route intentionally violates the configured router tuple
            router.preload(Outside, { params: { id: "atlas" } }),
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
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/failure-projects/:id", {
            preload: () => Effect.fail("missing-project").pipe(Effect.asVoid),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/failure-projects/atlas",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

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
                  // Without an `error` schema only the failure `_tag` is kept.
                  cause: { _tag: "RoutePreloadUntypedFailure" },
                });
                expect(state.cause.reasons.find(Cause.isFailReason)?.error).toBe(state.error);
              }
            }),
          );
        }),
      ),
    ));

  it("keeps a route's schema-typed preload failure in router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
            id: Schema.String,
          }) {}
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/typed-failure-projects/:id", {
            error: ProjectNotFound,
            preload: ({ params }) => Effect.fail(new ProjectNotFound({ id: params.id })),
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/typed-failure-projects/atlas",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigateHref("/typed-failure-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure" && state.error?._tag === "RoutePreloadError") {
                expectTypeOf(state.error.cause).toEqualTypeOf<ProjectNotFound>();
                expect(state.error.cause).toBeInstanceOf(ProjectNotFound);
                expect(state.error.cause.id).toBe("atlas");
              } else {
                expect.fail("Expected a RoutePreloadError failure.");
              }
            }),
          );
        }),
      ),
    ));

  it("keeps erased Promise-shaped preload defects in router state", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));

          const Project = Route.define("/promise-failure-projects/:id", {
            preload: () => Promise.resolve(undefined) as never,
          });
          const router = createBrowserRouterKernel([Project] as const, {
            initialHref: "/promise-failure-projects/atlas",
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());

          router.navigateHref("/promise-failure-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              const state = router.state.get();
              expect(state._tag).toBe("Failure");
              if (state._tag === "Failure") {
                expect(state.error).toBeUndefined();
                expect(Cause.squash(state.cause)).toBeInstanceOf(EffectInputPromiseRejected);
              }
            }),
          );
        }),
      ),
    ));
});
