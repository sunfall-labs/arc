import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Action, ActionResult, defineApp, makeRuntime, Resource, ResponseContext, route, Route, runWithRuntime, Server, ServerClient } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import type { DevtoolsRequestTrace } from "@effect-ui/devtools";
import {
  createServerActionResponseEffect,
  createHydrationScript,
  createStreamHydrationScript,
  createServerRpcResponseEffect,
  createRequestHandlerEffect,
  createRequestHandler,
  hydrateFromDocument,
  hydrateStartHydrationChunksFromDocument,
  hydrateStartHydrationChunksFromDocumentEffect,
  makeRpcClient,
  preloadRequest,
  preloadRequestEffect,
  serverActionPath,
  serverRpcPath,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationSequenceAttribute,
  startActionForm,
  StartHydrationChunkParseError,
  StartAction,
  submitStartActionEffect,
  defineFileRoute
} from "../src/index.js";
import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport
} from "../src/diagnostics-report.js";
import {
  parseStartDiagnosticsCliArgs,
  runStartDiagnosticsCli,
  runStartDiagnosticsCliEffect
} from "../src/cli.js";
import {
  actionManifestVirtualModuleId,
  appGraphVirtualModuleId,
  defaultFileRouteGeneratedFile,
  defaultFileRouteDirectory,
  discoverFileRoutes,
  effectUiStart,
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
  handleSsrDevRequest,
  handleSsrDevMiddlewareEffect,
  handleSsrDevRequestEffect,
  isServerOnlyModule,
  loadStartAppGraphDiagnostics,
  loadStartAppGraphDiagnosticsEffect,
  makeStartBuildAppGraphEffect,
  resolveStartHandler,
  serializeStartActionManifest,
  serializeStartAppGraph,
  serializeStartFileRouteManifest,
  serializeStartServerFunctionManifest,
  serverFunctionManifestVirtualModuleId,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartHandlerNotFound,
  StartServerOnlyModuleError,
  validateStartBuildPolicyEffect,
  shouldHandleSsrRequest
} from "../src/vite.js";

const scriptText = (script: string): string =>
  script.replace(/^<script[^>]*>/, "").replace("</script>", "");

const makeStreamHydrationElement = (script: string, sequence: number) => {
  const attributes = new Map<string, string>([
    [streamHydrationSequenceAttribute, String(sequence)]
  ]);

  return {
    textContent: scriptText(script),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    }
  };
};

const workspacePackageAlias = (path: string): string =>
  join(process.cwd(), path);

const startDiagnosticsRunnerViteConfig = () => ({
  resolve: {
    alias: [
      { find: "effect", replacement: workspacePackageAlias("node_modules/effect/dist/index.js") },
      { find: "@effect-ui/core", replacement: workspacePackageAlias("packages/core/src/index.ts") },
      { find: "@effect-ui/db", replacement: workspacePackageAlias("packages/db/src/index.ts") },
      { find: "@effect-ui/start", replacement: workspacePackageAlias("packages/start/src/index.ts") },
      { find: "@effect-ui/start/vite", replacement: workspacePackageAlias("packages/start/src/vite.ts") }
    ]
  }
});

describe("Effect UI Start", () => {
  it("defines file routes with the same typed href contract as core routes", () => {
    const ProjectRoute = defineFileRoute("/projects/:id")({
      params: Schema.Struct({ id: Schema.String })
    });

    expect(Route.href(ProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
  });

  it("preloads matched route resources into a hydration payload", async () => {
    const Project = Resource.family({
      name: "Start.Project.byId",
      load: (id: string) => Effect.succeed({ id, name: "Atlas" })
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });

    const result = await preloadRequest(
      app,
      new Request("https://example.com/projects/atlas")
    );

    expect(result.match?.params.id).toBe("atlas");
    expect(result.routePlan).toMatchObject({
      _tag: "Matched",
      href: "/projects/atlas"
    });
    expect(result.routePlan.refs.map((ref) => ref.key)).toEqual([Project("atlas").key]);
    expect(result.resources.resources).toHaveLength(1);
    expect(result.resources.resources[0]).toMatchObject({
      name: "Start.Project.byId",
      input: "atlas",
      state: {
        _tag: "Success",
        value: { id: "atlas", name: "Atlas" }
      }
    });
  });

  it("passes hydration script to custom renderers", async () => {
    const Project = Resource.family({
      name: "Start.Project.render",
      load: (id: string) => Effect.succeed({ id })
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      render: ({ match, hydrationScript }) =>
        `<html><body><main>${match?.href}</main>${hydrationScript}</body></html>`
    });

    const response = await handler(new Request("https://example.com/projects/kepler"));
    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain("<main>/projects/kepler</main>");
    expect(html).toContain("Start.Project.render");
    expect(html).toContain("id=\"__EFFECT_UI_HYDRATION__\"");
  });

  it("emits Devtools-compatible request traces for SSR requests", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Project = Resource.family({
      name: "Start.Project.trace",
      load: (id: string) => Effect.succeed({ id })
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: ({ match }) => `<html><body><main>${match?.href}</main></body></html>`
    });

    const response = await handler(
      new Request("https://example.com/projects/atlas?tab=activity", {
        headers: {
          "x-effect-ui-request-id": "req-ssr-atlas",
          cookie: "session=redacted"
        }
      })
    );

    expect(traces).toEqual([]);
    await expect(response.text()).resolves.toContain("/projects/atlas?tab=activity");

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-ssr-atlas",
          method: "GET",
          path: "/projects/atlas",
          transport: "ssr",
          cookies: [
            {
              name: "session",
              value: "redacted"
            }
          ]
        }),
        response: expect.objectContaining({
          status: 200
        }),
        services: ["RequestContext", "ResponseContext"],
        routePlan: expect.objectContaining({
          _tag: "Matched",
          href: "/projects/atlas?tab=activity",
          resources: [
            {
              key: Project("atlas").key,
              family: "Start.Project.trace",
              input: "atlas"
            }
          ]
        }),
        resources: [
          {
            key: Project("atlas").key,
            family: "Start.Project.trace",
            input: "atlas"
          }
        ],
        collections: [],
        serverFunctions: [],
        actions: [],
        fibers: [
          {
            name: "request-runtime",
            status: "done"
          }
        ],
        streams: [
          expect.objectContaining({
            name: "response",
            state: "closed"
          })
        ],
        status: "success",
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "stream-close",
          startedAt: expect.any(Number),
          completedAt: expect.any(Number),
          durationMillis: expect.any(Number),
          beforeDispose: expect.objectContaining({
            fiberCount: expect.any(Number),
            familyCount: expect.any(Number),
            moduleCount: expect.any(Number),
            tagCount: expect.any(Number)
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0
          })
        })
      })
    ]);
  });

  it("uses a fresh resource store for each SSR request", async () => {
    let loads = 0;
    const Project = Resource.family({
      name: "Start.Project.request-store",
      load: (id: string) => Effect.sync(() => ({
        id,
        sequence: ++loads
      }))
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      render: ({ match }) => {
        const id = match?.params.id ?? "missing";
        const project = Resource.read(Project(id));
        return `<html><body><main>${project.id}:${project.sequence}</main></body></html>`;
      }
    });

    const first = await handler(new Request("https://example.com/projects/atlas"));
    const second = await handler(new Request("https://example.com/projects/atlas"));

    await expect(first.text()).resolves.toContain("atlas:1");
    await expect(second.text()).resolves.toContain("atlas:2");
    expect(loads).toBe(2);
  });

  it("dehydrates DB collections from the SSR request runtime", async () => {
    const Projects = Collection.define<{ readonly id: string; readonly name: string; readonly sequence: number }>({
      name: "Start.Collection.request-store",
      getKey: (project) => project.id
    });
    let sequence = 0;
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) =>
        Projects.writeInsertEffect({
          id: params.id,
          name: `Project ${params.id}`,
          sequence: ++sequence
        })
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      collections: [Projects],
      render: ({ collections, hydrationScript }) => {
        const project = Projects.rows()[0];
        return `<html><body><main>${project?.id}:${project?.sequence}</main><aside>${collections.collections[0]?.rows.length}</aside>${hydrationScript}</body></html>`;
      }
    });

    const first = await handler(new Request("https://example.com/projects/atlas"));
    const second = await handler(new Request("https://example.com/projects/atlas"));
    const firstHtml = await first.text();
    const secondHtml = await second.text();

    expect(firstHtml).toContain("<main>atlas:1</main>");
    expect(firstHtml).toContain("<aside>1</aside>");
    expect(firstHtml).toContain("Start.Collection.request-store");
    expect(firstHtml).toContain("\"collections\"");
    expect(secondHtml).toContain("<main>atlas:2</main>");
  });

  it("automatically dehydrates route-touched collection preloads", async () => {
    let projectLoads = 0;
    let taskLoads = 0;
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.route-touched.projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          projectLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        })
    });
    const Tasks = Collection.define<{ readonly id: string; readonly title: string }>({
      name: "Start.Collection.route-touched.tasks",
      getKey: (task) => task.id,
      load: () =>
        Effect.sync(() => {
          taskLoads += 1;
          return [{ id: "ship", title: "Ship it" }];
        })
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: () => Projects.preloadEffect()
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });

    const result = await preloadRequest(
      app,
      new Request("https://example.com/projects/atlas")
    );

    expect(projectLoads).toBe(1);
    expect(taskLoads).toBe(0);
    expect(result.collectionPreload.routeTouchedCollections.map((collection) => collection.name)).toEqual([
      "Start.Collection.route-touched.projects"
    ]);
    expect(result.collectionPreload.registeredCollections).toEqual([]);
    expect(result.collectionPreload.dehydratedCollections.map((collection) => collection.name)).toEqual([
      "Start.Collection.route-touched.projects"
    ]);
    expect(result.collections.collections.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-touched.projects"
    ]);
    expect(result.hydration.collections?.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-touched.projects"
    ]);
    expect(result.collections.collections[0]?.rows).toEqual([
      {
        key: "atlas",
        value: { id: "atlas", name: "Atlas" },
        synced: true,
        origin: "remote"
      }
    ]);

    const handler = createRequestHandler(app, {
      render: ({ collectionPreload, collections, hydrationScript }) =>
        `<html><body><main>${collectionPreload.routeTouchedCollections.map((collection) => collection.name).join(",")}</main><aside>${collections.collections.length}</aside>${hydrationScript}</body></html>`
    });
    const response = await handler(new Request("https://example.com/projects/atlas"));
    const html = await response.text();

    expect(projectLoads).toBe(2);
    expect(taskLoads).toBe(0);
    expect(html).toContain("<main>Start.Collection.route-touched.projects</main>");
    expect(html).toContain("<aside>1</aside>");
    expect(html).toContain("\"Start.Collection.route-touched.projects\"");
    expect(html).not.toContain("Start.Collection.route-touched.tasks");
  });

  it("preloads and dehydrates matched route-declared collections", async () => {
    let projectLoads = 0;
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.route-declared.projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          projectLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        })
    });
    const ProjectRoute = route("/declared-projects", {
      preloadCollections: [Projects]
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {}
    });

    const result = await preloadRequest(
      app,
      new Request("https://example.com/declared-projects")
    );

    expect(projectLoads).toBe(1);
    expect(result.collectionPreload.routeTouchedCollections).toEqual([]);
    expect(result.collectionPreload.routeDeclaredCollections.map((collection) => collection.name)).toEqual([
      "Start.Collection.route-declared.projects"
    ]);
    expect(result.collectionPreload.registeredCollections).toEqual([]);
    expect(result.collectionPreload.dehydratedCollections.map((collection) => collection.name)).toEqual([
      "Start.Collection.route-declared.projects"
    ]);
    expect(result.collections.collections[0]?.rows).toEqual([
      {
        key: "atlas",
        value: { id: "atlas", name: "Atlas" },
        synced: true,
        origin: "remote"
      }
    ]);

    const handler = createRequestHandler(app, {
      render: ({ collectionPreload, collections, hydrationScript }) =>
        `<html><body><main>${collectionPreload.routeDeclaredCollections.map((collection) => collection.name).join(",")}</main><aside>${collections.collections.length}</aside>${hydrationScript}</body></html>`
    });
    const response = await handler(new Request("https://example.com/declared-projects"));
    const html = await response.text();

    expect(projectLoads).toBe(2);
    expect(html).toContain("<main>Start.Collection.route-declared.projects</main>");
    expect(html).toContain("<aside>1</aside>");
    expect(html).toContain("\"Start.Collection.route-declared.projects\"");
  });

  it("preloads and renders with an app server layer", async () => {
    interface Projects {
      readonly get: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
    }
    const Projects = Context.Service<Projects>("@effect-ui/start/test/Projects");
    const ProjectsLive = Layer.succeed(Projects)({
      get: (id) => Effect.succeed({ id, name: "Layered Atlas" })
    });
    const Project = Resource.family({
      name: "Start.Project.layered",
      load: (id: string) => Projects.use((projects) => projects.get(id))
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id))
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
      server: ProjectsLive
    });

    const result = await Effect.runPromise(
      preloadRequestEffect(app, new Request("https://example.com/projects/atlas"))
    );
    const response = await Effect.runPromise(
      createRequestHandlerEffect(app, {
        render: ({ resources }) =>
          Effect.succeed(`<html><body>${resources.resources[0]?.state.value.name}</body></html>`)
      })(new Request("https://example.com/projects/atlas"))
    );

    expect(result.resources.resources[0]?.state.value).toEqual({
      id: "atlas",
      name: "Layered Atlas"
    });
    await expect(response.text()).resolves.toContain("Layered Atlas");
  });

  it("keeps request runtime fibers alive until streamed response bodies close", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    let interrupted = false;
    let fibers: Set<Fiber.Fiber<unknown, unknown>> | undefined;
    const handler = createRequestHandler(app, {
      render: ({ runtime }) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                interrupted = true;
              })
            ),
            Effect.forkDetach({ startImmediately: true })
          );
          runtime.resourceStore.fibers.add(fiber as Fiber.Fiber<unknown, unknown>);
          fibers = runtime.resourceStore.fibers;

          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode("<html>"));
                controller.enqueue(encoder.encode("streamed"));
                controller.close();
              }
            }),
            {
              headers: {
                "content-type": "text/html"
              }
            }
          );
        })
    });

    const response = await handler(new Request("https://example.com/"));

    expect(interrupted).toBe(false);
    expect(fibers?.size).toBe(1);
    await expect(response.text()).resolves.toContain("streamed");
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(fibers?.size).toBe(0);
    expect(interrupted).toBe(true);
  });

  it("emits request traces when streamed responses are cancelled", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    let cancelled: unknown;
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("chunk"));
            },
            cancel(reason) {
              cancelled = reason;
            }
          }),
          {
            headers: {
              "content-type": "text/html"
            }
          }
        )
    });

    const response = await handler(
      new Request("https://example.com/", {
        headers: {
          "x-effect-ui-request-id": "req-cancel"
        }
      })
    );
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false
    });
    await reader.cancel("client-disconnect");

    expect(cancelled).toBe("client-disconnect");
    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-cancel",
          transport: "ssr"
        }),
        status: "cancelled",
        streams: [
          expect.objectContaining({
            name: "response",
            state: "cancelled"
          })
        ],
        fibers: [
          {
            name: "request-runtime",
            status: "interrupted"
          }
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "client-disconnect",
          durationMillis: expect.any(Number),
          beforeDispose: expect.objectContaining({
            fiberCount: expect.any(Number)
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0
          })
        })
      })
    ]);
  });

  it("emits request traces when request handlers fail", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () => Effect.fail("render-failed")
    });

    await expect(
      handler(
        new Request("https://example.com/", {
          headers: {
            "x-effect-ui-request-id": "req-failure"
          }
        })
      )
    ).rejects.toBe("render-failed");

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-failure",
          transport: "ssr"
        }),
        status: "failure",
        streams: [],
        fibers: [
          {
            name: "request-runtime",
            status: "failed"
          }
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "request-failure",
          durationMillis: expect.any(Number),
          beforeDispose: expect.objectContaining({
            fiberCount: expect.any(Number)
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0
          })
        })
      })
    ]);
  });

  it("keeps a Promise request handler as the host boundary", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    const handler = createRequestHandler(app);

    await expect(handler(new Request("https://example.com/"))).resolves.toBeInstanceOf(Response);
  });

  it("applies response context mutations from Start render effects", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      render: () =>
        ResponseContext.use((response) =>
          Effect.gen(function* () {
            yield* response.setStatus(202);
            yield* response.setHeader("x-effect-ui-render-context", "yes");
            yield* response.setCookie("theme", "dark", {
              path: "/",
              secure: true,
              sameSite: "None"
            });
            return "<html><body>context</body></html>";
          })
        )
    });

    const response = await handler(new Request("https://example.com/"));

    expect(response.status).toBe(202);
    expect(response.headers.get("x-effect-ui-render-context")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.getSetCookie()).toEqual([
      "theme=dark; Path=/; Secure; SameSite=None"
    ]);
    await expect(response.text()).resolves.toContain("context");
  });

  it("serves server functions over the Start RPC endpoint", async () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>("Start.echo.rpc", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String })
    });
    const echo = Server.implement(Echo, ({ value }) =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setHeader("x-effect-ui-rpc-context", "yes");
          yield* response.setCookie("rpc", value, { path: "/rpc" });
          return { value: value.toUpperCase() };
        })
      )
    );
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const response = await Effect.runPromise(
      createServerRpcResponseEffect(
        app,
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: echo.name,
            input: { value: "ada" }
          })
        })
      )
    );

    await expect(response.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" }
    });
    expect(response.headers.get("x-effect-ui-rpc-context")).toBe("yes");
    expect(response.headers.getSetCookie()).toEqual(["rpc=ada; Path=/rpc"]);
  });

  it("emits request traces for RPC and Start action transports", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>("Start.echo.trace", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String })
    });
    const echo = Server.implement(Echo, ({ value }) => Effect.succeed({ value: value.toUpperCase() }));
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.trace.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() })
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      actions: [Ping],
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        })
    });

    const rpcResponse = await handler(
      new Request(`https://example.com${serverRpcPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-effect-ui-request-id": "req-rpc-trace"
        },
        body: JSON.stringify({
          name: echo.name,
          input: { value: "ada" }
        })
      })
    );
    await expect(rpcResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" }
    });

    const actionResponse = await handler(
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-effect-ui-request-id": "req-action-trace"
        },
        body: JSON.stringify({
          name: Ping.name,
          input: { value: "pong" }
        })
      })
    );
    await expect(actionResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "PONG" }
    });

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-rpc-trace",
          transport: "rpc",
          path: serverRpcPath
        }),
        serverFunctions: [
          {
            name: echo.name,
            status: "success"
          }
        ],
        actions: [],
        status: "success"
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-action-trace",
          transport: "action",
          path: serverActionPath
        }),
        serverFunctions: [],
        actions: [
          {
            name: Ping.name,
            state: "Success"
          }
        ],
        status: "success"
      })
    ]);
  });

  it("lets browser runtimes call server functions through ServerClient", async () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>("Start.echo.remote", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String })
    });
    const echo = Server.client(Echo);
    Server.implement(Echo, ({ value }) => Effect.succeed({ value: `server:${value}` }));
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app);
    const fetcher: typeof globalThis.fetch = (input, init) =>
      handler(new Request(input, init));
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        endpoint: `https://example.com${serverRpcPath}`,
        fetch: fetcher
      })
    );

    await expect(
      Effect.runPromise(Effect.provide(echo.effect({ value: "atlas" }), runtime))
    ).resolves.toEqual({ value: "server:atlas" });
  });

  it("round-trips schema-encoded server function failures", async () => {
    const ExampleError = Schema.TaggedStruct("ExampleError", {
      message: Schema.String
    });
    type ExampleErrorType = {
      readonly _tag: "ExampleError";
      readonly message: string;
    };
    const Fail = Server.contract<string, string, ExampleErrorType>("Start.fail.remote", {
      input: Schema.String,
      output: Schema.String,
      error: ExampleError
    });
    const fail = Server.client(Fail);
    Server.implement(Fail, () => Effect.fail({ _tag: "ExampleError" as const, message: "not today" }));
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app);
    const fetcher: typeof globalThis.fetch = (input, init) =>
      handler(new Request(input, init));
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        endpoint: `https://example.com${serverRpcPath}`,
        fetch: fetcher
      })
    );
    const exit = await Effect.runPromise(
      Effect.exit(Effect.provide(fail.effect("x"), runtime))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined).toEqual({
      _tag: "ExampleError",
      message: "not today"
    });
  });

  it("runs Start actions from JSON and form posts in the request runtime", async () => {
    const SubmitNameInput = Schema.Struct({
      name: Schema.String,
      redirectTo: Schema.optional(Schema.String)
    });
    type SubmitNameInput = typeof SubmitNameInput.Type;
    type SubmitNameResult = ActionResult<
      { readonly name: string },
      SubmitNameInput,
      string,
      string
    >;
    const SubmitNameResult = Schema.TaggedUnion({
      Success: {
        value: Schema.Struct({ name: Schema.String })
      },
      ValidationFailure: {
        fieldErrors: Schema.Struct({
          name: Schema.optional(Schema.Array(Schema.String))
        }),
        formErrors: Schema.Array(Schema.String),
        cause: Schema.optional(Schema.Unknown)
      },
      Redirect: {
        location: Schema.String,
        status: Schema.Number,
        replace: Schema.optional(Schema.Boolean)
      },
      Failure: {
        error: Schema.String
      }
    });
    interface Names {
      readonly submit: (input: SubmitNameInput) => Effect.Effect<SubmitNameResult>;
    }
    const Names = Context.Service<Names>("@effect-ui/start/test/Names");
    const submitted: Array<string> = [];
    const NamesLive = Layer.succeed(Names)({
      submit: (input) =>
        Effect.sync(() => {
          const name = input.name.trim();
          if (name.length < 3) {
            return ActionResult.validation<SubmitNameInput, string>({
              fieldErrors: {
                name: ["Use at least three characters."]
              },
              formErrors: []
            });
          }

          submitted.push(name);
          return input.redirectTo
            ? ActionResult.redirect(input.redirectTo, { status: 303, replace: true })
            : ActionResult.success({ name });
        })
    });
    const SubmitName = Action.define<SubmitNameInput, SubmitNameResult, never, Names>({
      name: "Start.action.submitName",
      input: SubmitNameInput,
      output: SubmitNameResult,
      run: (input) => Names.use((names) => names.submit(input))
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
      server: NamesLive
    });
    const handler = createRequestHandler(app, {
      actions: [SubmitName]
    });

    const validation = await Effect.runPromise(
      createServerActionResponseEffect(
        app,
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: SubmitName.name,
            input: { name: "Al" }
          })
        }),
        [SubmitName]
      )
    );
    const form = startActionForm(SubmitName, {
      input: {
        redirectTo: "/projects/atlas?tab=activity"
      }
    });
    const formBody = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value])
    );
    formBody.set("name", "Atlas Forms");
    const redirect = await handler(
      new Request(`https://example.com${form.action}`, {
        method: form.method.toUpperCase(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody
      })
    );

    expect(validation.status).toBe(422);
    await expect(validation.json()).resolves.toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: ["Use at least three characters."]
      }
    });
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe("/projects/atlas?tab=activity");
    expect(submitted).toEqual(["Atlas Forms"]);
  });

  it("discovers Start actions from the Action registry when no explicit list is supplied", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.registry.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() })
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const response = await createRequestHandler(app)(
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: Ping.name,
          input: { value: "registry" }
        })
      })
    );

    await expect(response.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "REGISTRY" }
    });
  });

  it("returns action invalidation hydration to JSON clients", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String
    });
    let project = {
      id: "atlas",
      name: "Initial"
    };
    const Project = Resource.family({
      name: "Start.action.Project.hydration",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project)
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.project.rename.hydration",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) =>
        Effect.sync(() => {
          project = { id, name };
          return project;
        }),
      invalidates: (_project, input) => [Project(input.id)]
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject]
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: typeof fetch = (input, init) => {
      const url = input instanceof Request
        ? input.url
        : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };

    try {
      await clientRuntime.runPromise(Resource.prefetchEffect(ref));

      const result = await Effect.runPromise(
        submitStartActionEffect(
          RenameProject,
          { id: "atlas", name: "Renamed From Server" },
          {
            fetch: fetcher,
            runtime: clientRuntime
          }
        )
      );

      expect(result).toMatchObject({
        _tag: "Success",
        value: {
          id: "atlas",
          name: "Renamed From Server"
        },
        invalidation: {
          entries: [
            {
              ref: {
                key: ref.key,
                family: "Start.action.Project.hydration",
                input: "atlas"
              }
            }
          ]
        },
        hydration: {
          resources: [
            {
              key: ref.key,
              state: {
                value: {
                  id: "atlas",
                  name: "Renamed From Server"
                }
              }
            }
          ]
        }
      });
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed From Server"
      });

      const action = StartAction.use(RenameProject, {
        fetch: fetcher,
        runtime: clientRuntime
      });
      await expect(
        action.submit({ id: "atlas", name: "Renamed Through StartAction" })
      ).resolves.toMatchObject({
        _tag: "Success",
        value: {
          id: "atlas",
          name: "Renamed Through StartAction"
        }
      });
      expect(action.invalidation.get()).toMatchObject({
        entries: [
          {
            ref: {
              key: ref.key,
              family: "Start.action.Project.hydration",
              input: "atlas"
            }
          }
        ]
      });
      expect(action.hydration.get()).toMatchObject({
        resources: [
          {
            key: ref.key,
            state: {
              value: {
                id: "atlas",
                name: "Renamed Through StartAction"
              }
            }
          }
        ]
      });
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed Through StartAction"
      });
    } finally {
      await clientRuntime.dispose();
    }
  });

  it("decodes Start action client success values with the action output schema", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.client.decode",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) => Effect.succeed({ id, name })
    });
    const badFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: {
              id: 123,
              name: "Bad Wire Value"
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );

    const exit = await Effect.runPromiseExit(
      submitStartActionEffect(
        RenameProject,
        { id: "atlas", name: "Atlas" },
        { fetch: badFetch }
      )
    );

    expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined).toBeInstanceOf(Schema.SchemaError);
  });

  it("replays semantic action tag invalidations on JSON clients", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String
    });
    const ProjectTag = Resource.tag<{ readonly id: string }>("Start.action.Project.tag", {
      key: ({ id }) => id
    });
    let project = {
      id: "atlas",
      name: "Initial"
    };
    const Project = Resource.family({
      name: "Start.action.Project.tagged",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
      provides: (value) => [ProjectTag({ id: value.id })]
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.project.rename.tagged",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) =>
        Effect.sync(() => {
          project = { id, name };
          return project;
        }),
      invalidates: (_project, input) => [ProjectTag({ id: input.id })]
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject]
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: typeof fetch = (input, init) => {
      const url = input instanceof Request
        ? input.url
        : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };

    try {
      await clientRuntime.runPromise(Resource.prefetchEffect(ref));

      const result = await Effect.runPromise(
        submitStartActionEffect(
          RenameProject,
          { id: "atlas", name: "Renamed Through Tag" },
          {
            fetch: fetcher,
            runtime: clientRuntime
          }
        )
      );

      expect(result).toMatchObject({
        _tag: "Success",
        invalidation: {
          targets: [
            {
              _tag: "Tag",
              key: "Start.action.Project.tag:atlas",
              name: "Start.action.Project.tag"
            }
          ],
          entries: []
        }
      });
      expect(result.hydration).toBeUndefined();
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed Through Tag"
      });
    } finally {
      await clientRuntime.dispose();
    }
  });

  it("exposes a StartAction client instance with Action-like state", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() })
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {}
    });
    const handler = createRequestHandler(app, {
      actions: [Ping]
    });
    const runtime = makeRuntime();
    const fetcher: typeof fetch = (input, init) => {
      const url = input instanceof Request
        ? input.url
        : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };
    const action = StartAction.use(Ping, { fetch: fetcher, runtime });

    try {
      expect(action.state.get()).toEqual({ _tag: "Idle" });
      const submission = action.submit({ value: "transport" });
      expect(action.state.get()).toMatchObject({
        _tag: "Pending",
        input: { value: "transport" }
      });

      await expect(submission).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "TRANSPORT" }
      });
      expect(action.state.get()).toMatchObject({
        _tag: "Success",
        value: {
          _tag: "Success",
          value: { value: "TRANSPORT" }
        }
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("applies action concurrency to native StartAction submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let requests = 0;
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.native-exhaust",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      policy: {
        concurrency: "exhaust"
      },
      run: ({ value }) => Effect.succeed({ value })
    });
    const fetcher: typeof fetch = async () => {
      const requestNumber = ++requests;
      await Effect.runPromise(Deferred.await(release));
      return new Response(
        JSON.stringify({
          _tag: "Success",
          value: { value: `response-${requestNumber}` }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };
    const runtime = makeRuntime();
    const action = StartAction.use(Ping, { fetch: fetcher, runtime });

    try {
      const first = runtime.runFork(action.submitEffect({ value: "first" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      const second = runtime.runFork(action.submitEffect({ value: "second" }));
      Effect.runSync(Deferred.succeed(release, undefined));

      await expect(runtime.runPromise(Fiber.join(first))).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "response-1" }
      });
      await expect(runtime.runPromise(Fiber.join(second))).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "response-1" }
      });
      expect(requests).toBe(1);
      expect(action.state.get()).toMatchObject({
        _tag: "Success",
        input: { value: "first" }
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("hydrates from a document script", () => {
    const User = Resource.family({
      name: "Start.User.document",
      load: (id: string) => Effect.succeed({ id, name: "Loaded" })
    });
    const ref = User("1");
    const payload = {
      resources: [
        {
          name: "Start.User.document",
          key: ref.key,
          input: "1",
          state: {
            _tag: "Success" as const,
            waiting: false as const,
            value: { id: "1", name: "Hydrated" },
            updatedAt: Date.now()
          }
        }
      ]
    };
    const script = createHydrationScript(payload);
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__"
          ? {
              textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", "")
            }
          : null
    };

    hydrateFromDocument(document as Pick<Document, "getElementById">);

    expect(Resource.read(ref)).toEqual({ id: "1", name: "Hydrated" });
  });

  it("hydrates DB collections from a document script", () => {
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.document",
      getKey: (project) => project.id
    });
    const payload = {
      resources: [],
      collections: [
        {
          name: "Start.Collection.document",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Hydrated Atlas" },
              synced: true,
              origin: "remote" as const
            }
          ],
          pendingMutations: [],
          updatedAt: Date.now()
        }
      ]
    };
    const script = createHydrationScript(payload);
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__"
          ? {
              textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", "")
            }
          : null
    };

    hydrateFromDocument(document as Pick<Document, "getElementById">, "__EFFECT_UI_HYDRATION__", {
      collections: [Projects]
    });

    expect(Projects.get("atlas")).toMatchObject({
      id: "atlas",
      name: "Hydrated Atlas",
      $synced: true
    });
  });

  it("hydrates browser payloads in an explicit runtime", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "Start.User.document-explicit-runtime",
        load: (id: string) => Effect.succeed({ id, name: "Loaded" })
      });
      const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
        name: "Start.Collection.document-explicit-runtime",
        getKey: (project) => project.id
      });
      const ref = User("1");
      const payload = {
        resources: [
          {
            name: "Start.User.document-explicit-runtime",
            key: ref.key,
            input: "1",
            state: {
              _tag: "Success" as const,
              waiting: false as const,
              value: { id: "1", name: "Runtime Hydrated" },
              updatedAt: 1
            }
          }
        ],
        collections: [
          {
            name: "Start.Collection.document-explicit-runtime",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Runtime Atlas" },
                synced: true,
                origin: "remote" as const
              }
            ],
            pendingMutations: [],
            updatedAt: 1
          }
        ]
      };
      const script = createHydrationScript(payload);
      const document = {
        getElementById: (id: string) =>
          id === "__EFFECT_UI_HYDRATION__"
            ? {
                textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", "")
              }
            : null
      };

      hydrateFromDocument(document as Pick<Document, "getElementById">, "__EFFECT_UI_HYDRATION__", {
        collections: [Projects],
        runtime
      });

      expect(Resource.status(ref)._tag).toBe("Initial");
      expect(Projects.get("atlas")).toBeUndefined();
      expect(runWithRuntime(runtime, () => Resource.read(ref))).toEqual({
        id: "1",
        name: "Runtime Hydrated"
      });
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        id: "atlas",
        name: "Runtime Atlas",
        $synced: true
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("hydrates document and stream payloads idempotently in an explicit runtime without duplicate resource loads", async () => {
    const runtime = makeRuntime();
    try {
      let loads = 0;
      const User = Resource.family({
        name: "Start.User.document-idempotent-runtime",
        load: (id: string) => Effect.sync(() => {
          loads += 1;
          return { id, name: "Loaded" };
        })
      });
      const ref = User("1");
      const payload = {
        resources: [
          {
            name: "Start.User.document-idempotent-runtime",
            key: ref.key,
            input: "1",
            state: {
              _tag: "Success" as const,
              waiting: false as const,
              value: { id: "1", name: "Hydrated" },
              updatedAt: 1
            }
          }
        ]
      };
      const mainText = scriptText(createHydrationScript(payload));
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScript(payload, 0),
        0
      );
      const document = {
        getElementById: (id: string) =>
          id === "__EFFECT_UI_HYDRATION__"
            ? { textContent: mainText }
            : null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : []
      };

      hydrateFromDocument(
        document as Parameters<typeof hydrateFromDocument>[0],
        "__EFFECT_UI_HYDRATION__",
        { runtime }
      );
      hydrateFromDocument(
        document as Parameters<typeof hydrateFromDocument>[0],
        "__EFFECT_UI_HYDRATION__",
        { runtime }
      );

      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBe("true");
      expect(Resource.status(ref)._tag).toBe("Initial");
      expect(runWithRuntime(runtime, () => Resource.read(ref))).toEqual({
        id: "1",
        name: "Hydrated"
      });
      await expect(runtime.runPromise(Resource.prefetchEffect(ref))).resolves.toEqual({
        id: "1",
        name: "Hydrated"
      });
      expect(loads).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });

  it("hydrates streamed collection chunks in sequence without replacing earlier chunks", async () => {
    const runtime = makeRuntime();
    try {
      const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
        name: "Start.Collection.streamed-sequence",
        getKey: (project) => project.id
      });
      const atlasPayload = {
        resources: [],
        collections: [
          {
            name: "Start.Collection.streamed-sequence",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Atlas" },
                synced: true,
                origin: "remote" as const
              }
            ],
            pendingMutations: [],
            updatedAt: 1
          }
        ]
      };
      const keplerPayload = {
        resources: [],
        collections: [
          {
            name: "Start.Collection.streamed-sequence",
            rows: [
              {
                key: "kepler",
                value: { id: "kepler", name: "Kepler" },
                synced: true,
                origin: "remote" as const
              }
            ],
            pendingMutations: [],
            updatedAt: 2
          }
        ]
      };
      const streamElements = [
        makeStreamHydrationElement(createStreamHydrationScript(keplerPayload, 1), 1),
        makeStreamHydrationElement(createStreamHydrationScript(atlasPayload, 0), 0)
      ];
      const document = {
        getElementById: () => null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? streamElements : []
      };

      const hydrated = await runtime.runPromise(
        hydrateStartHydrationChunksFromDocumentEffect(document, {
          collections: [Projects]
        })
      );
      const secondHydration = await runtime.runPromise(
        hydrateStartHydrationChunksFromDocumentEffect(document, {
          collections: [Projects]
        })
      );

      expect(
        hydrated.map((chunk) => chunk.payload.collections?.[0]?.rows[0]?.key)
      ).toEqual(["atlas", "kepler"]);
      expect(secondHydration).toEqual([]);
      expect(
        streamElements.map((element) => element.getAttribute(streamHydrationConsumedAttribute))
      ).toEqual(["true", "true"]);
      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual(
        ["atlas", "kepler"]
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("lets callers opt out of marking streamed hydration chunks consumed", async () => {
    const runtime = makeRuntime();
    try {
      const payload = {
        resources: []
      };
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScript(payload, 0),
        0
      );
      const document = {
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : []
      };

      const first = hydrateStartHydrationChunksFromDocument(document, {
        markConsumed: false,
        runtime
      });
      const second = hydrateStartHydrationChunksFromDocument(document, {
        markConsumed: false,
        runtime
      });

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects malformed streamed hydration chunks with typed repair guidance", () => {
    const element = {
      textContent: JSON.stringify({ resources: "invalid" }),
      getAttribute: (name: string) =>
        name === streamHydrationSequenceAttribute ? "4" : null
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : []
    };

    expect(() => hydrateStartHydrationChunksFromDocument(document)).toThrow(
      StartHydrationChunkParseError
    );
  });

  it("filters dev SSR requests to document navigations", () => {
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/projects/atlas",
        headers: { accept: "text/html" }
      })
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "HEAD",
        url: "/projects/atlas",
        headers: { accept: "*/*" }
      })
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/src/main.tsx",
        headers: { accept: "text/html" }
      })
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/projects/atlas",
        headers: { accept: "text/html" }
      })
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/__effect-ui/rpc",
        headers: { accept: "application/json" }
      })
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/__effect-ui/action",
        headers: { accept: "text/html" }
      })
    ).toBe(true);
  });

  it("keeps .server modules out of the client transform graph", () => {
    const plugin = effectUiStart();
    const transform = Array.isArray(plugin)
      ? plugin.find((item) => item && typeof item === "object" && "transform" in item)?.transform
      : plugin && typeof plugin === "object" && "transform" in plugin
        ? plugin.transform
        : undefined;

    expect(isServerOnlyModule("/src/domain.server.ts")).toBe(true);
    expect(isServerOnlyModule("/src/domain.contract.ts")).toBe(false);
    expect(() =>
      typeof transform === "function"
        ? transform.call({} as never, "", "/src/domain.server.ts", {})
        : undefined
    ).toThrow(StartServerOnlyModuleError);
    expect(
      typeof transform === "function"
        ? transform.call({} as never, "", "/src/domain.server.ts", { ssr: true })
        : undefined
    ).toBeNull();
  });

  it("emits a production-shaped server function manifest from the Vite preset", async () => {
    const manifest = serializeStartServerFunctionManifest({
      serverFunctionManifest: [
        {
          name: "Start.Project.manifest",
          module: "/src/project/project.server.ts",
          exportName: "getProject",
          clientModule: "/src/project/project.contract.ts",
          clientExportName: "getProject",
          inputSchema: true,
          outputSchema: true
        }
      ]
    });
    const plugin = effectUiStart({
      serverFunctionManifest: [
        {
          name: "Start.Project.manifest",
          module: "/src/project/project.server.ts",
          exportName: "getProject",
          clientModule: "/src/project/project.contract.ts",
          clientExportName: "getProject",
          inputSchema: true,
          outputSchema: true
        }
      ]
    });
    const config = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "config" in plugin &&
      typeof plugin.config === "function"
        ? plugin.config()
        : undefined;
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, serverFunctionManifestVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      entries: [
        {
          name: "Start.Project.manifest",
          server: {
            moduleKind: "server-only"
          },
          client: {
            _tag: "Import",
            module: "/src/project/project.contract.ts",
            moduleKind: "contract"
          }
        }
      ]
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_SERVER_FUNCTIONS__: manifest
      }
    });
    expect(resolved).toBe(`\0${serverFunctionManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("Start.Project.manifest");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("emits a production-shaped action manifest from the Vite preset", async () => {
    const manifest = serializeStartActionManifest({
      actionManifest: [
        {
          name: "Start.Project.renameAction",
          module: "/src/project/domain.ts",
          exportName: "RenameProject",
          clientModule: "/src/project/domain.ts",
          clientExportName: "RenameProject",
          inputSchema: true,
          outputSchema: true
        }
      ]
    });
    const plugin = effectUiStart({
      actionManifest: [
        {
          name: "Start.Project.renameAction",
          module: "/src/project/domain.ts",
          exportName: "RenameProject",
          clientModule: "/src/project/domain.ts",
          clientExportName: "RenameProject",
          inputSchema: true,
          outputSchema: true
        }
      ]
    });
    const config = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "config" in plugin &&
      typeof plugin.config === "function"
        ? plugin.config()
        : undefined;
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, actionManifestVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      actionPath: "/__effect-ui/action",
      entries: [
        {
          name: "Start.Project.renameAction",
          server: {
            moduleKind: "shared"
          },
          client: {
            _tag: "Import",
            module: "/src/project/domain.ts",
            moduleKind: "shared"
          }
        }
      ]
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_ACTIONS__: manifest
      }
    });
    expect(resolved).toBe(`\0${actionManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("Start.Project.renameAction");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("emits and loads a production-shaped file route manifest from the Vite preset", async () => {
    const options = {
      fileRoutes: [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx"
      ],
      fileRouteOptions: {
        routeDirectory: "src/routes"
      }
    };
    const manifest = serializeStartFileRouteManifest(options);
    const plugin = effectUiStart(options);
    const config = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "config" in plugin &&
      typeof plugin.config === "function"
        ? plugin.config()
        : undefined;
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, fileRouteManifestVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      routeDirectory: "src/routes",
      entries: [
        {
          routeId: "route_root",
          routePath: "/",
          moduleId: "src/routes/index.tsx"
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          moduleId: "src/routes/projects/$id.tsx"
        }
      ]
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_FILE_ROUTES__: manifest
      }
    });
    expect(resolved).toBe(`\0${fileRouteManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("loads typed file route definitions from the Vite preset", async () => {
    const plugin = effectUiStart({
      fileRoutes: [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx"
      ],
      fileRouteOptions: {
        routeDirectory: "src/routes"
      }
    });
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, fileRouteDefinitionsVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(resolved).toBe(`\0${fileRouteDefinitionsVirtualModuleId}`);
    expect(String(loaded)).toContain('import { Route as route_root } from "/src/routes/index.js";');
    expect(String(loaded)).toContain('import { Route as route_projects_$id } from "/src/routes/projects/$id.js";');
    expect(String(loaded)).toContain('const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;');
    expect(String(loaded)).toContain("export { route_root, route_projects_$id };");
    expect(String(loaded)).toContain("export const routes = [route_root, route_projects_$id] as const;");
    expect(String(loaded)).toContain("export const routeTree = routes;");
    expect(String(loaded)).toContain("export default routes;");
  });

  it("discovers file routes from the Vite root when no explicit route input is supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-routes-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/_layout.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/types.d.ts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/readme.md"), "# project routes\n");

      const plugin = effectUiStart();
      const config = !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "config" in plugin &&
        typeof plugin.config === "function"
          ? await (plugin.config as (config: { readonly root: string }) => unknown)({ root })
          : undefined;
      const resolved = !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "resolveId" in plugin &&
        typeof plugin.resolveId === "function"
          ? await plugin.resolveId.call({} as never, fileRouteManifestVirtualModuleId, undefined, {})
          : undefined;
      const loaded = !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "load" in plugin &&
        typeof plugin.load === "function" &&
        typeof resolved === "string"
          ? await plugin.load.call({} as never, resolved, {})
          : undefined;

      expect(discoverFileRoutes({ root })).toEqual([
        "src/routes/index.tsx",
        "src/routes/projects/$id.tsx",
        "src/routes/projects/_layout.tsx"
      ]);
      expect(config).toMatchObject({
        define: {
          __EFFECT_UI_FILE_ROUTES__: expect.any(String)
        }
      });
      expect(
        JSON.parse(
          (config as { readonly define: Record<string, string> }).define.__EFFECT_UI_FILE_ROUTES__
        )
      ).toMatchObject({
        version: 1,
        routeDirectory: defaultFileRouteDirectory,
        entries: [
          {
            routeId: "route_root",
            routePath: "/",
            moduleId: "src/routes/index.tsx"
          },
          {
            routeId: "route_projects_$id",
            routePath: "/projects/:id",
            moduleId: "src/routes/projects/$id.tsx"
          }
        ]
      });
      expect(String(loaded)).toContain("src/routes/projects/$id.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes generated file route definitions into the Vite root", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");

      const plugin = effectUiStart();
      if (
        !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "configResolved" in plugin &&
        typeof plugin.configResolved === "function"
      ) {
        await plugin.configResolved.call({} as never, { root } as never);
      }

      const generatedPath = join(root, defaultFileRouteGeneratedFile);
      const generated = readFileSync(generatedPath, "utf8");

      expect(generated).toContain("This file is generated by @effect-ui/start. Do not edit.");
      expect(generated).toContain('import type { Route } from "@effect-ui/core";');
      expect(generated).toContain('import { Route as route_root } from "./routes/index.js";');
      expect(generated).toContain('import { Route as route_projects_$id } from "./routes/projects/$id.js";');
      expect(generated).toContain('const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;');
      expect(generated).toContain("export const routeTree = routes;");
      expect(generated).toContain('  "/projects/:id": route_projects_$id');
      expect(generated).toContain("export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]> };");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can disable generated file route definition writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-disabled-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = effectUiStart({
        fileRouteGeneration: {
          outputFile: false
        }
      });
      if (
        !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "configResolved" in plugin &&
        typeof plugin.configResolved === "function"
      ) {
        await plugin.configResolved.call({} as never, { root } as never);
      }

      expect(existsSync(join(root, defaultFileRouteGeneratedFile))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits and loads a production-shaped app graph from the Vite preset", async () => {
    const options = {
      serverFunctionManifest: [
        {
          name: "Start.Project.appGraph",
          module: "/src/project/project.server.ts",
          exportName: "getProject",
          inputSchema: true,
          outputSchema: true
        }
      ],
      actionManifest: [
        {
          name: "Start.Project.appGraph.rename",
          module: "/src/project/project.actions.ts",
          exportName: "RenameProject",
          inputSchema: true,
          outputSchema: true
        }
      ],
      fileRoutes: [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx"
      ],
      fileRouteOptions: {
        routeDirectory: "src/routes"
      }
    };
    const graph = serializeStartAppGraph(options);
    const plugin = effectUiStart(options);
    const config = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "config" in plugin &&
      typeof plugin.config === "function"
        ? plugin.config()
        : undefined;
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, appGraphVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(JSON.parse(graph)).toMatchObject({
      version: 1,
      routes: {
        entries: [
          {
            routePath: "/"
          },
          {
            routePath: "/projects/:id"
          }
        ]
      },
      serverFunctions: {
        entries: [
          {
            name: "Start.Project.appGraph"
          }
        ]
      },
      actions: {
        entries: [
          {
            name: "Start.Project.appGraph.rename"
          }
        ]
      }
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_APP_GRAPH__: graph
      }
    });
    expect(resolved).toBe(`\0${appGraphVirtualModuleId}`);
    expect(String(loaded)).toContain("export const graph = ");
    expect(String(loaded)).toContain("export const diagnostics = ");
    expect(String(loaded)).toContain('"routeCount":2');
    expect(String(loaded)).toContain('import { Resource, Route } from "@effect-ui/core";');
    expect(String(loaded)).toContain('import { Collection } from "@effect-ui/db";');
    expect(String(loaded)).toContain('import { Route as route_root } from "/src/routes/index.js";');
    expect(String(loaded)).toContain('import { Route as route_projects_$id } from "/src/routes/projects/$id.js";');
    expect(String(loaded)).toContain("const resourceDiagnostics = Resource.diagnostics();");
    expect(String(loaded)).toContain("const collectionDiagnostics = Collection.diagnostics();");
    expect(String(loaded)).toContain("const routeModules = [");
    expect(String(loaded)).toContain('routeId: "route_projects_$id"');
    expect(String(loaded)).toContain("paramsSchema: routeModulePresence(route_projects_$id.options?.params)");
    expect(String(loaded)).toContain("preload: routeModulePresence(route_projects_$id.options?.preload)");
    expect(String(loaded)).toContain("preloadResources: Route.describePreloadResources(route_projects_$id)");
    expect(String(loaded)).toContain("preloadCollections: Route.describePreloadCollections(route_projects_$id)");
    expect(String(loaded)).toContain("const unknownRoutePreloadResources = routeModules");
    expect(String(loaded)).toContain("const unknownRoutePreloadCollections = routeModules");
    expect(String(loaded)).toContain("unknownRoutePreloadResources,");
    expect(String(loaded)).toContain("unknownRoutePreloadCollections,");
    expect(String(loaded)).toContain("resourceFamilies: resourceDiagnostics.families");
    expect(String(loaded)).toContain("resourceTags: resourceDiagnostics.tags");
    expect(String(loaded)).toContain("collectionDefinitions: collectionDiagnostics.collections");
    expect(String(loaded)).toContain("export const routes = graph.routes;");
    expect(String(loaded)).toContain("Start.Project.appGraph.rename");
  });

  it("emits a resolved diagnostics policy guard in the app graph virtual module", async () => {
    const plugin = effectUiStart({
      buildPolicy: {
        wireSchemas: false,
        diagnostics: {
          routePreloadResources: {
            requireDeclaredForPreload: true
          },
          routePreloadCollections: {
            requireDeclaredForPreload: true
          }
        }
      },
      fileRoutes: [
        "src/routes/projects/$id.tsx"
      ],
      fileRouteOptions: {
        routeDirectory: "src/routes"
      }
    });
    const resolved = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "resolveId" in plugin &&
      typeof plugin.resolveId === "function"
        ? await plugin.resolveId.call({} as never, appGraphVirtualModuleId, undefined, {})
        : undefined;
    const loaded = !Array.isArray(plugin) &&
      plugin &&
      typeof plugin === "object" &&
      "load" in plugin &&
      typeof plugin.load === "function" &&
      typeof resolved === "string"
        ? await plugin.load.call({} as never, resolved, {})
        : undefined;

    expect(String(loaded)).toContain(
      '"routePreloadResources":{"requireDeclaredForPreload":true}'
    );
    expect(String(loaded)).toContain(
      '"routePreloadCollections":{"requireDeclaredForPreload":true}'
    );
    expect(String(loaded)).toContain("export const diagnosticsPolicyViolations = collectDiagnosticsPolicyViolations(diagnostics, diagnosticsPolicy);");
    expect(String(loaded)).toContain("Effect UI app graph diagnostics policy failed");
    expect(String(loaded)).toContain("Routes with preload must declare preloadResources.");
    expect(String(loaded)).toContain("Routes with preload must declare preloadCollections.");
    expect(String(loaded)).toContain("error.diagnostics = diagnostics;");
  });

  it("loads resolved app graph diagnostics through Vite for CI scripts", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-runner-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          "import { Resource, route } from \"@effect-ui/core\";",
          "import { Collection } from \"@effect-ui/db\";",
          "const ProjectById = Resource.family({",
          "  name: \"Runner.Project.byId\",",
          "  load: (id: string) => ({ id })",
          "});",
          "const Projects = Collection.define<{ readonly id: string }>({",
          "  name: \"Runner.Projects\",",
          "  getKey: (project) => project.id,",
          "  load: () => [{ id: \"atlas\" }]",
          "});",
          "export const Route = route(\"/\", {",
          "  preloadResources: [ProjectById],",
          "  preloadCollections: [Projects],",
          "  preload: () => undefined",
          "});"
        ].join("\n")
      );

      const result = await Effect.runPromise(
        loadStartAppGraphDiagnosticsEffect({
          root,
          configFile: false,
          start: {
            fileRoutes: ["src/routes/index.ts"],
            fileRouteOptions: {
              routeDirectory: "src/routes"
            },
            buildPolicy: {
              wireSchemas: false,
              diagnostics: {
                routePreloadResources: {
                  requireDeclaredForPreload: true
                },
                routePreloadCollections: {
                  requireDeclaredForPreload: true
                }
              }
            }
          },
          vite: startDiagnosticsRunnerViteConfig()
        })
      );

      expect(result.diagnosticsPolicyViolations).toEqual([]);
      expect(result.diagnostics.routeModules).toEqual([
        expect.objectContaining({
          routePath: "/",
          preload: "present",
          preloadResources: {
            status: "declared",
            families: ["Runner.Project.byId"]
          },
          preloadCollections: {
            status: "declared",
            collections: ["Runner.Projects"]
          }
        })
      ]);
      expect(result.diagnostics.resourceFamilies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Runner.Project.byId" })
        ])
      );
      expect(result.diagnostics.collectionDefinitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Runner.Projects" })
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("rejects resolved app graph diagnostics policy violations through Vite", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-runner-fail-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          "import { route } from \"@effect-ui/core\";",
          "export const Route = route(\"/\", {",
          "  preload: () => undefined",
          "});"
        ].join("\n")
      );

      await expect(
        loadStartAppGraphDiagnostics({
          root,
          configFile: false,
          start: {
            fileRoutes: ["src/routes/index.ts"],
            fileRouteOptions: {
              routeDirectory: "src/routes"
            },
            buildPolicy: {
              wireSchemas: false,
              diagnostics: {
                routePreloadResources: {
                  requireDeclaredForPreload: true
                },
                routePreloadCollections: {
                  requireDeclaredForPreload: true
                }
              }
            }
          },
          vite: startDiagnosticsRunnerViteConfig()
        })
      ).rejects.toMatchObject({
        name: "StartAppGraphDiagnosticsPolicyError"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("parses and runs the Start diagnostics CLI wrapper", async () => {
    expect(
      parseStartDiagnosticsCliArgs([
        "diagnostics",
        "--root",
        "app",
        "--config=false",
        "--mode",
        "ci",
        "--pretty"
      ])
    ).toEqual({
      _tag: "Diagnostics",
      options: {
        root: "app",
        configFile: false,
        mode: "ci",
        json: true,
        pretty: true
      }
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["diagnostics", "--json"], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () => Effect.succeed({
          graph: {
            version: 1,
            routes: { version: 1, entries: [], modules: [], routeDirectory: "src/routes" },
            serverFunctions: { version: 1, rpcPath: "/__effect-ui/rpc", entries: [] },
            actions: { version: 1, actionPath: "/__effect-ui/action", entries: [] }
          },
          diagnostics: {
            version: 1,
            routeCount: 0,
            serverFunctionCount: 0,
            actionCount: 0,
            routePaths: [],
            routeModules: [],
            serverFunctionModules: [],
            actionModules: [],
            resourceFamilies: [],
            resourceTags: [],
            collectionDefinitions: [],
            serverOnlyModules: [],
            browserClientModules: [],
            rpcPath: "/__effect-ui/rpc",
            actionPath: "/__effect-ui/action",
            schemaCoverage: {
              serverFunctions: { total: 0, input: 0, output: 0, error: 0 },
              actions: { total: 0, input: 0, output: 0, error: 0 }
            },
            missingSchemas: [],
            unknownActionBehavior: [],
            unknownRoutePreloadResources: [],
            unknownRoutePreloadCollections: []
          },
          diagnosticsPolicyViolations: []
        })
      })
    );

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      diagnostics: {
        routeCount: 0
      },
      diagnosticsPolicyViolations: []
    });
  });

  it("returns a usage result for invalid Start diagnostics CLI input", async () => {
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["unknown"], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable")
      })
    );

    expect(result.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain('Unknown command "unknown".');
    expect(stderr.join("\n")).toContain("Usage: effect-ui-start diagnostics");
  });

  it("prints an agent-readable Start diagnostics repair report", async () => {
    const loadedDiagnostics = {
      graph: {
        version: 1 as const,
        routes: { version: 1 as const, entries: [], modules: [], routeDirectory: "src/routes" },
        serverFunctions: { version: 1 as const, rpcPath: "/__effect-ui/rpc", entries: [] },
        actions: { version: 1 as const, actionPath: "/__effect-ui/action", entries: [] }
      },
      diagnostics: {
        version: 1 as const,
        routeCount: 1,
        serverFunctionCount: 1,
        actionCount: 1,
        routePaths: ["/projects/:id"],
        routeModules: [
          {
            routeId: "route_projects_$id",
            routePath: "/projects/:id",
            moduleId: "/src/routes/projects/$id.tsx",
            filePath: "src/routes/projects/$id.tsx",
            pathParamCount: 1,
            hasPathParams: true,
            params: [{ name: "id", optional: false }],
            paramsSchema: "present" as const,
            searchSchema: "absent" as const,
            preload: "present" as const,
            preloadResources: {
              status: "unknown" as const,
              families: []
            },
            preloadCollections: {
              status: "unknown" as const,
              collections: []
            },
            component: "present" as const
          }
        ],
        serverFunctionModules: [
          {
            id: "sf_project_load",
            name: "Project.load",
            server: {
              module: "src/project/project.server.ts",
              exportName: "loadProject",
              moduleKind: "server-only" as const,
              hasHandler: true
            },
            client: {
              _tag: "Rpc" as const,
              rpcPath: "/__effect-ui/rpc"
            },
            wire: {
              inputSchema: true,
              outputSchema: false,
              errorSchema: false,
              complete: false,
              missing: ["output" as const, "error" as const]
            }
          }
        ],
        actionModules: [
          {
            id: "act_project_rename",
            name: "Project.rename",
            server: {
              module: "src/project/project.actions.ts",
              exportName: "renameProject",
              moduleKind: "server-only" as const
            },
            client: {
              _tag: "Post" as const,
              actionPath: "/__effect-ui/action"
            },
            wire: {
              inputSchema: false,
              outputSchema: true,
              errorSchema: false,
              complete: false,
              missing: ["input" as const, "error" as const]
            },
            behavior: {
              invalidates: "unknown" as const,
              optimistic: "unknown" as const,
              retry: "present" as const,
              concurrency: "unknown" as const
            }
          }
        ],
        resourceFamilies: [],
        resourceTags: [],
        collectionDefinitions: [],
        serverOnlyModules: ["src/project/project.actions.ts", "src/project/project.server.ts"],
        browserClientModules: [],
        rpcPath: "/__effect-ui/rpc",
        actionPath: "/__effect-ui/action",
        schemaCoverage: {
          serverFunctions: { total: 1, input: 1, output: 0, error: 0 },
          actions: { total: 1, input: 0, output: 1, error: 0 }
        },
        missingSchemas: [
          {
            kind: "serverFunction" as const,
            name: "Project.load",
            input: true,
            output: false,
            error: false
          },
          {
            kind: "action" as const,
            name: "Project.rename",
            input: false,
            output: true,
            error: false
          }
        ],
        unknownActionBehavior: [
          {
            kind: "action" as const,
            name: "Project.rename",
            invalidates: "unknown" as const,
            optimistic: "unknown" as const,
            retry: "present" as const,
            concurrency: "unknown" as const
          }
        ],
        unknownRoutePreloadResources: [
          {
            kind: "route" as const,
            routeId: "route_projects_$id",
            routePath: "/projects/:id",
            moduleId: "/src/routes/projects/$id.tsx",
            filePath: "src/routes/projects/$id.tsx",
            preload: "present" as const,
            preloadResources: {
              status: "unknown" as const,
              families: []
            }
          }
        ],
        unknownRoutePreloadCollections: [
          {
            kind: "route" as const,
            routeId: "route_projects_$id",
            routePath: "/projects/:id",
            moduleId: "/src/routes/projects/$id.tsx",
            filePath: "src/routes/projects/$id.tsx",
            preload: "present" as const,
            preloadCollections: {
              status: "unknown" as const,
              collections: []
            }
          }
        ]
      },
      diagnosticsPolicyViolations: []
    };
    const report = createStartDiagnosticsReport(loadedDiagnostics);
    const formatted = formatStartDiagnosticsReport(report);
    const stdout: string[] = [];
    const result = await runStartDiagnosticsCli(["diagnostics"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      loadDiagnostics: async () => loadedDiagnostics
    });

    expect(report.status).toBe("needs-attention");
    expect(formatted).toContain("Owner: src/routes/projects/$id.tsx");
    expect(formatted).toContain("Add `preloadResources: [...]`");
    expect(formatted).toContain("Add `preloadCollections: [...]`");
    expect(formatted).toContain("Owner: src/project/project.actions.ts#renameProject");
    expect(formatted).toContain("Declare action behavior metadata");
    expect(formatted).toContain("Add `input` and `error` schemas");
    expect(formatted).toContain("Owner: src/project/project.server.ts#loadProject");
    expect(formatted).toContain("Add `output` and `error` schemas");
    expect(result.exitCode).toBe(0);
    expect(stdout).toEqual([formatted]);
  });

  it("returns a failing exit code for Start diagnostics CLI policy errors", async () => {
    const stderr: string[] = [];
    const unknownPreloadRoute = {
      kind: "route" as const,
      routeId: "route_index",
      routePath: "/",
      moduleId: "/src/routes/index.ts",
      filePath: "src/routes/index.ts",
      preload: "present" as const,
      preloadResources: {
        status: "unknown" as const,
        families: []
      }
    };
    const failure = Object.assign(new Error("Routes with preload must declare preloadResources."), {
      name: "StartAppGraphDiagnosticsPolicyError",
      violations: [{ _tag: "UnknownRoutePreloadResources" }],
      diagnostics: {
        version: 1 as const,
        routeCount: 1,
        serverFunctionCount: 0,
        actionCount: 0,
        routePaths: ["/"],
        routeModules: [
          {
            routeId: "route_index",
            routePath: "/",
            moduleId: "/src/routes/index.ts",
            filePath: "src/routes/index.ts",
            pathParamCount: 0,
            hasPathParams: false,
            params: [],
            paramsSchema: "absent" as const,
            searchSchema: "absent" as const,
            preload: "present" as const,
            preloadResources: {
              status: "unknown" as const,
              families: []
            },
            preloadCollections: {
              status: "none" as const,
              collections: []
            },
            component: "present" as const
          }
        ],
        serverFunctionModules: [],
        actionModules: [],
        resourceFamilies: [],
        resourceTags: [],
        collectionDefinitions: [],
        serverOnlyModules: [],
        browserClientModules: [],
        rpcPath: "/__effect-ui/rpc",
        actionPath: "/__effect-ui/action",
        schemaCoverage: {
          serverFunctions: { total: 0, input: 0, output: 0, error: 0 },
          actions: { total: 0, input: 0, output: 0, error: 0 }
        },
        missingSchemas: [],
        unknownActionBehavior: [],
        unknownRoutePreloadResources: [unknownPreloadRoute],
        unknownRoutePreloadCollections: []
      }
    });
    const result = await runStartDiagnosticsCli(["diagnostics"], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
      loadDiagnostics: async () => {
        throw failure;
      }
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Routes with preload must declare preloadResources.");
    expect(stderr.join("\n")).toContain("Effect UI Start Diagnostics Report");
    expect(stderr.join("\n")).toContain("Owner: src/routes/index.ts");
    expect(stderr.join("\n")).toContain("Add `preloadResources: [...]`");
    expect(stderr.join("\n")).toContain("Owner: StartBuildPolicy.diagnostics");
  });

  it("exposes typed build policy validation over Start app graph diagnostics", async () => {
    const graph = await Effect.runPromise(
      makeStartBuildAppGraphEffect({
        serverFunctionManifest: [
          {
            name: "Start.Project.policy",
            module: "/src/project/project.server.ts",
            exportName: "getProject",
            inputSchema: true
          }
        ],
        actionManifest: [
          {
            name: "Start.Project.policy.rename",
            module: "/src/project/project.actions.ts",
            exportName: "RenameProject",
            inputSchema: true,
            outputSchema: true
          }
        ]
      })
    );
    const exit = await Effect.runPromiseExit(validateStartBuildPolicyEffect(graph));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartAppGraphMissingWireSchemas);
    expect(failure).toMatchObject({
      missing: [
        {
          kind: "serverFunction",
          name: "Start.Project.policy",
          input: true,
          output: false
        }
      ]
    });
    await expect(
      Effect.runPromise(
        validateStartBuildPolicyEffect(graph, {
          wireSchemas: {
            requireInput: true,
            requireOutput: false
          }
        })
      )
    ).resolves.toBeUndefined();
  });

  it("can fail the Start build policy on unknown action behavior metadata", async () => {
    const graph = await Effect.runPromise(
      makeStartBuildAppGraphEffect({
        buildPolicy: false,
        actionManifest: [
          {
            name: "Start.Project.policy.unknown-action",
            module: "/src/project/project.actions.ts",
            exportName: "RenameProject",
            inputSchema: true,
            outputSchema: true
          }
        ]
      })
    );
    const exit = await Effect.runPromiseExit(
      validateStartBuildPolicyEffect(graph, {
        wireSchemas: false,
        actionBehavior: {
          requireInvalidates: true,
          requireConcurrency: true
        }
      })
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartAppGraphUnknownActionBehavior);
    expect(failure).toMatchObject({
      unknown: [
        {
          kind: "action",
          name: "Start.Project.policy.unknown-action",
          invalidates: "unknown",
          concurrency: "unknown"
        }
      ]
    });
  });

  it("enforces configured build policy before the Vite preset emits app graph defines", () => {
    const plugin = effectUiStart({
      buildPolicy: true,
      serverFunctionManifest: [
        {
          name: "Start.Project.buildWall",
          module: "/src/project/project.server.ts",
          exportName: "getProject",
          inputSchema: true
        }
      ]
    });

    expect(() => {
      if (
        !Array.isArray(plugin) &&
        plugin &&
        typeof plugin === "object" &&
        "config" in plugin &&
        typeof plugin.config === "function"
      ) {
        plugin.config();
      }
    }).toThrow(StartAppGraphMissingWireSchemas);
  });

  it("resolves default and named Start handlers", async () => {
    const defaultHandler = () => new Response("default");
    const namedHandler = () => new Response("named");

    expect(resolveStartHandler({ default: defaultHandler })(new Request("https://example.com"))).toBeInstanceOf(Response);
    expect(resolveStartHandler({ handleRequest: namedHandler })).toBe(namedHandler);
    expect(resolveStartHandler({ custom: namedHandler }, { handlerExport: "custom" })).toBe(namedHandler);
    expect(() => resolveStartHandler({})).toThrow(StartHandlerNotFound);
  });

  it("loads dev SSR handler modules and transforms HTML responses", async () => {
    const loadedEntries: Array<string> = [];
    const transformedUrls: Array<string> = [];
    const server = {
      ssrLoadModule: async (id: string) => {
        loadedEntries.push(id);
        return {
          default: async (request: Request) =>
            new Response(`<html><body>${new URL(request.url).pathname}</body></html>`, {
              headers: { "content-type": "text/html" }
            })
        };
      },
      transformIndexHtml: async (url: string, html: string) => {
        transformedUrls.push(url);
        return html.replace("</body>", "<script>dev()</script></body>");
      }
    };

    const response = await handleSsrDevRequest(
      server,
      new Request("https://example.com/projects/atlas?tab=activity"),
      { serverEntry: "/src/server.tsx" }
    );
    const html = await response.text();

    expect(loadedEntries).toEqual(["/src/server.tsx"]);
    expect(transformedUrls).toEqual(["/projects/atlas?tab=activity"]);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain("/projects/atlas");
    expect(html).toContain("<script>dev()</script>");

    await expect(
      Effect.runPromise(
        handleSsrDevRequestEffect(server, new Request("https://example.com/projects/kepler"))
      )
    ).resolves.toBeInstanceOf(Response);
  });

  it("runs Vite dev middleware control flow through Effect", async () => {
    let nextCalls = 0;
    await Effect.runPromise(
      handleSsrDevMiddlewareEffect(
        {
          ssrLoadModule: async () => {
            throw new Error("should not load static requests");
          },
          transformIndexHtml: async (_url, html) => html
        },
        {
          headers: {},
          method: "GET",
          url: "/src/main.ts"
        } as IncomingMessage,
        {} as ServerResponse,
        () => {
          nextCalls += 1;
        }
      )
    );

    expect(nextCalls).toBe(1);

    const fixedErrors: Array<Error> = [];
    const nextErrors: Array<unknown> = [];
    await Effect.runPromise(
      handleSsrDevMiddlewareEffect(
        {
          ssrLoadModule: async () => ({}),
          transformIndexHtml: async (_url, html) => html,
          ssrFixStacktrace: (error) => {
            fixedErrors.push(error);
          }
        },
        {
          headers: { host: "example.com" },
          method: "GET",
          url: "/projects/atlas"
        } as IncomingMessage,
        {} as ServerResponse,
        (error) => {
          nextErrors.push(error);
        },
        { serverEntry: "/src/server.tsx" }
      )
    );

    expect(nextErrors).toHaveLength(1);
    expect(nextErrors[0]).toBeInstanceOf(StartHandlerNotFound);
    expect(fixedErrors).toEqual([nextErrors[0]]);
  });
});

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined => {
  const legacy = (cause as unknown as {
    readonly reasons?: ReadonlyArray<{ readonly _tag?: string; readonly error?: E }>;
  }).reasons?.find(Cause.isFailReason)?.error;
  if (legacy !== undefined) {
    return legacy;
  }

  return (cause as unknown as {
    readonly failures?: ReadonlyArray<{ readonly _tag?: string; readonly error?: E }>;
  }).failures?.find((failure) => failure._tag === "Fail")?.error;
};
