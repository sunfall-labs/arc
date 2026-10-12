import {
  Cause,
  Context,
  Data,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Option,
  Schema,
  Scope,
  Tracer,
} from "effect";
import { AsyncResult } from "effect/reactivity";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionResult,
  EffectInputCallbackError,
  makeRuntime,
  Resource,
  ResourceTypeId,
  RequestContext,
  ResponseContext,
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  Route,
  RoutePreloadError,
  runWithRuntime,
  type BrowserRouterState,
  Server,
  ActionTransportError,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import {
  defaultRuntime,
  eraseRuntime,
  makeActionInstance,
  createBrowserRouterKernel,
  clearActionDefinitionRegistryUnsafe,
  resourceDefinitionRegistry,
  ResourceFamily,
} from "@sunfall/arc-core/internal";
import {
  hydrateFromDocument,
  StartHydrationChunkParseError,
  StartHydrationPayloadParseError,
  StartHydrationPayloadSerializeError,
  StartPreloadError,
  StartAction,
  StartActionFormEncodeError,
  StartActionDuplicateName,
  type StartHydrationPayload,
} from "../src/index.js";
import { testHttpClientLayer, type TestFetch } from "./test-http-client.js";
import { createStartRequestHandler } from "../src/start-request-handler.js";
import { makeStartServerApp } from "../src/start-server-app.js";
import { rpcClientLayer } from "../src/start-rpc-client.js";
import { actionTransportLayer } from "../src/start-action-transport.js";
import {
  createServerActionResponse,
  createServerRpcResponse,
} from "../src/start-request-endpoints.js";
import {
  createHydrationScriptSync,
  createHydrationScript,
  createStreamHydrationScriptSync,
  hydrateStartPayload,
  hydrateStartHydrationChunksFromDocument,
  readStartHydrationChunks,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationSequenceAttribute,
} from "../src/hydration.js";
import { createStartRenderHydrationPlan } from "../src/render-hydration-plan.js";
import { preloadRequest } from "../src/start-request-preload.js";
import {
  serverActionPath,
  serverRpcPath,
  startRequestIdHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
} from "../src/rpc.js";
import {
  encodeStartActionRequest,
  startActionInputField,
} from "../src/start-action-request-codec.js";

import { completeRequestRuntimeWithResponse, makeRequestRuntime } from "../src/request-runtime.js";
import {
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
} from "../src/request-trace.js";
import {
  fileRouteDefinitionsVirtualModuleId,
  fileRouteManifestVirtualModuleId,
} from "../src/start-virtual-modules.js";
import {
  defaultFileRouteGeneratedFile,
  defaultFileRouteDirectory,
  discoverFileRoutes,
  makeStartFileRouteManifest,
  type FileRouteDiscoveryOptions,
  type SunfallArcStartOptions,
} from "../src/start-manifest-wall.js";
import {
  handleSsrDevRequest,
  handleSsrDevMiddleware,
  resolveStartHandlerSync,
  startDevServerFromVite,
  shouldHandleSsrRequest,
} from "../src/start-vite-dev-ssr.js";
import {
  sunfallArcStart,
  StartDevServerError,
  FileRouteDefinitionsOutputPathError,
  StartHandlerNotFound,
  StartServerOnlyModuleError,
} from "../src/vite.js";

const discoverFileRoutesSync = (options: FileRouteDiscoveryOptions = {}) =>
  Effect.runSync(discoverFileRoutes(options));
const serializeStartFileRouteManifest = (options: SunfallArcStartOptions = {}) =>
  JSON.stringify(Effect.runSync(makeStartFileRouteManifest(options)));
/** The file-route manifest the plugin serves as `virtual:sunfall-arc/file-routes`. */
const loadFileRouteManifestModule = (plugin: ReturnType<typeof sunfallArcStart>): unknown => {
  const resolved = plugin.resolveId(fileRouteManifestVirtualModuleId);
  const loaded = String(resolved === null ? undefined : plugin.load(resolved));
  const match = /^export const manifest = (.*);$/m.exec(loaded);
  return match?.[1] === undefined ? undefined : JSON.parse(match[1]);
};
/** One `effect/rpc` request message (`RpcSerialization.json`) calling `tag` with `payload`. */
const rpcMessage = (tag: string, payload: unknown): string =>
  JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] });

/** The encoded `Exit` of the one request in an `effect/rpc` JSON response. */
const readRpcExit = (response: Response) =>
  Effect.map(
    Effect.promise(
      () => response.json() as Promise<ReadonlyArray<{ _tag: string; exit?: unknown }>>,
    ),
    (messages) => messages.find((message) => message._tag === "Exit")?.exit,
  );

/** Start's browser `Server.Client` (`RpcClient` over HTTP), posting through `fetch`. */
const rpcClientOver = (fetch: TestFetch): Layer.Layer<Server.Client> =>
  rpcClientLayer.pipe(Layer.provide(testHttpClientLayer(fetch)));

const scriptText = (script: string): string =>
  script.replace(/^<script[^>]*>/, "").replace("</script>", "");

const runInRuntime = <A, E, Services, RuntimeError>(
  runtime: SunfallArcRuntime<Services, RuntimeError>,
  effect: Effect.Effect<A, E, Services>,
): Promise<A> => Effect.runPromise(runtime.provide(effect));

const makeStreamHydrationElement = (script: string, sequence: number) => {
  const attributes = new Map<string, string>([
    [streamHydrationSequenceAttribute, String(sequence)],
  ]);

  return {
    textContent: scriptText(script),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
  };
};

const workspacePackageAlias = (path: string): string => join(process.cwd(), path);

const sourceFiles = (directory: URL): readonly URL[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      return sourceFiles(child);
    }
    return /\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [child] : [];
  });

const workspaceSourceViteConfig = () => ({
  resolve: {
    alias: [
      { find: "effect", replacement: workspacePackageAlias("node_modules/effect/dist/index.js") },
      {
        find: "@sunfall/arc-core/internal",
        replacement: workspacePackageAlias("packages/core/src/internal.ts"),
      },
      {
        find: "@sunfall/arc-db/internal",
        replacement: workspacePackageAlias("packages/db/src/internal.ts"),
      },
      {
        find: "@sunfall/arc-core",
        replacement: workspacePackageAlias("packages/core/src/index.ts"),
      },
      { find: "@sunfall/arc-db", replacement: workspacePackageAlias("packages/db/src/index.ts") },
      {
        find: "@sunfall/arc-start",
        replacement: workspacePackageAlias("packages/start/src/index.ts"),
      },
      {
        find: "@sunfall/arc-start/vite",
        replacement: workspacePackageAlias("packages/start/src/vite.ts"),
      },
    ],
  },
});

const oneShotIterable = <A>(values: readonly A[]) => {
  let iteratorCalls = 0;
  let consumed = false;
  const iterable: Iterable<A> = {
    [Symbol.iterator]: function* () {
      iteratorCalls++;
      if (consumed) {
        return;
      }
      consumed = true;
      yield* values;
    },
  };

  return {
    iterable,
    get iteratorCalls() {
      return iteratorCalls;
    },
  };
};

/**
 * Submits `definition` the way UI does: through an Action instance on
 * `runtime` (the default runtime when omitted) whose submissions see Start's
 * `ActionTransport` serving it, so the request goes over the action transport
 * and the response applies to `runtime`.
 */
const submitViaActionTransport = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>,
  input: I,
  options: {
    readonly fetch: TestFetch;
    readonly runtime?: object;
  },
) => {
  const instance = makeActionInstance(
    definition,
    eraseRuntime((options.runtime ?? defaultRuntime) as typeof defaultRuntime),
  );
  return instance
    .submit(input)
    .pipe(
      Effect.provide(actionTransportLayer.pipe(Layer.provide(testHttpClientLayer(options.fetch)))),
    );
};

/** Records spans; `requests()` reads ended Start request spans' attributes. */
const spanRecorder = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return {
    spans,
    trace: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.withTracer(effect, tracer),
    run: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.withTracer(effect, tracer)),
    runExit: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromiseExit(Effect.withTracer(effect, tracer)),
    requests: () =>
      spans
        .filter((span) => span.name === "sunfall-arc.start.request" && span.status._tag === "Ended")
        .map((span) => Object.fromEntries(span.attributes)),
  };
};

describe("Sunfall Arc Start", () => {
  it("ignores synchronous throws from request runtime finalizers", async () => {
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const runtime = makeRequestRuntime(app);

    const response = await Effect.runPromise(
      completeRequestRuntimeWithResponse(runtime, new Response(null, { status: 204 }), () => {
        throw new Error("finalizer callback failed");
      }),
    );

    expect(response.status).toBe(204);
  });

  it("ignores synchronous throws from request runtime stream finalizers", async () => {
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const runtime = makeRequestRuntime(app);
    const response = await Effect.runPromise(
      completeRequestRuntimeWithResponse(
        runtime,
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("stream body"));
              controller.close();
            },
          }),
        ),
        () => {
          throw new Error("stream finalizer callback failed");
        },
      ),
    );

    await expect(response.text()).resolves.toBe("stream body");
  });

  it("preloads matched route resources into a hydration payload", async () => {
    const Project = Resource.define({
      name: "Start.Project.byId",
      load: (id: string) => Effect.succeed({ id, name: "Atlas" }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/projects/atlas")),
    );

    expect(result.match?.params.id).toBe("atlas");
    expect(result.routePlan).toMatchObject({
      _tag: "Matched",
      href: "/projects/atlas",
    });
    expect(result.routePlan.refs.map((ref) => ref.key)).toEqual([Project("atlas").key]);
    expect(result.resources.resources).toHaveLength(1);
    expect(result.resources.resources[0]).toMatchObject({
      name: "Start.Project.byId",
      input: "atlas",
      state: {
        _tag: "Success",
        value: { id: "atlas", name: "Atlas" },
      },
    });
  });

  it("passes legacy hydration scripts and the streaming plan to custom renderers", async () => {
    const Project = Resource.define({
      name: "Start.Project.render",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    let renderPlanResourceNames: readonly string[] = [];
    let renderPlanRootResourceCount = -1;
    let renderRootScript = "";
    const handler = createStartRequestHandler(app, {
      render: ({ match, hydrationPlan }) => {
        renderPlanRootResourceCount = hydrationPlan.root.payload.resources.length;
        renderPlanResourceNames = hydrationPlan.resourceChunks.flatMap((chunk) =>
          chunk.resources.map((resource) => resource.name),
        );
        renderRootScript = hydrationPlan.root.script;
        return `<html><body><main>${match?.href}</main>${hydrationPlan.legacy.script}</body></html>`;
      },
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/kepler"))),
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain("<main>/projects/kepler</main>");
    expect(html).toContain("Start.Project.render");
    expect(html).toContain('id="__SUNFALL_ARC_HYDRATION__"');
    expect(renderPlanRootResourceCount).toBe(0);
    expect(renderPlanResourceNames).toEqual(["Start.Project.render"]);
    expect(renderRootScript).not.toContain("Start.Project.render");
  });

  it("lets streamed renderers use the plan-derived root script without duplicating resource hydration", async () => {
    const Project = Resource.define({
      name: "Start.Project.stream-render",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: ({ hydrationPlan }) => {
        const streamedScripts = hydrationPlan.resourceChunks
          .map((chunk, index) => createStreamHydrationScriptSync(chunk, index))
          .join("");
        return `<html><body>${hydrationPlan.root.script}${streamedScripts}</body></html>`;
      },
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/atlas"))),
    );
    const html = await response.text();

    expect(html.match(/"name":"Start\.Project\.stream-render"/g)).toHaveLength(1);
    expect(html).toContain('id="__SUNFALL_ARC_HYDRATION__"');
    expect(html).toContain("data-sunfall-arc-hydration-chunk");
  });

  it("does not serialize the full legacy hydration script for streamed renderers that do not read it", async () => {
    const Project = Resource.define({
      name: "Start.Project.lazy-legacy-script",
      load: (id: string) => Effect.succeed({ id, count: 1n }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: ({ hydrationPlan }) =>
        `<html><body>${hydrationPlan.root.script}<main>stream shell</main></body></html>`,
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/atlas"))),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<main>stream shell</main>");
    expect(html).toContain('id="__SUNFALL_ARC_HYDRATION__"');
    expect(html).not.toContain("Start.Project.lazy-legacy-script");
  });

  it("creates a render hydration plan without duplicating root and streamed resource refs", async () => {
    const resources = {
      resources: [
        {
          name: "Start.Project.render-plan",
          key: "Start.Project.render-plan:atlas",
          input: "atlas",
          state: {
            _tag: "Success" as const,
            value: { id: "atlas", name: "Atlas" },
            waiting: false as const,
            timestamp: 1,
          },
        },
      ],
    };
    const plan = await Effect.runPromise(createStartRenderHydrationPlan({ resources }));
    const rootPairs = new Set(
      plan.root.payload.resources.map((resource) => `${resource.name}:${resource.key}`),
    );
    const streamedPairs = plan.resourceChunks.flatMap((chunk) =>
      chunk.resources.map((resource) => `${resource.name}:${resource.key}`),
    );

    expect(plan.root.payload.resources).toEqual([]);
    expect(plan.legacy.payload.resources.map((resource) => resource.name)).toEqual([
      "Start.Project.render-plan",
    ]);
    expect(plan.legacy.script).toContain("Start.Project.render-plan");
    expect(plan.root.script).toContain("__SUNFALL_ARC_HYDRATION__");
    expect(plan.root.script).not.toContain("Start.Project.render-plan");
    expect(streamedPairs).toEqual(["Start.Project.render-plan:Start.Project.render-plan:atlas"]);
    expect(streamedPairs.filter((pair) => rootPairs.has(pair))).toEqual([]);
  });

  it("defers full legacy render hydration script serialization until it is read", async () => {
    const plan = await Effect.runPromise(
      createStartRenderHydrationPlan({
        resources: {
          resources: [
            {
              name: "Start.Project.lazy-plan",
              key: "Start.Project.lazy-plan:atlas",
              input: "atlas",
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "atlas", count: 1n },
                timestamp: 1,
              },
            },
          ],
        },
      }),
    );

    expect(plan.root.script).toContain("__SUNFALL_ARC_HYDRATION__");
    expect(plan.root.script).not.toContain("Start.Project.lazy-plan");
    expect(() => plan.legacy.script).toThrow(StartHydrationPayloadSerializeError);
  });

  it("surfaces render hydration plan root serialization failures as typed errors", async () => {
    const exit = await Effect.runPromiseExit(
      createStartRenderHydrationPlan({
        resources: { resources: [] },
        // The root payload carries the route failure; a BigInt cannot be JSON.
        routeFailure: {
          path: "/projects/:id",
          href: "/projects/atlas",
          failure: { _tag: "Encoded", value: { count: 1n } as never },
        },
      }),
    );
    const failure = Exit.isFailure(exit)
      ? exit.cause.reasons.find(Cause.isFailReason)?.error
      : undefined;

    expect(failure).toBeInstanceOf(StartHydrationPayloadSerializeError);
  });

  it("records the route plan, response, and teardown on the SSR request span", async () => {
    const recorder = spanRecorder();
    const Project = Resource.define({
      name: "Start.Project.trace",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: ({ match }) => `<html><body><main>${match?.href}</main></body></html>`,
    });

    const response = await Effect.runPromise(
      recorder.trace(
        Effect.scoped(
          handler(
            new Request("https://example.com/projects/atlas?tab=activity", {
              headers: { "x-sunfall-arc-request-id": "req-ssr-atlas" },
            }),
          ),
        ),
      ),
    );

    // The request span stays open until the streamed body finishes.
    expect(recorder.requests()).toEqual([]);
    await expect(response.text()).resolves.toContain("/projects/atlas?tab=activity");

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.id": "req-ssr-atlas",
        "sunfall-arc.request.transport": "ssr",
        "http.request.method": "GET",
        "url.path": "/projects/atlas",
        "http.route": "/projects/:id",
        "sunfall-arc.route.href": "/projects/atlas?tab=activity",
        "sunfall-arc.route.resources": [Project("atlas").key],
        "sunfall-arc.hydration.resources": [Project("atlas").key],
        "http.response.status_code": 200,
        "sunfall-arc.request.status": "success",
        "sunfall-arc.stream.state": "closed",
        "sunfall-arc.teardown.reason": "stream-close",
        "sunfall-arc.teardown.runtime_disposed": true,
        "sunfall-arc.teardown.fibers": 0,
      }),
    ]);
  });

  it("uses a fresh resource store for each SSR request", async () => {
    let loads = 0;
    const Project = Resource.define<string, { readonly id: string; readonly sequence: number }>({
      name: "Start.Project.request-store",
      load: (id: string) =>
        Effect.sync(() => ({
          id,
          sequence: ++loads,
        })),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: ({ match }) => {
        const id = match?.params.id ?? "missing";
        const project = Effect.runSync(Resource.read(Project(id)));
        return `<html><body><main>${project.id}:${project.sequence}</main></body></html>`;
      },
    });

    const first = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/atlas"))),
    );
    const second = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/atlas"))),
    );

    await expect(first.text()).resolves.toContain("atlas:1");
    await expect(second.text()).resolves.toContain("atlas:2");
    expect(loads).toBe(2);
  });

  it("uses request-local server clients even when the app runtime provides one", async () => {
    const LookupProject = Server.contract("Start.Project.request-local-server-client", {
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, path: Schema.String }),
    });
    const lookupProject = Server.client(LookupProject);
    const calls: Array<string> = [];
    Server.implement(LookupProject, ({ id }) =>
      RequestContext.use((request) =>
        ResponseContext.use((response) =>
          Effect.gen(function* () {
            calls.push(`${id}:${request.url.pathname}`);
            yield* response.setStatus(209);
            yield* response.setHeader("x-sunfall-arc-local-server-client", "yes");
            return { id, path: request.url.pathname };
          }),
        ),
      ),
    );
    const ambientClient: Server.Client = Server.makeClient(() =>
      Effect.die("ambient ServerClient should not handle request-runtime calls"),
    );
    const ProjectRoute = Route.define("/local-server-client/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => lookupProject.effect({ id: params.id }),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
      server: Layer.succeed(Server.Client)(ambientClient),
    });
    const handler = createStartRequestHandler(app, {
      render: ({ match }) => `<html><body><main>${match?.params.id}</main></body></html>`,
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/local-server-client/atlas"))),
    );

    expect(calls).toEqual(["atlas:/local-server-client/atlas"]);
    expect(response.status).toBe(209);
    expect(response.headers.get("x-sunfall-arc-local-server-client")).toBe("yes");
    await expect(response.text()).resolves.toContain("<main>atlas</main>");
  });

  it("renders a failed route preload as the router Failure state on server and hydrating client", async () => {
    class ProjectMissing extends Data.TaggedError("ProjectMissing")<{
      readonly id: string;
      readonly secret: string;
    }> {}
    let preloads = 0;
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) =>
        Effect.suspend(() => {
          preloads++;
          return Effect.fail(new ProjectMissing({ id: params.id, secret: "db-host-10.0.0.1" }));
        }),
    });
    const routes = [ProjectRoute] as const;
    const app = makeStartServerApp({ routes });
    let serverState: BrowserRouterState<typeof routes> | undefined;
    const handler = createStartRequestHandler(app, {
      render: ({ runtime, routeFailure, hydrationPlan }) => {
        // A router rendered on the request runtime (what `RouterProvider` does).
        serverState = createBrowserRouterKernel(routes, {
          runtime: eraseRuntime(runtime),
          initialHref: "/projects/missing",
        }).state.get();
        const tag = routeFailure?.failure._tag === "Untyped" ? routeFailure.failure.tag : "";
        return `<main>${tag}</main>${hydrationPlan.legacy.script}`;
      },
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/missing"))),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("<main>ProjectMissing</main>");
    // Only the failure tag crosses the wire; failure data stays on the server.
    expect(html).not.toContain("db-host-10.0.0.1");
    expect(serverState).toMatchObject({ _tag: "Failure", href: "/projects/missing" });
    const serverError = serverState?._tag === "Failure" ? serverState.error : undefined;
    expect(serverError).toBeInstanceOf(RoutePreloadError);
    expect(serverError?.message).toBe(
      'Route "/projects/:id" failed to preload "/projects/missing": ProjectMissing',
    );

    const payload = JSON.parse(
      html.slice(html.indexOf("{"), html.lastIndexOf("}") + 1),
    ) as StartHydrationPayload;
    expect(payload.routeFailure).toEqual({
      path: "/projects/:id",
      href: "/projects/missing",
      failure: { _tag: "Untyped", tag: "ProjectMissing" },
    });

    // The hydrating client starts in the same Failure state without re-running
    // the preload, and the record is consumed by that first router.
    const clientRuntime = makeRuntime();
    try {
      await Effect.runPromise(clientRuntime.provide(hydrateStartPayload(payload)));
      const controller = createBrowserRouterHostController(routes, {
        runtime: eraseRuntime(clientRuntime),
        history: makeMemoryBrowserHistoryAdapter({ initialHref: "/projects/missing" }),
        initialMatchedState: (href, match) => ({ _tag: "Ready", href, match }),
      });
      const stop = controller.start();
      const clientState = controller.state.get();
      stop();
      expect(clientState).toMatchObject({ _tag: "Failure", href: "/projects/missing" });
      expect(clientState._tag === "Failure" ? clientState.error?.message : undefined).toBe(
        serverError?.message,
      );
      expect(preloads).toBe(1);

      const remounted = createBrowserRouterKernel(routes, {
        runtime: eraseRuntime(clientRuntime),
        initialHref: "/projects/missing",
      });
      expect(remounted.state.get()._tag).toBe("Ready");
    } finally {
      await Effect.runPromise(Effect.orDie(clientRuntime.dispose));
    }
  });

  it("sends a failure declared by the route error schema to the client as the typed error", async () => {
    class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
      id: Schema.String,
    }) {}
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      error: ProjectNotFound,
      preload: ({ params }) => Effect.fail(new ProjectNotFound({ id: params.id })),
    });
    const routes = [ProjectRoute] as const;
    const app = makeStartServerApp({ routes });
    const failureView = (state: BrowserRouterState<typeof routes>): string => {
      if (state._tag !== "Failure" || state.error?._tag !== "RoutePreloadError") {
        return "no failure";
      }
      // The typed failure, decoded from the wire on both server and client.
      const notFound: ProjectNotFound = state.error.cause;
      return notFound instanceof ProjectNotFound ? `Project "${notFound.id}" was not found.` : "";
    };
    let serverView: string | undefined;
    const handler = createStartRequestHandler(app, {
      render: ({ runtime, hydrationPlan }) => {
        serverView = failureView(
          createBrowserRouterKernel(routes, {
            runtime: eraseRuntime(runtime),
            initialHref: "/projects/missing",
          }).state.get(),
        );
        return `<main>${serverView}</main>${hydrationPlan.legacy.script}`;
      },
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/missing"))),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(serverView).toBe('Project "missing" was not found.');
    const payload = JSON.parse(
      html.slice(html.indexOf("{", html.indexOf("</main>")), html.lastIndexOf("}") + 1),
    ) as StartHydrationPayload;
    expect(payload.routeFailure).toEqual({
      path: "/projects/:id",
      href: "/projects/missing",
      failure: { _tag: "Encoded", value: { _tag: "ProjectNotFound", id: "missing" } },
    });

    const clientRuntime = makeRuntime();
    try {
      await Effect.runPromise(clientRuntime.provide(hydrateStartPayload(payload)));
      const clientState = createBrowserRouterKernel(routes, {
        runtime: eraseRuntime(clientRuntime),
        initialHref: "/projects/missing",
      }).state.get();
      expect(clientState._tag === "Failure" ? clientState.error?.cause : undefined).toEqual(
        new ProjectNotFound({ id: "missing" }),
      );
      expect(failureView(clientState)).toBe(serverView);
    } finally {
      await Effect.runPromise(Effect.orDie(clientRuntime.dispose));
    }
  });

  it("renders unmatched URLs as 404 and hydrates that not-found state at any URL", async () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
    });
    const routes = [ProjectRoute] as const;
    const app = makeStartServerApp({ routes });
    const handler = createStartRequestHandler(app, {
      render: ({ hydrationPlan }) => `<main>Not found</main>${hydrationPlan.legacy.script}`,
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/__sunfall-arc/not-found"))),
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    const payload = JSON.parse(
      html.slice(html.indexOf("{", html.indexOf("</main>")), html.lastIndexOf("}") + 1),
    ) as StartHydrationPayload;
    expect(payload.notFound).toBe(true);

    // A static host serves this document (404.html) at every missing URL,
    // including ones a dynamic route matches; the first router hydrates it
    // as not found, and later routers match normally.
    const clientRuntime = makeRuntime();
    try {
      await Effect.runPromise(clientRuntime.provide(hydrateStartPayload(payload)));
      const hydrating = createBrowserRouterKernel(routes, {
        runtime: eraseRuntime(clientRuntime),
        initialHref: "/projects/unpublished",
      });
      expect(hydrating.state.get()).toEqual({ _tag: "NotFound", href: "/projects/unpublished" });
      const later = createBrowserRouterKernel(routes, {
        runtime: eraseRuntime(clientRuntime),
        initialHref: "/projects/unpublished",
      });
      expect(later.state.get()._tag).toBe("Ready");
    } finally {
      await Effect.runPromise(Effect.orDie(clientRuntime.dispose));
    }
  });

  it("renders URLs whose params the route schema rejects as 404 and hydrates not found", async () => {
    let preloaded = 0;
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.Literals(["atlas", "kepler"]) }),
      preload: () =>
        Effect.sync(() => {
          preloaded++;
        }),
    });
    const routes = [ProjectRoute] as const;
    const app = makeStartServerApp({ routes });
    let serverState: unknown;
    const handler = createStartRequestHandler(app, {
      render: ({ runtime, hydrationPlan, routePlan }) => {
        serverState = createBrowserRouterKernel(routes, {
          runtime: eraseRuntime(runtime),
          initialHref: routePlan.href,
        }).state.get();
        return `<main>Not found</main>${hydrationPlan.legacy.script}`;
      },
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/unknown"))),
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(preloaded).toBe(0);
    expect(serverState).toEqual({ _tag: "NotFound", href: "/projects/unknown" });
    const payload = JSON.parse(
      html.slice(html.indexOf("{", html.indexOf("</main>")), html.lastIndexOf("}") + 1),
    ) as StartHydrationPayload;
    expect(payload.notFound).toBe(true);

    const clientRuntime = makeRuntime();
    try {
      await Effect.runPromise(clientRuntime.provide(hydrateStartPayload(payload)));
      const hydrating = createBrowserRouterKernel(routes, {
        runtime: eraseRuntime(clientRuntime),
        initialHref: "/projects/unknown",
      });
      expect(hydrating.state.get()).toEqual(serverState);
    } finally {
      await Effect.runPromise(Effect.orDie(clientRuntime.dispose));
    }
  });

  it("keeps failing standalone preloadRequest when route preload fails", async () => {
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: () => Effect.fail("missing"),
    });
    const app = makeStartServerApp({ routes: [ProjectRoute] as const });

    const failure = await Effect.runPromise(
      Effect.flip(preloadRequest(app, new Request("https://example.com/projects/atlas"))),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
  });

  it("preloads and renders with an app server layer", async () => {
    interface Projects {
      readonly get: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
    }
    const Projects = Context.Service<Projects>("@sunfall/arc-start/test/Projects");
    const ProjectsLive = Layer.succeed(Projects)({
      get: (id) => Effect.succeed({ id, name: "Layered Atlas" }),
    });
    const Project = Resource.define({
      name: "Start.Project.layered",
      load: (id: string) => Projects.use((projects) => projects.get(id)),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
      server: ProjectsLive,
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/projects/atlas")),
    );
    const response = await Effect.runPromise(
      Effect.scoped(
        createStartRequestHandler(app, {
          render: ({ resources }) => {
            const value: unknown = resources.resources[0]?.state.value;
            const name =
              typeof value === "object" && value !== null && "name" in value
                ? value.name
                : undefined;
            return Effect.succeed(`<html><body>${name}</body></html>`);
          },
        })(new Request("https://example.com/projects/atlas")),
      ),
    );

    expect(result.resources.resources[0]?.state.value).toEqual({
      id: "atlas",
      name: "Layered Atlas",
    });
    await expect(response.text()).resolves.toContain("Layered Atlas");
  });

  it("keeps request runtime fibers alive until streamed response bodies close", async () => {
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    let interrupted = false;
    let fiberCount: (() => number) | undefined;
    const handler = createStartRequestHandler(app, {
      render: ({ runtime }) =>
        Effect.gen(function* () {
          yield* runtime.resourceStore.fiberRegistry.run(
            Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
          );
          fiberCount = () => Effect.runSync(runtime.resourceStore.fiberRegistry.size);

          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode("<html>"));
                controller.enqueue(encoder.encode("streamed"));
                controller.close();
              },
            }),
            {
              headers: {
                "content-type": "text/html",
              },
            },
          );
        }),
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/"))),
    );

    expect(interrupted).toBe(false);
    expect(fiberCount?.()).toBe(1);
    await expect(response.text()).resolves.toContain("streamed");
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(fiberCount?.()).toBe(0);
    expect(interrupted).toBe(true);
  });

  it("records cancelled streamed responses on the request span", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    let cancelled: unknown;
    const handler = createStartRequestHandler(app, {
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("chunk"));
            },
            cancel(reason) {
              cancelled = reason;
            },
          }),
          {
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });

    const response = await Effect.runPromise(
      recorder.trace(Effect.scoped(handler(new Request("https://example.com/")))),
    );
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
    });
    await reader.cancel("client-disconnect");

    expect(cancelled).toBe("client-disconnect");
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "cancelled",
        "sunfall-arc.stream.state": "cancelled",
        "sunfall-arc.teardown.reason": "client-disconnect",
        "sunfall-arc.teardown.runtime_disposed": true,
        "sunfall-arc.teardown.fibers": 0,
      }),
    ]);
  });

  it("records a failed response body on the request span", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: (controller) => controller.error(new Error("render chunk failed")),
          }),
          { headers: { "content-type": "text/html" } },
        ),
    });

    const response = await Effect.runPromise(
      recorder.trace(Effect.scoped(handler(new Request("https://example.com/")))),
    );
    await expect(response.text()).rejects.toBeDefined();

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "transport",
        "sunfall-arc.stream.state": "errored",
        "sunfall-arc.teardown.reason": "stream-error",
        "sunfall-arc.teardown.runtime_disposed": true,
      }),
    ]);
  });

  it("records Effect metrics with low-cardinality route paths for Start request handling", () => {
    const ObservedRoute = Route.define("/observed-metrics/:id", {});
    const app = makeStartServerApp({
      routes: [ObservedRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: ({ match }) => `<main>${match?.href}</main>`,
    });
    const attributes = {
      transport: "ssr",
      method: "GET",
      path: "/observed-metrics/:id",
    };
    const requestCount = Metric.withAttributes(startRequestCountMetric, attributes);
    const requestDuration = Metric.withAttributes(startRequestDurationMetric, attributes);
    const requestStatus = Metric.withAttributes(startRequestStatusMetric, {
      ...attributes,
      status: "success",
    });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const beforeCount = yield* Metric.value(requestCount);
          const beforeDuration = yield* Metric.value(requestDuration);
          const beforeStatus = yield* Metric.value(requestStatus);
          const beforeSuccessCount = beforeStatus.occurrences.get("success") ?? 0;

          const response = yield* handler(
            new Request("https://example.com/observed-metrics/atlas"),
          );
          const text = yield* Effect.tryPromise(() => response.text());
          const afterCount = yield* Metric.value(requestCount);
          const afterDuration = yield* Metric.value(requestDuration);
          const afterStatus = yield* Metric.value(requestStatus);

          yield* Effect.sync(() => {
            expect(text).toContain("/observed-metrics/atlas");
            expect(afterCount.count).toBe(beforeCount.count + 1);
            expect(afterDuration.count).toBe(beforeDuration.count + 1);
            expect(afterStatus.occurrences.get("success")).toBe(beforeSuccessCount + 1);
          });
        }),
      ),
    );
  });

  it("finalizes RPC failure request metrics from the request runtime finalization event", () => {
    const FailsDomain = Server.contract("Start.metrics.rpc.failure", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.String,
      error: Schema.String,
    });
    Server.implement(
      FailsDomain,
      (): Effect.Effect<string, string> => Effect.fail("metrics-domain-failed"),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app);
    const attributes = {
      transport: "rpc",
      method: "POST",
      path: serverRpcPath,
    };
    const requestDuration = Metric.withAttributes(startRequestDurationMetric, attributes);
    const requestSuccessStatus = Metric.withAttributes(startRequestStatusMetric, {
      ...attributes,
      status: "success",
    });
    const requestFailureStatus = Metric.withAttributes(startRequestStatusMetric, {
      ...attributes,
      status: "failure",
    });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const beforeDuration = yield* Metric.value(requestDuration);
          const beforeSuccess = yield* Metric.value(requestSuccessStatus);
          const beforeFailure = yield* Metric.value(requestFailureStatus);
          const beforeSuccessCount = beforeSuccess.occurrences.get("success") ?? 0;
          const beforeFailureCount = beforeFailure.occurrences.get("failure") ?? 0;

          const response = yield* handler(
            new Request(`https://example.com${serverRpcPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: rpcMessage(FailsDomain.name, { value: "atlas" }),
            }),
          );
          const exit = yield* readRpcExit(response);
          const afterDuration = yield* Metric.value(requestDuration);
          const afterSuccess = yield* Metric.value(requestSuccessStatus);
          const afterFailure = yield* Metric.value(requestFailureStatus);

          yield* Effect.sync(() => {
            expect(exit).toEqual({
              _tag: "Failure",
              cause: [{ _tag: "Fail", error: "metrics-domain-failed" }],
            });
            expect(afterDuration.count).toBe(beforeDuration.count + 1);
            expect(afterSuccess.occurrences.get("success") ?? 0).toBe(beforeSuccessCount);
            expect(afterFailure.occurrences.get("failure")).toBe(beforeFailureCount + 1);
          });
        }),
      ),
    );
  });

  it("waits for streamed close, error, or cancel before finalizing request metrics", () => {
    const CancelRoute = Route.define("/metrics-cancel", {});
    const app = makeStartServerApp({
      routes: [CancelRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("chunk"));
            },
          }),
          {
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });
    const attributes = {
      transport: "ssr",
      method: "GET",
      path: "/metrics-cancel",
    };
    const requestCount = Metric.withAttributes(startRequestCountMetric, attributes);
    const requestDuration = Metric.withAttributes(startRequestDurationMetric, attributes);
    const requestCancelledStatus = Metric.withAttributes(startRequestStatusMetric, {
      ...attributes,
      status: "cancelled",
    });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const beforeCount = yield* Metric.value(requestCount);
          const beforeDuration = yield* Metric.value(requestDuration);
          const beforeCancelled = yield* Metric.value(requestCancelledStatus);
          const beforeCancelledCount = beforeCancelled.occurrences.get("cancelled") ?? 0;

          const response = yield* handler(new Request("https://example.com/metrics-cancel"));
          const midCount = yield* Metric.value(requestCount);
          const midDuration = yield* Metric.value(requestDuration);
          const midCancelled = yield* Metric.value(requestCancelledStatus);
          const midCancelledCount = midCancelled.occurrences.get("cancelled") ?? 0;
          const reader = response.body!.getReader();
          yield* Effect.tryPromise(() => reader.read());
          yield* Effect.tryPromise(() => reader.cancel("metrics-client-left"));
          const afterCount = yield* Metric.value(requestCount);
          const afterDuration = yield* Metric.value(requestDuration);
          const afterCancelled = yield* Metric.value(requestCancelledStatus);

          yield* Effect.sync(() => {
            expect(midCount.count).toBe(beforeCount.count);
            expect(midDuration.count).toBe(beforeDuration.count);
            expect(midCancelledCount).toBe(beforeCancelledCount);
            expect(afterCount.count).toBe(beforeCount.count + 1);
            expect(afterDuration.count).toBe(beforeDuration.count + 1);
            expect(afterCancelled.occurrences.get("cancelled")).toBe(beforeCancelledCount + 1);
          });
        }),
      ),
    );
  });

  it("ends the request span as a failure when request handlers fail", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      // Deliberately fails with a typed error the render contract does not admit, to test failure handling.
      render: () => Effect.fail("render-failed") as Effect.Effect<never>,
    });

    await expect(
      Effect.runPromise(
        recorder.trace(Effect.scoped(handler(new Request("https://example.com/")))),
      ),
    ).rejects.toMatchObject({
      _tag: "StartRequestHandlerError",
      cause: "render-failed",
    });

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "domain",
        "sunfall-arc.teardown.reason": "request-failure",
        "sunfall-arc.teardown.runtime_disposed": true,
        "sunfall-arc.teardown.fibers": 0,
      }),
    ]);
    const span = recorder.spans.find((span) => span.name === "sunfall-arc.start.request");
    expect(span?.status._tag === "Ended" && Exit.isFailure(span.status.exit)).toBe(true);
  });

  it("preserves the original handler failure when request runtime cleanup fails", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      // Deliberately fails with a typed error the render contract does not admit, to test failure handling.
      render: ({ runtime }) =>
        Effect.gen(function* () {
          runtime.resourceStore.moduleRegistry.register(Symbol("cleanup-failure"), {
            dispose: Effect.fail("cleanup-failed"),
          });
          return yield* Effect.fail("render-failed");
        }) as Effect.Effect<never>,
    });

    await expect(
      Effect.runPromise(
        recorder.trace(Effect.scoped(handler(new Request("https://example.com/")))),
      ),
    ).rejects.toMatchObject({
      _tag: "StartRequestHandlerError",
      cause: "render-failed",
    });

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.teardown.runtime_disposed": false,
        "sunfall-arc.teardown.cleanup_failure": "cleanup-failed",
      }),
    ]);
  });

  it("records cancelled requests when handlers are interrupted before a response", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () => Effect.interrupt,
    });

    const exit = await Effect.runPromiseExit(
      recorder.trace(Effect.scoped(handler(new Request("https://example.com/")))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "cancelled",
        "sunfall-arc.failure.kind": "interruption",
        "sunfall-arc.teardown.reason": "interruption",
        "sunfall-arc.teardown.runtime_disposed": true,
        "sunfall-arc.teardown.fibers": 0,
      }),
    ]);
  });

  it("reads request runtime teardown snapshots through ResourceStore diagnostics", async () => {
    const runtime = makeRuntime();
    runtime.resourceStore.moduleRegistry.register(Symbol("start-trace-module"), {});

    try {
      expect(Effect.runSync(runtime.resourceStore.diagnostics.snapshot)).toEqual({
        fiberCount: 0,
        familyCount: 0,
        moduleCount: 1,
        tagCount: 0,
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps Start source off unsafe mutable ResourceStore internals", () => {
    const offenders = sourceFiles(new URL("../src/", import.meta.url))
      .filter((file) => readFileSync(file, "utf8").includes("unsafeMutableResourceStore"))
      .map((file) => file.pathname);

    expect(offenders).toEqual([]);
  });

  it("keeps an Effect request handler as the host boundary", async () => {
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app);

    await expect(
      Effect.runPromise(Effect.scoped(handler(new Request("https://example.com/")))),
    ).resolves.toBeInstanceOf(Response);
  });

  it("reports synchronous render callback throws through the Start request Effect error", async () => {
    const thrown = new Error("render exploded");
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () => {
        throw thrown;
      },
    });

    const failure = await Effect.runPromise(
      Effect.scoped(Effect.flip(handler(new Request("https://example.com/")))),
    );

    expect(failure).toMatchObject({
      _tag: "StartRequestHandlerError",
      operation: "handle-request",
    });
    expect(failure.cause).toBeInstanceOf(EffectInputCallbackError);
    expect((failure.cause as EffectInputCallbackError).operation).toBe("Start.render");
    expect((failure.cause as EffectInputCallbackError).cause).toBe(thrown);
  });

  it("applies response context mutations from Start render effects", async () => {
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        Effect.orDie(
          ResponseContext.use((response) =>
            Effect.gen(function* () {
              yield* response.setStatus(202);
              yield* response.setHeader("x-sunfall-arc-render-context", "yes");
              yield* response.setCookie("theme", "dark", {
                path: "/",
                secure: true,
                sameSite: "none",
              });
              return "<html><body>context</body></html>";
            }),
          ),
        ),
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/"))),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-sunfall-arc-render-context")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.getSetCookie()).toEqual(["theme=dark; Path=/; Secure; SameSite=None"]);
    await expect(response.text()).resolves.toContain("context");
  });

  it("parents the Start request span on an incoming traceparent", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const parentSpanId = "00f067aa0ba902b7";
    const spans: Array<Tracer.Span> = [];
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        Effect.orDie(
          Effect.map(Effect.currentSpan, (span) => {
            spans.push(span);
            return "<html><body>traced</body></html>";
          }),
        ),
    });

    await Effect.runPromise(
      Effect.scoped(
        handler(
          new Request("https://example.com/", {
            headers: { traceparent: `00-${traceId}-${parentSpanId}-01` },
          }),
        ),
      ),
    );

    let requestSpan: Tracer.AnySpan | undefined = spans[0];
    while (requestSpan?._tag === "Span" && requestSpan.name !== "sunfall-arc.start.request") {
      requestSpan = Option.getOrUndefined(requestSpan.parent);
    }
    expect(requestSpan).toMatchObject({ _tag: "Span", name: "sunfall-arc.start.request", traceId });
    const parent =
      requestSpan?._tag === "Span" ? Option.getOrUndefined(requestSpan.parent) : undefined;
    expect(parent).toMatchObject({ _tag: "ExternalSpan", traceId, spanId: parentSpanId });
  });

  it("continues the client's current span into the server request span over RPC", async () => {
    const serverSpans: Array<Tracer.Span> = [];
    const Traced = Server.contract("Start.trace.client-propagation", {
      input: Schema.String,
      output: Schema.String,
    });
    Server.implement(Traced, (value) =>
      Effect.orDie(
        Effect.map(Effect.currentSpan, (span) => {
          serverSpans.push(span);
          return value;
        }),
      ),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app);
    const fetcher: TestFetch = (input, init) =>
      Effect.orDie(
        Effect.scoped(handler(new Request(new URL(String(input), "https://example.com"), init))),
      );
    const client = rpcClientOver(fetcher);

    const clientSpan = await Effect.runPromise(
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        expect(yield* Server.client(Traced).effect("hello")).toBe("hello");
        return span;
      }).pipe(Effect.withSpan("client.operation"), Effect.provide(client)),
    );

    let requestSpan: Tracer.AnySpan | undefined = serverSpans[0];
    while (requestSpan?._tag === "Span" && requestSpan.name !== "sunfall-arc.start.request") {
      requestSpan = Option.getOrUndefined(requestSpan.parent);
    }
    expect(requestSpan).toMatchObject({
      _tag: "Span",
      name: "sunfall-arc.start.request",
      traceId: clientSpan.traceId,
    });
    const parent =
      requestSpan?._tag === "Span" ? Option.getOrUndefined(requestSpan.parent) : undefined;
    // The request span continues the client's HTTP span, a child of the
    // caller's span through the `RpcClient` span.
    expect(parent).toMatchObject({ _tag: "ExternalSpan", traceId: clientSpan.traceId });
  });

  it("fails invalid response context status through the typed Start request error path", async () => {
    const recorder = spanRecorder();
    const Home = Route.define("/", {});
    const app = makeStartServerApp({
      routes: [Home] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        Effect.orDie(
          ResponseContext.use((response) =>
            Effect.gen(function* () {
              yield* response.setStatus(99);
              return "<html><body>invalid status</body></html>";
            }),
          ),
        ),
    });

    const failure = await recorder.run(
      Effect.scoped(Effect.flip(handler(new Request("https://example.com/invalid-status")))),
    );

    expect(failure).toMatchObject({
      _tag: "StartRequestHandlerError",
      operation: "handle-request",
      request: {
        method: "GET",
        url: "https://example.com/invalid-status",
      },
    });
    expect(failure.cause).toBeInstanceOf(EffectInputCallbackError);
    expect((failure.cause as EffectInputCallbackError).operation).toBe("ResponseContext.apply");
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.teardown.reason": "request-failure",
        "sunfall-arc.teardown.runtime_disposed": true,
        "sunfall-arc.teardown.fibers": 0,
      }),
    ]);
  });

  it("runs returned Start render effects with the request runtime as ambient", async () => {
    const Project = Resource.define<string, { readonly id: string; readonly name: string }>({
      name: "Start.render.ambient.project",
      load: (id) => Effect.succeed({ id, name: `Project ${id}` }),
    });
    const ProjectRoute = Route.define("/projects/:id", {
      preload: ({ params }) => Resource.preload(Project(params.id)).pipe(Effect.asVoid),
    });
    const app = makeStartServerApp({
      routes: [ProjectRoute] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        Effect.gen(function* () {
          const project = yield* Effect.orDie(Resource.read(Project("atlas")));
          return `<html><body>${project.name}</body></html>`;
        }),
    });

    const response = await Effect.runPromise(
      Effect.scoped(handler(new Request("https://example.com/projects/atlas"))),
    );

    await expect(response.text()).resolves.toContain("Project atlas");
  });

  it("serves server functions over the Start RPC endpoint", async () => {
    const Echo = Server.contract("Start.echo.rpc", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const echo = Server.implement(Echo, ({ value }) =>
      Effect.orDie(
        ResponseContext.use((response) =>
          Effect.gen(function* () {
            yield* response.setHeader("x-sunfall-arc-rpc-context", "yes");
            yield* response.setCookie("rpc", value, { path: "/rpc" });
            return { value: value.toUpperCase() };
          }),
        ),
      ),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const response = await Effect.runPromise(
      Effect.scoped(
        createServerRpcResponse(
          app,
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: rpcMessage(echo.name, { value: "ada" }),
          }),
        ),
      ),
    );

    await expect(Effect.runPromise(readRpcExit(response))).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" },
    });
    expect(response.headers.get("x-sunfall-arc-rpc-context")).toBe("yes");
    expect(response.headers.getSetCookie()).toEqual(["rpc=ada; Path=/rpc"]);
  });

  it("finalizes transport diagnostics after ResponseContext headers", async () => {
    const SpoofRpc = Server.contract("Start.echo.transport-diagnostics", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const spoofRpc = Server.implement(SpoofRpc, ({ value }) =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setHeader(startRequestIdHeader, "spoofed-rpc");
          yield* response.setHeader(startTransportKindHeader, "spoofed-rpc");
          yield* response.setHeader(startTransportProtocolHeader, "spoofed-rpc");
          return { value: value.toUpperCase() };
        }),
      ),
    );
    // `run` writes response headers, so it requires the ResponseContext Start provides.
    const SpoofAction = Action.define<
      { readonly value: string },
      { readonly value: string },
      never,
      ResponseContext
    >({
      name: "Start.action.transport-diagnostics",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) =>
        Effect.orDie(
          ResponseContext.use((response) =>
            Effect.gen(function* () {
              yield* response.setHeader(startRequestIdHeader, "spoofed-action");
              yield* response.setHeader(startTransportKindHeader, "spoofed-action");
              yield* response.setHeader(startTransportProtocolHeader, "spoofed-action");
              return { value: value.toUpperCase() };
            }),
          ),
        ),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });

    const rpcResponse = await Effect.runPromise(
      Effect.scoped(
        createServerRpcResponse(
          app,
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [startRequestIdHeader]: "req-rpc-authoritative",
            },
            body: rpcMessage(spoofRpc.name, { value: "ada" }),
          }),
        ),
      ),
    );
    const actionResponse = await Effect.runPromise(
      Effect.scoped(
        createServerActionResponse(
          app,
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [startRequestIdHeader]: "req-action-authoritative",
            },
            body: JSON.stringify({
              name: SpoofAction.name,
              input: { value: "grace" },
            }),
          }),
          [SpoofAction],
        ),
      ),
    );

    await expect(Effect.runPromise(readRpcExit(rpcResponse))).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" },
    });
    expect(rpcResponse.headers.get(startRequestIdHeader)).toBe("req-rpc-authoritative");
    expect(rpcResponse.headers.get(startTransportKindHeader)).toBe("rpc");
    expect(rpcResponse.headers.get(startTransportProtocolHeader)).toBe(
      startTransportProtocolVersion,
    );

    await expect(actionResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "GRACE" },
    });
    expect(actionResponse.headers.get(startRequestIdHeader)).toBe("req-action-authoritative");
    expect(actionResponse.headers.get(startTransportKindHeader)).toBe("action");
    expect(actionResponse.headers.get(startTransportProtocolHeader)).toBe(
      startTransportProtocolVersion,
    );
  });

  it("maps non-JSON-safe action response bodies to defect responses", async () => {
    const BigAction = Action.define<null, bigint>({
      name: "Start.bigint.action",
      run: () => Effect.succeed(1n),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const actionResponse = await Effect.runPromise(
      Effect.scoped(
        createServerActionResponse(
          app,
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: BigAction.name,
              input: null,
            }),
          }),
          [BigAction],
        ),
      ),
    );

    expect(actionResponse.status).toBe(500);
    await expect(actionResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });
  });

  it("records RPC and Start action spans inside request spans", async () => {
    const recorder = spanRecorder();
    const Echo = Server.contract("Start.echo.trace", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const echo = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: value.toUpperCase() }),
    );
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.trace.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [Ping],
    });

    const rpcResponse = await recorder.run(
      Effect.scoped(
        handler(
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-sunfall-arc-request-id": "req-rpc-trace",
            },
            body: rpcMessage(echo.name, { value: "ada" }),
          }),
        ),
      ),
    );
    await expect(Effect.runPromise(readRpcExit(rpcResponse))).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" },
    });
    expect(rpcResponse.headers.get(startRequestIdHeader)).toBe("req-rpc-trace");

    const actionResponse = await recorder.run(
      Effect.scoped(
        handler(
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-sunfall-arc-request-id": "req-action-trace",
            },
            body: JSON.stringify({
              name: Ping.name,
              input: { value: "pong" },
            }),
          }),
        ),
      ),
    );
    await expect(actionResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "PONG" },
    });
    expect(actionResponse.headers.get(startRequestIdHeader)).toBe("req-action-trace");

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.id": "req-rpc-trace",
        "sunfall-arc.request.transport": "rpc",
        "url.path": serverRpcPath,
        "sunfall-arc.request.status": "success",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-action-trace",
        "sunfall-arc.request.transport": "action",
        "url.path": serverActionPath,
        "sunfall-arc.request.status": "success",
      }),
    ]);
    const requestSpans = recorder.spans.filter((span) => span.name === "sunfall-arc.start.request");
    const child = (name: string) => recorder.spans.find((span) => span.name === name);
    expect(child("sunfall-arc.start.rpc")?.attributes.get("sunfall-arc.rpc.name")).toBe(echo.name);
    expect(Option.getOrUndefined(child("sunfall-arc.start.rpc")!.parent)?.spanId).toBe(
      requestSpans[0]!.spanId,
    );
    expect(child("sunfall-arc.start.action")?.attributes.get("sunfall-arc.action.name")).toBe(
      Ping.name,
    );
    expect(Option.getOrUndefined(child("sunfall-arc.start.action")!.parent)?.spanId).toBe(
      requestSpans[1]!.spanId,
    );
  });

  it("uses one generated request id for transport diagnostics and the request span", async () => {
    const recorder = spanRecorder();
    const Echo = Server.contract("Start.echo.trace.generated-id", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const echo = Server.implement(Echo, ({ value }) => Effect.succeed({ value }));
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {});

    const response = await recorder.run(
      Effect.scoped(
        handler(
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: rpcMessage(echo.name, { value: "ada" }),
          }),
        ),
      ),
    );
    await expect(Effect.runPromise(readRpcExit(response))).resolves.toEqual({
      _tag: "Success",
      value: { value: "ada" },
    });

    expect(recorder.requests()).toHaveLength(1);
    expect(response.headers.get(startRequestIdHeader)).toBe(
      recorder.requests()[0]!["sunfall-arc.request.id"],
    );
  });

  it("classifies RPC and Start action request failures by layer", async () => {
    const recorder = spanRecorder();
    const FailsDomain = Server.contract("Start.trace.failure.domain", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.String,
      error: Schema.String,
    });
    const failsDomain = Server.implement(
      FailsDomain,
      (): Effect.Effect<string, string> => Effect.fail("domain-failed"),
    );
    const ActionFailsDomain = Action.define<{ readonly value: string }, string, string>({
      name: "Start.trace.action.failure.domain",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.String,
      error: Schema.String,
      run: () => Effect.fail("action-domain-failed"),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [ActionFailsDomain],
    });
    const rpcRequest = (id: string, tag: string, payload: unknown) =>
      new Request(`https://example.com${serverRpcPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sunfall-arc-request-id": id,
        },
        body: rpcMessage(tag, payload),
      });
    const actionRequest = (id: string, body: unknown) =>
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sunfall-arc-request-id": id,
        },
        body: JSON.stringify(body),
      });

    const rpcDomain = await recorder.run(
      Effect.scoped(
        handler(rpcRequest("req-rpc-domain-failure", failsDomain.name, { value: "ada" })),
      ),
    );
    await expect(Effect.runPromise(readRpcExit(rpcDomain))).resolves.toEqual({
      _tag: "Failure",
      cause: [{ _tag: "Fail", error: "domain-failed" }],
    });

    const rpcValidation = await recorder.run(
      Effect.scoped(
        handler(rpcRequest("req-rpc-validation-failure", failsDomain.name, { value: 1 })),
      ),
    );
    // `RpcServer` answers payloads that fail the input schema with a defect.
    await expect(Effect.runPromise(readRpcExit(rpcValidation))).resolves.toMatchObject({
      _tag: "Failure",
      cause: [{ _tag: "Die" }],
    });

    const rpcProtocol = await recorder.run(
      Effect.scoped(handler(rpcRequest("req-rpc-protocol-failure", "Start.trace.missing", {}))),
    );
    await expect(Effect.runPromise(readRpcExit(rpcProtocol))).resolves.toEqual({
      _tag: "Failure",
      cause: [{ _tag: "Die", defect: "Unknown request tag: Start.trace.missing" }],
    });

    const rpcTransport = await recorder.run(
      Effect.scoped(
        handler(
          new Request(`https://example.com${serverRpcPath}`, {
            method: "GET",
            headers: {
              "x-sunfall-arc-request-id": "req-rpc-transport-failure",
            },
          }),
        ),
      ),
    );
    expect(rpcTransport.status).toBe(405);
    await rpcTransport.text();

    const actionDomain = await recorder.run(
      Effect.scoped(
        handler(
          actionRequest("req-action-domain-failure", {
            name: ActionFailsDomain.name,
            input: { value: "ada" },
          }),
        ),
      ),
    );
    await expect(actionDomain.json()).resolves.toEqual({
      _tag: "Failure",
      error: "action-domain-failed",
    });

    const actionValidation = await recorder.run(
      Effect.scoped(
        handler(
          actionRequest("req-action-validation-failure", {
            name: ActionFailsDomain.name,
            input: { value: 1 },
          }),
        ),
      ),
    );
    expect(actionValidation.status).toBe(400);
    await actionValidation.text();

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.id": "req-rpc-domain-failure",
        "sunfall-arc.request.transport": "rpc",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "domain",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-rpc-validation-failure",
        "sunfall-arc.request.transport": "rpc",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "protocol",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-rpc-protocol-failure",
        "sunfall-arc.request.transport": "rpc",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "protocol",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-rpc-transport-failure",
        "sunfall-arc.request.transport": "rpc",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "transport",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-action-domain-failure",
        "sunfall-arc.request.transport": "action",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "domain",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-action-validation-failure",
        "sunfall-arc.request.transport": "action",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "validation",
      }),
    ]);
  });

  it("classifies Start action response encoding and hydration metadata defects", async () => {
    const recorder = spanRecorder();
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const Project = Resource.define({
      name: "Start.trace.action.meta-defect.Project",
      input: Schema.String,
      output: ProjectSchema,
      load: (id) =>
        Effect.succeed({
          id,
          name: 1,
        } as unknown as typeof ProjectSchema.Type),
    });
    const BadOutput = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.trace.action.output-defect",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: () =>
        Effect.succeed({
          value: 1,
        } as unknown as { readonly value: string }),
    });
    const BadMeta = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
      name: "Start.trace.action.meta-defect",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: ({ id }) =>
        Effect.gen(function* () {
          yield* Effect.orDie(Resource.preload(Project(id)));
          return { ok: true };
        }),
      invalidates: (_result, input) => [Project(input.id)],
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [BadOutput, BadMeta],
    });
    const actionRequest = (id: string, name: string, input: unknown) =>
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sunfall-arc-request-id": id,
        },
        body: JSON.stringify({ name, input }),
      });

    const outputResponse = await recorder.run(
      Effect.scoped(
        handler(actionRequest("req-action-output-defect", BadOutput.name, { value: "ok" })),
      ),
    );
    expect(outputResponse.status).toBe(500);
    await expect(outputResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });

    const metaResponse = await recorder.run(
      Effect.scoped(
        handler(actionRequest("req-action-meta-defect", BadMeta.name, { id: "atlas" })),
      ),
    );
    expect(metaResponse.status).toBe(500);
    await expect(metaResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });

    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.id": "req-action-output-defect",
        "sunfall-arc.request.transport": "action",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "defect",
      }),
      expect.objectContaining({
        "sunfall-arc.request.id": "req-action-meta-defect",
        "sunfall-arc.request.transport": "action",
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.failure.kind": "defect",
      }),
    ]);
  });

  it("lets browser runtimes call server functions through ServerClient", async () => {
    const Echo = Server.contract("Start.echo.remote", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const echo = Server.client(Echo);
    Server.implement(Echo, ({ value }) => Effect.succeed({ value: `server:${value}` }));
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app);
    const fetcher: TestFetch = (input, init) =>
      Effect.orDie(Effect.scoped(handler(new Request(input, init))));
    const runtime = rpcClientOver(fetcher);

    await expect(
      Effect.runPromise(Effect.provide(echo.effect({ value: "atlas" }), runtime)),
    ).resolves.toEqual({ value: "server:atlas" });
  });

  it("round-trips schema-encoded server function failures", async () => {
    const ExampleError = Schema.TaggedStruct("ExampleError", {
      message: Schema.String,
    });
    type ExampleErrorType = {
      readonly _tag: "ExampleError";
      readonly message: string;
    };
    const Fail = Server.contract("Start.fail.remote", {
      input: Schema.String,
      output: Schema.String,
      error: ExampleError,
    });
    const fail = Server.client(Fail);
    Server.implement(
      Fail,
      (): Effect.Effect<string, ExampleErrorType> =>
        Effect.fail({ _tag: "ExampleError", message: "not today" }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app);
    const fetcher: TestFetch = (input, init) =>
      Effect.orDie(Effect.scoped(handler(new Request(input, init))));
    const runtime = rpcClientOver(fetcher);
    const exit = await Effect.runPromise(Effect.exit(Effect.provide(fail.effect("x"), runtime)));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined).toEqual({
      _tag: "ExampleError",
      message: "not today",
    });
  });

  it("runs Start actions from JSON and form posts in the request runtime", async () => {
    const SubmitNameInput = Schema.Struct({
      name: Schema.String,
      redirectTo: Schema.optional(Schema.String),
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
        value: Schema.Struct({ name: Schema.String }),
      },
      ValidationFailure: {
        fieldErrors: Schema.Struct({
          name: Schema.optional(Schema.Array(Schema.String)),
        }),
        formErrors: Schema.Array(Schema.String),
        cause: Schema.optional(Schema.Unknown),
      },
      Redirect: {
        location: Schema.String,
        status: Schema.Number,
        replace: Schema.optional(Schema.Boolean),
      },
      Failure: {
        error: Schema.String,
      },
    });
    interface Names {
      readonly submit: (input: SubmitNameInput) => Effect.Effect<SubmitNameResult>;
    }
    const Names = Context.Service<Names>("@sunfall/arc-start/test/Names");
    const submitted: Array<string> = [];
    const NamesLive = Layer.succeed(Names)({
      submit: (input) =>
        Effect.sync(() => {
          const name = input.name.trim();
          if (name.length < 3) {
            return ActionResult.validation<SubmitNameInput, string>({
              fieldErrors: {
                name: ["Use at least three characters."],
              },
              formErrors: [],
            });
          }

          submitted.push(name);
          return input.redirectTo
            ? ActionResult.redirect(input.redirectTo, { status: 303, replace: true })
            : ActionResult.success({ name });
        }),
    });
    const SubmitName = Action.define<SubmitNameInput, SubmitNameResult, never, Names>({
      name: "Start.action.submitName",
      input: SubmitNameInput,
      output: SubmitNameResult,
      run: (input) => Names.use((names) => names.submit(input)),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
      server: NamesLive,
    });
    const handler = createStartRequestHandler(app, {
      actions: [SubmitName],
    });

    const validation = await Effect.runPromise(
      Effect.scoped(
        createServerActionResponse(
          app,
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: SubmitName.name,
              input: { name: "Al" },
            }),
          }),
          [SubmitName],
        ),
      ),
    );
    const form = StartAction.form(SubmitName, {
      input: {
        redirectTo: "/projects/atlas?tab=activity",
      },
    });
    const formBody = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value]),
    );
    formBody.set("name", "Atlas Forms");
    const redirect = await Effect.runPromise(
      Effect.scoped(
        handler(
          new Request("https://example.com/", {
            method: form.method.toUpperCase(),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: formBody,
          }),
        ),
      ),
    );

    // A validation outcome is an answer, not a transport error.
    expect(validation.status).toBe(200);
    await expect(validation.json()).resolves.toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: ["Use at least three characters."],
      },
    });
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe("/projects/atlas?tab=activity");
    expect(submitted).toEqual(["Atlas Forms"]);
  });

  it("uses the same schema action request codec for JSON submits and progressive form defaults", async () => {
    const EncodedInput = Schema.Struct({
      id: Schema.String.pipe(Schema.brand("StartActionCodecProjectId")),
      count: Schema.NumberFromString,
    });
    type EncodedInput = typeof EncodedInput.Type;
    const Submit = Action.define<EncodedInput, { readonly ok: boolean }>({
      name: "Start.action.codec.shared",
      input: EncodedInput,
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const input: EncodedInput = {
      id: "atlas" as EncodedInput["id"],
      count: 7,
    };

    const jsonRequest = await Effect.runPromise(encodeStartActionRequest(Submit, input));
    const form = StartAction.form(Submit, { input });
    const formInput = form.hiddenFields.find((field) => field.name === startActionInputField);

    expect(jsonRequest).toEqual({
      name: Submit.name,
      input: {
        id: "atlas",
        count: "7",
      },
    });
    expect(JSON.parse(formInput?.value ?? "{}")).toEqual(jsonRequest.input);
  });

  it("decodes progressive action FormData into the Action input without hidden transport fields", async () => {
    const Submit = Action.define<
      { readonly id: string; readonly name: string },
      { readonly ok: boolean }
    >({
      name: "Start.action.codec.user-form-fields",
      input: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const form = StartAction.form(Submit, { input: { id: "atlas" } });
    const formData = new FormData();

    for (const field of form.hiddenFields) {
      formData.set(field.name, field.value);
    }
    formData.set("name", "Atlas Forms");

    await expect(Effect.runPromise(StartAction.decodeFormData(Submit, formData))).resolves.toEqual({
      id: "atlas",
      name: "Atlas Forms",
    });
  });

  it("reads a posted form as the domain input: checkboxes, repeated names, empty selects, numbers", async () => {
    const Submit = Action.define({
      name: "Start.action.codec.form-shapes",
      input: Schema.Struct({
        title: Schema.String,
        urgent: Schema.Boolean,
        labelIds: Schema.Array(Schema.String),
        assigneeId: Schema.NullOr(Schema.String),
        note: Schema.optional(Schema.String),
        estimate: Schema.Number,
      }),
      run: (input) => Effect.succeed(input),
    });
    const decode = (entries: ReadonlyArray<readonly [string, string]>) => {
      const formData = new FormData();
      for (const [name, value] of entries) {
        formData.append(name, value);
      }
      return Effect.runPromise(StartAction.decodeFormData(Submit, formData));
    };

    // Nothing checked, nobody assigned, no note.
    await expect(
      decode([
        ["title", "Ship"],
        ["assigneeId", ""],
        ["note", ""],
        ["estimate", "3"],
      ]),
    ).resolves.toEqual({
      title: "Ship",
      urgent: false,
      labelIds: [],
      assigneeId: null,
      estimate: 3,
    });
    // One box of a group, then several.
    await expect(
      decode([
        ["title", "Ship"],
        ["urgent", "on"],
        ["labelIds", "bug"],
        ["assigneeId", "u_1"],
        ["estimate", "0.5"],
      ]),
    ).resolves.toMatchObject({ urgent: true, labelIds: ["bug"], assigneeId: "u_1", estimate: 0.5 });
    await expect(
      decode([
        ["title", ""],
        ["labelIds", "bug"],
        ["labelIds", "ui"],
        ["estimate", "1"],
      ]),
    ).resolves.toMatchObject({ title: "", labelIds: ["bug", "ui"] });
  });

  it("decodes a progressive form's defaults with its fields, as the server decodes its post", async () => {
    const Input = Schema.Struct({ id: Schema.String, name: Schema.String });
    const Submit = Action.define({
      name: "Start.action.codec.form-defaults",
      input: Input,
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const form = StartAction.form(Submit, { input: { id: "atlas", name: "Default" } });
    const formData = new FormData();
    for (const field of form.hiddenFields) {
      formData.set(field.name, field.value);
    }
    formData.set("name", "Atlas Forms");

    // The visible field wins over the default; the default `id` reaches the schema.
    await expect(Effect.runPromise(StartAction.decodeFormData(Submit, formData))).resolves.toEqual({
      id: "atlas",
      name: "Atlas Forms",
    });
  });

  it("fails progressive form default encoding with typed errors for circular and BigInt inputs", () => {
    const Submit = Action.define<Record<string, unknown>, { readonly ok: boolean }>({
      name: "Start.action.codec.form-failure",
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => StartAction.form(Submit, { input: circular })).toThrow(StartActionFormEncodeError);
    expect(() => StartAction.form(Submit, { input: { count: 1n } })).toThrow(
      StartActionFormEncodeError,
    );
  });

  it("discovers Start actions from the Action registry when no explicit list is supplied", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.registry.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const response = await Effect.runPromise(
      Effect.scoped(
        createStartRequestHandler(app)(
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: Ping.name,
              input: { value: "registry" },
            }),
          }),
        ),
      ),
    );

    await expect(response.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "REGISTRY" },
    });
  });

  it("materializes explicit Start action iterables once when creating the request handler", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.explicit-one-shot",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const explicitActions = oneShotIterable([Ping]);
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: explicitActions.iterable,
    });
    const submit = (value: string) =>
      Effect.runPromise(
        Effect.scoped(
          handler(
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: Ping.name,
                input: { value },
              }),
            }),
          ),
        ),
      );

    const first = await submit("first");
    const second = await submit("second");

    expect(explicitActions.iteratorCalls).toBe(1);
    await expect(first.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "FIRST" },
    });
    await expect(second.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "SECOND" },
    });
  });

  it("rejects duplicate explicit Start action names when creating the request handler", () => {
    const First = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.explicit-duplicate",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `first:${value}` }),
    });
    const Second = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.explicit-duplicate",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `second:${value}` }),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });

    expect(() =>
      createStartRequestHandler(app, {
        actions: [First, Second],
      }),
    ).toThrow(StartActionDuplicateName);
  });

  it("uses the app registry snapshot for RPC and action dispatch", () => {
    const Echo = Server.contract("Start.registry.snapshot.echo", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const echo = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: value.toUpperCase() }),
    );
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.registry.snapshot.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          Server.clearRegistryUnsafe();
          clearActionDefinitionRegistryUnsafe();
          const handler = createStartRequestHandler(app);
          const rpc = yield* handler(
            new Request(`https://example.com${serverRpcPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: rpcMessage(echo.name, { value: "snapshot" }),
            }),
          );
          const action = yield* handler(
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: Ping.name,
                input: { value: "snapshot" },
              }),
            }),
          );

          const rpcBody = yield* readRpcExit(rpc);
          const actionBody = yield* Effect.tryPromise(() => action.json());
          expect(rpcBody).toEqual({
            _tag: "Success",
            value: { value: "SNAPSHOT" },
          });
          expect(actionBody).toEqual({
            _tag: "Success",
            value: { value: "SNAPSHOT" },
          });
        }),
      ),
    );
  });

  it("dispatches RPC and actions from an explicit app-local registry", () => {
    const Echo = Server.contract("Start.registry.local.echo", {
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const localEcho = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: `local:${value}` }),
    );
    const LocalPing = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.registry.local.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `local:${value}` }),
    });
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
      registry: {
        actions: [LocalPing],
        serverFunctions: [localEcho],
      },
    });

    Server.implement(Echo, ({ value }) => Effect.succeed({ value: `global:${value}` }));
    Action.define<{ readonly value: string }, { readonly value: string }>({
      name: LocalPing.name,
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `global:${value}` }),
    });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const handler = createStartRequestHandler(app);
          const rpc = yield* handler(
            new Request(`https://example.com${serverRpcPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: rpcMessage(localEcho.name, { value: "registry" }),
            }),
          );
          const action = yield* handler(
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: LocalPing.name,
                input: { value: "registry" },
              }),
            }),
          );

          const rpcBody = yield* readRpcExit(rpc);
          const actionBody = yield* Effect.tryPromise(() => action.json());
          expect(rpcBody).toEqual({
            _tag: "Success",
            value: { value: "local:registry" },
          });
          expect(actionBody).toEqual({
            _tag: "Success",
            value: { value: "local:registry" },
          });
        }),
      ),
    );
  });

  it("returns action invalidation hydration to JSON clients", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    let project = {
      id: "atlas",
      name: "Initial",
    };
    const Project = Resource.define({
      name: "Start.action.Project.hydration",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
    });
    const RenameProject = Action.define({
      name: "Start.action.project.rename.hydration",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      invalidates: (_project, input) => [Project(input.id)],
    });
    const renameProject = Action.implement(RenameProject, ({ id, name }) =>
      Effect.sync(() => {
        project = { id, name };
        return project;
      }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [renameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return Effect.orDie(Effect.scoped(handler(new Request(url, init))));
    };

    try {
      await runInRuntime(clientRuntime, Resource.preload(ref));

      const result = await Effect.runPromise(
        submitViaActionTransport(
          RenameProject,
          { id: "atlas", name: "Renamed From Server" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toEqual({
        id: "atlas",
        name: "Renamed From Server",
      });
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Renamed From Server",
      });

      // A stateful instance on the client runtime submits through the same transport.
      const action = makeActionInstance(RenameProject, eraseRuntime(clientRuntime));
      await expect(
        Effect.runPromise(
          action
            .submit({ id: "atlas", name: "Renamed Through Transport" })
            .pipe(
              Effect.provide(
                actionTransportLayer.pipe(Layer.provide(testHttpClientLayer(fetcher))),
              ),
            ),
        ),
      ).resolves.toEqual({ id: "atlas", name: "Renamed Through Transport" });
      expect(action.state.get().result).toMatchObject({
        _tag: "Success",
        value: { id: "atlas", name: "Renamed Through Transport" },
      });
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Renamed Through Transport",
      });
    } finally {
      await Effect.runPromise(clientRuntime.dispose);
    }
  });

  it("does not suppress invalidations for a different hydrated resource family", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    class FamilyLocalKeyResource<A> extends ResourceFamily<string, A> {
      override ref(input: string): Resource.Ref<string, A> {
        return {
          [ResourceTypeId]: ResourceTypeId,
          family: this,
          input,
          key: input,
        };
      }
    }

    let invalidatedProject = {
      id: "atlas",
      name: "Invalidation Initial",
    };
    const HydratedProject = new FamilyLocalKeyResource<typeof ProjectSchema.Type>({
      name: "Start.action.Project.identity-hydrated",
      input: Schema.String,
      output: ProjectSchema,
      load: (id: string) => Effect.succeed({ id, name: "Hydrated Initial" }),
    });
    const InvalidatedProject = new FamilyLocalKeyResource<typeof ProjectSchema.Type>({
      name: "Start.action.Project.identity-invalidated",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(invalidatedProject),
    });
    const TouchProject = Action.define({
      name: "Start.action.project.identity-refresh",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ ok: Schema.Boolean }),
    });
    const clientRuntime = makeRuntime();
    const hydratedRef = HydratedProject.ref("atlas");
    const invalidatedRef = InvalidatedProject.ref("atlas");
    const fetcher: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { ok: true },
            hydration: {
              resources: [
                {
                  name: HydratedProject.options.name,
                  key: hydratedRef.key,
                  input: "atlas",
                  state: {
                    _tag: "Success",
                    waiting: false,
                    value: { id: "atlas", name: "Hydrated By Action" },
                    timestamp: 1,
                  },
                },
              ],
            },
            invalidation: {
              targets: [
                {
                  _tag: "Ref",
                  key: invalidatedRef.key,
                  family: InvalidatedProject.options.name,
                  input: "atlas",
                },
              ],
              entries: [],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    try {
      await runInRuntime(clientRuntime, Resource.preload(hydratedRef));
      await runInRuntime(clientRuntime, Resource.preload(invalidatedRef));
      invalidatedProject = {
        id: "atlas",
        name: "Invalidated By Action",
      };

      await expect(
        Effect.runPromise(
          submitViaActionTransport(
            TouchProject,
            { id: "atlas" },
            {
              fetch: fetcher,
              runtime: clientRuntime,
            },
          ),
        ),
      ).resolves.toEqual({ ok: true });

      expect(hydratedRef.key).toBe(invalidatedRef.key);
      expect(HydratedProject.options.name).not.toBe(InvalidatedProject.options.name);
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(
            Effect.runSync(Resource.status(hydratedRef)).result,
            () => undefined,
          ),
        ),
      ).toEqual({
        id: "atlas",
        name: "Hydrated By Action",
      });
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(
            Effect.runSync(Resource.status(invalidatedRef)).result,
            () => undefined,
          ),
        ),
      ).toEqual({
        id: "atlas",
        name: "Invalidated By Action",
      });
    } finally {
      await Effect.runPromise(clientRuntime.dispose);
    }
  });

  it("applies action transport responses to the submitting runtime", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    let project = {
      id: "atlas",
      name: "Initial",
    };
    const Project = Resource.define({
      name: "Start.action.client.caller-runtime",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
    });
    const RenameProject = Action.define({
      name: "Start.action.client.caller-runtime.rename",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      invalidates: (_project, input) => [Project(input.id)],
    });
    const renameProject = Action.implement(RenameProject, ({ id, name }) =>
      Effect.sync(() => {
        project = { id, name };
        return project;
      }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [renameProject],
    });
    const runtime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return Effect.orDie(Effect.scoped(handler(new Request(url, init))));
    };
    try {
      await runInRuntime(runtime, Resource.preload(ref));
      expect(
        runWithRuntime(defaultRuntime, () => Effect.runSync(Resource.status(ref)).result._tag),
      ).toBe("Initial");

      await expect(
        Effect.runPromise(
          submitViaActionTransport(
            RenameProject,
            { id: "atlas", name: "Caller Runtime" },
            { fetch: fetcher, runtime },
          ),
        ),
      ).resolves.toEqual({ id: "atlas", name: "Caller Runtime" });

      expect(
        runWithRuntime(runtime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Caller Runtime",
      });
      expect(
        runWithRuntime(defaultRuntime, () => Effect.runSync(Resource.status(ref)).result._tag),
      ).toBe("Initial");
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("applies an Action's optimistic only on the submitting client, not at the endpoint", async () => {
    const optimisticSites: Array<string> = [];
    let site = "client";
    let runs = 0;
    const Rename = Action.define({
      name: "Start.action.optimistic-site",
      input: Schema.String,
      output: Schema.String,
      optimistic: () =>
        Effect.sync(() => {
          optimisticSites.push(site);
        }),
    });
    const rename = Action.implement(Rename, (name) =>
      Effect.sync(() => {
        runs++;
        return name;
      }),
    );
    const handler = createStartRequestHandler(
      makeStartServerApp({ routes: [Route.define("/", {})] as const }),
      { actions: [rename] },
    );
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      site = "endpoint";
      return Effect.orDie(Effect.scoped(handler(new Request(url, init)))).pipe(
        Effect.ensuring(Effect.sync(() => (site = "client"))),
      );
    };

    await expect(
      Effect.runPromise(submitViaActionTransport(Rename, "Atlas", { fetch: fetcher })),
    ).resolves.toBe("Atlas");
    expect(runs).toBe(1);
    expect(optimisticSites).toEqual(["client"]);

    // A direct endpoint request (a progressive form post) runs the Action
    // without any optimistic work.
    optimisticSites.length = 0;
    const response = await Effect.runPromise(
      Effect.scoped(
        handler(
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: Rename.name, input: "Borealis" }),
          }),
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(runs).toBe(2);
    expect(optimisticSites).toEqual([]);
  });

  it("decodes Start action client success values with the action output schema", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const RenameProject = Action.define({
      name: "Start.action.client.decode",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
    });
    const badFetch: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: {
              id: 123,
              name: "Bad Wire Value",
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const exit = await Effect.runPromiseExit(
      submitViaActionTransport(RenameProject, { id: "atlas", name: "Atlas" }, { fetch: badFetch }),
    );

    expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined).toBeInstanceOf(
      Schema.SchemaError,
    );
  });

  it("rejects successful Start action bodies carried by failing HTTP statuses", async () => {
    const Ping = Action.define({
      name: "Start.action.client.success-bad-status",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const fetcher: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const exit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: fetcher }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ActionTransportError);
    expect(failure).toMatchObject({
      reason: "BadStatus",
      status: 500,
      payload: {
        _tag: "Success",
      },
    });
  });

  it("reads Start action validation bodies as 2xx answers", async () => {
    type PingResult = ActionResult<
      { readonly value: string },
      { readonly value: string },
      string,
      string
    >;
    const PingResult = Schema.TaggedUnion({
      Success: {
        value: Schema.Struct({ value: Schema.String }),
      },
      ValidationFailure: {
        fieldErrors: Schema.Struct({
          value: Schema.optional(Schema.Array(Schema.String)),
        }),
        formErrors: Schema.Array(Schema.String),
        cause: Schema.optional(Schema.Unknown),
      },
      Redirect: {
        location: Schema.String,
        status: Schema.Number,
        replace: Schema.optional(Schema.Boolean),
      },
      Failure: {
        error: Schema.String,
      },
    });
    const Ping = Action.define({
      name: "Start.action.client.validation-status",
      input: Schema.Struct({ value: Schema.String }),
      output: PingResult,
    });
    const validationBody = {
      _tag: "ValidationFailure" as const,
      fieldErrors: {
        value: ["Too short."],
      },
      formErrors: [],
      cause: undefined,
    };
    const validationWithStatus =
      (status: number): TestFetch =>
      () =>
        Effect.succeed(
          new Response(JSON.stringify(validationBody), {
            status,
            headers: { "content-type": "application/json" },
          }),
        );

    const badExit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "x" }, { fetch: validationWithStatus(422) }),
    );
    const ok = await Effect.runPromise(
      submitViaActionTransport(Ping, { value: "x" }, { fetch: validationWithStatus(200) }),
    );
    const failure = Exit.isFailure(badExit) ? firstFailure(badExit.cause) : undefined;

    expect(failure).toBeInstanceOf(ActionTransportError);
    expect(failure).toMatchObject({
      reason: "BadStatus",
      status: 422,
      payload: {
        _tag: "ValidationFailure",
      },
    });
    expect(ok).toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        value: ["Too short."],
      },
    });
  });

  it("rejects malformed Start action response metadata as transport errors", async () => {
    const Ping = Action.define({
      name: "Start.action.client.malformed-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const malformedInvalidation: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
            invalidation: {
              targets: {},
              entries: [],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const malformedHydration: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
            hydration: {
              resources: {},
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const missingSuccessValue: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const missingRefInput: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
            invalidation: {
              targets: [
                {
                  _tag: "Ref",
                  key: "Project:atlas",
                  family: "Project",
                },
              ],
              entries: [
                {
                  ref: {
                    key: "Project:atlas",
                    family: "Project",
                  },
                  causes: [],
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const invalidationExit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: malformedInvalidation }),
    );
    const hydrationExit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: malformedHydration }),
    );
    const missingSuccessValueExit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: missingSuccessValue }),
    );
    const missingRefInputExit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: missingRefInput }),
    );

    for (const exit of [
      invalidationExit,
      hydrationExit,
      missingSuccessValueExit,
      missingRefInputExit,
    ]) {
      const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
      expect(failure).toBeInstanceOf(ActionTransportError);
      expect(failure).toMatchObject({
        reason: "InvalidResponse",
        message: "Action response did not match the Sunfall Arc Start action protocol.",
      });
    }
  });

  it("rejects semantically invalid Start action invalidation metadata", async () => {
    const Project = Resource.define({
      name: "Start.action.client.semantic-ref",
      load: (id: string) => Effect.succeed({ id }),
    });
    const validRef = Project("valid");
    const Ping = Action.define({
      name: "Start.action.client.semantic-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const responseWithInvalidation =
      (invalidation: unknown): TestFetch =>
      () =>
        Effect.succeed(
          new Response(
            JSON.stringify({
              _tag: "Success",
              value: { value: "ok" },
              invalidation,
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
    const responseWithTarget = (target: unknown): TestFetch =>
      responseWithInvalidation({
        targets: [target],
        entries: [],
      });

    const unknownFamilyExit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: responseWithTarget({
            _tag: "Ref",
            key: "missing",
            family: "Start.action.client.missing-family",
            input: "valid",
          }),
        },
      ),
    );
    const keyMismatchExit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: responseWithTarget({
            _tag: "Ref",
            key: validRef.key,
            family: "Start.action.client.semantic-ref",
            input: "different",
          }),
        },
      ),
    );
    const entryMismatchExit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: responseWithInvalidation({
            targets: [
              {
                _tag: "Ref",
                key: validRef.key,
                family: "Start.action.client.semantic-ref",
                input: "valid",
              },
            ],
            entries: [
              {
                ref: {
                  key: validRef.key,
                  family: "Start.action.client.semantic-ref",
                  input: "different",
                },
                causes: [],
              },
            ],
          }),
        },
      ),
    );
    const malformedTagTargetExit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: responseWithTarget({
            _tag: "Tag",
            key: "Start.action.client.semantic-tag-wrong:valid",
            name: "Start.action.client.semantic-tag",
          }),
        },
      ),
    );
    const malformedTagCauseExit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: responseWithInvalidation({
            targets: [],
            entries: [
              {
                ref: {
                  key: validRef.key,
                  family: "Start.action.client.semantic-ref",
                  input: "valid",
                },
                causes: [
                  {
                    _tag: "Tag",
                    key: "Start.action.client.semantic-tag-wrong:valid",
                    name: "Start.action.client.semantic-tag",
                  },
                ],
              },
            ],
          }),
        },
      ),
    );

    const unknownFamily = Exit.isFailure(unknownFamilyExit)
      ? firstFailure(unknownFamilyExit.cause)
      : undefined;
    const keyMismatch = Exit.isFailure(keyMismatchExit)
      ? firstFailure(keyMismatchExit.cause)
      : undefined;
    const entryMismatch = Exit.isFailure(entryMismatchExit)
      ? firstFailure(entryMismatchExit.cause)
      : undefined;
    const malformedTagTarget = Exit.isFailure(malformedTagTargetExit)
      ? firstFailure(malformedTagTargetExit.cause)
      : undefined;
    const malformedTagCause = Exit.isFailure(malformedTagCauseExit)
      ? firstFailure(malformedTagCauseExit.cause)
      : undefined;

    expect(unknownFamily).toBeInstanceOf(ActionTransportError);
    expect(unknownFamily).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata referenced an unknown Resource family.",
    });
    expect(keyMismatch).toBeInstanceOf(ActionTransportError);
    expect(keyMismatch).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource input.",
    });
    expect(entryMismatch).toBeInstanceOf(ActionTransportError);
    expect(entryMismatch).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource input.",
    });
    expect(malformedTagTarget).toBeInstanceOf(ActionTransportError);
    expect(malformedTagTarget).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource tag key.",
    });
    expect(malformedTagCause).toBeInstanceOf(ActionTransportError);
    expect(malformedTagCause).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource tag key.",
    });
  });

  it("replays action ref invalidations through runtime-local Resource families", async () => {
    const runtime = makeRuntime();
    let count = 0;
    const load = () => Effect.succeed(count);
    const Count = Resource.define({
      name: "Start.action.client.runtime-local-ref",
      load: (_input: null) => load(),
    });
    const ref = Count(null);
    const Ping = Action.define({
      name: "Start.action.client.runtime-local-ref",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const definitions = resourceDefinitionRegistry() as Map<string, unknown>;
    const globalDefinition = definitions.get("Start.action.client.runtime-local-ref");
    const fetcher: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
            invalidation: {
              targets: [
                {
                  _tag: "Ref",
                  key: ref.key,
                  family: "Start.action.client.runtime-local-ref",
                  input: null,
                },
              ],
              entries: [],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    try {
      await Effect.runPromise(runtime.provide(Resource.preload(ref)));
      definitions.delete("Start.action.client.runtime-local-ref");
      count = 1;

      await expect(
        Effect.runPromise(
          submitViaActionTransport(Ping, { value: "ok" }, { fetch: fetcher, runtime }),
        ),
      ).resolves.toEqual({ value: "ok" });

      expect(runtime.runSync(Resource.read(ref))).toBe(1);
    } finally {
      if (globalDefinition) {
        definitions.set("Start.action.client.runtime-local-ref", globalDefinition);
      }
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("applies action response metadata to the submitting runtime only", async () => {
    const Project = Resource.define({
      name: "Start.action.client.response-runtime",
      load: (_id: string) => Effect.succeed({ id: "atlas", name: "Initial" }),
    });
    const Ping = Action.define({
      name: "Start.action.client.response-runtime",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const appRuntime = makeRuntime();
    const otherRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: TestFetch = () =>
      Effect.succeed("transport-ok").pipe(
        Effect.map(
          (token) =>
            new Response(
              JSON.stringify({
                _tag: "Success",
                value: { value: token },
                hydration: {
                  resources: [
                    {
                      name: Project.family.options.name,
                      key: ref.key,
                      input: "atlas",
                      state: {
                        _tag: "Success",
                        waiting: false,
                        value: { id: "atlas", name: "Hydrated In App Runtime" },
                        timestamp: 1,
                      },
                    },
                  ],
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
        ),
      );

    try {
      await runInRuntime(appRuntime, Resource.preload(ref));
      await runInRuntime(otherRuntime, Resource.preload(ref));

      await expect(
        Effect.runPromise(
          submitViaActionTransport(
            Ping,
            { value: "submit" },
            {
              fetch: fetcher,
              runtime: appRuntime,
            },
          ),
        ),
      ).resolves.toEqual({ value: "transport-ok" });

      expect(
        runWithRuntime(appRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Hydrated In App Runtime",
      });
      expect(
        runWithRuntime(otherRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Initial",
      });
    } finally {
      await Effect.runPromise(appRuntime.dispose);
      await Effect.runPromise(otherRuntime.dispose);
    }
  });

  it("reports malformed Start action hydration payloads as transport errors", async () => {
    const Ping = Action.define({
      name: "Start.action.client.bad-hydration-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const fetcher: TestFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
            hydration: {
              resources: [{ name: 1 }],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const exit = await Effect.runPromiseExit(
      submitViaActionTransport(Ping, { value: "ok" }, { fetch: fetcher }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ActionTransportError);
    expect(failure).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action response metadata could not be applied.",
    });
  });

  it("normalizes Start action HTTP client failures as network transport errors", async () => {
    const Ping = Action.define({
      name: "Start.action.client.transport-setup-throw",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });

    const exit = await Effect.runPromiseExit(
      submitViaActionTransport(
        Ping,
        { value: "ok" },
        {
          fetch: () => {
            throw new Error("fetcher failed");
          },
        },
      ),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ActionTransportError);
    expect(failure).toMatchObject({
      reason: "Network",
      message: "Start action request failed.",
    });
  });

  it("replays semantic action tag invalidations on JSON clients", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const ProjectTag = Resource.tag<{ readonly id: string }>("Start.action.Project.tag", {
      key: ({ id }) => id,
    });
    let project = {
      id: "atlas",
      name: "Initial",
    };
    const Project = Resource.define({
      name: "Start.action.Project.tagged",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
      provides: (value) => [ProjectTag({ id: value.id })],
    });
    const RenameProject = Action.define({
      name: "Start.action.project.rename.tagged",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      invalidates: (_project, input) => [ProjectTag({ id: input.id })],
    });
    const renameProject = Action.implement(RenameProject, ({ id, name }) =>
      Effect.sync(() => {
        project = { id, name };
        return project;
      }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [renameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return Effect.orDie(Effect.scoped(handler(new Request(url, init))));
    };

    try {
      await runInRuntime(clientRuntime, Resource.preload(ref));

      const result = await Effect.runPromise(
        submitViaActionTransport(
          RenameProject,
          { id: "atlas", name: "Renamed Through Tag" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toEqual({ id: "atlas", name: "Renamed Through Tag" });
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Renamed Through Tag",
      });
    } finally {
      await Effect.runPromise(clientRuntime.dispose);
    }
  });

  it("replays direct action ref invalidations on JSON clients", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    let project = {
      id: "atlas",
      name: "Initial",
    };
    const Project = Resource.define({
      name: "Start.action.Project.ref",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
    });
    const RenameProject = Action.define({
      name: "Start.action.project.rename.ref",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      invalidates: (_project, input) => [Project(input.id)],
    });
    const renameProject = Action.implement(RenameProject, ({ id, name }) =>
      Effect.sync(() => {
        project = { id, name };
        return project;
      }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [renameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: TestFetch = (input, init) =>
      Effect.orDie(
        Effect.scoped(
          Effect.gen(function* () {
            const url =
              input instanceof Request
                ? input.url
                : new URL(String(input), "https://example.com").href;
            const response = yield* handler(new Request(url, init));
            const body = yield* Effect.tryPromise(
              () => response.json() as Promise<Record<string, unknown>>,
            );
            delete body.hydration;
            return new Response(JSON.stringify(body), {
              status: response.status,
              headers: {
                "content-type": response.headers.get("content-type") ?? "application/json",
              },
            });
          }),
        ),
      );

    try {
      await runInRuntime(clientRuntime, Resource.preload(ref));

      const result = await Effect.runPromise(
        submitViaActionTransport(
          RenameProject,
          { id: "atlas", name: "Renamed Through Ref" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toEqual({ id: "atlas", name: "Renamed Through Ref" });
      expect(
        runWithRuntime(clientRuntime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Renamed Through Ref",
      });
    } finally {
      await Effect.runPromise(clientRuntime.dispose);
    }
  });

  it("submits served Actions through a runtime-provided ActionTransport", async () => {
    const Ping = Action.define({
      name: "Start.action.client.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
    });
    const ping = Action.implement(Ping, ({ value }) =>
      Effect.succeed({ value: value.toUpperCase() }),
    );
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      actions: [ping],
    });
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return Effect.orDie(Effect.scoped(handler(new Request(url, init))));
    };
    const runtime = makeRuntime(
      actionTransportLayer.pipe(Layer.provide(testHttpClientLayer(fetcher))),
    );
    const action = Action.use(Ping, { runtime });

    try {
      expect(action.state.get()).toEqual({ result: AsyncResult.initial(), input: Option.none() });
      const submission = Effect.runFork(action.submit({ value: "transport" }));
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Initial", waiting: true },
        input: Option.some({ value: "transport" }),
      });

      await expect(Effect.runPromise(Fiber.join(submission))).resolves.toEqual({
        value: "TRANSPORT",
      });
      expect(action.state.get().result).toMatchObject({
        _tag: "Success",
        waiting: false,
        value: { value: "TRANSPORT" },
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("round-trips a served Action's typed output and typed error, running Action.implement on the server", async () => {
    class NameTaken extends Schema.TaggedError<NameTaken>()("NameTaken", {
      name: Schema.String,
    }) {}
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      createdAt: Schema.DateTimeUtcFromString,
    });
    // Shared, browser-safe: schemas only.
    const CreateProject = Action.define({
      name: "Start.action.served.create",
      input: Schema.Struct({ name: Schema.String }),
      output: ProjectSchema,
      error: NameTaken,
    });
    // Server-only.
    const serverRuns: Array<string> = [];
    const createProject = Action.implement(CreateProject, ({ name }) =>
      Effect.suspend(() => {
        serverRuns.push(name);
        return name === "taken"
          ? Effect.fail(new NameTaken({ name }))
          : Effect.succeed({
              id: name.toLowerCase(),
              createdAt: DateTime.makeUnsafe("2026-10-12T09:30:00.000Z"),
            });
      }),
    );
    expect(CreateProject.run).toBeUndefined();
    expect(createProject.name).toBe(CreateProject.name);
    const handler = createStartRequestHandler(
      makeStartServerApp({ routes: [Route.define("/", {})] as const }),
      { actions: [createProject] },
    );
    const fetcher: TestFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return Effect.orDie(Effect.scoped(handler(new Request(url, init))));
    };

    const created = await Effect.runPromise(
      submitViaActionTransport(CreateProject, { name: "Atlas" }, { fetch: fetcher }),
    );
    expect(created.id).toBe("atlas");
    // The output schema decoded the wire value back into a DateTime.
    expect(DateTime.isDateTime(created.createdAt)).toBe(true);
    expect(DateTime.toEpochMillis(created.createdAt)).toBe(Date.parse("2026-10-12T09:30:00.000Z"));

    const exit = await Effect.runPromiseExit(
      submitViaActionTransport(CreateProject, { name: "taken" }, { fetch: fetcher }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
    expect(failure).toBeInstanceOf(NameTaken);
    expect(failure).toMatchObject({ name: "taken" });
    expect(serverRuns).toEqual(["Atlas", "taken"]);
  });

  it("applies action concurrency to transported submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let requests = 0;
    const Ping = Action.define({
      name: "Start.action.client.native-exhaust",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      policy: {
        concurrency: "exhaust",
      },
    });
    const fetcher: TestFetch = () =>
      Effect.gen(function* () {
        const requestNumber = ++requests;
        yield* Deferred.await(release);
        return new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: `response-${requestNumber}` },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      });
    const runtime = makeRuntime(
      actionTransportLayer.pipe(Layer.provide(testHttpClientLayer(fetcher))),
    );
    const action = Action.use(Ping, { runtime });

    try {
      const first = runtime.runFork(action.submit({ value: "first" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      const second = runtime.runFork(action.submit({ value: "second" }));
      Effect.runSync(Deferred.succeed(release, undefined));

      await expect(runInRuntime(runtime, Fiber.join(first))).resolves.toEqual({
        value: "response-1",
      });
      await expect(runInRuntime(runtime, Fiber.join(second))).resolves.toEqual({
        value: "response-1",
      });
      expect(requests).toBe(1);
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Success", waiting: false },
        input: Option.some({ value: "first" }),
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps the newest hydration when a stale parallel submission settles later", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const ResultSchema = Schema.Struct({
      name: Schema.String,
    });
    let invalidatedProject = {
      id: "atlas",
      name: "Invalidation Initial",
    };
    const Project = Resource.define({
      name: "Start.action.Project.stale-hydration",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed({ id: "atlas", name: "Initial" }),
    });
    const InvalidatedProject = Resource.define({
      name: "Start.action.Project.stale-invalidation",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(invalidatedProject),
    });
    const RenameProject = Action.define({
      name: "Start.action.client.stale-hydration",
      input: Schema.Struct({ name: Schema.String }),
      output: ResultSchema,
      policy: {
        concurrency: "parallel",
      },
    });
    const ref = Project("atlas");
    const invalidatedRef = InvalidatedProject("atlas");
    const firstRelease = Effect.runSync(Deferred.make<void>());
    const secondRelease = Effect.runSync(Deferred.make<void>());
    let requests = 0;
    const responseFor = (
      name: string,
      updatedAt: number,
      options: { readonly invalidateProject?: boolean } = {},
    ): Response =>
      new Response(
        JSON.stringify({
          _tag: "Success",
          value: { name },
          hydration: {
            resources: [
              {
                name: "Start.action.Project.stale-hydration",
                key: ref.key,
                input: "atlas",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "atlas", name },
                  timestamp: updatedAt,
                },
              },
            ],
          },
          ...(options.invalidateProject
            ? {
                invalidation: {
                  targets: [
                    {
                      _tag: "Ref",
                      key: invalidatedRef.key,
                      family: "Start.action.Project.stale-invalidation",
                      input: "atlas",
                    },
                  ],
                  entries: [
                    {
                      ref: {
                        key: invalidatedRef.key,
                        family: "Start.action.Project.stale-invalidation",
                        input: "atlas",
                      },
                      causes: [
                        {
                          _tag: "Ref",
                          key: invalidatedRef.key,
                          family: "Start.action.Project.stale-invalidation",
                        },
                      ],
                    },
                  ],
                },
              }
            : {}),
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    const fetcher: TestFetch = () =>
      Effect.gen(function* () {
        requests += 1;
        const current = requests;
        if (current === 1) {
          yield* Deferred.await(firstRelease);
          return responseFor("First", 1, { invalidateProject: true });
        }

        yield* Deferred.await(secondRelease);
        return responseFor("Second", 2);
      });
    const runtime = makeRuntime(
      actionTransportLayer.pipe(Layer.provide(testHttpClientLayer(fetcher))),
    );
    const action = Action.use(RenameProject, { runtime });

    try {
      await runInRuntime(runtime, Resource.preload(ref));
      await runInRuntime(runtime, Resource.preload(invalidatedRef));
      const first = runtime.runFork(action.submit({ name: "First" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      const second = runtime.runFork(action.submit({ name: "Second" }));

      Effect.runSync(Deferred.succeed(secondRelease, undefined));
      await expect(runInRuntime(runtime, Fiber.join(second))).resolves.toEqual({
        name: "Second",
      });
      expect(
        runWithRuntime(runtime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Second",
      });
      expect(
        runWithRuntime(runtime, () =>
          AsyncResult.getOrElse(
            Effect.runSync(Resource.status(invalidatedRef)).result,
            () => undefined,
          ),
        ),
      ).toEqual({
        id: "atlas",
        name: "Invalidation Initial",
      });

      invalidatedProject = {
        id: "atlas",
        name: "Invalidated By First",
      };
      Effect.runSync(Deferred.succeed(firstRelease, undefined));
      await expect(runInRuntime(runtime, Fiber.join(first))).resolves.toEqual({
        name: "First",
      });
      expect(
        runWithRuntime(runtime, () =>
          AsyncResult.getOrElse(Effect.runSync(Resource.status(ref)).result, () => undefined),
        ),
      ).toEqual({
        id: "atlas",
        name: "Second",
      });
      expect(
        runWithRuntime(runtime, () =>
          AsyncResult.getOrElse(
            Effect.runSync(Resource.status(invalidatedRef)).result,
            () => undefined,
          ),
        ),
      ).toEqual({
        id: "atlas",
        name: "Invalidated By First",
      });
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Success", waiting: false },
        input: Option.some({ name: "Second" }),
      });
    } finally {
      Effect.runSync(Deferred.succeed(firstRelease, undefined));
      Effect.runSync(Deferred.succeed(secondRelease, undefined));
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("hydrates from a document script", () => {
    const User = Resource.define({
      name: "Start.User.document",
      load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
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
            timestamp: Date.now(),
          },
        },
      ],
    };
    const script = createHydrationScriptSync(payload);
    const document = {
      getElementById: (id: string) =>
        id === "__SUNFALL_ARC_HYDRATION__"
          ? {
              textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", ""),
            }
          : null,
    };

    Effect.runSync(hydrateFromDocument(document as Pick<Document, "getElementById">));

    expect(Effect.runSync(Resource.read(ref))).toEqual({ id: "1", name: "Hydrated" });
  });

  it("surfaces malformed document hydration JSON through the Effect error channel", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__SUNFALL_ARC_HYDRATION__" ? { textContent: "{" } : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("rejects root hydration payloads with malformed settled submissions", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__SUNFALL_ARC_HYDRATION__"
          ? { textContent: JSON.stringify({ resources: [], settledSubmissions: "not-array" }) }
          : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("surfaces empty document hydration scripts as malformed JSON", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__SUNFALL_ARC_HYDRATION__" ? { textContent: "" } : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("surfaces hydration script serialization failures through the Effect error channel", async () => {
    const payload: { readonly resources: ReadonlyArray<never>; self?: unknown } = {
      resources: [],
    };
    payload.self = payload;

    const exit = await Effect.runPromiseExit(createHydrationScript(payload));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(Exit.isFailure(exit)).toBe(true);
    expect(failure).toBeInstanceOf(StartHydrationPayloadSerializeError);
    expect(failure).toMatchObject({
      operation: "root-payload",
      value: payload,
      guidance: expect.stringContaining("JSON-serializable"),
    });
    expect(failure?.cause).toBeInstanceOf(TypeError);
  });

  it("escapes custom hydration script ids as HTML attributes", async () => {
    const script = await Effect.runPromise(createHydrationScript({ resources: [] }, `root"<&`));

    expect(script).toContain(`id="root&quot;&lt;&amp;"`);
    expect(script.match(/<script/g)).toHaveLength(1);
    expect(script).toContain(`{"resources":[]}`);
  });

  it("throws hydration script serialization failures from the sync facade", () => {
    const payload: { readonly resources: ReadonlyArray<never>; self?: unknown } = {
      resources: [],
    };
    payload.self = payload;

    expect(() => createHydrationScriptSync(payload)).toThrow(StartHydrationPayloadSerializeError);

    try {
      createHydrationScriptSync(payload);
    } catch (error) {
      expect(error).toMatchObject({
        operation: "root-payload",
        value: payload,
        guidance: expect.stringContaining("JSON-serializable"),
      });
      expect((error as StartHydrationPayloadSerializeError).cause).toBeInstanceOf(TypeError);
    }
  });

  it("surfaces malformed streamed hydration JSON through the Effect error channel", async () => {
    const element = {
      textContent: "{",
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "2" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const exit = await Effect.runPromiseExit(hydrateStartHydrationChunksFromDocument(document));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationChunkParseError);
  });

  it("rejects streamed hydration chunks with malformed settled submissions", async () => {
    const element = {
      textContent: JSON.stringify({
        _tag: "StartHydrationChunk",
        version: 1,
        sequence: 0,
        payload: { resources: [], settledSubmissions: "not-array" },
      }),
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "0" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const exit = await Effect.runPromiseExit(hydrateStartHydrationChunksFromDocument(document));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationChunkParseError);
  });

  it("surfaces empty streamed hydration chunks as malformed JSON", async () => {
    const element = {
      textContent: "",
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "2" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const exit = await Effect.runPromiseExit(hydrateStartHydrationChunksFromDocument(document));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return expect.fail("expected failure exit");
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationChunkParseError);
  });

  it("hydrates browser payloads in an explicit runtime", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.define({
        name: "Start.User.document-explicit-runtime",
        load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
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
              timestamp: 1,
            },
          },
        ],
      };
      const script = createHydrationScriptSync(payload);
      const document = {
        getElementById: (id: string) =>
          id === "__SUNFALL_ARC_HYDRATION__"
            ? {
                textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", ""),
              }
            : null,
      };

      runtime.runSync(
        hydrateFromDocument(document as Pick<Document, "getElementById">, {
          id: "__SUNFALL_ARC_HYDRATION__",
        }),
      );

      expect(Effect.runSync(Resource.status(ref)).result._tag).toBe("Initial");
      expect(runtime.runSync(Resource.read(ref))).toEqual({
        id: "1",
        name: "Runtime Hydrated",
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("hydrates document and stream payloads idempotently in an explicit runtime without duplicate resource loads", async () => {
    const runtime = makeRuntime();
    try {
      let loads = 0;
      const User = Resource.define({
        name: "Start.User.document-idempotent-runtime",
        load: (id: string) =>
          Effect.sync(() => {
            loads += 1;
            return { id, name: "Loaded" };
          }),
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
              timestamp: 1,
            },
          },
        ],
      };
      const mainText = scriptText(createHydrationScriptSync(payload));
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScriptSync(payload, 0),
        0,
      );
      const document = {
        getElementById: (id: string) =>
          id === "__SUNFALL_ARC_HYDRATION__" ? { textContent: mainText } : null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      runtime.runSync(
        hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0], {
          id: "__SUNFALL_ARC_HYDRATION__",
        }),
      );
      runtime.runSync(
        hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0], {
          id: "__SUNFALL_ARC_HYDRATION__",
        }),
      );

      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBe("true");
      expect(Effect.runSync(Resource.status(ref)).result._tag).toBe("Initial");
      expect(runtime.runSync(Resource.read(ref))).toEqual({
        id: "1",
        name: "Hydrated",
      });
      await expect(runInRuntime(runtime, Resource.preload(ref))).resolves.toEqual({
        id: "1",
        name: "Hydrated",
      });
      expect(loads).toBe(0);
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("returns merged root and streamed payloads from document hydration effects", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.define({
        name: "Start.User.document-return-merged",
        load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
      });
      const rootRef = User("root");
      const streamRef = User("stream");
      const rootPayload = {
        resources: [
          {
            name: "Start.User.document-return-merged",
            key: rootRef.key,
            input: "root",
            state: {
              _tag: "Success" as const,
              waiting: false as const,
              value: { id: "root", name: "Root" },
              timestamp: 1,
            },
          },
        ],
      };
      const streamPayload = {
        resources: [
          {
            name: "Start.User.document-return-merged",
            key: streamRef.key,
            input: "stream",
            state: {
              _tag: "Success" as const,
              waiting: false as const,
              value: { id: "stream", name: "Stream" },
              timestamp: 2,
            },
          },
        ],
      };
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScriptSync(streamPayload, 1),
        1,
      );
      const document = {
        getElementById: (id: string) =>
          id === "__SUNFALL_ARC_HYDRATION__"
            ? { textContent: scriptText(createHydrationScriptSync(rootPayload)) }
            : null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      const hydrated = await runInRuntime(
        runtime,
        hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0], {
          id: "__SUNFALL_ARC_HYDRATION__",
        }),
      );

      expect(hydrated?.resources.map((resource) => resource.key)).toEqual([
        rootRef.key,
        streamRef.key,
      ]);
      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBe("true");
      expect(runtime.runSync(Resource.read(rootRef))).toEqual({
        id: "root",
        name: "Root",
      });
      expect(runtime.runSync(Resource.read(streamRef))).toEqual({
        id: "stream",
        name: "Stream",
      });
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps earlier streamed hydration chunks applied when a later chunk fails", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.define({
        name: "Start.User.stream-progressive-failure",
        input: Schema.String,
        output: Schema.Struct({
          id: Schema.String,
          name: Schema.String,
        }),
        load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
      });
      const validRef = User("valid");
      const invalidRef = User("invalid");
      const validPayload = {
        resources: [
          {
            name: "Start.User.stream-progressive-failure",
            key: validRef.key,
            input: "valid",
            state: {
              _tag: "Success" as const,
              waiting: false as const,
              value: { id: "valid", name: "Valid" },
              timestamp: 1,
            },
          },
        ],
      };
      const invalidChunk = {
        _tag: "StartHydrationChunk",
        version: 1,
        sequence: 1,
        payload: {
          resources: [
            {
              name: "Start.User.stream-progressive-failure",
              key: invalidRef.key,
              input: "invalid",
              state: {
                _tag: "Success",
                waiting: false,
                value: { id: "invalid" },
                timestamp: 2,
              },
            },
          ],
        },
      };
      const streamElements = [
        makeStreamHydrationElement(createStreamHydrationScriptSync(validPayload, 0), 0),
        makeStreamHydrationElement(JSON.stringify(invalidChunk), 1),
      ];
      const document = {
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? streamElements : [],
      };

      const exit = await Effect.runPromiseExit(
        runtime.provide(hydrateStartHydrationChunksFromDocument(document)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toMatchObject({
          _tag: "ResourceSnapshotCodecError",
        });
      }
      expect(runtime.runSync(Resource.read(validRef))).toEqual({
        id: "valid",
        name: "Valid",
      });
      expect(
        runWithRuntime(runtime, () => Effect.runSync(Resource.status(invalidRef)).result._tag),
      ).toBe("Initial");
      expect(
        streamElements.map((element) => element.getAttribute(streamHydrationConsumedAttribute)),
      ).toEqual([null, null]);
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("lets callers opt out of marking streamed hydration chunks consumed", async () => {
    const runtime = makeRuntime();
    try {
      const payload = {
        resources: [],
      };
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScriptSync(payload, 0),
        0,
      );
      const document = {
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      const first = runtime.runSync(
        hydrateStartHydrationChunksFromDocument(document, { markConsumed: false }),
      );
      const second = runtime.runSync(
        hydrateStartHydrationChunksFromDocument(document, { markConsumed: false }),
      );

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBeNull();
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("rejects malformed streamed hydration chunks with typed repair guidance", async () => {
    const element = {
      textContent: JSON.stringify({ resources: "invalid" }),
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "4" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const error = await Effect.runPromise(
      Effect.flip(hydrateStartHydrationChunksFromDocument(document)),
    );
    expect(error).toBeInstanceOf(StartHydrationChunkParseError);
    expect(error).toMatchObject({
      sequence: 4,
      value: { resources: "invalid" },
    });
  });

  it("reads legacy streamed root payloads as ordered chunks", () => {
    const payload = {
      resources: [],
    };
    const element = {
      textContent: JSON.stringify(payload),
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "7" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    expect(Effect.runSync(readStartHydrationChunks(document))).toEqual([
      {
        _tag: "StartHydrationChunk",
        version: 1,
        sequence: 7,
        payload,
      },
    ]);
  });

  it("surfaces streamed hydration chunk parse failures from Effect helpers", async () => {
    const element = {
      textContent: "{",
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "2" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const exit = await Effect.runPromiseExit(hydrateStartHydrationChunksFromDocument(document));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(StartHydrationChunkParseError);
      expect(error).toMatchObject({
        sequence: 2,
        value: "{",
      });
    }
  });

  it("rejects malformed root hydration payloads with typed repair guidance", () => {
    const document = {
      getElementById: (id: string) =>
        id === "__SUNFALL_ARC_HYDRATION__"
          ? { textContent: JSON.stringify({ resources: "invalid" }) }
          : null,
      querySelectorAll: () => [],
    };

    expect(() =>
      Effect.runSync(hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0])),
    ).toThrow(StartHydrationPayloadParseError);
  });

  it("filters dev SSR requests to document navigations", () => {
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/projects/atlas",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "HEAD",
        url: "/projects/atlas",
        headers: { accept: "*/*" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/users/alice@example.com",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/releases/1.0",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/projects/foo.json",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/projects/atlas",
        headers: { accept: "text/html;q=0,application/json" },
      }),
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/src/main.tsx",
        headers: { accept: "text/html" },
      }),
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "GET",
        url: "/assets/app.js",
        headers: { accept: "application/javascript" },
      }),
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/projects/atlas",
        headers: { accept: "text/html" },
      }),
    ).toBe(false);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/__sunfall-arc/rpc",
        headers: { accept: "application/json" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/__sunfall-arc/action",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/custom/start-rpc",
        headers: { accept: "application/json" },
      }),
    ).toBe(false);
  });

  it("keeps .server modules out of the client transform graph", () => {
    const plugin = sunfallArcStart();

    expect(plugin.transform("", "/src/domain.contract.ts", {})).toBeNull();
    expect(() => plugin.transform("", "/src/domain.server.ts?import", {})).toThrow(
      StartServerOnlyModuleError,
    );
    expect(() => plugin.transform("", "/src/domain.server.ts", {})).toThrow(
      StartServerOnlyModuleError,
    );
    expect(() => plugin.transform("", "/src/domain.server.tsrx", {})).toThrow(
      StartServerOnlyModuleError,
    );
    expect(plugin.transform("", "/src/domain.server.ts", { ssr: true })).toBeNull();
  });

  it("emits and loads a production-shaped file route manifest from the Vite preset", async () => {
    const options = {
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    };
    const manifest = serializeStartFileRouteManifest(options);
    const plugin = sunfallArcStart(options);
    plugin.config();
    const resolved = plugin.resolveId(fileRouteManifestVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      routeDirectory: "src/routes",
      entries: [
        {
          routeId: "route_root",
          routePath: "/",
          moduleId: "src/routes/index.tsx",
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          moduleId: "src/routes/projects/$id.tsx",
        },
      ],
    });
    expect(loadFileRouteManifestModule(plugin)).toEqual(JSON.parse(manifest));
    expect(resolved).toBe(`\0${fileRouteManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("accepts iterable file route manifest entries without requiring explicit modules", async () => {
    const source = await Effect.runPromise(
      makeStartFileRouteManifest({
        fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
        fileRouteOptions: {
          routeDirectory: "src/routes",
        },
      }),
    );
    const entries = oneShotIterable(source.entries);
    const manifest = await Effect.runPromise(
      makeStartFileRouteManifest({
        fileRouteManifest: entries.iterable,
        fileRouteOptions: {
          routeDirectory: "src/routes",
        },
      }),
    );

    expect(entries.iteratorCalls).toBe(1);
    expect(manifest.entries.map((entry) => entry.routePath)).toEqual(["/", "/projects/:id"]);
    expect(manifest.modules).toEqual([
      expect.objectContaining({
        kind: "Route",
        moduleId: "src/routes/index.tsx",
      }),
      expect.objectContaining({
        kind: "Route",
        moduleId: "src/routes/projects/$id.tsx",
      }),
    ]);
  });

  it("loads typed file route definitions from the Vite preset", async () => {
    const plugin = sunfallArcStart({
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const resolved = plugin.resolveId(fileRouteDefinitionsVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(resolved).toBe(`\0${fileRouteDefinitionsVirtualModuleId}`);
    expect(String(loaded)).toContain('import { route as route_root } from "/src/routes/index.js";');
    expect(String(loaded)).toContain(
      'import { route as route_projects_$id } from "/src/routes/projects/$id.js";',
    );
    expect(String(loaded)).toContain(
      'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
    );
    expect(String(loaded)).toContain("export { route_root, route_projects_$id };");
    expect(String(loaded)).toContain(
      "export const routes = [route_root, route_projects_$id] as const;",
    );
    expect(String(loaded)).not.toContain("export const routeTree");
    expect(String(loaded)).not.toContain("export default");
  });

  it("discovers file routes from the Vite root when no explicit route input is supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-routes-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/_layout.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/types.d.ts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/types.d.mts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/types.d.cts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/readme.md"), "# project routes\n");

      const plugin = sunfallArcStart();
      plugin.config({ root });
      const resolved = plugin.resolveId(fileRouteManifestVirtualModuleId);
      const loaded = resolved === null ? undefined : plugin.load(resolved);

      expect(discoverFileRoutesSync({ root })).toEqual([
        "src/routes/index.tsx",
        "src/routes/projects/$id.tsx",
        "src/routes/projects/_layout.tsx",
      ]);
      expect(loadFileRouteManifestModule(plugin)).toMatchObject({
        version: 1,
        routeDirectory: defaultFileRouteDirectory,
        entries: [
          {
            routeId: "route_root",
            routePath: "/",
            moduleId: "src/routes/index.tsx",
          },
          {
            routeId: "route_projects_$id",
            routePath: "/projects/:id",
            moduleId: "src/routes/projects/$id.tsx",
          },
        ],
      });
      expect(String(loaded)).toContain("src/routes/projects/$id.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes generated file route definitions into the Vite root", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-generated-routes-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");

      const plugin = sunfallArcStart();
      plugin.configResolved({ root });

      const generatedPath = join(root, defaultFileRouteGeneratedFile);
      const generated = readFileSync(generatedPath, "utf8");

      expect(generated).toContain("This file is generated by @sunfall/arc-start. Do not edit.");
      expect(generated).toContain('import { Route } from "@sunfall/arc-core";');
      expect(generated).toContain('import { route as route_root } from "./routes/index.js";');
      expect(generated).toContain(
        'import { route as route_projects_$id } from "./routes/projects/$id.js";',
      );
      expect(generated).toContain(
        'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
      );
      expect(generated).toContain("  route_projects_$id: route_projects_$id,");
      expect(generated).toContain("export type FileRouteHrefOptionsById = {");
      expect(generated).toContain(
        "readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]>;",
      );
      expect(generated).not.toContain("ByPath");
      expect(generated).not.toContain("export type Href<");
      expect(generated).not.toContain("export type RouteId =");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not rediscover generated route definitions written under the route directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-generated-routes-under-routes-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = sunfallArcStart({
        fileRouteGeneration: {
          outputFile: "src/routes/routeTree.gen.ts",
        },
      });
      plugin.configResolved({ root, command: "serve" });

      const generatedPath = join(root, "src/routes/routeTree.gen.ts");
      expect(existsSync(generatedPath)).toBe(true);

      plugin.config({ root });
      const manifest = loadFileRouteManifestModule(plugin) as {
        readonly entries: readonly unknown[];
      };
      expect(manifest.entries).toEqual([
        expect.objectContaining({
          routeId: "route_root",
          moduleId: "src/routes/index.tsx",
        }),
      ]);
      expect(JSON.stringify(manifest)).not.toContain("routeTree.gen");

      const resolved = plugin.resolveId(fileRouteDefinitionsVirtualModuleId);
      const loaded = resolved === null ? undefined : plugin.load(resolved);
      expect(String(loaded)).not.toContain("routeTree.gen");

      const invalidated: Array<{ readonly id: string }> = [];
      plugin.hotUpdate?.({
        type: "update",
        file: generatedPath,
        server: {
          moduleGraph: {
            getModuleById: (id) => ({ id }),
            invalidateModule: (module) => {
              invalidated.push(module as { readonly id: string });
            },
          },
        },
      });
      expect(invalidated).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes generated route artifacts and virtual modules on route hot updates", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-generated-routes-hot-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = sunfallArcStart();
      plugin.configResolved({ root, command: "serve" });

      const generatedPath = join(root, defaultFileRouteGeneratedFile);
      expect(readFileSync(generatedPath, "utf8")).not.toContain(
        "import { route as route_projects_$id }",
      );

      const virtualIds = [fileRouteManifestVirtualModuleId, fileRouteDefinitionsVirtualModuleId];
      const resolvedIds = virtualIds
        .map((id) => plugin.resolveId(id))
        .filter((id): id is string => id !== null);
      const modules = new Map(resolvedIds.map((id) => [id, { id }]));
      const invalidated: Array<{ readonly id: string }> = [];

      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");
      plugin.hotUpdate?.({
        type: "create",
        file: join(root, "src/routes/projects/$id.tsx"),
        server: {
          moduleGraph: {
            getModuleById: (id) => modules.get(id),
            invalidateModule: (module) => {
              invalidated.push(module as { readonly id: string });
            },
          },
        },
      });

      const generated = readFileSync(generatedPath, "utf8");
      expect(generated).toContain(
        'import { route as route_projects_$id } from "./routes/projects/$id.js";',
      );
      expect(generated).toContain("  route_projects_$id: route_projects_$id,");
      expect(invalidated.map((module) => module.id)).toEqual(resolvedIds);

      const resolved = plugin.resolveId(fileRouteDefinitionsVirtualModuleId);
      const loaded = resolved === null ? undefined : plugin.load(resolved);
      expect(String(loaded)).toContain("route_projects_$id");

      rmSync(join(root, "src/routes/projects/$id.tsx"), { force: true });
      invalidated.length = 0;
      plugin.hotUpdate?.({
        type: "delete",
        file: join(root, "src/routes/projects/$id.tsx"),
        server: {
          moduleGraph: {
            getModuleById: (id) => modules.get(id),
            invalidateModule: (module) => {
              invalidated.push(module as { readonly id: string });
            },
          },
        },
      });

      const regenerated = readFileSync(generatedPath, "utf8");
      expect(regenerated).not.toContain("import { route as route_projects_$id }");
      expect(regenerated).not.toContain("  route_projects_$id: route_projects_$id,");
      expect(invalidated.map((module) => module.id)).toEqual(resolvedIds);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can disable generated file route definition writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-generated-routes-disabled-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = sunfallArcStart({
        fileRouteGeneration: {
          outputFile: false,
        },
      });
      plugin.configResolved({ root });

      expect(existsSync(join(root, defaultFileRouteGeneratedFile))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects generated file route definitions outside the Vite root", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-generated-routes-outside-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = sunfallArcStart({
        fileRouteGeneration: {
          outputFile: "../routeTree.gen.ts",
        },
      });

      expect(() => plugin.configResolved({ root })).toThrow(FileRouteDefinitionsOutputPathError);
      expect(existsSync(join(root, "../routeTree.gen.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(join(root, "../routeTree.gen.ts"), { force: true });
    }
  });

  it("normalizes one-shot file route iterables once for Vite config and virtual module loads", () => {
    const fileRoutes = oneShotIterable(["src/routes/projects/$id.tsx", "src/routes/index.tsx"]);
    const plugin = sunfallArcStart({
      fileRoutes: fileRoutes.iterable,
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
      fileRouteGeneration: { outputFile: false },
    });
    plugin.config({ root: process.cwd() });
    const manifestId = plugin.resolveId(fileRouteManifestVirtualModuleId);
    const firstModule = manifestId === null ? undefined : plugin.load(manifestId);
    const secondModule = manifestId === null ? undefined : plugin.load(manifestId);

    expect(fileRoutes.iteratorCalls).toBe(1);
    expect(String(firstModule)).toContain("src/routes/projects/$id.tsx");
    expect(String(secondModule)).toContain("src/routes/projects/$id.tsx");
  });

  it("rejects a route module whose declared path differs from its file location", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-route-path-mismatch-"));
    mkdirSync(join(root, "src/routes/projects"), { recursive: true });
    writeFileSync(
      join(root, "src/routes/projects/$id.ts"),
      [
        'import { Route } from "@sunfall/arc-core";',
        'export const route = Route.define("/project/:id", {});',
      ].join("\n"),
    );
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, ws: false },
      ...workspaceSourceViteConfig(),
      plugins: [sunfallArcStart({ fileRouteOptions: { routeDirectory: "src/routes" } })],
    });

    try {
      await expect(server.ssrLoadModule("/src/routeTree.gen.ts")).rejects.toThrow(
        'src/routes/projects/$id.ts declares Route.define("/project/:id"), but its file location maps to "/projects/:id".',
      );
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("compiles the browser RPC client out of App.launch for static builds", async () => {
    const staticPlugin = sunfallArcStart({
      buildPolicy: {
        staticClient: {
          target: "static",
          forbidBrowserRpc: true,
        },
      },
    });
    const browserRpc = (
      plugin: ReturnType<typeof sunfallArcStart>,
      command: "build" | "serve",
    ): unknown =>
      plugin.config({ root: process.cwd() }, { command }).define?.__SUNFALL_ARC_BROWSER_RPC__;

    expect(browserRpc(staticPlugin, "build")).toBe("false");
    expect(browserRpc(staticPlugin, "serve")).toBe("true");
    expect(browserRpc(sunfallArcStart(), "build")).toBe("true");
  });

  it("resolves default and named Start handlers", async () => {
    const defaultHandler = () => new Response("default");
    const namedHandler = () => new Response("named");

    expect(
      resolveStartHandlerSync({ default: defaultHandler })(new Request("https://example.com")),
    ).toBeInstanceOf(Response);
    expect(resolveStartHandlerSync({ handleRequest: namedHandler })).toBe(namedHandler);
    expect(resolveStartHandlerSync({ custom: namedHandler }, { handlerExport: "custom" })).toBe(
      namedHandler,
    );
    expect(() => resolveStartHandlerSync({})).toThrow(StartHandlerNotFound);
  });

  it("loads dev SSR handler modules and transforms HTML responses", async () => {
    const loadedEntries: Array<string> = [];
    const transformedUrls: Array<string> = [];
    const server = {
      ssrLoadModule: (id: string) =>
        Effect.sync(() => {
          loadedEntries.push(id);
          return {
            default: (request: Request) =>
              Effect.succeed(
                new Response(`<html><body>${new URL(request.url).pathname}</body></html>`, {
                  headers: { "content-type": "text/html" },
                }),
              ),
          };
        }),
      transformIndexHtml: (url: string, html: string) =>
        Effect.sync(() => {
          transformedUrls.push(url);
          return html.replace("</body>", "<script>dev()</script></body>");
        }),
    };

    const response = await Effect.runPromise(
      handleSsrDevRequest(server, new Request("https://example.com/projects/atlas?tab=activity"), {
        serverEntry: "/src/server.tsx",
      }),
    );
    const html = await response.text();

    expect(loadedEntries).toEqual(["/src/server.tsx"]);
    expect(transformedUrls).toEqual(["/projects/atlas?tab=activity"]);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain("/projects/atlas");
    expect(html).toContain("<script>dev()</script>");

    await expect(
      Effect.runPromise(
        handleSsrDevRequest(server, new Request("https://example.com/projects/kepler")),
      ),
    ).resolves.toBeInstanceOf(Response);
  });

  it("does not end dev SSR request spans as success before host transform failures", async () => {
    const recorder = spanRecorder();
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () => "<html><body>home</body></html>",
    });
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: handler,
        }),
      transformIndexHtml: (_url: string, _html: string) =>
        Effect.fail(
          new StartDevServerError({
            operation: "transform-html",
            error: new Error("vite transform failed"),
          }),
        ),
    };

    const exit = await recorder.runExit(
      handleSsrDevRequest(server, new Request("https://example.com/")),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "transform-html" });
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.stream.state": "errored",
        "sunfall-arc.teardown.reason": "dev-ssr-host-transform",
      }),
    ]);
  });

  it("reports dev SSR request aborts as cancelled requests while reading HTML", async () => {
    const controller = new AbortController();
    const started = Effect.runSync(Deferred.make<void>());
    const cancelled = Effect.runSync(Deferred.make<unknown>());
    const recorder = spanRecorder();
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("<html><body>loading"));
              Effect.runSync(Deferred.succeed(started, undefined).pipe(Effect.ignore));
            },
            cancel(reason) {
              Effect.runSync(Deferred.succeed(cancelled, reason).pipe(Effect.ignore));
            },
          }),
          {
            headers: { "content-type": "text/html" },
          },
        ),
    });
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: handler,
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const fiber = Effect.runFork(
      recorder.trace(
        handleSsrDevRequest(
          server,
          new Request("https://example.com/", { signal: controller.signal }),
        ),
      ),
    );

    await recorder.run(Deferred.await(started));
    controller.abort("dev-client-disconnect");
    await expect(
      recorder.run(Deferred.await(cancelled).pipe(Effect.timeout("1 second"))),
    ).resolves.toBe("dev-client-disconnect");
    const exit = await recorder.run(Fiber.await(fiber));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "read-html" });
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "cancelled",
        "sunfall-arc.stream.state": "cancelled",
        "sunfall-arc.teardown.reason": "dev-client-disconnect",
      }),
    ]);
  });

  it("keeps dev SSR transform failures as failures when abort happens after HTML read", async () => {
    const controller = new AbortController();
    const recorder = spanRecorder();
    const app = makeStartServerApp({
      routes: [Route.define("/", {})] as const,
    });
    const handler = createStartRequestHandler(app, {
      render: () => "<html><body>home</body></html>",
    });
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: handler,
        }),
      transformIndexHtml: (_url: string, _html: string) =>
        Effect.sync(() => {
          controller.abort("abort-after-read");
        }).pipe(
          Effect.flatMap(() =>
            Effect.fail(
              new StartDevServerError({
                operation: "transform-html",
                error: new Error("vite transform failed"),
              }),
            ),
          ),
        ),
    };

    const exit = await recorder.runExit(
      handleSsrDevRequest(
        server,
        new Request("https://example.com/", { signal: controller.signal }),
      ),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "transform-html" });
    expect(recorder.requests()).toEqual([
      expect.objectContaining({
        "sunfall-arc.request.status": "failure",
        "sunfall-arc.stream.state": "errored",
        "sunfall-arc.teardown.reason": "dev-ssr-host-transform",
      }),
    ]);
  });

  it("cancels dev SSR HTML body reads when the request aborts", async () => {
    const controller = new AbortController();
    const started = Effect.runSync(Deferred.make<void>());
    const cancelled = Effect.runSync(Deferred.make<unknown>());
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(stream) {
                  stream.enqueue(new TextEncoder().encode("<html><body>loading"));
                  Effect.runSync(Deferred.succeed(started, undefined).pipe(Effect.ignore));
                },
                cancel(reason) {
                  Effect.runSync(Deferred.succeed(cancelled, reason).pipe(Effect.ignore));
                },
              }),
              {
                headers: { "content-type": "text/html" },
              },
            ),
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const fiber = Effect.runFork(
      handleSsrDevRequest(
        server,
        new Request("https://example.com/slow", { signal: controller.signal }),
      ),
    );

    await Effect.runPromise(Deferred.await(started));
    controller.abort("dev-client-disconnect");
    const cancelReason = await Effect.runPromise(
      Deferred.await(cancelled).pipe(Effect.timeout("1 second")),
    );
    const exit = await Effect.runPromise(Fiber.await(fiber));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(cancelReason).toBe("dev-client-disconnect");
    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "read-html" });
  });

  it("provides a request Scope to Vite dev SSR handler Effects", async () => {
    let finalized = false;
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: () =>
            Effect.gen(function* () {
              const scope = yield* Scope.Scope;
              yield* Scope.addFinalizer(
                scope,
                Effect.sync(() => {
                  finalized = true;
                }),
              );
              return new Response("<html><body>scoped</body></html>", {
                headers: { "content-type": "text/html" },
              });
            }),
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const response = await Effect.runPromise(
      handleSsrDevRequest(server, new Request("https://example.com/scoped")),
    );

    await expect(response.text()).resolves.toContain("scoped");
    expect(finalized).toBe(true);
  });

  it("runs Vite dev SSR middleware handler Effects in the configured runtime", async () => {
    interface DevSsrToken {
      readonly value: string;
    }
    const DevSsrToken = Context.Service<DevSsrToken>("@sunfall/arc-start/test/DevSsrToken");
    const runtime = makeRuntime(Layer.succeed(DevSsrToken)({ value: "runtime-token" }));
    const done = Effect.runSync(Deferred.make<void>());
    const headers = new Map<string, string | readonly string[]>();
    const nextErrors: Array<unknown> = [];
    let middleware:
      | ((
          request: IncomingMessage,
          response: ServerResponse,
          next: (error?: unknown) => void,
        ) => void)
      | undefined;
    const plugin = sunfallArcStart({
      serverEntry: "/src/server.tsx",
      devSsr: { runtime },
    });
    const server = {
      ssrLoadModule: async () => ({
        default: () =>
          DevSsrToken.use((token) =>
            Effect.succeed(
              new Response(null, {
                status: 204,
                headers: { "x-dev-ssr-token": token.value },
              }),
            ),
          ),
      }),
      transformIndexHtml: async (_url: string, html: string) => html,
      middlewares: {
        use: (
          handler: (
            request: IncomingMessage,
            response: ServerResponse,
            next: (error?: unknown) => void,
          ) => void,
        ) => {
          middleware = handler;
        },
      },
    };
    const request = {
      headers: { host: "example.com", accept: "text/html" },
      method: "GET",
      url: "/",
      once: () => request,
      off: () => request,
    } as unknown as IncomingMessage;
    const response = {
      writableEnded: false,
      setHeader: (name: string, value: string | readonly string[]) => {
        headers.set(name.toLowerCase(), value);
      },
      end: () => {
        (response as { writableEnded: boolean }).writableEnded = true;
        Effect.runSync(Deferred.succeed(done, undefined).pipe(Effect.ignore));
      },
      once: () => response,
      off: () => response,
    } as unknown as ServerResponse;

    try {
      plugin.configureServer(server)();
      middleware?.(request, response, (error) => {
        nextErrors.push(error);
      });
      await Effect.runPromise(Deferred.await(done).pipe(Effect.timeout("1 second")));
    } finally {
      await Effect.runPromise(runtime.dispose);
    }

    expect(nextErrors).toEqual([]);
    expect(headers.get("x-dev-ssr-token")).toBe("runtime-token");
  });

  it("contains Vite dev SSR middleware fork setup failures", () => {
    const setupError = new Error("dev SSR runtime failed to fork");
    const nextErrors: Array<unknown> = [];
    let requestOffCount = 0;
    let responseOffCount = 0;
    let middleware:
      | ((
          request: IncomingMessage,
          response: ServerResponse,
          next: (error?: unknown) => void,
        ) => void)
      | undefined;
    const plugin = sunfallArcStart({
      serverEntry: "/src/server.tsx",
      devSsr: {
        runtime: {
          runFork: () => {
            throw setupError;
          },
        },
      },
    });
    const server = {
      ssrLoadModule: async () => ({}),
      transformIndexHtml: async (_url: string, html: string) => html,
      middlewares: {
        use: (
          handler: (
            request: IncomingMessage,
            response: ServerResponse,
            next: (error?: unknown) => void,
          ) => void,
        ) => {
          middleware = handler;
        },
      },
    };
    const request = {
      headers: { host: "example.com", accept: "text/html" },
      method: "GET",
      url: "/",
      once: () => request,
      off: () => {
        requestOffCount += 1;
        return request;
      },
    } as unknown as IncomingMessage;
    const response = {
      writableEnded: false,
      once: () => response,
      off: () => {
        responseOffCount += 1;
        return response;
      },
    } as unknown as ServerResponse;

    plugin.configureServer(server)();
    middleware?.(request, response, (error) => {
      nextErrors.push(error);
    });

    expect(nextErrors).toEqual([setupError]);
    expect(requestOffCount).toBe(0);
    expect(responseOffCount).toBe(0);
  });

  it("keeps Vite dev SSR pass-through Scope alive until streamed bodies are cancelled", async () => {
    let finalized = false;
    let cancelled: unknown;
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: () =>
            Effect.gen(function* () {
              const scope = yield* Scope.Scope;
              yield* Scope.addFinalizer(
                scope,
                Effect.sync(() => {
                  finalized = true;
                }),
              );
              return new Response(
                new ReadableStream<Uint8Array>({
                  pull(controller) {
                    controller.enqueue(new TextEncoder().encode("chunk"));
                  },
                  cancel(reason) {
                    cancelled = reason;
                  },
                }),
                {
                  headers: { "content-type": "text/plain" },
                },
              );
            }),
        }),
      transformIndexHtml: (_url: string, html: string) =>
        Effect.sync(() => {
          expect.fail("text/plain pass-through responses should not be transformed");
          return html;
        }),
    };

    const response = await Effect.runPromise(
      handleSsrDevRequest(server, new Request("https://example.com/pass-through")),
    );
    const reader = response.body!.getReader();

    expect(finalized).toBe(false);
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    expect(finalized).toBe(false);
    await reader.cancel("dev-client-cancel");

    expect(cancelled).toBe("dev-client-cancel");
    expect(finalized).toBe(true);
  });

  it("adapts the Vite Promise dev server host to Effect operations", async () => {
    const fixedErrors: Array<Error> = [];
    const server = startDevServerFromVite({
      ssrLoadModule: async (id: string) => ({ id }),
      transformIndexHtml: async (url: string, html: string) => `${url}:${html}`,
      ssrFixStacktrace: (error) => {
        fixedErrors.push(error);
      },
    });

    await expect(Effect.runPromise(server.ssrLoadModule("/src/server.tsx"))).resolves.toEqual({
      id: "/src/server.tsx",
    });
    await expect(
      Effect.runPromise(server.transformIndexHtml("/projects", "<html />")),
    ).resolves.toBe("/projects:<html />");

    const error = new Error("stack");
    await Effect.runPromise(server.ssrFixStacktrace?.(error) ?? Effect.void);
    expect(fixedErrors).toEqual([error]);

    const failing = startDevServerFromVite({
      ssrLoadModule: async () => {
        throw new Error("load failed");
      },
      transformIndexHtml: async (_url: string, html: string) => html,
    });
    const exit = await Effect.runPromiseExit(failing.ssrLoadModule("/src/server.tsx"));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "load-module" });
  });

  it("rejects Promise-returning dev SSR handlers at the EffectInput seam", async () => {
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          // Deliberately Promise-shaped handler: the EffectInput seam must reject it at runtime.
          default: (() => Effect.runPromise(Effect.succeed(new Response("promise")))) as never,
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const exit = await Effect.runPromiseExit(
      handleSsrDevRequest(server, new Request("https://example.com/promise")),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({
      operation: "run-handler",
      error: expect.objectContaining({
        _tag: "EffectInputPromiseRejected",
      }),
    });
  });

  it("rejects invalid dev SSR handler values inside the typed dev server channel", async () => {
    const server = {
      ssrLoadModule: (_id: string) =>
        Effect.succeed({
          default: () => "not a response" as never,
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const exit = await Effect.runPromiseExit(
      handleSsrDevRequest(server, new Request("https://example.com/invalid")),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({
      operation: "run-handler",
      error: expect.objectContaining({
        _tag: "StartHandlerInvalidResponse",
      }),
    });
  });

  it("runs Vite dev middleware control flow through Effect", async () => {
    let nextCalls = 0;
    await Effect.runPromise(
      handleSsrDevMiddleware(
        {
          ssrLoadModule: () =>
            Effect.sync(() => {
              expect.fail("should not load static requests");
            }),
          transformIndexHtml: (_url, html) => Effect.succeed(html),
        },
        {
          headers: {},
          method: "GET",
          url: "/src/main.ts",
        } as IncomingMessage,
        {} as ServerResponse,
        () => {
          nextCalls += 1;
        },
      ),
    );

    expect(nextCalls).toBe(1);

    let throwingNextCalls = 0;
    let loadedStatic = false;
    await expect(
      Effect.runPromise(
        handleSsrDevMiddleware(
          {
            ssrLoadModule: () =>
              Effect.sync(() => {
                loadedStatic = true;
                return {};
              }),
            transformIndexHtml: (_url, html) => Effect.succeed(html),
          },
          {
            headers: {},
            method: "GET",
            url: "/src/static.ts",
          } as IncomingMessage,
          {} as ServerResponse,
          () => {
            throwingNextCalls += 1;
            throw new Error("pass-through next failed");
          },
        ),
      ),
    ).resolves.toBeUndefined();

    expect(throwingNextCalls).toBe(1);
    expect(loadedStatic).toBe(false);

    const fixedErrors: Array<Error> = [];
    const nextErrors: Array<unknown> = [];
    await Effect.runPromise(
      handleSsrDevMiddleware(
        {
          ssrLoadModule: () => Effect.succeed({}),
          transformIndexHtml: (_url, html) => Effect.succeed(html),
          ssrFixStacktrace: (error) =>
            Effect.sync(() => {
              fixedErrors.push(error);
            }),
        },
        {
          headers: { host: "example.com" },
          method: "GET",
          url: "/projects/atlas",
        } as IncomingMessage,
        {} as ServerResponse,
        (error) => {
          nextErrors.push(error);
        },
        { serverEntry: "/src/server.tsx" },
      ),
    );

    expect(nextErrors).toHaveLength(1);
    expect(nextErrors[0]).toBeInstanceOf(StartHandlerNotFound);
    expect(fixedErrors).toEqual([nextErrors[0]]);
  });

  it("passes Node origin policy into Vite dev SSR middleware", async () => {
    let handledUrl: string | undefined;
    let responseEnded = false;
    const nextErrors: Array<unknown> = [];
    const response = {
      setHeader: () => undefined,
      end: () => {
        responseEnded = true;
      },
    } as unknown as ServerResponse;

    await Effect.runPromise(
      handleSsrDevMiddleware(
        {
          ssrLoadModule: () =>
            Effect.succeed({
              default: (request: Request) => {
                handledUrl = request.url;
                return new Response(null, { status: 204 });
              },
            }),
          transformIndexHtml: (_url, html) => Effect.succeed(html),
        },
        Object.assign(new IncomingMessage(new Socket()), {
          headers: {
            host: "internal.local",
            "x-forwarded-proto": "https",
            "x-forwarded-host": "public.example.com",
          },
          method: "GET",
          url: "/settings",
        }),
        response,
        (error) => {
          nextErrors.push(error);
        },
        {
          serverEntry: "/src/server.tsx",
          nodeRequest: { trustForwardedHeaders: false },
        },
      ),
    );

    expect(nextErrors).toEqual([]);
    expect(responseEnded).toBe(true);
    expect(handledUrl).toBe("http://internal.local/settings");
  });

  it("owns Node abort lifecycle when Vite dev SSR middleware runs directly", async () => {
    const request = Object.assign(new EventEmitter(), {
      headers: {
        accept: "text/html",
        host: "example.com",
      },
      method: "GET",
      url: "/projects/atlas",
    }) as unknown as IncomingMessage;
    const responseEvents = new EventEmitter();
    const responseState = { writableEnded: false };
    const response = Object.assign(responseEvents, {
      get writableEnded() {
        return responseState.writableEnded;
      },
      set writableEnded(value: boolean) {
        responseState.writableEnded = value;
      },
      setHeader: () => undefined,
      end: () => {
        responseState.writableEnded = true;
        responseEvents.emit("finish");
      },
    }) as unknown as ServerResponse;
    const cancelledReads: Array<unknown> = [];
    const nextErrors: Array<unknown> = [];
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode("<html>"));
      },
      cancel: (reason) => {
        cancelledReads.push(reason);
      },
    });

    const fiber = Effect.runFork(
      handleSsrDevMiddleware(
        {
          ssrLoadModule: () =>
            Effect.succeed({
              default: () =>
                new Response(body, {
                  headers: { "content-type": "text/html" },
                }),
            }),
          transformIndexHtml: () =>
            Effect.sync(() => {
              expect.fail("aborted dev SSR reads should not transform HTML");
            }),
        },
        request,
        response,
        (error) => {
          nextErrors.push(error);
        },
        { serverEntry: "/src/server.tsx" },
      ),
    );

    await Effect.runPromise(Effect.sleep("20 millis"));
    response.emit("close");
    await Effect.runPromise(Fiber.await(fiber));
    await Effect.runPromise(Effect.sleep("20 millis"));

    expect(cancelledReads).toHaveLength(1);
    expect(nextErrors.length).toBeLessThanOrEqual(1);
  });

  it("continues middleware error reporting when Vite ssrFixStacktrace throws", async () => {
    let fixAttempts = 0;
    const nextErrors: Array<unknown> = [];
    const server = startDevServerFromVite({
      ssrLoadModule: async () => ({}),
      transformIndexHtml: async (_url: string, html: string) => html,
      ssrFixStacktrace: () => {
        fixAttempts += 1;
        throw new Error("stack trace fix failed");
      },
    });

    await expect(
      Effect.runPromise(
        handleSsrDevMiddleware(
          server,
          {
            headers: { host: "example.com" },
            method: "GET",
            url: "/projects/atlas",
          } as IncomingMessage,
          {} as ServerResponse,
          (error) => {
            nextErrors.push(error);
          },
          { serverEntry: "/src/server.tsx" },
        ),
      ),
    ).resolves.toBeUndefined();

    expect(fixAttempts).toBe(1);
    expect(nextErrors).toHaveLength(1);
    expect(nextErrors[0]).toBeInstanceOf(StartHandlerNotFound);
  });

  it("keeps Vite dev SSR middleware failures contained when next throws", async () => {
    let nextCalls = 0;
    const server = startDevServerFromVite({
      ssrLoadModule: async () => ({}),
      transformIndexHtml: async (_url: string, html: string) => html,
    });

    await expect(
      Effect.runPromise(
        handleSsrDevMiddleware(
          server,
          {
            headers: { host: "example.com" },
            method: "GET",
            url: "/projects/atlas",
          } as IncomingMessage,
          {} as ServerResponse,
          () => {
            nextCalls += 1;
            throw new Error("next failed");
          },
          { serverEntry: "/src/server.tsx" },
        ),
      ),
    ).resolves.toBeUndefined();

    expect(nextCalls).toBe(1);
  });
});

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined => {
  return cause.reasons.find(Cause.isFailReason)?.error;
};
