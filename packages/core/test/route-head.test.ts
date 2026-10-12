import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  Signal,
} from "../src/index.js";
import { eraseRuntime, routeHeadOf, settledRouteHead } from "../src/internal.js";

const names = new Map([
  ["atlas", "Atlas"],
  ["curie", "Curie"],
]);

const ProjectName = Resource.define({
  name: "RouteHead.projectName",
  input: Schema.String,
  output: Schema.String,
  // Async, so a navigation is pending for a moment.
  load: (id) => Effect.succeed(names.get(id) ?? id).pipe(Effect.delay("1 millis")),
});

const ProjectRoute = Route.define("/head-projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  search: Schema.Struct({ tab: Schema.optional(Schema.String) }),
  preload: ({ params }) =>
    params.id === "missing" ? Route.notFound() : Resource.preload(ProjectName(params.id)),
  head: ({ params, search, read }) => ({
    title: read(ProjectName(params.id)) ?? params.id,
    ...(search.tab === undefined ? {} : { description: `${search.tab} tab` }),
    meta: [{ property: "og:type", content: "article" }],
  }),
});
const HomeRoute = Route.define("/head-home");
const routes = [ProjectRoute, HomeRoute] as const;

describe("route head", () => {
  it("derives a route's head from its match and the Resources its preload loaded", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime();
        const match = Route.match(routes, "/head-projects/atlas?tab=activity")!;

        // Before the preload, `read` has nothing.
        expect(routeHeadOf(match, runtime.resourceStore).title).toBe("atlas");
        yield* runtime.provide(Resource.preload(ProjectName("atlas")));
        expect(routeHeadOf(match, runtime.resourceStore)).toEqual({
          title: "Atlas",
          description: "activity tab",
          meta: [{ property: "og:type", content: "article" }],
        });
        // A route without `head`, and no route at all, have an empty head.
        expect(routeHeadOf(Route.match(routes, "/head-home"), runtime.resourceStore)).toEqual({});
        expect(routeHeadOf(undefined, runtime.resourceStore)).toEqual({});
        yield* runtime.dispose;
      }),
    ));

  it("follows the route the router settles on and the Resources its head reads", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const head = settledRouteHead(runtime.resourceStore);
          const seen: Array<string | undefined> = [];
          const unsubscribe = head.subscribe(() => {
            seen.push(Signal.peek(head)?.head.title);
          });
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
          expect(Signal.peek(head)).toBeUndefined();

          const router = createBrowserRouterHostController(routes, {
            history: makeMemoryBrowserHistoryAdapter({ initialHref: "/head-projects/atlas" }),
            runtime: eraseRuntime(runtime),
          });
          yield* Effect.addFinalizer(() => router.dispose());
          router.start();
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)?.head.title).toBe("Atlas")),
          );

          // A navigation keeps the previous head while the next page is pending.
          router.navigateHref("/head-projects/curie");
          expect(Signal.peek(head)?.head.title).toBe("Atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)?.head.title).toBe("Curie")),
          );

          // The head follows the Resource it reads.
          names.set("curie", "Marie Curie");
          yield* runtime.provide(Resource.invalidate(ProjectName("curie")));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)?.head.title).toBe("Marie Curie")),
          );

          // A not-found page and a route without `head` have an empty head.
          router.navigateHref("/head-projects/missing");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)).toEqual({ head: {}, status: "NotFound" })),
          );
          router.navigateHref("/head-projects/atlas");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)?.head.title).toBe("Atlas")),
          );
          router.navigateHref("/head-home");
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(Signal.peek(head)).toEqual({ head: {}, status: "Ready" })),
          );
          expect(seen).toContain("Marie Curie");
        }),
      ),
    ));
});
