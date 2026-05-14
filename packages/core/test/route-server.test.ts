import { Effect, Exit, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineApp, read, RequestContext, Resource, ResponseContext, route, Route, Server } from "../src/index.js";

describe("route", () => {
  it("builds typed hrefs", () => {
    const ProjectRoute = route("/projects/:id", {});

    expect(Route.href(ProjectRoute, { params: { id: "abc" } })).toBe("/projects/abc");
    expect(Route.href(ProjectRoute, { params: { id: "a b" } })).toBe("/projects/a%20b");
  });

  it("infers route props", () => {
    const ProjectRoute = route("/projects/:id", {});

    expectTypeOf<Route.Props<typeof ProjectRoute>>().toEqualTypeOf<{
      readonly params: { readonly id: string };
      readonly search: Record<string, never>;
    }>();
  });

  it("builds and matches optional route params", () => {
    const MaybeProjectRoute = route("/projects/:id?", {});
    const NestedMaybeProjectRoute = route("/projects/:id?/settings", {});

    expect(Route.href(MaybeProjectRoute, { params: {} })).toBe("/projects");
    expect(Route.href(MaybeProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
    expect(MaybeProjectRoute.match("/projects")?.params).toEqual({});
    expect(MaybeProjectRoute.match("/projects/atlas")?.params).toEqual({ id: "atlas" });
    expect(NestedMaybeProjectRoute.match("/projects/settings")?.params).toEqual({});
    expect(NestedMaybeProjectRoute.match("/projects/atlas/settings")?.params).toEqual({ id: "atlas" });
    expectTypeOf<Route.Props<typeof MaybeProjectRoute>>().toEqualTypeOf<{
      readonly params: { readonly id?: string };
      readonly search: Record<string, never>;
    }>();
  });

  it("defines client-only apps", () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home],
      client: {}
    });

    expect(app.fullStack).toBe(false);
  });

  it("matches route params and search", () => {
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      search: Schema.Struct({ tab: Schema.optional(Schema.Literal("activity")) })
    });

    const match = Route.match([ProjectRoute] as const, "/projects/atlas?tab=activity");

    expect(match?.params.id).toBe("atlas");
    expect(match?.search.tab).toBe("activity");
    expect(match?.href).toBe("/projects/atlas?tab=activity");
  });

  it("runs route preload as an Effect", () => {
    let preloaded = "";
    const ProjectRoute = route("/projects/:id", {
      preload: ({ params }) =>
        Effect.sync(() => {
          preloaded = params.id;
        })
    });
    const match = ProjectRoute.match("/projects/atlas");

    expect(match).toBeDefined();
    return Effect.runPromise(
      Effect.promise(() => Route.preload(match!)).pipe(
        Effect.tap(() => Effect.sync(() => expect(preloaded).toBe("atlas"))),
        Effect.asVoid
      )
    );
  });

  it("plans route preload resources and hydration payloads", () => {
    const Project = Resource.family({
      name: "Route.Project.plan",
      load: (id: string) => Effect.succeed({ id, name: "Atlas" })
    });
    const ProjectRoute = route("/projects/:id", {
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });

    return Effect.runPromise(
      Effect.promise(() => Route.planNavigation([ProjectRoute] as const, "/projects/atlas")).pipe(
        Effect.tap((plan) =>
          Effect.sync(() => {
            expect(plan._tag).toBe("Matched");
            expect(plan.match?.params.id).toBe("atlas");
            expect(plan.refs.map((ref) => ref.key)).toEqual([Project("atlas").key]);
            expect(plan.resources.resources[0]).toMatchObject({
              name: "Route.Project.plan",
              input: "atlas",
              state: {
                _tag: "Success",
                value: { id: "atlas", name: "Atlas" }
              }
            });
            expect(read(Project("atlas"))).toEqual({ id: "atlas", name: "Atlas" });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("describes declared route preload resource families without executing preload", () => {
    let ran = false;
    const Project = Resource.family({
      name: "Route.Project.preload-diagnostics",
      load: (id: string) => Effect.succeed({ id })
    });
    const ProjectRoute = route("/projects/:id", {
      preloadResources: [Project, Project("atlas"), "Route.Project.extra"],
      preloadCollections: [
        { name: "Route.Project.collection" },
        "Route.Project.collection.extra"
      ],
      preload: () =>
        Effect.sync(() => {
          ran = true;
        })
    });
    const UnknownRoute = route("/unknown", {
      preload: () => Effect.void
    });
    const PlainRoute = route("/plain", {});

    expect(Route.preloadResourceFamilies(ProjectRoute)).toEqual([
      "Route.Project.extra",
      "Route.Project.preload-diagnostics"
    ]);
    expect(Route.preloadCollectionNames(ProjectRoute)).toEqual([
      "Route.Project.collection",
      "Route.Project.collection.extra"
    ]);
    expect(Route.describePreloadResources(ProjectRoute)).toEqual({
      status: "declared",
      families: [
        "Route.Project.extra",
        "Route.Project.preload-diagnostics"
      ]
    });
    expect(Route.describePreloadCollections(ProjectRoute)).toEqual({
      status: "declared",
      collections: [
        "Route.Project.collection",
        "Route.Project.collection.extra"
      ]
    });
    expect(Route.describePreloadResources(UnknownRoute)).toEqual({
      status: "unknown",
      families: []
    });
    expect(Route.describePreloadCollections(UnknownRoute)).toEqual({
      status: "unknown",
      collections: []
    });
    expect(Route.describePreloadResources(PlainRoute)).toEqual({
      status: "none",
      families: []
    });
    expect(Route.describePreloadCollections(PlainRoute)).toEqual({
      status: "none",
      collections: []
    });
    expect(ran).toBe(false);
  });

  it("plans not found routes without running preload", () => {
    const Home = route("/", {});

    return Effect.runPromise(
      Effect.promise(() => Route.planNavigation([Home] as const, "/missing")).pipe(
        Effect.tap((plan) =>
          Effect.sync(() =>
            expect(plan).toEqual({
              _tag: "NotFound",
              href: "/missing",
              match: undefined,
              refs: [],
              resources: { resources: [] }
            })
          )
        ),
        Effect.asVoid
      )
    );
  });
});

describe("Server", () => {
  it("runs Effect-backed server functions", () => {
    const getNumber = Server.fn("Number.get", {
      handler: (_input: void) => Effect.succeed(42)
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const promiseValue = yield* Effect.promise(() => getNumber());
        const effectValue = yield* getNumber.effect();

        yield* Effect.sync(() => {
          expect(promiseValue).toBe(42);
          expect(effectValue).toBe(42);
          expect(Server.manifest([getNumber])).toEqual([
            {
              name: "Number.get",
              inputSchema: false,
              outputSchema: false,
              errorSchema: false
            }
          ]);
        });
      })
    );
  });

  it("invokes schema-backed server functions across the wire", () => {
    const echo = Server.fn("Echo", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      handler: ({ value }) => Effect.succeed({ value: value.toUpperCase() })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const success = yield* echo.invoke({ value: "ada" });
        const invalid = yield* Effect.exit(echo.invoke({ value: 1 }));

        yield* Effect.sync(() => {
          expect(success).toEqual({ value: "ADA" });
          expect(Exit.isFailure(invalid)).toBe(true);
        });
      })
    );
  });

  it("provides request context to server routes", () => {
    const serverRoute = Server.route("GET", "/hello", () =>
      RequestContext.use(({ url }) => Effect.succeed(new Response(url.pathname)))
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          Server.handleRoute(serverRoute, new Request("https://example.com/hello"))
        );
        const responseText = yield* Effect.promise(() => response.text());
        const effectResponse = yield* Server.handleRouteEffect(
          serverRoute,
          new Request("https://example.com/effect")
        );
        const effectResponseText = yield* Effect.promise(() => effectResponse.text());

        yield* Effect.sync(() => {
          expect(responseText).toBe("/hello");
          expect(effectResponseText).toBe("/effect");
        });
      })
    );
  });

  it("applies response context mutations from server routes", () => {
    const serverRoute = Server.route("GET", "/login", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setStatus(202, "Accepted");
          yield* response.setHeader("x-effect-ui-route", "response-context");
          yield* response.setCookie("session", "abc123", {
            httpOnly: true,
            path: "/",
            sameSite: "Lax"
          });
          return new Response("ok");
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          Server.handleRoute(serverRoute, new Request("https://example.com/login"))
        );
        const body = yield* Effect.promise(() => response.text());

        yield* Effect.sync(() => {
          expect(response.status).toBe(202);
          expect(response.statusText).toBe("Accepted");
          expect(response.headers.get("x-effect-ui-route")).toBe("response-context");
          expect(response.headers.getSetCookie()).toEqual([
            "session=abc123; Path=/; HttpOnly; SameSite=Lax"
          ]);
          expect(body).toBe("ok");
        });
      })
    );
  });
});
