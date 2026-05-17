import { Effect, Exit, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  buildRoutePath,
  DuplicateRouteParam,
  defineApp,
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  InvalidRouteParam,
  matchRoutePath,
  parseRoutePathSegments,
  read,
  RequestContext,
  Resource,
  ResponseCookieSerializationError,
  ResponseContext,
  route,
  Route,
  RouteNavigationError,
  RoutePreloadError,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  Server,
  ServerRouteHandlerError
} from "../src/index.js";

describe("route", () => {
  it("builds typed hrefs", () => {
    const ProjectRoute = route("/projects/:id", {});

    expect(Route.href(ProjectRoute, { params: { id: "abc" } })).toBe("/projects/abc");
    expect(Route.href(ProjectRoute, { params: { id: "a b" } })).toBe("/projects/a%20b");
  });

  it("matches routes without an options object", () => {
    const ProjectRoute = route("/projects/:id");

    expect(Route.href(ProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
    expect(ProjectRoute.match("/projects/atlas")?.params).toEqual({ id: "atlas" });
  });

  it("infers route props", () => {
    const ProjectRoute = route("/projects/:id", {});

    expectTypeOf<Route.Props<typeof ProjectRoute>>().toEqualTypeOf<{
      readonly params: { readonly id: string };
      readonly search: Record<string, never>;
      readonly match: Route.Match<typeof ProjectRoute>;
    }>();
  });

  it("builds and matches optional route params", () => {
    const MaybeProjectRoute = route("/projects/:id?", {});
    const NestedMaybeProjectRoute = route("/projects/:id?/settings", {});

    expect(Route.href(MaybeProjectRoute)).toBe("/projects");
    expect(Route.href(MaybeProjectRoute, { params: {} })).toBe("/projects");
    expect(Route.href(MaybeProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
    expect(MaybeProjectRoute.match("/projects")?.params).toEqual({});
    expect(MaybeProjectRoute.match("/projects/atlas")?.params).toEqual({ id: "atlas" });
    expect(NestedMaybeProjectRoute.match("/projects/settings")?.params).toEqual({});
    expect(NestedMaybeProjectRoute.match("/projects/atlas/settings")?.params).toEqual({ id: "atlas" });
    expectTypeOf<Route.Props<typeof MaybeProjectRoute>>().toEqualTypeOf<{
      readonly params: { readonly id?: string };
      readonly search: Record<string, never>;
      readonly match: Route.Match<typeof MaybeProjectRoute>;
    }>();
  });

  it("builds static route hrefs without an options object", () => {
    const HomeRoute = route("/", {});

    expect(Route.href(HomeRoute)).toBe("/");
    expect(Route.href(HomeRoute, {})).toBe("/");
  });

  it("exposes shared route grammar helpers", () => {
    const segments = parseRoutePathSegments("/projects/:id?/settings");

    expect(segments).toEqual([
      { _tag: "Static", value: "projects" },
      { _tag: "Dynamic", name: "id", optional: true },
      { _tag: "Static", value: "settings" }
    ]);
    expect(routePathFromSegments(segments)).toBe("/projects/:id?/settings");
    expect(routeParamsFromSegments(segments)).toEqual([{ name: "id", optional: true }]);
    expect(routePathSlug("/projects/:id?/settings")).toBe("projects_$id_optional_settings");
    expect(buildRoutePath("/projects/:id?/settings", {})).toBe("/projects/settings");
    expect(buildRoutePath("/projects/:id?/settings", { id: "atlas" })).toBe("/projects/atlas/settings");
    expect(matchRoutePath("/projects/:id?/settings", "/projects/settings")).toEqual({});
    expect(matchRoutePath("/projects/:id?/settings", "/projects/atlas/settings")).toEqual({ id: "atlas" });
  });

  it("rejects invalid and duplicate route params at the route grammar seam", () => {
    expect(() => parseRoutePathSegments("/projects/:123")).toThrow(InvalidRouteParam);
    expect(() => parseRoutePathSegments("/projects/:?")).toThrow(InvalidRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id/:id")).toThrow(DuplicateRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id/:id?")).toThrow(DuplicateRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id?/:id?")).toThrow(DuplicateRouteParam);
    expect(() => buildRoutePath("/projects/:id/:id", { id: "atlas" })).toThrow(DuplicateRouteParam);
    expect(() => matchRoutePath("/projects/:id/:id", "/projects/atlas/settings")).toThrow(DuplicateRouteParam);
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

  it("matches static routes before dynamic routes when caller order is reversed", () => {
    const ProjectRoute = route("/projects/:id", {});
    const ProjectSettingsRoute = route("/projects/settings", {});

    const match = Route.match([ProjectRoute, ProjectSettingsRoute] as const, "/projects/settings");

    expect(match?.route).toBe(ProjectSettingsRoute);
    expect(match?.params).toEqual({});
  });

  it("keeps caller order for same-specificity dynamic routes", () => {
    const ProjectBySlugRoute = route("/projects/:slug", {});
    const ProjectByIdRoute = route("/projects/:id", {});

    const match = Route.match([ProjectBySlugRoute, ProjectByIdRoute] as const, "/projects/atlas");

    expect(match?.route).toBe(ProjectBySlugRoute);
    expect(match?.params).toEqual({ slug: "atlas" });
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
    const effect = Route.preloadEffect(match!);
    expect(preloaded).toBe("");

    return Effect.runPromise(
      effect.pipe(
        Effect.tap(() => Effect.sync(() => expect(preloaded).toBe("atlas"))),
        Effect.asVoid
      )
    );
  });

  it("captures synchronous preload failures inside the returned Effect", () => {
    const ProjectRoute = route("/projects/:id", {
      preload: () => {
        throw "preload-failed";
      }
    });
    const match = ProjectRoute.match("/projects/atlas");

    expect(match).toBeDefined();
    let effect: Effect.Effect<void, RoutePreloadError> | undefined;
    expect(() => {
      effect = Route.preloadEffect(match!);
    }).not.toThrow();

    return Effect.runPromise(
      Effect.flip(effect!).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RoutePreloadError);
            expect(error.cause).toBe("preload-failed");
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("captures erased Promise-shaped preload returns as typed preload failures", () => {
    const ProjectRoute = route("/projects/:id", {
      preload: () => Promise.resolve(undefined) as never
    });
    const match = ProjectRoute.match("/projects/atlas");

    expect(match).toBeDefined();

    return Effect.runPromise(
      Effect.flip(Route.preloadEffect(match!)).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RoutePreloadError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "Route.preload(/projects/:id)",
              cause: expect.any(EffectInputPromiseRejected)
            });
          })
        ),
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
      Route.planNavigationEffect([ProjectRoute] as const, "/projects/atlas").pipe(
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
      Route.planNavigationEffect([Home] as const, "/missing").pipe(
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

  it("captures route schema decode failures inside navigation effects", () => {
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number })
    });

    let effect:
      | Effect.Effect<
          Route.NavigationPlan<typeof ProjectRoute>,
          Route.NavigationError
        >
      | undefined;
    expect(() => {
      effect = Route.planNavigationEffect([ProjectRoute] as const, "/projects/atlas");
    }).not.toThrow();

    return Effect.runPromise(
      Effect.flip(effect!).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect(error.input).toBe("/projects/atlas");
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("captures route schema decode failures inside match effects", () => {
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number })
    });

    return Effect.runPromise(
      Effect.flip(Route.matchEffect([ProjectRoute] as const, "/projects/atlas")).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect(error.input).toBe("/projects/atlas");
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("captures route grammar failures inside match effects", () => {
    const DuplicateParamRoute = route("/projects/:id/:id", {});
    const InvalidParamRoute = route("/invalid-projects/:123", {});

    return Effect.runPromise(
      Effect.gen(function* () {
        const duplicateError = yield* Effect.flip(
          Route.matchEffect([DuplicateParamRoute] as const, "/projects/atlas/settings")
        );
        const invalidError = yield* Effect.flip(
          Route.matchEffect([InvalidParamRoute] as const, "/invalid-projects/atlas")
        );

        expect(duplicateError).toBeInstanceOf(RouteNavigationError);
        expect(duplicateError.input).toBe("/projects/atlas/settings");
        expect(duplicateError.cause).toBeInstanceOf(DuplicateRouteParam);
        expect(invalidError).toBeInstanceOf(RouteNavigationError);
        expect(invalidError.input).toBe("/invalid-projects/atlas");
        expect(invalidError.cause).toBeInstanceOf(InvalidRouteParam);
      })
    );
  });

  it("keeps schema decode failures synchronous for match helpers", () => {
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number })
    });

    expect(() => ProjectRoute.match("/projects/atlas")).toThrow();
    expect(() => Route.match([ProjectRoute] as const, "/projects/atlas")).toThrow();
  });
});

describe("Server", () => {
  it("runs Effect-backed server functions", () => {
    const getNumber = Server.fn("Number.get", {
      handler: (_input: void) => Effect.succeed(42)
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const callableValue = yield* getNumber();
        const effectValue = yield* getNumber.effect();

        yield* Effect.sync(() => {
          expect(callableValue).toBe(42);
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
        const response = yield* Server.handleRoute(serverRoute, new Request("https://example.com/hello"));
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

  it("suspends server route handlers until the returned Effect runs", () => {
    let called = 0;
    const serverRoute = Server.route("GET", "/hello", () => {
      called++;
      throw "handler-failed";
    });

    let effect: Effect.Effect<Response, ServerRouteHandlerError> | undefined;
    expect(() => {
      effect = Server.handleRouteEffect(serverRoute, new Request("https://example.com/hello"));
    }).not.toThrow();
    expect(called).toBe(0);

    return Effect.runPromise(
      Effect.flip(effect!).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(called).toBe(1);
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toBeInstanceOf(EffectInputCallbackError);
            expect(error.cause).toMatchObject({
              operation: "Server.route(GET /hello).handler",
              cause: "handler-failed"
            });
          })
        ),
        Effect.asVoid
      )
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
        const response = yield* Server.handleRoute(serverRoute, new Request("https://example.com/login"));
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

  it("rejects invalid SameSite response cookie attributes at runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const serverRoute = Server.route("GET", "/bad-cookie", () =>
          ResponseContext.use((response) =>
            Effect.gen(function* () {
              yield* response.setCookie("session", "abc123", {
                sameSite: "Loose" as never
              });
              return new Response("ok");
            })
          )
        );
        const failure = yield* Effect.flip(
          Server.handleRoute(serverRoute, new Request("https://example.com/bad-cookie"))
        );

        expect(failure).toBeInstanceOf(ResponseCookieSerializationError);
        expect(failure).toMatchObject({
          attribute: "SameSite"
        });
        expect((failure as ResponseCookieSerializationError).cause).toBe("Loose");
      })
    ));

  it("reports malformed request cookies through ServerRouteHandlerError", () => {
    const serverRoute = Server.route("GET", "/cookies", () =>
      RequestContext.use(({ cookies }) =>
        Effect.succeed(new Response(cookies.get("session") ?? "missing"))
      )
    );

    return Effect.runPromise(
      Effect.flip(
        Server.handleRouteEffect(
          serverRoute,
          new Request("https://example.com/cookies", {
            headers: {
              cookie: "session=%E0%A4%A"
            }
          })
        )
      ).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "RequestContext.make"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("reports invalid response cookie attributes as typed Effect errors", () => {
    const serverRoute = Server.route("GET", "/cookies", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setCookie("session", "abc123", {
            path: "/; HttpOnly",
            maxAge: Number.POSITIVE_INFINITY
          });
          return new Response("ok");
        })
      )
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRouteEffect(serverRoute, new Request("https://example.com/cookies"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ResponseCookieSerializationError);
            expect(error).toMatchObject({
              _tag: "ResponseCookieSerializationError",
              attribute: "Path"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("reports invalid response headers through ServerRouteHandlerError", () => {
    const serverRoute = Server.route("GET", "/headers", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setHeader("bad header", "value");
          return new Response("ok");
        })
      )
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRouteEffect(serverRoute, new Request("https://example.com/headers"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "ResponseContext.setHeader"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("reports invalid response status application through ServerRouteHandlerError", () => {
    const serverRoute = Server.route("GET", "/status", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setStatus(99);
          return new Response("ok");
        })
      )
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRouteEffect(serverRoute, new Request("https://example.com/status"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "ResponseContext.apply"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });
});
