// @vitest-environment happy-dom

import { Cause, Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeRuntime, onDispose, route, RoutePreloadError } from "@effect-ui/core";
import type { BrowserRouter, BrowserRouterState } from "../src/index.js";

vi.doMock("solid-js", () => import("solid-js/dist/solid.js"));
vi.doMock("solid-js/web", () => import("solid-js/web/dist/web.js"));

const { createRoot } = await import("solid-js");
const { createComponent, render } = await import("solid-js/web");
const { createBrowserRouter, RouterOutlet, RouterProvider, useRouter } = await import("../src/index.js");

describe("createBrowserRouter", () => {
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
});
