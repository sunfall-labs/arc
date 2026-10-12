import { Effect, Schema } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  RouteNotFound,
  RouteRedirect,
  type RoutePreloadError,
} from "../src/index.js";
import { browserRouteInstanceKey, eraseRuntime } from "../src/internal.js";

class ItemMissing extends Schema.TaggedError<ItemMissing>()("ItemMissing", {
  id: Schema.String,
}) {}

const items = new Map([["atlas", "Atlas"]]);

const Viewer = Resource.define({
  name: "RouteVerdicts.core.viewer",
  input: Schema.Literal("me"),
  output: Schema.String,
  load: () => Effect.succeed("Ada"),
});

const ItemName = Resource.define({
  name: "RouteVerdicts.core.item",
  input: Schema.String,
  output: Schema.String,
  error: ItemMissing,
  load: (id) => {
    const name = items.get(id);
    return name === undefined ? Effect.fail(new ItemMissing({ id })) : Effect.succeed(name);
  },
});

const ItemRoute = Route.define("/items/:id", {
  params: Schema.Struct({ id: Schema.String }),
  // The verdicts are not failures: they need no `error` schema entry.
  error: ItemMissing,
  preload: ({ params }) =>
    Resource.preload(Viewer("me")).pipe(
      Effect.andThen(Resource.preload(ItemName(params.id))),
      Effect.catchTag(
        "ItemMissing",
        (error): Effect.Effect<never, RouteNotFound | RouteRedirect> =>
          error.id === "gone" ? Route.redirect("/items/atlas") : Route.notFound(),
      ),
    ),
});

const LoopRoute = Route.define("/loop", { preload: () => Route.redirect("/loop") });

describe("route preload verdicts", () => {
  it("keeps the verdicts out of the route's typed failure", () => {
    expectTypeOf<Route.PreloadFailure<typeof ItemRoute>>().toEqualTypeOf<ItemMissing>();
    const Plain = Route.define("/plain", { preload: () => Route.notFound() });
    // A preload that can only answer "not found" cannot fail.
    expectTypeOf<Route.PreloadFailure<typeof Plain>>().toEqualTypeOf<never>();
    const matched = Route.match([ItemRoute], "/items/atlas")!;
    expectTypeOf<Route.PreloadVerdict<typeof ItemRoute>>().toEqualTypeOf<
      RouteNotFound | RouteRedirect
    >();
    expectTypeOf<Route.PreloadVerdict<typeof LoopRoute>>().toEqualTypeOf<RouteRedirect>();
    expectTypeOf(Route.preload(matched)).toEqualTypeOf<
      Effect.Effect<void, RoutePreloadError<ItemMissing> | RouteNotFound | RouteRedirect>
    >();
  });

  it("plans Route.notFound() as NotFound, with what the preload loaded before it", async () => {
    const plan = await Effect.runPromise(
      makeRuntime().provide(Route.planNavigation([ItemRoute], "/items/nope")),
    );
    expect(plan).toMatchObject({ _tag: "NotFound", href: "/items/nope", match: undefined });
    expect(plan.resources.resources.map((resource) => resource.key)).toEqual([
      'RouteVerdicts.core.viewer:"me"',
    ]);
  });

  it("plans Route.redirect(...) as Redirect, hydrating nothing", async () => {
    const plan = await Effect.runPromise(
      makeRuntime().provide(Route.planNavigation([ItemRoute], "/items/gone")),
    );
    expect(plan).toMatchObject({
      _tag: "Redirect",
      href: "/items/gone",
      location: "/items/atlas",
      status: 302,
      resources: { resources: [] },
    });
    expect(plan.match?.params).toEqual({ id: "gone" });
  });

  it("settles client navigation NotFound, or follows a redirect into history", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/items/atlas" });
          const router = createBrowserRouterHostController([ItemRoute, LoopRoute] as const, {
            history,
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());
          router.start();

          router.navigateHref("/items/nope");
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({ _tag: "NotFound", href: "/items/nope" }),
            ),
          );

          router.navigateHref("/items/gone");
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({ _tag: "Ready", href: "/items/atlas" }),
            ),
          );
          // The redirect replaced the entry it redirected from.
          expect(history.entries()).toEqual(["/items/atlas", "/items/nope", "/items/atlas"]);

          router.navigateHref("/loop");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(router.state.get()).toMatchObject({ _tag: "Failure" })),
          );
        }),
      ),
    ));

  it("keys a route instance by route and params, not search", () => {
    const List = Route.define("/projects/:key/issues", {
      search: Schema.Struct({ q: Schema.optional(Schema.String) }),
    });
    const state = (href: string) => ({
      _tag: "Ready" as const,
      href,
      match: Route.match([List], href)!,
    });
    expect(browserRouteInstanceKey(state("/projects/TRK/issues?q=a"))).toBe(
      browserRouteInstanceKey(state("/projects/TRK/issues?q=b")),
    );
    expect(browserRouteInstanceKey(state("/projects/TRK/issues"))).not.toBe(
      browserRouteInstanceKey(state("/projects/WEB/issues")),
    );
    expect(browserRouteInstanceKey({ _tag: "NotFound", href: "/x" })).toBeUndefined();
  });
});
