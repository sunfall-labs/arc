import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  RequestContext,
  Resource,
  ResponseCookieSerializationError,
  ResponseContext,
  Route,
  RouteNavigationError,
  RoutePreloadError,
  RoutePreloadFailureCodecError,
  RoutePreloadUntypedFailure,
  Server,
  ServerRouteHandlerError,
} from "../src/index.js";
import {
  buildRoutePath,
  DuplicateRouteParam,
  InvalidRouteParam,
  matchRoutePath,
  parseRoutePathSegments,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  matchRoutes,
} from "../src/internal.js";

describe("route", () => {
  it("builds typed hrefs", () => {
    const ProjectRoute = Route.define("/projects/:id", {});

    expect(Route.href(ProjectRoute, { params: { id: "abc" } })).toBe("/projects/abc");
    expect(Route.href(ProjectRoute, { params: { id: "a b" } })).toBe("/projects/a%20b");
  });

  it("matches routes without an options object", () => {
    const ProjectRoute = Route.define("/projects/:id");

    expect(Route.href(ProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
    expect(Route.match([ProjectRoute], "/projects/atlas")?.params).toEqual({ id: "atlas" });
  });

  it("infers route props", () => {
    const ProjectRoute = Route.define("/projects/:id", {});

    expectTypeOf<Route.Props<typeof ProjectRoute>>().toMatchTypeOf<{
      readonly params: { readonly id: string };
      readonly search: Record<string, never>;
      readonly match: Route.Match<typeof ProjectRoute>;
    }>();
  });

  it("builds and matches optional route params", () => {
    const MaybeProjectRoute = Route.define("/projects/:id?", {});
    const NestedMaybeProjectRoute = Route.define("/projects/:id?/settings", {});

    expect(Route.href(MaybeProjectRoute)).toBe("/projects");
    expect(Route.href(MaybeProjectRoute, { params: {} })).toBe("/projects");
    expect(Route.href(MaybeProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
    expect(Route.match([MaybeProjectRoute], "/projects")?.params).toEqual({});
    expect(Route.match([MaybeProjectRoute], "/projects/atlas")?.params).toEqual({ id: "atlas" });
    expect(Route.match([NestedMaybeProjectRoute], "/projects/settings")?.params).toEqual({});
    expect(Route.match([NestedMaybeProjectRoute], "/projects/atlas/settings")?.params).toEqual({
      id: "atlas",
    });
    expectTypeOf<Route.Props<typeof MaybeProjectRoute>>().toMatchTypeOf<{
      readonly params: { readonly id?: string };
      readonly search: Record<string, never>;
      readonly match: Route.Match<typeof MaybeProjectRoute>;
    }>();
  });

  it("builds static route hrefs without an options object", () => {
    const HomeRoute = Route.define("/", {});

    expect(Route.href(HomeRoute)).toBe("/");
    expect(Route.href(HomeRoute, {})).toBe("/");
  });

  it("exposes shared route grammar helpers", () => {
    const segments = parseRoutePathSegments("/projects/:id?/settings");

    expect(segments).toEqual([
      { _tag: "Static", value: "projects" },
      { _tag: "Dynamic", name: "id", optional: true },
      { _tag: "Static", value: "settings" },
    ]);
    expect(routePathFromSegments(segments)).toBe("/projects/:id?/settings");
    expect(routeParamsFromSegments(segments)).toEqual([{ name: "id", optional: true }]);
    expect(routePathSlug("/projects/:id?/settings")).toBe("projects_$id_optional_settings");
    expect(buildRoutePath("/projects/:id?/settings", {})).toBe("/projects/settings");
    expect(buildRoutePath("/projects/:id?/settings", { id: "atlas" })).toBe(
      "/projects/atlas/settings",
    );
    expect(matchRoutePath("/projects/:id?/settings", "/projects/settings")).toEqual({});
    expect(matchRoutePath("/projects/:id?/settings", "/projects/atlas/settings")).toEqual({
      id: "atlas",
    });
  });

  it("rejects invalid and duplicate route params at the route grammar seam", () => {
    expect(() => parseRoutePathSegments("/projects/:123")).toThrow(InvalidRouteParam);
    expect(() => parseRoutePathSegments("/projects/:?")).toThrow(InvalidRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id/:id")).toThrow(DuplicateRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id/:id?")).toThrow(DuplicateRouteParam);
    expect(() => parseRoutePathSegments("/projects/:id?/:id?")).toThrow(DuplicateRouteParam);
    expect(() => buildRoutePath("/projects/:id/:id", { id: "atlas" })).toThrow(DuplicateRouteParam);
    expect(() => matchRoutePath("/projects/:id/:id", "/projects/atlas/settings")).toThrow(
      DuplicateRouteParam,
    );
  });

  it("matches route params and search", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      search: Schema.Struct({ tab: Schema.optional(Schema.Literal("activity")) }),
    });

    const match = Route.match([ProjectRoute] as const, "/projects/atlas?tab=activity");

    expect(match?.params.id).toBe("atlas");
    expect(match?.search.tab).toBe("activity");
    expect(match?.href).toBe("/projects/atlas?tab=activity");
  });

  it("matches static routes before dynamic routes when caller order is reversed", () => {
    const ProjectRoute = Route.define("/projects/:id", {});
    const ProjectSettingsRoute = Route.define("/projects/settings", {});

    const match = Route.match([ProjectRoute, ProjectSettingsRoute] as const, "/projects/settings");

    expect(match?.route).toBe(ProjectSettingsRoute);
    expect(match?.params).toEqual({});
  });

  it("keeps caller order for same-specificity dynamic routes", () => {
    const ProjectBySlugRoute = Route.define("/projects/:slug", {});
    const ProjectByIdRoute = Route.define("/projects/:id", {});

    const match = Route.match([ProjectBySlugRoute, ProjectByIdRoute] as const, "/projects/atlas");

    expect(match?.route).toBe(ProjectBySlugRoute);
    expect(match?.params).toEqual({ slug: "atlas" });
  });

  it("runs route preload as an Effect", () => {
    let preloaded = "";
    const ProjectRoute = Route.define("/projects/:id", {
      preload: ({ params }) =>
        Effect.sync(() => {
          preloaded = params.id;
        }),
    });
    const match = Route.match([ProjectRoute], "/projects/atlas");

    expect(match).toBeDefined();
    const effect = Route.preload(match!);
    expect(preloaded).toBe("");

    return Effect.runPromise(
      effect.pipe(
        Effect.tap(() => Effect.sync(() => expect(preloaded).toBe("atlas"))),
        Effect.asVoid,
      ),
    );
  });

  it("reports synchronous preload throws as defects inside the returned Effect", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      preload: () => {
        throw "preload-failed";
      },
    });
    const match = Route.match([ProjectRoute], "/projects/atlas");

    expect(match).toBeDefined();
    let effect: Effect.Effect<void, RoutePreloadError> | undefined;
    expect(() => {
      effect = Route.preload(match!);
    }).not.toThrow();

    return Effect.runPromise(
      Effect.exit(effect!).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              expect(Cause.hasFails(exit.cause)).toBe(false);
              expect(Cause.squash(exit.cause)).toBe("preload-failed");
            }
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("reports erased Promise-shaped preload returns as defects", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      preload: () => Promise.resolve(undefined) as never,
    });
    const match = Route.match([ProjectRoute], "/projects/atlas");

    expect(match).toBeDefined();

    return Effect.runPromise(
      Effect.exit(Route.preload(match!)).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              expect(Cause.hasFails(exit.cause)).toBe(false);
              expect(Cause.squash(exit.cause)).toBeInstanceOf(EffectInputPromiseRejected);
            }
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("fails preload with the route's typed error", () =>
    Effect.gen(function* () {
      class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
        id: Schema.String,
      }) {}
      const ProjectRoute = Route.define("/projects/:id", {
        error: ProjectNotFound,
        preload: ({ params }) => Effect.fail(new ProjectNotFound({ id: params.id })),
      });
      const match = Route.match([ProjectRoute], "/projects/atlas")!;

      const error = yield* Effect.flip(Route.preload(match));
      expectTypeOf(error).toEqualTypeOf<RoutePreloadError<ProjectNotFound>>();
      expect(error.cause).toBeInstanceOf(ProjectNotFound);
      expect(error.cause.id).toBe("atlas");
      expect(error.message).toBe(
        'Route "/projects/:id" failed to preload "/projects/atlas": ProjectNotFound',
      );
    }).pipe(Effect.runPromise));

  it("round-trips a typed preload failure through its error schema snapshot", () =>
    Effect.gen(function* () {
      class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
        id: Schema.String,
        at: Schema.Date,
      }) {}
      const ProjectRoute = Route.define("/projects/:id", {
        error: ProjectNotFound,
        preload: ({ params }) =>
          Effect.fail(new ProjectNotFound({ id: params.id, at: new Date(0) })),
      });
      const match = Route.match([ProjectRoute], "/projects/atlas")!;
      const error = yield* Effect.flip(Route.preload(match));

      const snapshot = yield* Route.preloadFailureSnapshot(ProjectRoute, error);
      expect(snapshot).toEqual({
        path: "/projects/:id",
        href: "/projects/atlas",
        failure: {
          _tag: "Encoded",
          value: { _tag: "ProjectNotFound", id: "atlas", at: "1970-01-01T00:00:00.000Z" },
        },
      });

      const wire = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
      const cause = Route.preloadFailureCauseFromSnapshot(ProjectRoute, wire);
      const decoded = cause.reasons.find(Cause.isFailReason)?.error;
      expect(decoded).toBeInstanceOf(RoutePreloadError);
      expect(decoded?.cause).toBeInstanceOf(ProjectNotFound);
      expect(decoded?.cause).toMatchObject({ id: "atlas", at: new Date(0) });
    }).pipe(Effect.runPromise));

  it("keeps only the failure tag for routes without an error schema", () =>
    Effect.gen(function* () {
      class ProjectMissing extends Schema.TaggedError<ProjectMissing>()("ProjectMissing", {
        secret: Schema.String,
      }) {}
      const ProjectRoute = Route.define("/projects/:id", {
        preload: () => Effect.fail(new ProjectMissing({ secret: "db-host" })),
      });
      const error = yield* Effect.flip(
        Route.preload(Route.match([ProjectRoute], "/projects/atlas")!),
      );

      const snapshot = yield* Route.preloadFailureSnapshot(ProjectRoute, error);
      expect(snapshot.failure).toEqual({ _tag: "Untyped", tag: "ProjectMissing" });
      const decoded = Route.preloadFailureCauseFromSnapshot(ProjectRoute, snapshot).reasons.find(
        Cause.isFailReason,
      )?.error;
      expect(error.cause).toEqual(new RoutePreloadUntypedFailure({ tag: "ProjectMissing" }));
      expect(decoded?.cause).toEqual(new RoutePreloadUntypedFailure({ tag: "ProjectMissing" }));
    }).pipe(Effect.runPromise));

  it("turns failures that cannot cross the wire with the error schema into codec defects", () =>
    Effect.gen(function* () {
      class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
        id: Schema.String,
      }) {}
      const ProjectRoute = Route.define("/projects/:id", {
        error: ProjectNotFound,
        preload: () => Effect.fail("not-a-project-not-found" as never),
      });
      const error = yield* Effect.flip(
        Route.preload(Route.match([ProjectRoute], "/projects/atlas")!),
      );

      const snapshot = yield* Route.preloadFailureSnapshot(ProjectRoute, error);
      expect(snapshot.failure).toEqual({ _tag: "Unencodable" });
      expect(JSON.stringify(snapshot)).not.toContain("not-a-project-not-found");

      const defect = (failure: Route.PreloadFailureEncoding) =>
        Cause.squash(Route.preloadFailureCauseFromSnapshot(ProjectRoute, { ...snapshot, failure }));
      expect(defect({ _tag: "Unencodable" })).toEqual(
        new RoutePreloadFailureCodecError({
          path: "/projects/:id",
          href: "/projects/atlas",
          operation: "encode",
        }),
      );
      expect(defect({ _tag: "Encoded", value: { _tag: "ProjectNotFound" } })).toMatchObject({
        _tag: "RoutePreloadFailureCodecError",
        operation: "decode",
      });
      expect(defect({ _tag: "Untyped", tag: "ProjectNotFound" })).toMatchObject({
        _tag: "RoutePreloadFailureCodecError",
        operation: "decode",
      });
    }).pipe(Effect.runPromise));

  it("rejects preload failures outside the route error schema at compile time", () => {
    class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
      id: Schema.String,
    }) {}
    Route.define("/projects/:id", {
      // @ts-expect-error preload may fail only with the route error schema's type
      error: ProjectNotFound,
      preload: () => Effect.fail("missing"),
    });
  });

  it("plans route preload resources and hydration payloads", () => {
    const Project = Resource.define<string, { readonly id: string; readonly name: string }>({
      name: "Route.Project.plan",
      load: (id) => Effect.succeed({ id, name: "Atlas" }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      preload: ({ params }) => Resource.preload(Project(params.id)),
    });

    return Effect.runPromise(
      Route.planNavigation([ProjectRoute] as const, "/projects/atlas").pipe(
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
                value: { id: "atlas", name: "Atlas" },
              },
            });
            expect(Effect.runSync(Resource.read(Project("atlas")))).toEqual({
              id: "atlas",
              name: "Atlas",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("describes declared route preload resource families without executing preload", () => {
    let ran = false;
    const Project = Resource.define({
      name: "Route.Project.preload-diagnostics",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      preloadResources: [Project, Project("atlas"), "Route.Project.extra"],
      preloadCollections: [{ name: "Route.Project.collection" }, "Route.Project.collection.extra"],
      preload: () =>
        Effect.sync(() => {
          ran = true;
        }),
    });
    const UnknownRoute = Route.define("/unknown", {
      preload: () => Effect.void,
    });
    const PlainRoute = Route.define("/plain", {});

    expect(Route.preloadResourceFamilies(ProjectRoute)).toEqual([
      "Route.Project.extra",
      "Route.Project.preload-diagnostics",
    ]);
    expect(Route.preloadCollectionNames(ProjectRoute)).toEqual([
      "Route.Project.collection",
      "Route.Project.collection.extra",
    ]);
    expect(Route.describePreloadResources(ProjectRoute)).toEqual({
      status: "declared",
      families: ["Route.Project.extra", "Route.Project.preload-diagnostics"],
    });
    expect(Route.describePreloadCollections(ProjectRoute)).toEqual({
      status: "declared",
      collections: ["Route.Project.collection", "Route.Project.collection.extra"],
    });
    expect(Route.describePreloadResources(UnknownRoute)).toEqual({
      status: "unknown",
      families: [],
    });
    expect(Route.describePreloadCollections(UnknownRoute)).toEqual({
      status: "unknown",
      collections: [],
    });
    expect(Route.describePreloadResources(PlainRoute)).toEqual({
      status: "none",
      families: [],
    });
    expect(Route.describePreloadCollections(PlainRoute)).toEqual({
      status: "none",
      collections: [],
    });
    expect(ran).toBe(false);
  });

  it("plans not found routes without running preload", () => {
    const Home = Route.define("/", {});

    return Effect.runPromise(
      Route.planNavigation([Home] as const, "/missing").pipe(
        Effect.tap((plan) =>
          Effect.sync(() =>
            expect(plan).toEqual({
              _tag: "NotFound",
              href: "/missing",
              match: undefined,
              refs: [],
              resources: { resources: [] },
            }),
          ),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("captures route schema decode failures inside navigation effects", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number }),
    });

    let effect:
      | Effect.Effect<Route.NavigationPlan<typeof ProjectRoute>, Route.NavigationPlanError>
      | undefined;
    expect(() => {
      effect = Route.planNavigation([ProjectRoute] as const, "/projects/atlas");
    }).not.toThrow();

    return Effect.runPromise(
      Effect.flip(effect!).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect(error).toMatchObject({ input: "/projects/atlas" });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("captures route schema decode failures inside match effects", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number }),
    });

    return Effect.runPromise(
      Effect.flip(matchRoutes([ProjectRoute] as const, "/projects/atlas")).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(RouteNavigationError);
            expect(error.input).toBe("/projects/atlas");
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("captures route grammar failures inside match effects", () => {
    const DuplicateParamRoute = Route.define("/projects/:id/:id", {});
    const InvalidParamRoute = Route.define("/invalid-projects/:123", {});

    return Effect.runPromise(
      Effect.gen(function* () {
        const duplicateError = yield* Effect.flip(
          matchRoutes([DuplicateParamRoute] as const, "/projects/atlas/settings"),
        );
        const invalidError = yield* Effect.flip(
          matchRoutes([InvalidParamRoute] as const, "/invalid-projects/atlas"),
        );

        expect(duplicateError).toBeInstanceOf(RouteNavigationError);
        expect(duplicateError.input).toBe("/projects/atlas/settings");
        expect(duplicateError.cause).toBeInstanceOf(DuplicateRouteParam);
        expect(invalidError).toBeInstanceOf(RouteNavigationError);
        expect(invalidError.input).toBe("/invalid-projects/atlas");
        expect(invalidError.cause).toBeInstanceOf(InvalidRouteParam);
      }),
    );
  });

  it("keeps schema decode failures synchronous for match helpers", () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.Number }),
    });

    expect(() => Route.match([ProjectRoute], "/projects/atlas")).toThrow();
    expect(() => Route.match([ProjectRoute] as const, "/projects/atlas")).toThrow();
  });
});

describe("Server", () => {
  it("runs Effect-backed server functions", () => {
    const getNumber = Server.implement(Server.contract<void, number>("Number.get"), (_input) =>
      Effect.succeed(42),
    );

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
              errorSchema: false,
            },
          ]);
        });
      }),
    );
  });

  it("invokes schema-backed server functions across the wire", () => {
    const echo = Server.implement(
      Server.contract<{ readonly value: string }, { readonly value: string }>("Echo", {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      }),
      ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const success = yield* echo.invoke({ value: "ada" });
        const invalid = yield* Effect.exit(echo.invoke({ value: 1 }));

        yield* Effect.sync(() => {
          expect(success).toEqual({ value: "ADA" });
          expect(Exit.isFailure(invalid)).toBe(true);
        });
      }),
    );
  });

  it("provides request context to server routes", () => {
    const serverRoute = Server.route("GET", "/hello", () =>
      RequestContext.use(({ url }) => Effect.succeed(new Response(url.pathname))),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Server.handleRoute(
          serverRoute,
          new Request("https://example.com/hello"),
        );
        const responseText = yield* Effect.promise(() => response.text());
        const effectResponse = yield* Server.handleRoute(
          serverRoute,
          new Request("https://example.com/effect"),
        );
        const effectResponseText = yield* Effect.promise(() => effectResponse.text());

        yield* Effect.sync(() => {
          expect(responseText).toBe("/hello");
          expect(effectResponseText).toBe("/effect");
        });
      }),
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
      effect = Server.handleRoute(serverRoute, new Request("https://example.com/hello"));
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
              cause: "handler-failed",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("applies response context mutations from server routes", () => {
    const serverRoute = Server.route("GET", "/login", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setStatus(202, "Accepted");
          yield* response.setHeader("x-sunfall-arc-route", "response-context");
          yield* response.setCookie("session", "abc123", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
          });
          return new Response("ok");
        }),
      ),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Server.handleRoute(
          serverRoute,
          new Request("https://example.com/login"),
        );
        const body = yield* Effect.promise(() => response.text());

        yield* Effect.sync(() => {
          expect(response.status).toBe(202);
          expect(response.statusText).toBe("Accepted");
          expect(response.headers.get("x-sunfall-arc-route")).toBe("response-context");
          expect(response.headers.getSetCookie()).toEqual([
            "session=abc123; Path=/; HttpOnly; SameSite=Lax",
          ]);
          expect(body).toBe("ok");
        });
      }),
    );
  });

  it("rejects invalid SameSite response cookie attributes at runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const serverRoute = Server.route("GET", "/bad-cookie", () =>
          ResponseContext.use((response) =>
            Effect.gen(function* () {
              yield* response.setCookie("session", "abc123", {
                sameSite: "Loose" as never,
              });
              return new Response("ok");
            }),
          ),
        );
        const failure = yield* Effect.flip(
          Server.handleRoute(serverRoute, new Request("https://example.com/bad-cookie")),
        );

        expect(failure).toBeInstanceOf(ResponseCookieSerializationError);
        expect(failure).toMatchObject({
          attribute: "SameSite",
        });
        expect((failure as ResponseCookieSerializationError).cause).toBe("Loose");
      }),
    ));

  it("keeps malformed percent-encoded request cookies as their raw value", () => {
    const serverRoute = Server.route("GET", "/cookies", () =>
      RequestContext.use(({ cookies }) =>
        Effect.succeed(new Response(cookies.get("session") ?? "missing")),
      ),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Server.handleRoute(
          serverRoute,
          new Request("https://example.com/cookies", {
            headers: {
              cookie: "session=%E0%A4%A",
            },
          }),
        );
        const body = yield* Effect.promise(() => response.text());
        expect(body).toBe("%E0%A4%A");
      }),
    );
  });

  it("reports invalid response cookie attributes as typed Effect errors", () => {
    const serverRoute = Server.route("GET", "/cookies", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setCookie("session", "abc123", {
            path: "/; HttpOnly",
            maxAge: Number.POSITIVE_INFINITY,
          });
          return new Response("ok");
        }),
      ),
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRoute(serverRoute, new Request("https://example.com/cookies"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ResponseCookieSerializationError);
            expect(error).toMatchObject({
              _tag: "ResponseCookieSerializationError",
              attribute: "Path",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("reports invalid response headers through ServerRouteHandlerError", () => {
    const serverRoute = Server.route("GET", "/headers", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setHeader("bad header", "value");
          return new Response("ok");
        }),
      ),
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRoute(serverRoute, new Request("https://example.com/headers"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "ResponseContext.setHeader",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("reports invalid response status application through ServerRouteHandlerError", () => {
    const serverRoute = Server.route("GET", "/status", () =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setStatus(99);
          return new Response("ok");
        }),
      ),
    );

    return Effect.runPromise(
      Effect.flip(Server.handleRoute(serverRoute, new Request("https://example.com/status"))).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error).toBeInstanceOf(ServerRouteHandlerError);
            expect(error.cause).toMatchObject({
              _tag: "EffectInputCallbackError",
              operation: "ResponseContext.apply",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });
});
