import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Schema,
  Scope,
  Stream,
} from "effect";
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
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionResult,
  defaultRuntime,
  defineApp,
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  makeRuntime,
  read,
  Resource,
  ResourceFamily,
  ResourceTypeId,
  RequestContext,
  ResponseContext,
  route,
  Route,
  RoutePreloadError,
  runWithRuntime,
  Server,
  ServerClient,
  ServerTransportError,
  type EffectUiRuntime,
  type ResourceRef,
} from "@effect-ui/core";
import { Collection, CollectionSnapshotCodecError } from "@effect-ui/db";
import type { DevtoolsRequestTrace } from "@effect-ui/devtools";
import {
  createServerActionResponseEffect,
  createHydrationScript,
  createHydrationScriptEffect,
  createHtmlResponseEffect,
  createStartRenderHydrationPlanEffect,
  createStreamHydrationScript,
  createServerRpcResponseEffect,
  createRequestHandlerEffect,
  createRequestHandler,
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  hydrateFromDocument,
  hydrateFromDocumentEffect,
  hydrateStartPayloadEffect,
  hydrateStartHydrationChunksFromDocument,
  hydrateStartHydrationChunksFromDocumentEffect,
  readStartHydrationChunks,
  makeRpcClient,
  preloadRequest,
  preloadRequestEffect,
  serverActionPath,
  serverRpcPath,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationSequenceAttribute,
  startRequestIdHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
  startActionForm,
  startActionInputField,
  StartHydrationChunkParseError,
  StartHydrationPayloadParseError,
  StartHydrationPayloadSerializeError,
  StartPreloadError,
  StartRequestHandlerError,
  StartCollectionDuplicateName,
  StartAction,
  StartActionFormEncodeError,
  StartActionDuplicateName,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
  FileRoutePreloadError,
  type StartFetch,
  type FileRoutePreloadResource,
  submitStartActionEffect,
  encodeStartActionRequestEffect,
  resolveStartActionEndpoint,
  resolveStartRpcEndpoint,
  resolveStartTransportEndpoints,
  defineFileRoute,
} from "../src/index.js";
import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
} from "../src/diagnostics-report.js";
import { completeRequestRuntimeWithResponse, makeRequestRuntime } from "../src/request-runtime.js";
import { buildStartRequestTrace, requestRuntimeTeardownSnapshot } from "../src/request-trace.js";
import {
  effectUiStartVirtualModules,
  loadStartAppGraphDiagnosticsFromServerEffect,
  loadStartAppGraphDiagnosticsWithOwnedServerEffect,
  loadStartAppGraphDiagnosticsWithServerEffect,
} from "../src/start-vite-diagnostics-loader.js";
import {
  parseStartDiagnosticsCliArgs,
  runStartDiagnosticsCli,
  runStartDiagnosticsCliEffect,
  runStartDiagnosticsCliMainEffect,
} from "../src/cli.js";
import type { StartAgentGraphQueryKind } from "../src/start-agent-graph-contract.js";
import { startAgentGraphQueryKinds } from "../src/start-agent-graph-vocabulary.js";
import { startDiagnosticsCliVerifyCommandsForQuery } from "../src/start-diagnostics-cli-contract.js";
import { describeStartAppGraph } from "../src/app-graph.js";
import {
  actionManifestVirtualModuleId,
  appGraphRuntimeDiagnosticsVirtualModuleId,
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
  makeStartActionManifestEffect,
  makeStartFileRouteManifestEffect,
  makeStartServerFunctionManifestEffect,
  resolveStartHandler,
  serializeStartActionManifest,
  serializeStartAppGraph,
  serializeStartFileRouteManifest,
  serializeStartServerFunctionManifest,
  serverFunctionManifestVirtualModuleId,
  startDevServerFromVite,
  StartAppGraphDiagnosticsRunnerError,
  StartAppGraphMissingWireSchemas,
  StartAppGraphUnknownActionBehavior,
  StartDevServerError,
  FileRouteDefinitionsOutputPathError,
  StartHandlerNotFound,
  StartManifestDirectReferenceError,
  StartServerOnlyModuleError,
  validateStartBuildPolicyEffect,
  shouldHandleSsrRequest,
} from "../src/vite.js";

const scriptText = (script: string): string =>
  script.replace(/^<script[^>]*>/, "").replace("</script>", "");

const runInRuntime = <A, E, R, RuntimeError>(
  runtime: EffectUiRuntime<unknown, RuntimeError>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> => Effect.runPromise(runtime.provide(effect));

const startAgentGraphCliQueryTextByKind = {
  action: "Project.rename",
  collection: "ProjectRows",
  endpoint: "rpc",
  finding: "wire-schema",
  module: "project.server",
  node: "Project",
  resource: "Project.byId",
  "resource-tag": "Project.updated",
  route: "/projects/:id",
  "server-function": "Project.load",
} satisfies Record<StartAgentGraphQueryKind, string>;

const shellSplit = (command: string): readonly string[] => {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let hasCurrent = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        current += char;
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (hasCurrent) {
        args.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }

    hasCurrent = true;
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === "\\") {
      index += 1;
      current += command[index] ?? "";
      continue;
    }
    current += char;
  }

  if (inSingleQuote) {
    throw new Error(`Unclosed single quote in shell command: ${command}`);
  }
  if (hasCurrent) {
    args.push(current);
  }
  return args;
};

const shellSplitStartCliArgs = (command: string): readonly string[] => {
  const [binary, ...args] = shellSplit(command);
  expect(binary).toBe("effect-ui-start");
  return args;
};

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

const startDiagnosticsRunnerViteConfig = () => ({
  resolve: {
    alias: [
      { find: "effect", replacement: workspacePackageAlias("node_modules/effect/dist/index.js") },
      { find: "@effect-ui/core", replacement: workspacePackageAlias("packages/core/src/index.ts") },
      { find: "@effect-ui/db", replacement: workspacePackageAlias("packages/db/src/index.ts") },
      {
        find: "@effect-ui/start",
        replacement: workspacePackageAlias("packages/start/src/index.ts"),
      },
      {
        find: "@effect-ui/start/vite",
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

describe("Effect UI Start", () => {
  it("defines file routes with the same typed href contract as core routes", () => {
    const ProjectRoute = defineFileRoute("/projects/:id")({
      params: Schema.Struct({ id: Schema.String }),
    });

    expect(Route.href(ProjectRoute, { params: { id: "atlas" } })).toBe("/projects/atlas");
  });

  it("ignores synchronous throws from request trace callbacks", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: () => {
        throw new Error("trace callback failed");
      },
      render: () => new Response(null, { status: 204 }),
    });

    const response = await Effect.runPromise(handler(new Request("https://example.com/")));

    expect(response.status).toBe(204);
  });

  it("ignores synchronous throws from request runtime finalizers", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const runtime = makeRequestRuntime(app);

    const response = await Effect.runPromise(
      completeRequestRuntimeWithResponse(runtime, new Response(null, { status: 204 }), {
        onFinalize: () => {
          throw new Error("finalizer callback failed");
        },
      }),
    );

    expect(response.status).toBe(204);
  });

  it("ignores synchronous throws from request runtime stream finalizers", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
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
        {
          onStreamFinalize: () => {
            throw new Error("stream finalizer callback failed");
          },
        },
      ),
    );

    await expect(response.text()).resolves.toBe("stream body");
  });

  it("preloads matched route resources into a hydration payload", async () => {
    const Project = Resource.family({
      name: "Start.Project.byId",
      load: (id: string) => Effect.succeed({ id, name: "Atlas" }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
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
    const Project = Resource.family({
      name: "Start.Project.render",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    let renderPlanResourceNames: readonly string[] = [];
    let renderPlanRootResourceCount = -1;
    let renderRootScript = "";
    const handler = createRequestHandler(app, {
      render: ({ match, legacyHydrationScript, hydrationRootScript, hydrationPlan }) => {
        renderPlanRootResourceCount = hydrationPlan.root.payload.resources.length;
        renderPlanResourceNames = hydrationPlan.streamedResourceChunks.flatMap((chunk) =>
          chunk.resources.map((resource) => resource.name),
        );
        renderRootScript = hydrationRootScript;
        return `<html><body><main>${match?.href}</main>${legacyHydrationScript}</body></html>`;
      },
    });

    const response = await Effect.runPromise(
      handler(new Request("https://example.com/projects/kepler")),
    );
    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain("<main>/projects/kepler</main>");
    expect(html).toContain("Start.Project.render");
    expect(html).toContain('id="__EFFECT_UI_HYDRATION__"');
    expect(renderPlanRootResourceCount).toBe(0);
    expect(renderPlanResourceNames).toEqual(["Start.Project.render"]);
    expect(renderRootScript).not.toContain("Start.Project.render");
  });

  it("lets streamed renderers use the plan-derived root script without duplicating resource hydration", async () => {
    const Project = Resource.family({
      name: "Start.Project.stream-render",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      render: ({ hydrationRootScript, hydrationPlan }) => {
        const streamedScripts = hydrationPlan.streamedResourceChunks
          .map((chunk, index) => createStreamHydrationScript(chunk, index))
          .join("");
        return `<html><body>${hydrationRootScript}${streamedScripts}</body></html>`;
      },
    });

    const response = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const html = await response.text();

    expect(html.match(/"name":"Start\.Project\.stream-render"/g)).toHaveLength(1);
    expect(html).toContain('id="__EFFECT_UI_HYDRATION__"');
    expect(html).toContain("data-effect-ui-hydration-chunk");
  });

  it("does not serialize the full legacy hydration script for streamed renderers that do not read it", async () => {
    const Project = Resource.family({
      name: "Start.Project.lazy-legacy-script",
      load: (id: string) => Effect.succeed({ id, count: 1n }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      render: ({ hydrationRootScript }) =>
        `<html><body>${hydrationRootScript}<main>stream shell</main></body></html>`,
    });

    const response = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<main>stream shell</main>");
    expect(html).toContain('id="__EFFECT_UI_HYDRATION__"');
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
            _tag: "Success",
            value: { id: "atlas", name: "Atlas" },
          },
        },
      ],
    };
    const collections = {
      collections: [
        {
          name: "Start.Collection.render-plan",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas" },
              synced: true,
              origin: "remote",
            },
          ],
          pendingMutations: [],
        },
      ],
    };

    const plan = await Effect.runPromise(
      createStartRenderHydrationPlanEffect({ resources, collections }),
    );
    const rootPairs = new Set(
      plan.root.payload.resources.map((resource) => `${resource.name}:${resource.key}`),
    );
    const streamedPairs = plan.streamedResourceChunks.flatMap((chunk) =>
      chunk.resources.map((resource) => `${resource.name}:${resource.key}`),
    );

    expect(plan.root.payload.resources).toEqual([]);
    expect(plan.root.payload.collections?.map((collection) => collection.name)).toEqual([
      "Start.Collection.render-plan",
    ]);
    expect(plan.legacy.payload.resources.map((resource) => resource.name)).toEqual([
      "Start.Project.render-plan",
    ]);
    expect(plan.legacy.script).toContain("Start.Project.render-plan");
    expect(plan.root.script).toContain("__EFFECT_UI_HYDRATION__");
    expect(plan.root.script).toContain("Start.Collection.render-plan");
    expect(plan.root.script).not.toContain("Start.Project.render-plan");
    expect(streamedPairs).toEqual(["Start.Project.render-plan:Start.Project.render-plan:atlas"]);
    expect(streamedPairs.filter((pair) => rootPairs.has(pair))).toEqual([]);
  });

  it("defers full legacy render hydration script serialization until it is read", async () => {
    const plan = await Effect.runPromise(
      createStartRenderHydrationPlanEffect({
        resources: {
          resources: [
            {
              name: "Start.Project.lazy-plan",
              key: "Start.Project.lazy-plan:atlas",
              input: "atlas",
              state: {
                _tag: "Success",
                value: { id: "atlas", count: 1n },
              },
            },
          ],
        },
        collections: { collections: [] },
      }),
    );

    expect(plan.root.script).toContain("__EFFECT_UI_HYDRATION__");
    expect(plan.root.script).not.toContain("Start.Project.lazy-plan");
    expect(() => plan.legacy.script).toThrow(StartHydrationPayloadSerializeError);
  });

  it("surfaces render hydration plan root serialization failures as typed errors", async () => {
    const collections = {
      collections: [
        {
          name: "Start.Collection.render-plan.invalid",
          rows: [
            {
              key: "bigint",
              value: { count: 1n },
              synced: true,
              origin: "remote",
            },
          ],
          pendingMutations: [],
        },
      ],
    };

    const exit = await Effect.runPromiseExit(
      createStartRenderHydrationPlanEffect({
        resources: { resources: [] },
        collections,
      }),
    );
    const failure = Exit.isFailure(exit)
      ? exit.cause.reasons.find(Cause.isFailReason)?.error
      : undefined;

    expect(failure).toBeInstanceOf(StartHydrationPayloadSerializeError);
  });

  it("emits Devtools-compatible request traces for SSR requests", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Project = Resource.family({
      name: "Start.Project.trace",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: ({ match }) => `<html><body><main>${match?.href}</main></body></html>`,
    });

    const response = await Effect.runPromise(
      handler(
        new Request("https://example.com/projects/atlas?tab=activity", {
          headers: {
            "x-effect-ui-request-id": "req-ssr-atlas",
            authorization: "Bearer top-secret",
            cookie: "session=s3cr3t",
            "x-api-key": "key-secret",
          },
        }),
      ),
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
          headers: expect.arrayContaining([
            { name: "authorization", value: "<redacted>" },
            { name: "cookie", value: "<redacted>" },
            { name: "x-api-key", value: "<redacted>" },
            { name: "x-effect-ui-request-id", value: "req-ssr-atlas" },
          ]),
          cookies: [
            {
              name: "session",
              value: "<redacted>",
            },
          ],
        }),
        response: expect.objectContaining({
          status: 200,
        }),
        services: ["RequestContext", "ResponseContext"],
        routePlan: expect.objectContaining({
          _tag: "Matched",
          href: "/projects/atlas?tab=activity",
          resources: [
            {
              key: Project("atlas").key,
              family: "Start.Project.trace",
              input: "atlas",
            },
          ],
          hydration: {
            resourceCount: 1,
            resourceKeys: [Project("atlas").key],
          },
        }),
        resources: [
          {
            key: Project("atlas").key,
            family: "Start.Project.trace",
            input: "atlas",
          },
        ],
        collections: [],
        serverFunctions: [],
        actions: [],
        fibers: [
          {
            name: "request-runtime",
            status: "done",
          },
        ],
        streams: [
          expect.objectContaining({
            name: "response",
            state: "closed",
          }),
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
            tagCount: expect.any(Number),
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0,
          }),
        }),
      }),
    ]);
    expect(JSON.stringify(traces[0])).not.toContain("top-secret");
    expect(JSON.stringify(traces[0])).not.toContain("s3cr3t");
    expect(JSON.stringify(traces[0])).not.toContain("key-secret");
  });

  it("uses a fresh resource store for each SSR request", async () => {
    let loads = 0;
    const Project = Resource.family({
      name: "Start.Project.request-store",
      load: (id: string) =>
        Effect.sync(() => ({
          id,
          sequence: ++loads,
        })),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      render: ({ match }) => {
        const id = match?.params.id ?? "missing";
        const project = Resource.read(Project(id));
        return `<html><body><main>${project.id}:${project.sequence}</main></body></html>`;
      },
    });

    const first = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const second = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );

    await expect(first.text()).resolves.toContain("atlas:1");
    await expect(second.text()).resolves.toContain("atlas:2");
    expect(loads).toBe(2);
  });

  it("uses request-local server clients even when the app runtime provides one", async () => {
    const LookupProject = Server.contract<
      { readonly id: string },
      { readonly id: string; readonly path: string }
    >("Start.Project.request-local-server-client", {
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
            yield* response.setHeader("x-effect-ui-local-server-client", "yes");
            return { id, path: request.url.pathname };
          }),
        ),
      ),
    );
    const ambientClient: ServerClient = {
      call: () =>
        Effect.fail(
          new ServerTransportError({
            reason: "Network",
            message: "ambient ServerClient should not handle request-runtime calls",
          }),
        ),
    };
    const ProjectRoute = route("/local-server-client/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => lookupProject.effect({ id: params.id }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
      server: Layer.succeed(ServerClient)(ambientClient),
    });
    const handler = createRequestHandler(app, {
      render: ({ match }) => `<html><body><main>${match?.params.id}</main></body></html>`,
    });

    const response = await Effect.runPromise(
      handler(new Request("https://example.com/local-server-client/atlas")),
    );

    expect(calls).toEqual(["atlas:/local-server-client/atlas"]);
    expect(response.status).toBe(209);
    expect(response.headers.get("x-effect-ui-local-server-client")).toBe("yes");
    await expect(response.text()).resolves.toContain("<main>atlas</main>");
  });

  it("dehydrates DB collections from the SSR request runtime", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Projects = Collection.define<{
      readonly id: string;
      readonly name: string;
      readonly sequence: number;
    }>({
      name: "Start.Collection.request-store",
      getKey: (project) => project.id,
    });
    let sequence = 0;
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) =>
        Projects.writeInsertEffect({
          id: params.id,
          name: `Project ${params.id}`,
          sequence: ++sequence,
        }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      collections: [Projects],
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: ({ collections, legacyHydrationScript }) => {
        const project = Projects.rows()[0];
        return `<html><body><main>${project?.id}:${project?.sequence}</main><aside>${collections.collections[0]?.rows.length}</aside>${legacyHydrationScript}</body></html>`;
      },
    });

    const first = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const second = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const firstHtml = await first.text();
    const secondHtml = await second.text();

    expect(firstHtml).toContain("<main>atlas:1</main>");
    expect(firstHtml).toContain("<aside>1</aside>");
    expect(firstHtml).toContain("Start.Collection.request-store");
    expect(firstHtml).toContain('"collections"');
    expect(traces[0]?.collections).toEqual([
      {
        name: "Start.Collection.request-store",
        state: "Initial",
      },
    ]);
    expect(traces[0]?.collections[0]).not.toHaveProperty("eventCount");
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
        }),
    });
    const _Tasks = Collection.define<{ readonly id: string; readonly title: string }>({
      name: "Start.Collection.route-touched.tasks",
      getKey: (task) => task.id,
      load: () =>
        Effect.sync(() => {
          taskLoads += 1;
          return [{ id: "ship", title: "Ship it" }];
        }),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: () => Projects.preloadEffect(),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/projects/atlas")),
    );

    expect(projectLoads).toBe(1);
    expect(taskLoads).toBe(0);
    expect(
      result.collectionPreload.routeTouchedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.route-touched.projects"]);
    expect(result.collectionPreload.registeredCollections).toEqual([]);
    expect(
      result.collectionPreload.dehydratedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.route-touched.projects"]);
    expect(result.collections.collections.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-touched.projects",
    ]);
    expect(result.hydration.collections?.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-touched.projects",
    ]);
    expect(result.collections.collections[0]?.rows).toEqual([
      {
        key: "atlas",
        value: { id: "atlas", name: "Atlas" },
        synced: true,
        origin: "remote",
      },
    ]);

    const handler = createRequestHandler(app, {
      render: ({ collectionPreload, collections, legacyHydrationScript }) =>
        `<html><body><main>${collectionPreload.routeTouchedCollections.map((collection) => collection.name).join(",")}</main><aside>${collections.collections.length}</aside>${legacyHydrationScript}</body></html>`,
    });
    const response = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );
    const html = await response.text();

    expect(projectLoads).toBe(2);
    expect(taskLoads).toBe(0);
    expect(html).toContain("<main>Start.Collection.route-touched.projects</main>");
    expect(html).toContain("<aside>1</aside>");
    expect(html).toContain('"Start.Collection.route-touched.projects"');
    expect(html).not.toContain("Start.Collection.route-touched.tasks");
  });

  it("dehydrates route collection preloads captured inside nested collectors", async () => {
    let projectLoads = 0;
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.route-nested-collector.projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          projectLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        }),
    });
    const ProjectRoute = route("/nested-collector-projects", {
      preload: () => Collection.collectEffect(Projects.preloadEffect()).pipe(Effect.asVoid),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/nested-collector-projects")),
    );

    expect(projectLoads).toBe(1);
    expect(
      result.collectionPreload.routeTouchedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.route-nested-collector.projects"]);
    expect(result.collections.collections.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-nested-collector.projects",
    ]);
    expect(result.hydration.collections?.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.route-nested-collector.projects",
    ]);
  });

  it("excludes route-touched live query collections from hydration payloads", async () => {
    const Projects = Collection.define<{
      readonly id: string;
      readonly name: string;
      readonly progress: number;
    }>({
      name: "Start.Collection.live-query-source.projects",
      getKey: (project) => project.id,
      load: () => Effect.succeed([{ id: "atlas", name: "Atlas", progress: 72 }]),
    });
    const ProjectCards = Collection.liveQuery<
      { readonly id: string; readonly name: string },
      string
    >({
      name: "Start.Collection.live-query-derived.cards",
      getKey: (project) => project.id,
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          name: project.name,
        })),
    });
    const ProjectRoute = route("/live-query-projects", {
      preload: () => ProjectCards.preloadEffect(),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/live-query-projects")),
    );

    expect(
      result.collectionPreload.routeTouchedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.live-query-source.projects"]);
    expect(
      result.collectionPreload.routeTouchedCollections.some(
        (collection) => collection.name === ProjectCards.name,
      ),
    ).toBe(false);
    expect(
      result.collectionPreload.dehydratedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.live-query-source.projects"]);
    expect(result.hydration.collections?.map((snapshot) => snapshot.name)).toEqual([
      "Start.Collection.live-query-source.projects",
    ]);
    expect(
      result.hydration.collections?.some((snapshot) => snapshot.name === ProjectCards.name),
    ).toBe(false);

    const clientRuntime = makeRuntime();
    try {
      await Effect.runPromise(
        clientRuntime.provide(
          hydrateStartPayloadEffect(result.hydration, {
            collections: [Projects, ProjectCards],
          }),
        ),
      );
      expect(
        runWithRuntime(clientRuntime, () => ProjectCards.rows().map((project) => project.name)),
      ).toEqual(["Atlas"]);
    } finally {
      await Effect.runPromise(clientRuntime.disposeEffect);
    }
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
        }),
    });
    const ProjectRoute = route("/declared-projects", {
      preloadCollections: [Projects],
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/declared-projects")),
    );

    expect(projectLoads).toBe(1);
    expect(result.collectionPreload.routeTouchedCollections).toEqual([]);
    expect(
      result.collectionPreload.routeDeclaredCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.route-declared.projects"]);
    expect(result.collectionPreload.registeredCollections).toEqual([]);
    expect(
      result.collectionPreload.dehydratedCollections.map((collection) => collection.name),
    ).toEqual(["Start.Collection.route-declared.projects"]);
    expect(result.collections.collections[0]?.rows).toEqual([
      {
        key: "atlas",
        value: { id: "atlas", name: "Atlas" },
        synced: true,
        origin: "remote",
      },
    ]);

    const handler = createRequestHandler(app, {
      render: ({ collectionPreload, collections, legacyHydrationScript }) =>
        `<html><body><main>${collectionPreload.routeDeclaredCollections.map((collection) => collection.name).join(",")}</main><aside>${collections.collections.length}</aside>${legacyHydrationScript}</body></html>`,
    });
    const response = await Effect.runPromise(
      handler(new Request("https://example.com/declared-projects")),
    );
    const html = await response.text();

    expect(projectLoads).toBe(2);
    expect(html).toContain("<main>Start.Collection.route-declared.projects</main>");
    expect(html).toContain("<aside>1</aside>");
    expect(html).toContain('"Start.Collection.route-declared.projects"');
  });

  it("defines file route preload metadata and work from the preload helper", async () => {
    let resourceLoads = 0;
    let collectionLoads = 0;
    let extraPreloads = 0;
    const ProjectById = Resource.family<string, { readonly id: string; readonly name: string }>({
      name: "Start.FileRoutePreloadHelper.projectById",
      load: (id) =>
        Effect.sync(() => {
          resourceLoads += 1;
          return { id, name: "Atlas" };
        }),
    });
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.FileRoutePreloadHelper.projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          collectionLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-projects/:id");
    const preload = ProjectRouteBuilder.preload(
      {
        params: Schema.Struct({ id: Schema.String }),
        resources: ({ resource }) => [resource(ProjectById, ({ params }) => params.id)],
        collections: [Projects],
      },
      ({ params }) =>
        Effect.sync(() => {
          if (params.id === "atlas") {
            extraPreloads += 1;
          }
        }),
    );
    const ProjectRoute = preload.route();
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    expect(Object.keys(preload)).not.toContain("route");

    expect(Route.describePreloadResources(ProjectRoute)).toEqual({
      status: "declared",
      families: ["Start.FileRoutePreloadHelper.projectById"],
    });
    expect(Route.describePreloadCollections(ProjectRoute)).toEqual({
      status: "declared",
      collections: ["Start.FileRoutePreloadHelper.projects"],
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/file-helper-projects/atlas")),
    );

    expect(resourceLoads).toBe(1);
    expect(collectionLoads).toBe(1);
    expect(extraPreloads).toBe(1);
    expect(result.resources.resources.map((resource) => resource.name)).toEqual([
      "Start.FileRoutePreloadHelper.projectById",
    ]);
    expect(result.collectionPreload.routeDeclaredCollections).toEqual([Projects]);
  });

  it("allows file route preload helpers to declare collections by name", async () => {
    let collectionLoads = 0;
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.FileRoutePreloadHelper.named-projects",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          collectionLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-named-projects");
    const preload = ProjectRouteBuilder.preload({
      collections: [Projects.name],
    });
    const ProjectRoute = preload.route();
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    expect(Route.describePreloadCollections(ProjectRoute)).toEqual({
      status: "declared",
      collections: [Projects.name],
    });

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/file-helper-named-projects"), {
        collectionRegistry: Collection.defaultRegistry,
      }),
    );

    expect(collectionLoads).toBe(1);
    expect(result.collectionPreload.routeDeclaredCollections).toEqual([Projects]);
    expect(result.collections.collections.map((collection) => collection.name)).toEqual([
      Projects.name,
    ]);
  });

  it("rejects Promise-shaped file route preload helper work as typed preload failure", async () => {
    const ProjectRouteBuilder = defineFileRoute("/file-helper-promise");
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({}, (() => Effect.runPromise(Effect.void)) as never),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(preloadRequest(app, new Request("https://example.com/file-helper-promise"))),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "custom-preload",
      path: "/file-helper-promise",
    });
    expect((routeFailure.cause as FileRoutePreloadError).guidance).toContain("Effect.tryPromise");
  });

  it("rejects file route preload helper work with throwing then getters as typed preload failure", async () => {
    const ProjectRouteBuilder = defineFileRoute("/file-helper-throwing-then");
    const throwingThen = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      },
    });
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({}, (() => throwingThen) as never),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-throwing-then")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "custom-preload",
      path: "/file-helper-throwing-then",
    });
    expect((routeFailure.cause as FileRoutePreloadError).guidance).toContain("Effect.tryPromise");
  });

  it("rejects Promise-shaped file route resource selector output as typed preload failure", async () => {
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "Start.FileRoutePreloadHelper.promise-selector.projectById",
      load: (id) => Effect.succeed({ id }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-promise-selector");
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({
        resources: [
          ProjectRouteBuilder.resource(ProjectById, (() =>
            Effect.runPromise(Effect.succeed("atlas"))) as never),
        ],
      }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-promise-selector")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "resource-selector",
      path: "/file-helper-promise-selector",
    });
    expect((routeFailure.cause as FileRoutePreloadError).guidance).toContain("Effect.tryPromise");
  });

  it("rejects file route resource selector output with throwing then getters as typed preload failure", async () => {
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "Start.FileRoutePreloadHelper.throwing-then-selector.projectById",
      load: (id) => Effect.succeed({ id }),
    });
    const throwingThen = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      },
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-throwing-then-selector");
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({
        resources: [ProjectRouteBuilder.resource(ProjectById, (() => throwingThen) as never)],
      }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-throwing-then-selector")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "resource-selector",
      path: "/file-helper-throwing-then-selector",
    });
    expect((routeFailure.cause as FileRoutePreloadError).guidance).toContain("Effect.tryPromise");
  });

  it("rejects public file route resource refs returning Promise-shaped work as typed preload failure", async () => {
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "Start.FileRoutePreloadHelper.promise-resource-refs.projectById",
      load: (id) => Effect.succeed({ id }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-promise-resource-refs");
    const resource: FileRoutePreloadResource<"/file-helper-promise-resource-refs"> = {
      family: { name: ProjectById.family.options.name },
      refs: (() => Effect.runPromise(Effect.succeed([ProjectById("atlas")]))) as never,
    };
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({
        resources: [resource],
      }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-promise-resource-refs")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "resource-selector",
      path: "/file-helper-promise-resource-refs",
    });
    expect((routeFailure.cause as FileRoutePreloadError).guidance).toContain("Effect.tryPromise");
  });

  it("rejects public file route resource refs returning malformed data as typed preload failure", async () => {
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "Start.FileRoutePreloadHelper.malformed-resource-refs.projectById",
      load: (id) => Effect.succeed({ id }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-malformed-resource-refs");
    const resource: FileRoutePreloadResource<"/file-helper-malformed-resource-refs"> = {
      family: { name: ProjectById.family.options.name },
      refs: (() => ({ key: ProjectById("atlas").key })) as never,
    };
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({
        resources: [resource],
      }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-malformed-resource-refs")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "resource-selector",
      path: "/file-helper-malformed-resource-refs",
      cause: expect.any(TypeError),
    });
  });

  it("captures thrown file route resource selectors as typed preload failure", async () => {
    const thrown = new Error("bad resource selector");
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "Start.FileRoutePreloadHelper.selector-error.projectById",
      load: (id) => Effect.succeed({ id }),
    });
    const ProjectRouteBuilder = defineFileRoute("/file-helper-selector-error/:id");
    const ProjectRoute = ProjectRouteBuilder({
      ...ProjectRouteBuilder.preload({
        resources: [
          ProjectRouteBuilder.resource(ProjectById, () => {
            throw thrown;
          }),
        ],
      }),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/file-helper-selector-error/atlas")),
      ),
    );

    expect(failure).toBeInstanceOf(StartPreloadError);
    expect(failure.operation).toBe("route-navigation");
    expect(failure.cause).toBeInstanceOf(RoutePreloadError);
    const routeFailure = failure.cause as RoutePreloadError;
    expect(routeFailure.cause).toBeInstanceOf(FileRoutePreloadError);
    expect(routeFailure.cause).toMatchObject({
      operation: "resource-selector",
      path: "/file-helper-selector-error/:id",
      cause: thrown,
    });
  });

  it("resolves route-declared collections from registered request collections before the default registry", async () => {
    let projectLoads = 0;
    const registry = Collection.makeRegistry();
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>(
      {
        name: "Start.Collection.route-declared.isolated-projects",
        getKey: (project) => project.id,
        load: () =>
          Effect.sync(() => {
            projectLoads += 1;
            return [{ id: "atlas", name: "Atlas" }];
          }),
      },
      registry,
    );
    const ProjectRoute = route("/isolated-declared-projects", {
      preloadCollections: [Projects],
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    expect(Collection.definitions().has(Projects.name)).toBe(false);

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/isolated-declared-projects"), {
        collections: [Projects],
      }),
    );

    expect(projectLoads).toBe(1);
    expect(result.collectionPreload.routeDeclaredCollections).toEqual([Projects]);
    expect(result.collectionPreload.dehydratedCollections).toEqual([Projects]);
    expect(result.collections.collections[0]?.rows).toEqual([
      {
        key: "atlas",
        value: { id: "atlas", name: "Atlas" },
        synced: true,
        origin: "remote",
      },
    ]);
  });

  it("requires an explicit registry to resolve route-declared collection strings", async () => {
    let projectLoads = 0;
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.route-declared.default-string",
      getKey: (project) => project.id,
      load: () =>
        Effect.sync(() => {
          projectLoads += 1;
          return [{ id: "atlas", name: "Atlas" }];
        }),
    });
    const ProjectRoute = route("/default-string-declared-projects", {
      preloadCollections: [Projects.name],
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    expect(Collection.definitions().get(Projects.name)).toBe(Projects);

    const error = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/default-string-declared-projects")),
      ),
    );

    expect(error).toBeInstanceOf(StartPreloadError);
    expect(error).toMatchObject({
      operation: "declared-collection-resolution",
      collectionName: Projects.name,
    });
    expect(projectLoads).toBe(0);

    const result = await Effect.runPromise(
      preloadRequest(app, new Request("https://example.com/default-string-declared-projects"), {
        collectionRegistry: Collection.defaultRegistry,
      }),
    );

    expect(projectLoads).toBe(1);
    expect(result.collectionPreload.routeDeclaredCollections).toEqual([Projects]);
    expect(result.collectionPreload.dehydratedCollections).toEqual([Projects]);
  });

  it("rejects duplicate direct collection definitions before route-declared name resolution", async () => {
    const name = "Start.Collection.route-declared.duplicate-direct";
    const PrimaryProjects = Collection.define<{ readonly id: string; readonly name: string }>({
      name,
      getKey: (project) => project.id,
      load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
    });
    const ShadowProjects = Collection.define<{ readonly slug: string; readonly title: string }>({
      name,
      getKey: (project) => project.slug,
      load: () => Effect.succeed([{ slug: "shadow", title: "Shadow" }]),
    });
    const ProjectRoute = route("/duplicate-direct-declared-projects", {
      preloadCollections: [name],
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });

    const error = await Effect.runPromise(
      Effect.flip(
        preloadRequest(app, new Request("https://example.com/duplicate-direct-declared-projects"), {
          collections: [PrimaryProjects, ShadowProjects],
        }),
      ),
    );

    expect(error).toBeInstanceOf(StartPreloadError);
    expect(error).toMatchObject({
      operation: "declared-collection-resolution",
      collectionName: name,
    });
    expect(error.cause).toBeInstanceOf(StartCollectionDuplicateName);
  });

  it("preloads and renders with an app server layer", async () => {
    interface Projects {
      readonly get: (id: string) => Effect.Effect<{ readonly id: string; readonly name: string }>;
    }
    const Projects = Context.Service<Projects>("@effect-ui/start/test/Projects");
    const ProjectsLive = Layer.succeed(Projects)({
      get: (id) => Effect.succeed({ id, name: "Layered Atlas" }),
    });
    const Project = Resource.family({
      name: "Start.Project.layered",
      load: (id: string) => Projects.use((projects) => projects.get(id)),
    });
    const ProjectRoute = route("/projects/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
      server: ProjectsLive,
    });

    const result = await Effect.runPromise(
      preloadRequestEffect(app, new Request("https://example.com/projects/atlas")),
    );
    const response = await Effect.runPromise(
      createRequestHandlerEffect(app, {
        render: ({ resources }) =>
          Effect.succeed(`<html><body>${resources.resources[0]?.state.value.name}</body></html>`),
      })(new Request("https://example.com/projects/atlas")),
    );

    expect(result.resources.resources[0]?.state.value).toEqual({
      id: "atlas",
      name: "Layered Atlas",
    });
    await expect(response.text()).resolves.toContain("Layered Atlas");
  });

  it("keeps request runtime fibers alive until streamed response bodies close", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    let interrupted = false;
    let fiberCount: (() => number) | undefined;
    const handler = createRequestHandler(app, {
      render: ({ runtime }) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
            Effect.forkDetach({ startImmediately: true }),
          );
          runtime.resourceStore.fiberRegistry.track(fiber as Fiber.Fiber<unknown, never>);
          fiberCount = () => runtime.resourceStore.fiberRegistry.size();

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

    const response = await Effect.runPromise(handler(new Request("https://example.com/")));

    expect(interrupted).toBe(false);
    expect(fiberCount?.()).toBe(1);
    await expect(response.text()).resolves.toContain("streamed");
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(fiberCount?.()).toBe(0);
    expect(interrupted).toBe(true);
  });

  it("emits request traces when streamed responses are cancelled", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
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
      handler(
        new Request("https://example.com/", {
          headers: {
            "x-effect-ui-request-id": "req-cancel",
          },
        }),
      ),
    );
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
    });
    await reader.cancel("client-disconnect");

    expect(cancelled).toBe("client-disconnect");
    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-cancel",
          transport: "ssr",
        }),
        status: "cancelled",
        streams: [
          expect.objectContaining({
            name: "response",
            state: "cancelled",
          }),
        ],
        fibers: [
          {
            name: "request-runtime",
            status: "interrupted",
          },
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "client-disconnect",
          durationMillis: expect.any(Number),
          beforeDispose: expect.objectContaining({
            fiberCount: expect.any(Number),
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0,
          }),
        }),
      }),
    ]);
  });

  it("records Start stream failure phases in request trace stream summaries", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () =>
        createHtmlResponseEffect({
          shell: "<html>",
          chunks: Stream.fail("render chunk failed"),
        }),
    });

    const response = await Effect.runPromise(
      handler(
        new Request("https://example.com/", {
          headers: {
            "x-effect-ui-request-id": "req-stream-failure",
          },
        }),
      ),
    );
    await expect(response.text()).rejects.toBeDefined();

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-stream-failure",
          transport: "ssr",
        }),
        status: "failure",
        failureKind: "domain",
        streams: [
          expect.objectContaining({
            name: "response",
            state: "errored",
            failurePhase: "Chunk",
          }),
        ],
        fibers: [
          {
            name: "request-runtime",
            status: "failed",
          },
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "stream-error",
        }),
      }),
    ]);
  });

  it("records Effect metrics for Start request handling", () => {
    const ObservedRoute = route("/observed-metrics", {});
    const app = defineApp({
      routes: [ObservedRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      render: ({ match }) => `<main>${match?.href}</main>`,
    });
    const attributes = {
      transport: "ssr",
      method: "GET",
      path: "/observed-metrics",
    };
    const requestCount = Metric.withAttributes(startRequestCountMetric, attributes);
    const requestDuration = Metric.withAttributes(startRequestDurationMetric, attributes);
    const requestStatus = Metric.withAttributes(startRequestStatusMetric, {
      ...attributes,
      status: "success",
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const beforeCount = yield* Metric.value(requestCount);
        const beforeDuration = yield* Metric.value(requestDuration);
        const beforeStatus = yield* Metric.value(requestStatus);
        const beforeSuccessCount = beforeStatus.occurrences.get("success") ?? 0;

        const response = yield* handler(new Request("https://example.com/observed-metrics"));
        const text = yield* Effect.tryPromise(() => response.text());
        const afterCount = yield* Metric.value(requestCount);
        const afterDuration = yield* Metric.value(requestDuration);
        const afterStatus = yield* Metric.value(requestStatus);

        yield* Effect.sync(() => {
          expect(text).toContain("/observed-metrics");
          expect(afterCount.count).toBe(beforeCount.count + 1);
          expect(afterDuration.count).toBe(beforeDuration.count + 1);
          expect(afterStatus.occurrences.get("success")).toBe(beforeSuccessCount + 1);
        });
      }),
    );
  });

  it("finalizes RPC failure request metrics from the request runtime finalization event", () => {
    const FailsDomain = Server.contract<{ readonly value: string }, string, string>(
      "Start.metrics.rpc.failure",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
        error: Schema.String,
      },
    );
    Server.implement(FailsDomain, () => Effect.fail("metrics-domain-failed"));
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app);
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
            body: JSON.stringify({
              name: FailsDomain.name,
              input: { value: "atlas" },
            }),
          }),
        );
        const body = yield* Effect.tryPromise(() => response.json());
        const afterDuration = yield* Metric.value(requestDuration);
        const afterSuccess = yield* Metric.value(requestSuccessStatus);
        const afterFailure = yield* Metric.value(requestFailureStatus);

        yield* Effect.sync(() => {
          expect(body).toEqual({
            _tag: "Failure",
            error: "metrics-domain-failed",
          });
          expect(afterDuration.count).toBe(beforeDuration.count + 1);
          expect(afterSuccess.occurrences.get("success") ?? 0).toBe(beforeSuccessCount);
          expect(afterFailure.occurrences.get("failure")).toBe(beforeFailureCount + 1);
        });
      }),
    );
  });

  it("waits for streamed close, error, or cancel before finalizing request metrics", () => {
    const CancelRoute = route("/metrics-cancel", {});
    const app = defineApp({
      routes: [CancelRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
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
        const afterDuration = yield* Metric.value(requestDuration);
        const afterCancelled = yield* Metric.value(requestCancelledStatus);

        yield* Effect.sync(() => {
          expect(midCount.count).toBe(beforeCount.count + 1);
          expect(midDuration.count).toBe(beforeDuration.count);
          expect(midCancelledCount).toBe(beforeCancelledCount);
          expect(afterDuration.count).toBe(beforeDuration.count + 1);
          expect(afterCancelled.occurrences.get("cancelled")).toBe(beforeCancelledCount + 1);
        });
      }),
    );
  });

  it("emits request traces when request handlers fail", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () => Effect.fail("render-failed"),
    });

    await expect(
      Effect.runPromise(
        handler(
          new Request("https://example.com/", {
            headers: {
              "x-effect-ui-request-id": "req-failure",
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "StartRequestHandlerError",
      cause: "render-failed",
    });

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-failure",
          transport: "ssr",
        }),
        status: "failure",
        failureKind: "domain",
        streams: [],
        fibers: [
          {
            name: "request-runtime",
            status: "failed",
          },
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "request-failure",
          durationMillis: expect.any(Number),
          beforeDispose: expect.objectContaining({
            fiberCount: expect.any(Number),
          }),
          afterDispose: expect.objectContaining({
            fiberCount: 0,
          }),
        }),
      }),
    ]);
  });

  it("preserves the original handler failure when request runtime cleanup fails", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: ({ runtime }) =>
        Effect.gen(function* () {
          runtime.resourceStore.moduleRegistry.register(Symbol("cleanup-failure"), {
            disposeEffect: Effect.fail("cleanup-failed"),
          });
          return yield* Effect.fail("render-failed");
        }),
    });

    await expect(
      Effect.runPromise(
        handler(
          new Request("https://example.com/", {
            headers: {
              "x-effect-ui-request-id": "req-cleanup-failure",
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "StartRequestHandlerError",
      cause: "render-failed",
    });

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-cleanup-failure",
        }),
        status: "failure",
        teardown: expect.objectContaining({
          runtimeDisposed: false,
          cleanupFailure: expect.objectContaining({
            _tag: "Failure",
            message: "cleanup-failed",
          }),
        }),
      }),
    ]);
  });

  it("emits cancelled request traces when handlers are interrupted before a response", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () => Effect.interrupt,
    });

    const exit = await Effect.runPromiseExit(
      handler(
        new Request("https://example.com/", {
          headers: {
            "x-effect-ui-request-id": "req-interrupted",
          },
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-interrupted",
          transport: "ssr",
        }),
        status: "cancelled",
        failureKind: "interruption",
        streams: [],
        fibers: [
          {
            name: "request-runtime",
            status: "interrupted",
          },
        ],
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "interruption",
          afterDispose: expect.objectContaining({
            fiberCount: 0,
          }),
        }),
      }),
    ]);
  });

  it("projects malformed trace cookies without throwing", () => {
    const trace = buildStartRequestTrace(
      new Request("https://example.com/", {
        headers: {
          cookie: "%E0%A4%A=secret",
        },
      }),
      {
        requestId: "req-malformed-cookie",
        transport: "ssr",
        startedAt: 0,
        collections: [],
        serverFunctions: [],
        actions: [],
      },
      "failure",
      {
        teardown: {
          runtimeDisposed: true,
        },
      },
    );

    expect(trace.request.cookies).toEqual([
      {
        name: "%E0%A4%A",
        value: "<redacted>",
      },
    ]);
    expect(trace.status).toBe("failure");
  });

  it("projects trace Set-Cookie counts as zero when the host omits getSetCookie", () => {
    const response = new Response("ok", {
      headers: {
        "set-cookie": "session=abc",
      },
    });
    Object.defineProperty(response.headers, "getSetCookie", {
      configurable: true,
      value: undefined,
    });
    const trace = buildStartRequestTrace(
      new Request("https://example.com/"),
      {
        requestId: "req-no-get-set-cookie",
        transport: "ssr",
        startedAt: 0,
        collections: [],
        serverFunctions: [],
        actions: [],
      },
      "success",
      {
        response,
        teardown: {
          runtimeDisposed: true,
        },
      },
    );

    expect(trace.response?.setCookieCount).toBeUndefined();
  });

  it("reads request runtime teardown snapshots through ResourceStore diagnostics", async () => {
    const runtime = makeRuntime();
    runtime.resourceStore.moduleRegistry.register(Symbol("start-trace-module"), {});

    try {
      expect(requestRuntimeTeardownSnapshot(runtime)).toEqual({
        fiberCount: 0,
        familyCount: 0,
        moduleCount: 1,
        tagCount: 0,
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps Start source off unsafe mutable ResourceStore internals", () => {
    const offenders = sourceFiles(new URL("../src/", import.meta.url))
      .filter((file) => readFileSync(file, "utf8").includes("unsafeMutableResourceStore"))
      .map((file) => file.pathname);

    expect(offenders).toEqual([]);
  });

  it("keeps an Effect request handler as the host boundary", async () => {
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app);

    await expect(
      Effect.runPromise(handler(new Request("https://example.com/"))),
    ).resolves.toBeInstanceOf(Response);
  });

  it("reports synchronous render callback throws through the Start request Effect error", async () => {
    const thrown = new Error("render exploded");
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandlerEffect(app, {
      render: () => {
        throw thrown;
      },
    });

    const failure = await Effect.runPromise(
      Effect.flip(handler(new Request("https://example.com/"))),
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
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
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
              sameSite: "None",
            });
            return "<html><body>context</body></html>";
          }),
        ),
    });

    const response = await Effect.runPromise(handler(new Request("https://example.com/")));

    expect(response.status).toBe(202);
    expect(response.headers.get("x-effect-ui-render-context")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.getSetCookie()).toEqual(["theme=dark; Path=/; Secure; SameSite=None"]);
    await expect(response.text()).resolves.toContain("context");
  });

  it("fails invalid response context status through the typed Start request error path", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () =>
        ResponseContext.use((response) =>
          Effect.gen(function* () {
            yield* response.setStatus(99);
            return "<html><body>invalid status</body></html>";
          }),
        ),
    });

    const failure = await Effect.runPromise(
      Effect.flip(handler(new Request("https://example.com/invalid-status"))),
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
    expect(traces).toEqual([
      expect.objectContaining({
        status: "failure",
        teardown: expect.objectContaining({
          runtimeDisposed: true,
          reason: "request-failure",
          afterDispose: expect.objectContaining({
            fiberCount: 0,
          }),
        }),
      }),
    ]);
  });

  it("runs returned Start render effects with the request runtime as ambient", async () => {
    const Project = Resource.family<string, { readonly id: string; readonly name: string }>({
      name: "Start.render.ambient.project",
      load: (id) => Effect.succeed({ id, name: `Project ${id}` }),
    });
    const ProjectRoute = route("/projects/:id", {
      preload: ({ params }) => Resource.prefetchEffect(Project(params.id)),
    });
    const app = defineApp({
      routes: [ProjectRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      render: () =>
        Effect.sync(() => {
          const project = Resource.read(Project("atlas"));
          return `<html><body>${project.name}</body></html>`;
        }),
    });

    const response = await Effect.runPromise(
      handler(new Request("https://example.com/projects/atlas")),
    );

    await expect(response.text()).resolves.toContain("Project atlas");
  });

  it("serves server functions over the Start RPC endpoint", async () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.rpc",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.implement(Echo, ({ value }) =>
      ResponseContext.use((response) =>
        Effect.gen(function* () {
          yield* response.setHeader("x-effect-ui-rpc-context", "yes");
          yield* response.setCookie("rpc", value, { path: "/rpc" });
          return { value: value.toUpperCase() };
        }),
      ),
    );
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const response = await Effect.runPromise(
      createServerRpcResponseEffect(
        app,
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: echo.name,
            input: { value: "ada" },
          }),
        }),
      ),
    );

    await expect(response.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" },
    });
    expect(response.headers.get("x-effect-ui-rpc-context")).toBe("yes");
    expect(response.headers.getSetCookie()).toEqual(["rpc=ada; Path=/rpc"]);
  });

  it("finalizes transport diagnostics after ResponseContext headers", async () => {
    const SpoofRpc = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.transport-diagnostics",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
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
    const SpoofAction = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.transport-diagnostics",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) =>
        ResponseContext.use((response) =>
          Effect.gen(function* () {
            yield* response.setHeader(startRequestIdHeader, "spoofed-action");
            yield* response.setHeader(startTransportKindHeader, "spoofed-action");
            yield* response.setHeader(startTransportProtocolHeader, "spoofed-action");
            return { value: value.toUpperCase() };
          }),
        ),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });

    const rpcResponse = await Effect.runPromise(
      createServerRpcResponseEffect(
        app,
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [startRequestIdHeader]: "req-rpc-authoritative",
          },
          body: JSON.stringify({
            name: spoofRpc.name,
            input: { value: "ada" },
          }),
        }),
      ),
    );
    const actionResponse = await Effect.runPromise(
      createServerActionResponseEffect(
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
    );

    await expect(rpcResponse.json()).resolves.toEqual({
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

  it("maps non-JSON-safe RPC and action response bodies to defect responses", async () => {
    const BigRpc = Server.contract<null, bigint>("Start.bigint.rpc");
    const bigRpc = Server.implement(BigRpc, () => Effect.succeed(1n));
    const BigAction = Action.define<null, bigint>({
      name: "Start.bigint.action",
      run: () => Effect.succeed(1n),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const rpcResponse = await Effect.runPromise(
      createServerRpcResponseEffect(
        app,
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: bigRpc.name,
            input: null,
          }),
        }),
      ),
    );
    const actionResponse = await Effect.runPromise(
      createServerActionResponseEffect(
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
    );

    expect(rpcResponse.status).toBe(500);
    await expect(rpcResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });
    expect(actionResponse.status).toBe(500);
    await expect(actionResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });
  });

  it("emits request traces for RPC and Start action transports", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.trace",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: value.toUpperCase() }),
    );
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.trace.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [Ping],
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
    });

    const rpcResponse = await Effect.runPromise(
      handler(
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-effect-ui-request-id": "req-rpc-trace",
          },
          body: JSON.stringify({
            name: echo.name,
            input: { value: "ada" },
          }),
        }),
      ),
    );
    await expect(rpcResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "ADA" },
    });
    expect(rpcResponse.headers.get(startRequestIdHeader)).toBe("req-rpc-trace");

    const actionResponse = await Effect.runPromise(
      handler(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-effect-ui-request-id": "req-action-trace",
          },
          body: JSON.stringify({
            name: Ping.name,
            input: { value: "pong" },
          }),
        }),
      ),
    );
    await expect(actionResponse.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "PONG" },
    });
    expect(actionResponse.headers.get(startRequestIdHeader)).toBe("req-action-trace");

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-rpc-trace",
          transport: "rpc",
          path: serverRpcPath,
        }),
        serverFunctions: [
          {
            name: echo.name,
            status: "success",
          },
        ],
        actions: [],
        status: "success",
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-action-trace",
          transport: "action",
          path: serverActionPath,
        }),
        serverFunctions: [],
        actions: [
          {
            name: Ping.name,
            state: "Success",
          },
        ],
        status: "success",
      }),
    ]);
  });

  it("uses one generated request id for transport diagnostics and request traces", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.trace.generated-id",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.implement(Echo, ({ value }) => Effect.succeed({ value }));
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
    });

    const response = await Effect.runPromise(
      handler(
        new Request(`https://example.com${serverRpcPath}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: echo.name,
            input: { value: "ada" },
          }),
        }),
      ),
    );
    await expect(response.json()).resolves.toEqual({
      _tag: "Success",
      value: { value: "ada" },
    });

    expect(traces).toHaveLength(1);
    expect(response.headers.get(startRequestIdHeader)).toBe(traces[0]!.request.id);
  });

  it("uses manifest transport endpoint paths for handler routing, traces, and clients", async () => {
    const endpoints = {
      serverFunctions: { rpcPath: "/custom/start-rpc" },
      actions: { actionPath: "/custom/start-action" },
    } as const;
    const traces: DevtoolsRequestTrace[] = [];
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.custom-endpoint",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.client(Echo);
    Server.implement(Echo, ({ value }) => Effect.succeed({ value: `rpc:${value}` }));
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.custom-endpoint",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `action:${value}` }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [Ping],
      appGraph: endpoints,
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
    });
    const fetcher: StartFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };
    const rpcRuntime = Layer.succeed(ServerClient)(
      makeRpcClient({
        fetch: fetcher,
        serverFunctionManifest: endpoints.serverFunctions,
      }),
    );

    await expect(
      Effect.runPromise(Effect.provide(echo.effect({ value: "atlas" }), rpcRuntime)),
    ).resolves.toEqual({ value: "rpc:atlas" });

    await expect(
      Effect.runPromise(
        submitStartActionEffect(
          Ping,
          { value: "submit" },
          {
            fetch: fetcher,
            actionManifest: endpoints.actions,
          },
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "Success",
      value: { value: "action:submit" },
    });

    const startPing = StartAction.use(Ping, {
      fetch: fetcher,
      actionManifest: endpoints.actions,
    });
    await expect(
      Effect.runPromise(startPing.submitEffect({ value: "stateful" })),
    ).resolves.toMatchObject({
      _tag: "Success",
      value: { value: "action:stateful" },
    });

    expect(StartAction.form(Ping, { actionManifest: endpoints.actions }).action).toBe(
      endpoints.actions.actionPath,
    );
    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          transport: "rpc",
          path: endpoints.serverFunctions.rpcPath,
        }),
        serverFunctions: [
          {
            name: Echo.name,
            status: "success",
          },
        ],
        status: "success",
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          transport: "action",
          path: endpoints.actions.actionPath,
        }),
        actions: [
          {
            name: Ping.name,
            state: "Success",
          },
        ],
        status: "success",
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          transport: "action",
          path: endpoints.actions.actionPath,
        }),
        actions: [
          {
            name: Ping.name,
            state: "Success",
          },
        ],
        status: "success",
      }),
    ]);
  });

  it("rejects invalid direct endpoint paths while preserving explicit adapter URLs", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.endpoint-policy",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const calls: string[] = [];
    const fetcher: StartFetch = (input) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
            value: { value: "ok" },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );
    };

    expect(() => resolveStartTransportEndpoints({ rpcPath: "rpc" })).toThrow(
      StartTransportEndpointPathError,
    );
    expect(() =>
      resolveStartTransportEndpoints({ actionPath: "https://example.com/action" }),
    ).toThrow(StartTransportEndpointPathError);
    expect(() => resolveStartTransportEndpoints({ rpcPath: "/same", actionPath: "/same" })).toThrow(
      StartTransportEndpointConflictError,
    );
    const invalidPathHandlerExit = await Effect.runPromiseExit(
      createRequestHandlerEffect(app, { rpcPath: "/__effect-ui/rpc\nx" })(
        new Request("https://example.com/"),
      ),
    );
    const collidingHandlerExit = await Effect.runPromiseExit(
      createRequestHandlerEffect(app, { rpcPath: "/same", actionPath: "/same" })(
        new Request("https://example.com/"),
      ),
    );
    const invalidPathHandlerFailure = Exit.isFailure(invalidPathHandlerExit)
      ? firstFailure(invalidPathHandlerExit.cause)
      : undefined;
    const collidingHandlerFailure = Exit.isFailure(collidingHandlerExit)
      ? firstFailure(collidingHandlerExit.cause)
      : undefined;

    expect(invalidPathHandlerFailure).toBeInstanceOf(StartRequestHandlerError);
    expect(
      (invalidPathHandlerFailure as StartRequestHandlerError | undefined)?.cause,
    ).toBeInstanceOf(StartTransportEndpointPathError);
    expect(collidingHandlerFailure).toBeInstanceOf(StartRequestHandlerError);
    expect((collidingHandlerFailure as StartRequestHandlerError | undefined)?.cause).toBeInstanceOf(
      StartTransportEndpointConflictError,
    );
    expect(() =>
      shouldHandleSsrRequest(
        { method: "POST", url: "/__effect-ui/rpc", headers: {} },
        { rpcPath: "https://example.com/rpc" },
      ),
    ).toThrow(StartTransportEndpointPathError);
    expect(() =>
      shouldHandleSsrRequest(
        { method: "POST", url: "/same", headers: {} },
        { rpcPath: "/same", actionPath: "/same" },
      ),
    ).toThrow(StartTransportEndpointConflictError);
    expect(resolveStartRpcEndpoint({ endpoint: "https://api.example.test/rpc" })).toBe(
      "https://api.example.test/rpc",
    );
    expect(resolveStartActionEndpoint({ action: "https://forms.example.test/action" })).toBe(
      "https://forms.example.test/action",
    );
    expect(() => StartAction.form(Ping, { actionPath: "https://example.com/action" })).toThrow(
      StartTransportEndpointPathError,
    );
    expect(StartAction.form(Ping, { action: "https://forms.example.test/action" }).action).toBe(
      "https://forms.example.test/action",
    );

    await expect(
      Effect.runPromise(
        submitStartActionEffect(
          Ping,
          { value: "ok" },
          {
            fetch: fetcher,
            endpoint: "https://api.example.test/action",
          },
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "Success",
      value: { value: "ok" },
    });
    expect(calls).toEqual(["https://api.example.test/action"]);
  });

  it("rejects RPC/action endpoint collisions at graph and diagnostics seams", async () => {
    const graphExit = await Effect.runPromiseExit(
      makeStartBuildAppGraphEffect({
        rpcPath: "/same",
        actionPath: "/same",
      }),
    );
    const graphFailure = Exit.isFailure(graphExit) ? firstFailure(graphExit.cause) : undefined;

    expect(graphFailure).toBeInstanceOf(StartTransportEndpointConflictError);

    const diagnosticsExit = await Effect.runPromiseExit(
      loadStartAppGraphDiagnosticsEffect({
        configFile: false,
        start: {
          rpcPath: "/same",
          actionPath: "/same",
        },
        vite: {
          configFile: false,
        },
      }),
    );
    const diagnosticsFailure = Exit.isFailure(diagnosticsExit)
      ? firstFailure(diagnosticsExit.cause)
      : undefined;

    expect(diagnosticsFailure).toBeInstanceOf(StartTransportEndpointConflictError);
  });

  it("classifies RPC and Start action request trace failures by layer", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const FailsDomain = Server.contract<{ readonly value: string }, string, string>(
      "Start.trace.failure.domain",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
        error: Schema.String,
      },
    );
    const failsDomain = Server.implement(FailsDomain, () => Effect.fail("domain-failed"));
    const ActionFailsDomain = Action.define<{ readonly value: string }, string, string>({
      name: "Start.trace.action.failure.domain",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.String,
      error: Schema.String,
      run: () => Effect.fail("action-domain-failed"),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [ActionFailsDomain],
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
    });
    const rpcRequest = (id: string, body: unknown, init: RequestInit = {}) =>
      new Request(`https://example.com${serverRpcPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-effect-ui-request-id": id,
          ...init.headers,
        },
        body: JSON.stringify(body),
      });
    const actionRequest = (id: string, body: unknown) =>
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-effect-ui-request-id": id,
        },
        body: JSON.stringify(body),
      });

    const rpcDomain = await Effect.runPromise(
      handler(
        rpcRequest("req-rpc-domain-failure", {
          name: failsDomain.name,
          input: { value: "ada" },
        }),
      ),
    );
    await expect(rpcDomain.json()).resolves.toEqual({
      _tag: "Failure",
      error: "domain-failed",
    });

    const rpcValidation = await Effect.runPromise(
      handler(
        rpcRequest("req-rpc-validation-failure", {
          name: failsDomain.name,
          input: { value: 1 },
        }),
      ),
    );
    expect(rpcValidation.status).toBe(400);
    await rpcValidation.text();

    const rpcProtocol = await Effect.runPromise(
      handler(
        rpcRequest("req-rpc-protocol-failure", {
          name: "Start.trace.missing",
          input: {},
        }),
      ),
    );
    expect(rpcProtocol.status).toBe(404);
    await rpcProtocol.text();

    const rpcTransport = await Effect.runPromise(
      handler(
        new Request(`https://example.com${serverRpcPath}`, {
          method: "GET",
          headers: {
            "x-effect-ui-request-id": "req-rpc-transport-failure",
          },
        }),
      ),
    );
    expect(rpcTransport.status).toBe(405);
    await rpcTransport.text();

    const actionDomain = await Effect.runPromise(
      handler(
        actionRequest("req-action-domain-failure", {
          name: ActionFailsDomain.name,
          input: { value: "ada" },
        }),
      ),
    );
    await expect(actionDomain.json()).resolves.toEqual({
      _tag: "Failure",
      error: "action-domain-failed",
    });

    const actionValidation = await Effect.runPromise(
      handler(
        actionRequest("req-action-validation-failure", {
          name: ActionFailsDomain.name,
          input: { value: 1 },
        }),
      ),
    );
    expect(actionValidation.status).toBe(400);
    await actionValidation.text();

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-rpc-domain-failure", transport: "rpc" }),
        status: "failure",
        failureKind: "domain",
        serverFunctions: [
          {
            name: failsDomain.name,
            status: "failure",
            failureKind: "domain",
          },
        ],
      }),
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-rpc-validation-failure", transport: "rpc" }),
        status: "failure",
        failureKind: "validation",
        serverFunctions: [
          {
            name: failsDomain.name,
            status: "failure",
            failureKind: "validation",
          },
        ],
      }),
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-rpc-protocol-failure", transport: "rpc" }),
        status: "failure",
        failureKind: "protocol",
        serverFunctions: [
          {
            name: "Start.trace.missing",
            status: "failure",
            failureKind: "protocol",
          },
        ],
      }),
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-rpc-transport-failure", transport: "rpc" }),
        status: "failure",
        failureKind: "transport",
        serverFunctions: [],
      }),
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-action-domain-failure", transport: "action" }),
        status: "failure",
        failureKind: "domain",
        actions: [
          {
            name: ActionFailsDomain.name,
            state: "Failure",
            failureKind: "domain",
          },
        ],
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          id: "req-action-validation-failure",
          transport: "action",
        }),
        status: "failure",
        failureKind: "validation",
        actions: [
          {
            name: ActionFailsDomain.name,
            state: "Failure",
            failureKind: "validation",
          },
        ],
      }),
    ]);
  });

  it("classifies Start action response encoding and hydration metadata defects in request traces", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const Project = Resource.family({
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
          yield* Resource.prefetchEffect(Project(id));
          return { ok: true };
        }),
      invalidates: (_result, input) => [Project(input.id)],
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [BadOutput, BadMeta],
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
    });
    const actionRequest = (id: string, name: string, input: unknown) =>
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-effect-ui-request-id": id,
        },
        body: JSON.stringify({ name, input }),
      });

    const outputResponse = await Effect.runPromise(
      handler(actionRequest("req-action-output-defect", BadOutput.name, { value: "ok" })),
    );
    expect(outputResponse.status).toBe(500);
    await expect(outputResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });

    const metaResponse = await Effect.runPromise(
      handler(actionRequest("req-action-meta-defect", BadMeta.name, { id: "atlas" })),
    );
    expect(metaResponse.status).toBe(500);
    await expect(metaResponse.json()).resolves.toMatchObject({
      _tag: "Defect",
    });

    expect(traces).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-action-output-defect", transport: "action" }),
        status: "failure",
        failureKind: "defect",
        actions: [
          {
            name: BadOutput.name,
            state: "Failure",
            failureKind: "defect",
          },
        ],
      }),
      expect.objectContaining({
        request: expect.objectContaining({ id: "req-action-meta-defect", transport: "action" }),
        status: "failure",
        failureKind: "defect",
        actions: [
          {
            name: BadMeta.name,
            state: "Failure",
            failureKind: "defect",
          },
        ],
      }),
    ]);
  });

  it("lets browser runtimes call server functions through ServerClient", async () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.echo.remote",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.client(Echo);
    Server.implement(Echo, ({ value }) => Effect.succeed({ value: `server:${value}` }));
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app);
    const fetcher: StartFetch = (input, init) => handler(new Request(input, init));
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        endpoint: `https://example.com${serverRpcPath}`,
        fetch: fetcher,
      }),
    );

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
    const Fail = Server.contract<string, string, ExampleErrorType>("Start.fail.remote", {
      input: Schema.String,
      output: Schema.String,
      error: ExampleError,
    });
    const fail = Server.client(Fail);
    Server.implement(Fail, () =>
      Effect.fail({ _tag: "ExampleError" as const, message: "not today" }),
    );
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app);
    const fetcher: StartFetch = (input, init) => handler(new Request(input, init));
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        endpoint: `https://example.com${serverRpcPath}`,
        fetch: fetcher,
      }),
    );
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
    const Names = Context.Service<Names>("@effect-ui/start/test/Names");
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
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
      server: NamesLive,
    });
    const handler = createRequestHandler(app, {
      actions: [SubmitName],
    });

    const validation = await Effect.runPromise(
      createServerActionResponseEffect(
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
    );
    const form = startActionForm(SubmitName, {
      input: {
        redirectTo: "/projects/atlas?tab=activity",
      },
    });
    const formBody = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value]),
    );
    formBody.set("name", "Atlas Forms");
    const redirect = await Effect.runPromise(
      handler(
        new Request(`https://example.com${form.action}`, {
          method: form.method.toUpperCase(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: formBody,
        }),
      ),
    );

    expect(validation.status).toBe(422);
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

    const jsonRequest = await Effect.runPromise(encodeStartActionRequestEffect(Submit, input));
    const form = startActionForm(Submit, { input });
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

  it("fails progressive form default encoding with typed errors for circular and BigInt inputs", () => {
    const Submit = Action.define<Record<string, unknown>, { readonly ok: boolean }>({
      name: "Start.action.codec.form-failure",
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => startActionForm(Submit, { input: circular })).toThrow(StartActionFormEncodeError);
    expect(() => startActionForm(Submit, { input: { count: 1n } })).toThrow(
      StartActionFormEncodeError,
    );
  });

  it("returns typed JSON redirects for form actions that explicitly accept JSON", async () => {
    const SubmitResult = Schema.TaggedUnion({
      Success: {
        value: Schema.Struct({ ok: Schema.Boolean }),
      },
      ValidationFailure: {
        fieldErrors: Schema.Struct({
          redirectTo: Schema.optional(Schema.Array(Schema.String)),
        }),
        formErrors: Schema.Array(Schema.String),
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
    const Submit = Action.define<
      { readonly redirectTo: string },
      ActionResult<{ readonly ok: boolean }, { readonly redirectTo: string }, string, string>
    >({
      name: "Start.action.form.accept-json",
      input: Schema.Struct({ redirectTo: Schema.String }),
      output: SubmitResult,
      run: ({ redirectTo }) =>
        Effect.succeed(ActionResult.redirect(redirectTo, { status: 303, replace: true })),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const form = startActionForm(Submit, { input: { redirectTo: "/projects/json" } });
    const formBody = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value]),
    );
    const response = await Effect.runPromise(
      createRequestHandler(app, { actions: [Submit] })(
        new Request(`https://example.com${form.action}`, {
          method: form.method.toUpperCase(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: formBody,
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      _tag: "Redirect",
      location: "/projects/json",
      status: 303,
      replace: true,
    });
  });

  it("honors Accept quality when choosing form action redirect responses", async () => {
    const SubmitResult = Schema.TaggedUnion({
      Success: {
        value: Schema.Struct({ ok: Schema.Boolean }),
      },
      ValidationFailure: {
        fieldErrors: Schema.Struct({
          redirectTo: Schema.optional(Schema.Array(Schema.String)),
        }),
        formErrors: Schema.Array(Schema.String),
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
    const Submit = Action.define<
      { readonly redirectTo: string },
      ActionResult<{ readonly ok: boolean }, { readonly redirectTo: string }, string, string>
    >({
      name: "Start.action.form.accept-quality",
      input: Schema.Struct({ redirectTo: Schema.String }),
      output: SubmitResult,
      run: ({ redirectTo }) => Effect.succeed(ActionResult.redirect(redirectTo, { status: 303 })),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const form = startActionForm(Submit, { input: { redirectTo: "/projects/html" } });
    const formBody = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value]),
    );
    const response = await Effect.runPromise(
      createRequestHandler(app, { actions: [Submit] })(
        new Request(`https://example.com${form.action}`, {
          method: form.method.toUpperCase(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "text/html, application/json;q=0.1",
          },
          body: formBody,
        }),
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/html");
  });

  it("discovers Start actions from the Action registry when no explicit list is supplied", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.registry.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const response = await Effect.runPromise(
      createRequestHandler(app)(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: Ping.name,
            input: { value: "registry" },
          }),
        }),
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
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: explicitActions.iterable,
    });
    const submit = (value: string) =>
      Effect.runPromise(
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
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });

    expect(() =>
      createRequestHandler(app, {
        actions: [First, Second],
      }),
    ).toThrow(StartActionDuplicateName);
  });

  it("uses the app registry snapshot for RPC and action dispatch", () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.registry.snapshot.echo",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const echo = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: value.toUpperCase() }),
    );
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.registry.snapshot.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        Server.clearRegistryUnsafe();
        Action.clearRegistryUnsafe();
        const handler = createRequestHandler(app);
        const rpc = yield* handler(
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: echo.name,
              input: { value: "snapshot" },
            }),
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

        const rpcBody = yield* Effect.tryPromise(() => rpc.json());
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
    );
  });

  it("dispatches RPC and actions from an explicit app-local registry", () => {
    const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
      "Start.registry.local.echo",
      {
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
      },
    );
    const localEcho = Server.implement(Echo, ({ value }) =>
      Effect.succeed({ value: `local:${value}` }),
    );
    const LocalPing = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.registry.local.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: `local:${value}` }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
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
      Effect.gen(function* () {
        const handler = createRequestHandler(app);
        const rpc = yield* handler(
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: localEcho.name,
              input: { value: "registry" },
            }),
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

        const rpcBody = yield* Effect.tryPromise(() => rpc.json());
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
    const Project = Resource.family({
      name: "Start.action.Project.hydration",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
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
      invalidates: (_project, input) => [Project(input.id)],
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: StartFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };

    try {
      await runInRuntime(clientRuntime, Resource.prefetchEffect(ref));

      const result = await Effect.runPromise(
        submitStartActionEffect(
          RenameProject,
          { id: "atlas", name: "Renamed From Server" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toMatchObject({
        _tag: "Success",
        value: {
          id: "atlas",
          name: "Renamed From Server",
        },
        invalidation: {
          entries: [
            {
              ref: {
                key: ref.key,
                family: "Start.action.Project.hydration",
                input: "atlas",
              },
            },
          ],
        },
        hydration: {
          resources: [
            {
              key: ref.key,
              state: {
                value: {
                  id: "atlas",
                  name: "Renamed From Server",
                },
              },
            },
          ],
        },
      });
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed From Server",
      });

      const action = StartAction.use(RenameProject, {
        fetch: fetcher,
        runtime: clientRuntime,
      });
      await expect(
        Effect.runPromise(
          action.submitEffect({ id: "atlas", name: "Renamed Through StartAction" }),
        ),
      ).resolves.toMatchObject({
        _tag: "Success",
        value: {
          id: "atlas",
          name: "Renamed Through StartAction",
        },
      });
      expect(action.invalidation.get()).toMatchObject({
        entries: [
          {
            ref: {
              key: ref.key,
              family: "Start.action.Project.hydration",
              input: "atlas",
            },
          },
        ],
      });
      expect(action.hydration.get()).toMatchObject({
        resources: [
          {
            key: ref.key,
            state: {
              value: {
                id: "atlas",
                name: "Renamed Through StartAction",
              },
            },
          },
        ],
      });
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed Through StartAction",
      });
    } finally {
      await Effect.runPromise(clientRuntime.disposeEffect);
    }
  });

  it("does not suppress invalidations for a different hydrated resource family", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    class FamilyLocalKeyResource<A> extends ResourceFamily<string, A> {
      override ref(input: string): ResourceRef<string, A> {
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
    const TouchProject = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
      name: "Start.action.project.identity-refresh",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => Effect.succeed({ ok: true }),
    });
    const clientRuntime = makeRuntime();
    const hydratedRef = HydratedProject.ref("atlas");
    const invalidatedRef = InvalidatedProject.ref("atlas");
    const fetcher: StartFetch = () =>
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
                    updatedAt: 1,
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
      await runInRuntime(clientRuntime, Resource.prefetchEffect(hydratedRef));
      await runInRuntime(clientRuntime, Resource.prefetchEffect(invalidatedRef));
      invalidatedProject = {
        id: "atlas",
        name: "Invalidated By Action",
      };

      await expect(
        Effect.runPromise(
          submitStartActionEffect(
            TouchProject,
            { id: "atlas" },
            {
              fetch: fetcher,
              runtime: clientRuntime,
            },
          ),
        ),
      ).resolves.toMatchObject({
        _tag: "Success",
        value: {
          ok: true,
        },
      });

      expect(hydratedRef.key).toBe(invalidatedRef.key);
      expect(HydratedProject.options.name).not.toBe(InvalidatedProject.options.name);
      expect(runWithRuntime(clientRuntime, () => Resource.status(hydratedRef).value)).toEqual({
        id: "atlas",
        name: "Hydrated By Action",
      });
      expect(runWithRuntime(clientRuntime, () => Resource.status(invalidatedRef).value)).toEqual({
        id: "atlas",
        name: "Invalidated By Action",
      });
    } finally {
      await Effect.runPromise(clientRuntime.disposeEffect);
    }
  });

  it("applies uncaptured StartAction response metadata to the caller runtime", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    let project = {
      id: "atlas",
      name: "Initial",
    };
    const Project = Resource.family({
      name: "Start.action.client.caller-runtime",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.client.caller-runtime.rename",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) =>
        Effect.sync(() => {
          project = { id, name };
          return project;
        }),
      invalidates: (_project, input) => [Project(input.id)],
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject],
    });
    const runtime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: StartFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };
    const action = StartAction.use(RenameProject, { fetch: fetcher });

    try {
      await runInRuntime(runtime, Resource.prefetchEffect(ref));
      expect(runWithRuntime(defaultRuntime, () => Resource.status(ref)._tag)).toBe("Initial");

      await expect(
        runInRuntime(runtime, action.submitEffect({ id: "atlas", name: "Caller Runtime" })),
      ).resolves.toMatchObject({
        _tag: "Success",
        value: {
          id: "atlas",
          name: "Caller Runtime",
        },
      });

      expect(runWithRuntime(runtime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Caller Runtime",
      });
      expect(runWithRuntime(defaultRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("decodes Start action client success values with the action output schema", async () => {
    const ProjectSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.client.decode",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) => Effect.succeed({ id, name }),
    });
    const badFetch: StartFetch = () =>
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
      submitStartActionEffect(RenameProject, { id: "atlas", name: "Atlas" }, { fetch: badFetch }),
    );

    expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined).toBeInstanceOf(
      Schema.SchemaError,
    );
  });

  it("rejects successful Start action bodies carried by failing HTTP statuses", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.success-bad-status",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const fetcher: StartFetch = () =>
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
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: fetcher }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ServerTransportError);
    expect(failure).toMatchObject({
      reason: "BadStatus",
      status: 500,
      payload: {
        _tag: "Success",
      },
    });
  });

  it("requires Start action validation bodies to use HTTP 422", async () => {
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
    const Ping = Action.define<{ readonly value: string }, PingResult>({
      name: "Start.action.client.validation-status",
      input: Schema.Struct({ value: Schema.String }),
      output: PingResult,
      run: ({ value }) => Effect.succeed(ActionResult.success({ value })),
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
      (status: number): StartFetch =>
      () =>
        Effect.succeed(
          new Response(JSON.stringify(validationBody), {
            status,
            headers: { "content-type": "application/json" },
          }),
        );

    const badExit = await Effect.runPromiseExit(
      submitStartActionEffect(Ping, { value: "x" }, { fetch: validationWithStatus(200) }),
    );
    const ok = await Effect.runPromise(
      submitStartActionEffect(Ping, { value: "x" }, { fetch: validationWithStatus(422) }),
    );
    const failure = Exit.isFailure(badExit) ? firstFailure(badExit.cause) : undefined;

    expect(failure).toBeInstanceOf(ServerTransportError);
    expect(failure).toMatchObject({
      reason: "BadStatus",
      status: 200,
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
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.malformed-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const malformedInvalidation: StartFetch = () =>
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
    const malformedHydration: StartFetch = () =>
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
    const missingSuccessValue: StartFetch = () =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            _tag: "Success",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const missingRefInput: StartFetch = () =>
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
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: malformedInvalidation }),
    );
    const hydrationExit = await Effect.runPromiseExit(
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: malformedHydration }),
    );
    const missingSuccessValueExit = await Effect.runPromiseExit(
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: missingSuccessValue }),
    );
    const missingRefInputExit = await Effect.runPromiseExit(
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: missingRefInput }),
    );

    for (const exit of [
      invalidationExit,
      hydrationExit,
      missingSuccessValueExit,
      missingRefInputExit,
    ]) {
      const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
      expect(failure).toBeInstanceOf(ServerTransportError);
      expect(failure).toMatchObject({
        reason: "InvalidResponse",
        message: "Action response did not match the Effect UI Start action protocol.",
      });
    }
  });

  it("rejects semantically invalid Start action invalidation metadata", async () => {
    const Project = Resource.family({
      name: "Start.action.client.semantic-ref",
      load: (id: string) => Effect.succeed({ id }),
    });
    const validRef = Project("valid");
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.semantic-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const responseWithInvalidation =
      (invalidation: unknown): StartFetch =>
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
    const responseWithTarget = (target: unknown): StartFetch =>
      responseWithInvalidation({
        targets: [target],
        entries: [],
      });

    const unknownFamilyExit = await Effect.runPromiseExit(
      submitStartActionEffect(
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
      submitStartActionEffect(
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
      submitStartActionEffect(
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
      submitStartActionEffect(
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
      submitStartActionEffect(
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

    expect(unknownFamily).toBeInstanceOf(ServerTransportError);
    expect(unknownFamily).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata referenced an unknown Resource family.",
    });
    expect(keyMismatch).toBeInstanceOf(ServerTransportError);
    expect(keyMismatch).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource input.",
    });
    expect(entryMismatch).toBeInstanceOf(ServerTransportError);
    expect(entryMismatch).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource input.",
    });
    expect(malformedTagTarget).toBeInstanceOf(ServerTransportError);
    expect(malformedTagTarget).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource tag key.",
    });
    expect(malformedTagCause).toBeInstanceOf(ServerTransportError);
    expect(malformedTagCause).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action invalidation metadata did not match the Resource tag key.",
    });
  });

  it("replays action ref invalidations through runtime-local Resource families", async () => {
    const runtime = makeRuntime();
    let count = 0;
    const load = () => Effect.succeed(count);
    const Count = Resource.family({
      name: "Start.action.client.runtime-local-ref",
      load: (_input: null) => load(),
    });
    const ref = Count(null);
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.runtime-local-ref",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const definitions = Resource.definitions() as Map<string, unknown>;
    const globalDefinition = definitions.get("Start.action.client.runtime-local-ref");
    const fetcher: StartFetch = () =>
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
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));
      definitions.delete("Start.action.client.runtime-local-ref");
      count = 1;

      await expect(
        Effect.runPromise(
          submitStartActionEffect(Ping, { value: "ok" }, { fetch: fetcher, runtime }),
        ),
      ).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "ok" },
      });

      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);
    } finally {
      if (globalDefinition) {
        definitions.set("Start.action.client.runtime-local-ref", globalDefinition);
      }
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("applies action response metadata through the explicit app runtime, not the transport runtime", async () => {
    interface TransportToken {
      readonly token: string;
    }
    const TransportToken = Context.Service<TransportToken>(
      "@effect-ui/start/test/ActionTransportToken",
    );
    const Project = Resource.family({
      name: "Start.action.client.response-runtime",
      load: (_id: string) => Effect.succeed({ id: "atlas", name: "Initial" }),
    });
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.response-runtime",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const appRuntime = makeRuntime();
    const transportRuntime = makeRuntime(Layer.succeed(TransportToken)({ token: "transport-ok" }));
    const ref = Project("atlas");
    const fetcher: StartFetch<never, TransportToken> = () =>
      TransportToken.use(({ token }) =>
        Effect.succeed(
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
                      updatedAt: 1,
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
      await runInRuntime(appRuntime, Resource.prefetchEffect(ref));
      await runInRuntime(transportRuntime, Resource.prefetchEffect(ref));

      await expect(
        Effect.runPromise(
          submitStartActionEffect(
            Ping,
            { value: "submit" },
            {
              fetch: fetcher,
              responseRuntime: appRuntime,
              transportRuntime,
            },
          ),
        ),
      ).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "transport-ok" },
      });

      expect(runWithRuntime(appRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Hydrated In App Runtime",
      });
      expect(runWithRuntime(transportRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Initial",
      });
    } finally {
      await Effect.runPromise(appRuntime.disposeEffect);
      await Effect.runPromise(transportRuntime.disposeEffect);
    }
  });

  it("reports malformed Start action hydration payloads as transport errors", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.bad-hydration-meta",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const fetcher: StartFetch = () =>
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
      submitStartActionEffect(Ping, { value: "ok" }, { fetch: fetcher }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ServerTransportError);
    expect(failure).toMatchObject({
      reason: "InvalidResponse",
      message: "Start action response metadata could not be applied.",
    });
  });

  it("normalizes Start action client header and fetch setup throws as transport errors", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.transport-setup-throw",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });
    const headerCause = new Error("headers failed");
    const fetchCause = new Error("fetcher failed");

    const headerExit = await Effect.runPromiseExit(
      submitStartActionEffect(
        Ping,
        { value: "ok" },
        {
          headers: () => {
            throw headerCause;
          },
        },
      ),
    );
    const fetchExit = await Effect.runPromiseExit(
      submitStartActionEffect(
        Ping,
        { value: "ok" },
        {
          fetch: () => {
            throw fetchCause;
          },
        },
      ),
    );
    const headerFailure = Exit.isFailure(headerExit) ? firstFailure(headerExit.cause) : undefined;
    const fetchFailure = Exit.isFailure(fetchExit) ? firstFailure(fetchExit.cause) : undefined;

    expect(headerFailure).toBeInstanceOf(ServerTransportError);
    expect(headerFailure).toMatchObject({
      reason: "Network",
      message: "Could not construct Start transport headers.",
      cause: headerCause,
    });
    expect(fetchFailure).toBeInstanceOf(ServerTransportError);
    expect(fetchFailure).toMatchObject({
      reason: "Network",
      message: "Start action request failed.",
      cause: fetchCause,
    });
  });

  it("rejects Promise-shaped Start action client headers as transport errors", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.promise-headers",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value }),
    });

    const exit = await Effect.runPromiseExit(
      submitStartActionEffect(
        Ping,
        { value: "ok" },
        {
          headers: (() => Promise.resolve({ authorization: "Bearer token" })) as never,
        },
      ),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(ServerTransportError);
    expect(failure).toMatchObject({
      reason: "Network",
      message: "Could not construct Start transport headers.",
      cause: expect.any(EffectInputPromiseRejected),
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
    const Project = Resource.family({
      name: "Start.action.Project.tagged",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
      provides: (value) => [ProjectTag({ id: value.id })],
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
      invalidates: (_project, input) => [ProjectTag({ id: input.id })],
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: StartFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };

    try {
      await runInRuntime(clientRuntime, Resource.prefetchEffect(ref));

      const result = await Effect.runPromise(
        submitStartActionEffect(
          RenameProject,
          { id: "atlas", name: "Renamed Through Tag" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toMatchObject({
        _tag: "Success",
        invalidation: {
          targets: [
            {
              _tag: "Tag",
              key: "Start.action.Project.tag:atlas",
              name: "Start.action.Project.tag",
            },
          ],
          entries: [],
        },
      });
      expect(result.hydration).toBeUndefined();
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed Through Tag",
      });
    } finally {
      await Effect.runPromise(clientRuntime.disposeEffect);
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
    const Project = Resource.family({
      name: "Start.action.Project.ref",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(project),
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      typeof ProjectSchema.Type
    >({
      name: "Start.action.project.rename.ref",
      input: Schema.Struct({ id: Schema.String, name: Schema.String }),
      output: ProjectSchema,
      run: ({ id, name }) =>
        Effect.sync(() => {
          project = { id, name };
          return project;
        }),
      invalidates: (_project, input) => [Project(input.id)],
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [RenameProject],
    });
    const clientRuntime = makeRuntime();
    const ref = Project("atlas");
    const fetcher: StartFetch = (input, init) =>
      Effect.gen(function* () {
        const url =
          input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
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
      });

    try {
      await runInRuntime(clientRuntime, Resource.prefetchEffect(ref));

      const result = await Effect.runPromise(
        submitStartActionEffect(
          RenameProject,
          { id: "atlas", name: "Renamed Through Ref" },
          {
            fetch: fetcher,
            runtime: clientRuntime,
          },
        ),
      );

      expect(result).toMatchObject({
        _tag: "Success",
        invalidation: {
          targets: [
            {
              _tag: "Ref",
              key: ref.key,
              family: "Start.action.Project.ref",
              input: "atlas",
            },
          ],
        },
      });
      expect(result.hydration).toBeUndefined();
      expect(runWithRuntime(clientRuntime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Renamed Through Ref",
      });
    } finally {
      await Effect.runPromise(clientRuntime.disposeEffect);
    }
  });

  it("exposes a StartAction client instance with Action-like state", async () => {
    const Ping = Action.define<{ readonly value: string }, { readonly value: string }>({
      name: "Start.action.client.ping",
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.Struct({ value: Schema.String }),
      run: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
    });
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      actions: [Ping],
    });
    const runtime = makeRuntime();
    const fetcher: StartFetch = (input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input), "https://example.com").href;
      return handler(new Request(url, init));
    };
    const action = StartAction.use(Ping, { fetch: fetcher, runtime });

    try {
      expect(action.state.get()).toEqual({ _tag: "Idle" });
      const submission = Effect.runFork(action.submitEffect({ value: "transport" }));
      expect(action.state.get()).toMatchObject({
        _tag: "Pending",
        input: { value: "transport" },
      });

      await expect(Effect.runPromise(Fiber.join(submission))).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "TRANSPORT" },
      });
      expect(action.state.get()).toMatchObject({
        _tag: "Success",
        value: {
          _tag: "Success",
          value: { value: "TRANSPORT" },
        },
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
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
        concurrency: "exhaust",
      },
      run: ({ value }) => Effect.succeed({ value }),
    });
    const fetcher: StartFetch = () =>
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
    const runtime = makeRuntime();
    const action = StartAction.use(Ping, { fetch: fetcher, runtime });

    try {
      const first = runtime.runFork(action.submitEffect({ value: "first" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      const second = runtime.runFork(action.submitEffect({ value: "second" }));
      Effect.runSync(Deferred.succeed(release, undefined));

      await expect(runInRuntime(runtime, Fiber.join(first))).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "response-1" },
      });
      await expect(runInRuntime(runtime, Fiber.join(second))).resolves.toMatchObject({
        _tag: "Success",
        value: { value: "response-1" },
      });
      expect(requests).toBe(1);
      expect(action.state.get()).toMatchObject({
        _tag: "Success",
        input: { value: "first" },
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("does not hydrate stale StartAction submissions", async () => {
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
    const Project = Resource.family({
      name: "Start.action.Project.stale-hydration",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed({ id: "atlas", name: "Initial" }),
    });
    const InvalidatedProject = Resource.family({
      name: "Start.action.Project.stale-invalidation",
      input: Schema.String,
      output: ProjectSchema,
      load: () => Effect.succeed(invalidatedProject),
    });
    const RenameProject = Action.define<{ readonly name: string }, typeof ResultSchema.Type>({
      name: "Start.action.client.stale-hydration",
      input: Schema.Struct({ name: Schema.String }),
      output: ResultSchema,
      policy: {
        concurrency: "parallel",
      },
      run: ({ name }) => Effect.succeed({ name }),
    });
    const runtime = makeRuntime();
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
                  updatedAt,
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
    const fetcher: StartFetch = () =>
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
    const action = StartAction.use(RenameProject, { fetch: fetcher, runtime });

    try {
      await runInRuntime(runtime, Resource.prefetchEffect(ref));
      await runInRuntime(runtime, Resource.prefetchEffect(invalidatedRef));
      const first = runtime.runFork(action.submitEffect({ name: "First" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      const second = runtime.runFork(action.submitEffect({ name: "Second" }));

      Effect.runSync(Deferred.succeed(secondRelease, undefined));
      await expect(runInRuntime(runtime, Fiber.join(second))).resolves.toMatchObject({
        _tag: "Success",
        value: { name: "Second" },
      });
      expect(runWithRuntime(runtime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Second",
      });
      expect(runWithRuntime(runtime, () => Resource.status(invalidatedRef).value)).toEqual({
        id: "atlas",
        name: "Invalidation Initial",
      });

      invalidatedProject = {
        id: "atlas",
        name: "Invalidated By First",
      };
      Effect.runSync(Deferred.succeed(firstRelease, undefined));
      await expect(runInRuntime(runtime, Fiber.join(first))).resolves.toMatchObject({
        _tag: "Success",
        value: { name: "First" },
      });
      expect(runWithRuntime(runtime, () => Resource.status(ref).value)).toEqual({
        id: "atlas",
        name: "Second",
      });
      expect(runWithRuntime(runtime, () => Resource.status(invalidatedRef).value)).toEqual({
        id: "atlas",
        name: "Invalidated By First",
      });
      expect(action.state.get()).toMatchObject({
        _tag: "Success",
        input: { name: "Second" },
      });
    } finally {
      Effect.runSync(Deferred.succeed(firstRelease, undefined));
      Effect.runSync(Deferred.succeed(secondRelease, undefined));
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("hydrates from a document script", () => {
    const User = Resource.family({
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
            updatedAt: Date.now(),
          },
        },
      ],
    };
    const script = createHydrationScript(payload);
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__"
          ? {
              textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", ""),
            }
          : null,
    };

    hydrateFromDocument(document as Pick<Document, "getElementById">);

    expect(Resource.read(ref)).toEqual({ id: "1", name: "Hydrated" });
  });

  it("hydrates DB collections from a document script", () => {
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.document",
      getKey: (project) => project.id,
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
              origin: "remote" as const,
            },
          ],
          pendingMutations: [],
          updatedAt: Date.now(),
        },
      ],
    };
    const script = createHydrationScript(payload);
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__"
          ? {
              textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", ""),
            }
          : null,
    };

    hydrateFromDocument(document as Pick<Document, "getElementById">, "__EFFECT_UI_HYDRATION__", {
      collections: [Projects],
    });

    expect(Projects.get("atlas")).toMatchObject({
      id: "atlas",
      name: "Hydrated Atlas",
      $synced: true,
    });
  });

  it("resolves Start hydration collections from a registry when concrete collections are not supplied", async () => {
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.registry-hydration",
      getKey: (project) => project.id,
    });

    await Effect.runPromise(
      hydrateStartPayloadEffect(
        {
          resources: [],
          collections: [
            {
              name: Projects.name,
              rows: [
                {
                  key: "atlas",
                  value: { id: "atlas", name: "Registry Atlas" },
                  synced: true,
                  origin: "remote" as const,
                },
              ],
              pendingMutations: [],
              updatedAt: Date.now(),
            },
          ],
        },
        {
          collectionRegistry: Collection.defaultRegistry,
        },
      ),
    );

    expect(Projects.get("atlas")).toMatchObject({
      id: "atlas",
      name: "Registry Atlas",
      $synced: true,
    });
  });

  it("surfaces collection snapshot codec failures from Start hydration effects", async () => {
    const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Start.Collection.invalid-hydration",
      getKey: (project) => project.id,
    });

    const exit = await Effect.runPromiseExit(
      hydrateStartPayloadEffect(
        {
          resources: [],
          collections: [
            {
              name: "Start.Collection.invalid-hydration",
              rows: "not-rows",
              pendingMutations: [],
              updatedAt: 1,
            } as never,
          ],
        },
        {
          collections: [Projects],
        },
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(CollectionSnapshotCodecError);
  });

  it("fails Start hydration when collection snapshots have no resolvable definition", async () => {
    const exit = await Effect.runPromiseExit(
      hydrateStartPayloadEffect(
        {
          resources: [],
          collections: [
            {
              name: "Start.Collection.missing-hydration-definition",
              rows: [],
              pendingMutations: [],
              updatedAt: 1,
            },
          ],
        },
        {
          collectionRegistry: Collection.makeRegistry(),
        },
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toMatchObject({
      _tag: "CollectionSnapshotCodecError",
      operation: "hydrate",
      path: "$.collections[0].name",
    });
  });

  it("fails Start hydration when direct collection definitions share a name", async () => {
    const name = "Start.Collection.duplicate-hydration-definition";
    const PrimaryProjects = Collection.define<{ readonly id: string; readonly name: string }>({
      name,
      getKey: (project) => project.id,
    });
    const ShadowProjects = Collection.define<{ readonly slug: string; readonly title: string }>({
      name,
      getKey: (project) => project.slug,
    });

    const exit = await Effect.runPromiseExit(
      hydrateStartPayloadEffect(
        {
          resources: [],
          collections: [
            {
              name,
              rows: [],
              pendingMutations: [],
              updatedAt: 1,
            },
          ],
        },
        {
          collections: [PrimaryProjects, ShadowProjects],
        },
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toMatchObject({
      _tag: "CollectionSnapshotCodecError",
      operation: "hydrate",
      path: "$.collections",
    });
  });

  it("does not partially apply resources when collection hydration validation fails", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "Start.User.invalid-collection-hydration",
        load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
      });
      const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
        name: "Start.Collection.invalid-after-resource",
        getKey: (project) => project.id,
      });
      const ref = User("1");
      const exit = await Effect.runPromiseExit(
        runtime.provide(
          hydrateStartPayloadEffect(
            {
              resources: [
                {
                  name: "Start.User.invalid-collection-hydration",
                  key: ref.key,
                  input: "1",
                  state: {
                    _tag: "Success" as const,
                    waiting: false as const,
                    value: { id: "1", name: "Hydrated" },
                    updatedAt: 1,
                  },
                },
              ],
              collections: [
                {
                  name: "Start.Collection.invalid-after-resource",
                  rows: "not-rows",
                  pendingMutations: [],
                  updatedAt: 1,
                } as never,
              ],
            },
            {
              collections: [Projects],
            },
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(firstFailure(exit.cause)).toBeInstanceOf(CollectionSnapshotCodecError);
      expect(runWithRuntime(runtime, () => Resource.status(ref)._tag)).toBe("Initial");
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("surfaces malformed document hydration JSON through the Effect error channel", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__" ? { textContent: "{" } : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocumentEffect(document as Parameters<typeof hydrateFromDocumentEffect>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("rejects root hydration payloads with malformed collection data", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__"
          ? { textContent: JSON.stringify({ resources: [], collections: "not-array" }) }
          : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocumentEffect(document as Parameters<typeof hydrateFromDocumentEffect>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("surfaces empty document hydration scripts as malformed JSON", async () => {
    const document = {
      getElementById: (id: string) =>
        id === "__EFFECT_UI_HYDRATION__" ? { textContent: "" } : null,
      querySelectorAll: () => [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateFromDocumentEffect(document as Parameters<typeof hydrateFromDocumentEffect>[0]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationPayloadParseError);
  });

  it("surfaces hydration script serialization failures through the Effect error channel", async () => {
    const payload: { readonly resources: ReadonlyArray<never>; self?: unknown } = {
      resources: [],
    };
    payload.self = payload;

    const exit = await Effect.runPromiseExit(createHydrationScriptEffect(payload));
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
    const script = await Effect.runPromise(
      createHydrationScriptEffect({ resources: [] }, `root"<&`),
    );

    expect(script).toContain(`id="root&quot;&lt;&amp;"`);
    expect(script.match(/<script/g)).toHaveLength(1);
    expect(script).toContain(`{"resources":[]}`);
  });

  it("throws hydration script serialization failures from the sync facade", () => {
    const payload: { readonly resources: ReadonlyArray<never>; self?: unknown } = {
      resources: [],
    };
    payload.self = payload;

    expect(() => createHydrationScript(payload)).toThrow(StartHydrationPayloadSerializeError);

    try {
      createHydrationScript(payload);
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

    const exit = await Effect.runPromiseExit(
      hydrateStartHydrationChunksFromDocumentEffect(document),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationChunkParseError);
  });

  it("rejects streamed hydration chunks with malformed collection data", async () => {
    const element = {
      textContent: JSON.stringify({
        _tag: "StartHydrationChunk",
        version: 1,
        sequence: 0,
        payload: { resources: [], collections: "not-array" },
      }),
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "0" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    const exit = await Effect.runPromiseExit(
      hydrateStartHydrationChunksFromDocumentEffect(document),
    );

    expect(Exit.isFailure(exit)).toBe(true);
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

    const exit = await Effect.runPromiseExit(
      hydrateStartHydrationChunksFromDocumentEffect(document),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(firstFailure(exit.cause)).toBeInstanceOf(StartHydrationChunkParseError);
  });

  it("hydrates browser payloads in an explicit runtime", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
        name: "Start.User.document-explicit-runtime",
        load: (id: string) => Effect.succeed({ id, name: "Loaded" }),
      });
      const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
        name: "Start.Collection.document-explicit-runtime",
        getKey: (project) => project.id,
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
              updatedAt: 1,
            },
          },
        ],
        collections: [
          {
            name: "Start.Collection.document-explicit-runtime",
            rows: [
              {
                key: "atlas",
                value: { id: "atlas", name: "Runtime Atlas" },
                synced: true,
                origin: "remote" as const,
              },
            ],
            pendingMutations: [],
            updatedAt: 1,
          },
        ],
      };
      const script = createHydrationScript(payload);
      const document = {
        getElementById: (id: string) =>
          id === "__EFFECT_UI_HYDRATION__"
            ? {
                textContent: script.replace(/^<script[^>]*>/, "").replace("</script>", ""),
              }
            : null,
      };

      hydrateFromDocument(document as Pick<Document, "getElementById">, "__EFFECT_UI_HYDRATION__", {
        collections: [Projects],
        runtime,
      });

      expect(Resource.status(ref)._tag).toBe("Initial");
      expect(Projects.get("atlas")).toBeUndefined();
      expect(runWithRuntime(runtime, () => Resource.read(ref))).toEqual({
        id: "1",
        name: "Runtime Hydrated",
      });
      expect(runWithRuntime(runtime, () => Projects.get("atlas"))).toMatchObject({
        id: "atlas",
        name: "Runtime Atlas",
        $synced: true,
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("hydrates document and stream payloads idempotently in an explicit runtime without duplicate resource loads", async () => {
    const runtime = makeRuntime();
    try {
      let loads = 0;
      const User = Resource.family({
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
              updatedAt: 1,
            },
          },
        ],
      };
      const mainText = scriptText(createHydrationScript(payload));
      const streamElement = makeStreamHydrationElement(createStreamHydrationScript(payload, 0), 0);
      const document = {
        getElementById: (id: string) =>
          id === "__EFFECT_UI_HYDRATION__" ? { textContent: mainText } : null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      hydrateFromDocument(
        document as Parameters<typeof hydrateFromDocument>[0],
        "__EFFECT_UI_HYDRATION__",
        { runtime },
      );
      hydrateFromDocument(
        document as Parameters<typeof hydrateFromDocument>[0],
        "__EFFECT_UI_HYDRATION__",
        { runtime },
      );

      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBe("true");
      expect(Resource.status(ref)._tag).toBe("Initial");
      expect(runWithRuntime(runtime, () => Resource.read(ref))).toEqual({
        id: "1",
        name: "Hydrated",
      });
      await expect(runInRuntime(runtime, Resource.prefetchEffect(ref))).resolves.toEqual({
        id: "1",
        name: "Hydrated",
      });
      expect(loads).toBe(0);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("returns merged root and streamed payloads from document hydration effects", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
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
              updatedAt: 1,
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
              updatedAt: 2,
            },
          },
        ],
      };
      const streamElement = makeStreamHydrationElement(
        createStreamHydrationScript(streamPayload, 1),
        1,
      );
      const document = {
        getElementById: (id: string) =>
          id === "__EFFECT_UI_HYDRATION__"
            ? { textContent: scriptText(createHydrationScript(rootPayload)) }
            : null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      const hydrated = await runInRuntime(
        runtime,
        hydrateFromDocumentEffect(
          document as Parameters<typeof hydrateFromDocumentEffect>[0],
          "__EFFECT_UI_HYDRATION__",
        ),
      );

      expect(hydrated?.resources.map((resource) => resource.key)).toEqual([
        rootRef.key,
        streamRef.key,
      ]);
      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBe("true");
      expect(runWithRuntime(runtime, () => Resource.read(rootRef))).toEqual({
        id: "root",
        name: "Root",
      });
      expect(runWithRuntime(runtime, () => Resource.read(streamRef))).toEqual({
        id: "stream",
        name: "Stream",
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("hydrates streamed collection chunks in sequence without replacing earlier chunks", async () => {
    const runtime = makeRuntime();
    try {
      const Projects = Collection.define<{ readonly id: string; readonly name: string }>({
        name: "Start.Collection.streamed-sequence",
        getKey: (project) => project.id,
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
                origin: "remote" as const,
              },
            ],
            pendingMutations: [],
            updatedAt: 1,
          },
        ],
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
                origin: "remote" as const,
              },
            ],
            pendingMutations: [],
            updatedAt: 2,
          },
        ],
      };
      const streamElements = [
        makeStreamHydrationElement(createStreamHydrationScript(keplerPayload, 1), 1),
        makeStreamHydrationElement(createStreamHydrationScript(atlasPayload, 0), 0),
      ];
      const document = {
        getElementById: () => null,
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? streamElements : [],
      };

      const hydrated = await runInRuntime(
        runtime,
        hydrateStartHydrationChunksFromDocumentEffect(document, {
          collections: [Projects],
        }),
      );
      const secondHydration = await runInRuntime(
        runtime,
        hydrateStartHydrationChunksFromDocumentEffect(document, {
          collections: [Projects],
        }),
      );

      expect(hydrated.map((chunk) => chunk.payload.collections?.[0]?.rows[0]?.key)).toEqual([
        "atlas",
        "kepler",
      ]);
      expect(secondHydration).toEqual([]);
      expect(
        streamElements.map((element) => element.getAttribute(streamHydrationConsumedAttribute)),
      ).toEqual(["true", "true"]);
      expect(runWithRuntime(runtime, () => Projects.rows().map((project) => project.id))).toEqual([
        "atlas",
        "kepler",
      ]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps earlier streamed hydration chunks applied when a later chunk fails", async () => {
    const runtime = makeRuntime();
    try {
      const User = Resource.family({
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
              updatedAt: 1,
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
                updatedAt: 2,
              },
            },
          ],
        },
      };
      const streamElements = [
        makeStreamHydrationElement(createStreamHydrationScript(validPayload, 0), 0),
        makeStreamHydrationElement(JSON.stringify(invalidChunk), 1),
      ];
      const document = {
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? streamElements : [],
      };

      const exit = await Effect.runPromiseExit(
        runtime.provide(hydrateStartHydrationChunksFromDocumentEffect(document)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toMatchObject({
          _tag: "ResourceSnapshotCodecError",
        });
      }
      expect(runWithRuntime(runtime, () => Resource.read(validRef))).toEqual({
        id: "valid",
        name: "Valid",
      });
      expect(runWithRuntime(runtime, () => Resource.status(invalidRef)._tag)).toBe("Initial");
      expect(
        streamElements.map((element) => element.getAttribute(streamHydrationConsumedAttribute)),
      ).toEqual([null, null]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("lets callers opt out of marking streamed hydration chunks consumed", async () => {
    const runtime = makeRuntime();
    try {
      const payload = {
        resources: [],
      };
      const streamElement = makeStreamHydrationElement(createStreamHydrationScript(payload, 0), 0);
      const document = {
        querySelectorAll: (selector: string) =>
          selector === `[${streamHydrationAttribute}]` ? [streamElement] : [],
      };

      const first = hydrateStartHydrationChunksFromDocument(document, {
        markConsumed: false,
        runtime,
      });
      const second = hydrateStartHydrationChunksFromDocument(document, {
        markConsumed: false,
        runtime,
      });

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(streamElement.getAttribute(streamHydrationConsumedAttribute)).toBeNull();
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rejects malformed streamed hydration chunks with typed repair guidance", () => {
    const element = {
      textContent: JSON.stringify({ resources: "invalid" }),
      getAttribute: (name: string) => (name === streamHydrationSequenceAttribute ? "4" : null),
    };
    const document = {
      querySelectorAll: (selector: string) =>
        selector === `[${streamHydrationAttribute}]` ? [element] : [],
    };

    expect(() => hydrateStartHydrationChunksFromDocument(document)).toThrow(
      StartHydrationChunkParseError,
    );

    try {
      hydrateStartHydrationChunksFromDocument(document);
    } catch (error) {
      expect(error).toMatchObject({
        sequence: 4,
        value: { resources: "invalid" },
      });
    }
  });

  it("reads legacy streamed root payloads as ordered chunks through the sync facade", () => {
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

    expect(readStartHydrationChunks(document)).toEqual([
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

    const exit = await Effect.runPromiseExit(
      hydrateStartHydrationChunksFromDocumentEffect(document),
    );

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
        id === "__EFFECT_UI_HYDRATION__"
          ? { textContent: JSON.stringify({ resources: "invalid" }) }
          : null,
      querySelectorAll: () => [],
    };

    expect(() =>
      hydrateFromDocument(document as Parameters<typeof hydrateFromDocument>[0]),
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
        url: "/__effect-ui/rpc",
        headers: { accept: "application/json" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest({
        method: "POST",
        url: "/__effect-ui/action",
        headers: { accept: "text/html" },
      }),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest(
        {
          method: "POST",
          url: "/__effect-ui/rpc",
          headers: { accept: "application/json" },
        },
        {
          rpcPath: "/custom/start-rpc",
          actionPath: "/custom/start-action",
        },
      ),
    ).toBe(false);
    expect(
      shouldHandleSsrRequest(
        {
          method: "POST",
          url: "/custom/start-rpc",
          headers: { accept: "application/json" },
        },
        {
          rpcPath: "/custom/start-rpc",
          actionPath: "/custom/start-action",
        },
      ),
    ).toBe(true);
    expect(
      shouldHandleSsrRequest(
        {
          method: "POST",
          url: "/custom/start-action",
          headers: { accept: "text/html" },
        },
        {
          rpcPath: "/custom/start-rpc",
          actionPath: "/custom/start-action",
        },
      ),
    ).toBe(true);
  });

  it("keeps .server modules out of the client transform graph", () => {
    const plugin = effectUiStart();

    expect(isServerOnlyModule("/src/domain.server.ts")).toBe(true);
    expect(isServerOnlyModule("/src/domain.server.tsrx")).toBe(true);
    expect(isServerOnlyModule("/src/domain.contract.ts")).toBe(false);
    expect(isServerOnlyModule("/src/domain.contract.tsrx")).toBe(false);
    expect(() => plugin.transform("", "/src/domain.server.ts", {})).toThrow(
      StartServerOnlyModuleError,
    );
    expect(() => plugin.transform("", "/src/domain.server.tsrx", {})).toThrow(
      StartServerOnlyModuleError,
    );
    expect(plugin.transform("", "/src/domain.server.ts", { ssr: true })).toBeNull();
  });

  it("rejects direct server function arrays instead of inferring export names from wire names", async () => {
    const getProject = Server.fn<string, string>("Start.Project.get-by-id", {
      handler: (id) => Effect.succeed(id),
    });
    const exit = await Effect.runPromiseExit(
      makeStartServerFunctionManifestEffect({
        serverEntry: "/src/project.server.ts",
        serverFunctions: [getProject],
      }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartManifestDirectReferenceError);
    expect(failure).toMatchObject({
      kind: "serverFunctions",
      count: 1,
      serverEntry: "/src/project.server.ts",
    });
    expect((failure as StartManifestDirectReferenceError).guidance).toContain(
      "serverFunctionSources",
    );
    expect((failure as StartManifestDirectReferenceError).guidance).toContain("exportName");
  });

  it("rejects direct action arrays instead of inferring export names from wire names", async () => {
    const RenameProject = Action.define<string, string>({
      name: "Start.Project.rename-from-form",
      run: (name) => Effect.succeed(name),
    });
    const exit = await Effect.runPromiseExit(
      makeStartActionManifestEffect({
        serverEntry: "/src/project.actions.ts",
        actions: [RenameProject],
      }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartManifestDirectReferenceError);
    expect(failure).toMatchObject({
      kind: "actions",
      count: 1,
      serverEntry: "/src/project.actions.ts",
    });
    expect((failure as StartManifestDirectReferenceError).guidance).toContain("actionSources");
    expect((failure as StartManifestDirectReferenceError).guidance).toContain("exportName");
  });

  it("emits a production-shaped server function manifest from the Vite preset", async () => {
    const manifest = serializeStartServerFunctionManifest({
      serverFunctionManifest: [
        {
          name: "Start.Project.manifest",
          module: "/src/project/project.server.tsrx",
          exportName: "getProject",
          clientModule: "/src/project/project.contract.tsrx",
          clientExportName: "getProject",
          inputSchema: true,
          outputSchema: true,
        },
      ],
    });
    const plugin = effectUiStart({
      serverFunctionManifest: [
        {
          name: "Start.Project.manifest",
          module: "/src/project/project.server.tsrx",
          exportName: "getProject",
          clientModule: "/src/project/project.contract.tsrx",
          clientExportName: "getProject",
          inputSchema: true,
          outputSchema: true,
        },
      ],
    });
    const config = plugin.config();
    const resolved = plugin.resolveId(serverFunctionManifestVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      entries: [
        {
          name: "Start.Project.manifest",
          server: {
            moduleKind: "server-only",
          },
          client: {
            _tag: "Import",
            module: "/src/project/project.contract.tsrx",
            moduleKind: "contract",
          },
        },
      ],
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_SERVER_FUNCTIONS__: manifest,
      },
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
          outputSchema: true,
        },
      ],
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
          outputSchema: true,
        },
      ],
    });
    const config = plugin.config();
    const resolved = plugin.resolveId(actionManifestVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(JSON.parse(manifest)).toMatchObject({
      version: 1,
      actionPath: "/__effect-ui/action",
      entries: [
        {
          name: "Start.Project.renameAction",
          server: {
            moduleKind: "shared",
          },
          client: {
            _tag: "Import",
            module: "/src/project/domain.ts",
            moduleKind: "shared",
          },
        },
      ],
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_ACTIONS__: manifest,
      },
    });
    expect(resolved).toBe(`\0${actionManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("Start.Project.renameAction");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("emits and loads a production-shaped file route manifest from the Vite preset", async () => {
    const options = {
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    };
    const manifest = serializeStartFileRouteManifest(options);
    const plugin = effectUiStart(options);
    const config = plugin.config();
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
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_FILE_ROUTES__: manifest,
      },
    });
    expect(resolved).toBe(`\0${fileRouteManifestVirtualModuleId}`);
    expect(String(loaded)).toContain("export const manifest = ");
    expect(String(loaded)).toContain("export const entries = manifest.entries;");
  });

  it("accepts iterable file route manifest entries without requiring explicit modules", async () => {
    const source = await Effect.runPromise(
      makeStartFileRouteManifestEffect({
        fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
        fileRouteOptions: {
          routeDirectory: "src/routes",
        },
      }),
    );
    const entries = oneShotIterable(source.entries);
    const manifest = await Effect.runPromise(
      makeStartFileRouteManifestEffect({
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
    const plugin = effectUiStart({
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const resolved = plugin.resolveId(fileRouteDefinitionsVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(resolved).toBe(`\0${fileRouteDefinitionsVirtualModuleId}`);
    expect(String(loaded)).toContain('import { Route as route_root } from "/src/routes/index.js";');
    expect(String(loaded)).toContain(
      'import { Route as route_projects_$id } from "/src/routes/projects/$id.js";',
    );
    expect(String(loaded)).toContain(
      'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
    );
    expect(String(loaded)).toContain("export { route_root, route_projects_$id };");
    expect(String(loaded)).toContain(
      "export const routes = [route_root, route_projects_$id] as const;",
    );
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
      writeFileSync(join(root, "src/routes/projects/types.d.mts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/types.d.cts"), "export {};\n");
      writeFileSync(join(root, "src/routes/projects/readme.md"), "# project routes\n");

      const plugin = effectUiStart();
      const config = plugin.config({ root });
      const resolved = plugin.resolveId(fileRouteManifestVirtualModuleId);
      const loaded = resolved === null ? undefined : plugin.load(resolved);

      expect(discoverFileRoutes({ root })).toEqual([
        "src/routes/index.tsx",
        "src/routes/projects/$id.tsx",
        "src/routes/projects/_layout.tsx",
      ]);
      expect(config).toMatchObject({
        define: {
          __EFFECT_UI_FILE_ROUTES__: expect.any(String),
        },
      });
      const serializedFileRoutes = config.define?.__EFFECT_UI_FILE_ROUTES__;
      expect(typeof serializedFileRoutes).toBe("string");
      expect(JSON.parse(String(serializedFileRoutes))).toMatchObject({
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
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");
      writeFileSync(join(root, "src/routes/projects/$id.tsx"), "export default null;\n");

      const plugin = effectUiStart();
      plugin.configResolved({ root });

      const generatedPath = join(root, defaultFileRouteGeneratedFile);
      const generated = readFileSync(generatedPath, "utf8");

      expect(generated).toContain("This file is generated by @effect-ui/start. Do not edit.");
      expect(generated).toContain('import { Route } from "@effect-ui/core";');
      expect(generated).toContain('import { Route as route_root } from "./routes/index.js";');
      expect(generated).toContain(
        'import { Route as route_projects_$id } from "./routes/projects/$id.js";',
      );
      expect(generated).toContain(
        'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
      );
      expect(generated).toContain("export const routeTree = routes;");
      expect(generated).toContain('  "/projects/:id": route_projects_$id');
      expect(generated).toContain(
        "export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]> };",
      );
      expect(generated).toContain("export const hrefByPath = <Path extends RoutePath>(");
      expect(generated).toContain(
        "export type Href<Id extends RouteId> = FileRouteHrefOptions<Id>;",
      );
      expect(generated).toContain(
        "export type Match<Path extends RoutePath> = FileRouteMatch<Path>;",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not rediscover generated route definitions written under the route directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-under-routes-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = effectUiStart({
        fileRouteGeneration: {
          outputFile: "src/routes/routeTree.gen.ts",
        },
      });
      plugin.configResolved({ root, command: "serve" });

      const generatedPath = join(root, "src/routes/routeTree.gen.ts");
      expect(existsSync(generatedPath)).toBe(true);

      const config = plugin.config({ root });
      const serializedFileRoutes = config.define?.__EFFECT_UI_FILE_ROUTES__;
      const manifest = JSON.parse(String(serializedFileRoutes));
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
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-hot-"));

    try {
      mkdirSync(join(root, "src/routes/projects"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = effectUiStart();
      plugin.configResolved({ root, command: "serve" });

      const generatedPath = join(root, defaultFileRouteGeneratedFile);
      expect(readFileSync(generatedPath, "utf8")).not.toContain(
        "import { Route as route_projects_$id }",
      );

      const virtualIds = [
        fileRouteManifestVirtualModuleId,
        fileRouteDefinitionsVirtualModuleId,
        appGraphVirtualModuleId,
        appGraphRuntimeDiagnosticsVirtualModuleId,
      ];
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
        'import { Route as route_projects_$id } from "./routes/projects/$id.js";',
      );
      expect(generated).toContain('  "/projects/:id": route_projects_$id');
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
      expect(regenerated).not.toContain("import { Route as route_projects_$id }");
      expect(regenerated).not.toContain('  "/projects/:id": route_projects_$id');
      expect(invalidated.map((module) => module.id)).toEqual(resolvedIds);
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
    const root = mkdtempSync(join(tmpdir(), "effect-ui-generated-routes-outside-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default null;\n");

      const plugin = effectUiStart({
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

  it("emits and loads a production-shaped app graph from the Vite preset", async () => {
    const options = {
      serverFunctionManifest: [
        {
          name: "Start.Project.appGraph",
          module: "/src/project/project.server.ts",
          exportName: "getProject",
          inputSchema: true,
          outputSchema: true,
        },
      ],
      actionManifest: [
        {
          name: "Start.Project.appGraph.rename",
          module: "/src/project/project.actions.ts",
          exportName: "RenameProject",
          inputSchema: true,
          outputSchema: true,
        },
      ],
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    };
    const graph = serializeStartAppGraph(options);
    const plugin = effectUiStart(options);
    const config = plugin.config();
    const resolved = plugin.resolveId(appGraphVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(JSON.parse(graph)).toMatchObject({
      version: 1,
      routes: {
        entries: [
          {
            routePath: "/",
          },
          {
            routePath: "/projects/:id",
          },
        ],
      },
      serverFunctions: {
        entries: [
          {
            name: "Start.Project.appGraph",
          },
        ],
      },
      actions: {
        entries: [
          {
            name: "Start.Project.appGraph.rename",
          },
        ],
      },
    });
    expect(config).toMatchObject({
      define: {
        __EFFECT_UI_APP_GRAPH__: graph,
      },
    });
    expect(resolved).toBe(`\0${appGraphVirtualModuleId}`);
    expect(String(loaded)).toMatchInlineSnapshot(`
      "export const graph = {"version":1,"routes":{"version":1,"routeDirectory":"src/routes","entries":[{"id":"index","routeId":"route_root","moduleId":"src/routes/index.tsx","filePath":"src/routes/index.tsx","routePath":"/","segments":[],"params":[]},{"id":"projects/$id","routeId":"route_projects_$id","moduleId":"src/routes/projects/$id.tsx","filePath":"src/routes/projects/$id.tsx","routePath":"/projects/:id","segments":[{"_tag":"Static","value":"projects"},{"_tag":"Dynamic","name":"id","optional":false}],"params":[{"name":"id","optional":false}]}],"modules":[{"id":"index","kind":"Route","routeId":"route_root","moduleId":"src/routes/index.tsx","filePath":"src/routes/index.tsx","routePath":"/","segments":[],"params":[],"exportName":"Route"},{"id":"projects/$id","kind":"Route","routeId":"route_projects_$id","moduleId":"src/routes/projects/$id.tsx","filePath":"src/routes/projects/$id.tsx","routePath":"/projects/:id","segments":[{"_tag":"Static","value":"projects"},{"_tag":"Dynamic","name":"id","optional":false}],"params":[{"name":"id","optional":false}],"exportName":"Route"}]},"serverFunctions":{"version":1,"rpcPath":"/__effect-ui/rpc","entries":[{"id":"sf_1pkzsl7_start-project-appgraph","name":"Start.Project.appGraph","server":{"module":"/src/project/project.server.ts","exportName":"getProject","moduleKind":"server-only","hasHandler":true},"client":{"_tag":"Rpc","id":"sf_1pkzsl7_start-project-appgraph","name":"Start.Project.appGraph","rpcPath":"/__effect-ui/rpc"},"wire":{"inputSchema":true,"outputSchema":true,"errorSchema":false}}]},"actions":{"version":1,"actionPath":"/__effect-ui/action","entries":[{"id":"act_11c8g85_start-project-appgraph-rename","name":"Start.Project.appGraph.rename","server":{"module":"/src/project/project.actions.ts","exportName":"RenameProject","moduleKind":"shared"},"client":{"_tag":"Post","id":"act_11c8g85_start-project-appgraph-rename","name":"Start.Project.appGraph.rename","actionPath":"/__effect-ui/action"},"wire":{"inputSchema":true,"outputSchema":true,"errorSchema":false},"behavior":{"invalidates":"unknown","optimistic":"unknown","retry":"unknown","concurrency":"unknown"}}]}};
      export const diagnostics = {"version":1,"routeCount":2,"serverFunctionCount":1,"actionCount":1,"routePaths":["/","/projects/:id"],"routeModules":[{"routeId":"route_root","routePath":"/","moduleId":"src/routes/index.tsx","filePath":"src/routes/index.tsx","pathParamCount":0,"hasPathParams":false,"params":[],"paramsSchema":"unknown","searchSchema":"unknown","preload":"unknown","preloadResources":{"status":"unknown","families":[]},"preloadCollections":{"status":"unknown","collections":[]},"component":"unknown"},{"routeId":"route_projects_$id","routePath":"/projects/:id","moduleId":"src/routes/projects/$id.tsx","filePath":"src/routes/projects/$id.tsx","pathParamCount":1,"hasPathParams":true,"params":[{"name":"id","optional":false}],"paramsSchema":"unknown","searchSchema":"unknown","preload":"unknown","preloadResources":{"status":"unknown","families":[]},"preloadCollections":{"status":"unknown","collections":[]},"component":"unknown"}],"serverFunctionModules":[{"id":"sf_1pkzsl7_start-project-appgraph","name":"Start.Project.appGraph","server":{"module":"/src/project/project.server.ts","exportName":"getProject","moduleKind":"server-only","hasHandler":true},"client":{"_tag":"Rpc","rpcPath":"/__effect-ui/rpc"},"wire":{"inputSchema":true,"outputSchema":true,"errorSchema":false,"complete":false,"missing":["error"]}}],"actionModules":[{"id":"act_11c8g85_start-project-appgraph-rename","name":"Start.Project.appGraph.rename","server":{"module":"/src/project/project.actions.ts","exportName":"RenameProject","moduleKind":"shared"},"client":{"_tag":"Post","actionPath":"/__effect-ui/action"},"wire":{"inputSchema":true,"outputSchema":true,"errorSchema":false,"complete":false,"missing":["error"]},"behavior":{"invalidates":"unknown","optimistic":"unknown","retry":"unknown","concurrency":"unknown"}}],"resourceFamilies":[],"resourceTags":[],"collectionDefinitions":[],"serverOnlyModules":["/src/project/project.server.ts"],"browserClientModules":[],"rpcPath":"/__effect-ui/rpc","actionPath":"/__effect-ui/action","schemaCoverage":{"serverFunctions":{"total":1,"input":1,"output":1,"error":0},"actions":{"total":1,"input":1,"output":1,"error":0}},"missingSchemas":[{"kind":"serverFunction","name":"Start.Project.appGraph","input":true,"output":true,"error":false},{"kind":"action","name":"Start.Project.appGraph.rename","input":true,"output":true,"error":false}],"unknownActionBehavior":[{"kind":"action","name":"Start.Project.appGraph.rename","invalidates":"unknown","optimistic":"unknown","retry":"unknown","concurrency":"unknown"}],"unknownRoutePreloadResources":[],"unknownRoutePreloadCollections":[]};
      export const diagnosticsPolicyViolations = [];
      export const routes = graph.routes;
      export const serverFunctions = graph.serverFunctions;
      export const actions = graph.actions;
      export default graph;"
    `);
    expect(String(loaded)).toContain("export const graph = ");
    expect(String(loaded)).toContain("export const diagnostics = {");
    expect(String(loaded)).not.toContain('import { Resource, Route } from "@effect-ui/core";');
    expect(String(loaded)).not.toContain("startAppGraphCollectionDefinitions");
    expect(String(loaded)).not.toContain("describeStartAppGraphRuntimeDiagnostics");
    expect(String(loaded)).not.toContain("validateStartAppGraphDiagnosticsPolicyExceptionEffect");
    expect(String(loaded)).not.toContain('import { Effect } from "effect";');
    expect(String(loaded)).toContain("export const diagnosticsPolicyViolations = [];");
    expect(String(loaded)).not.toContain(
      'import { Route as route_root } from "/src/routes/index.js";',
    );
    expect(String(loaded)).not.toContain(
      'import { Route as route_projects_$id } from "/src/routes/projects/$id.js";',
    );
    expect(String(loaded)).not.toContain("const resourceDiagnostics = Resource.diagnostics();");
    expect(String(loaded)).not.toContain("const routeModuleCandidates = [");
    expect(String(loaded)).not.toContain(
      "preloadResources: Route.describePreloadResources(route_projects_$id)",
    );
    expect(String(loaded)).not.toContain(
      "preloadCollections: Route.describePreloadCollections(route_projects_$id)",
    );
    expect(String(loaded)).not.toContain("routeModulePresence");
    expect(String(loaded)).toContain("export const routes = graph.routes;");
    expect(String(loaded)).toContain("Start.Project.appGraph.rename");
  });

  it("normalizes one-shot manifest iterables once for Vite config and virtual module loads", () => {
    const getProject = Server.fn<string, string>("Start.Project.one-shot-manifest", {
      handler: (id) => Effect.succeed(id),
    });
    const RenameProject = Action.define<string, string>({
      name: "Start.Project.one-shot-manifest.rename",
      run: (name) => Effect.succeed(name),
    });
    const fileRoutes = oneShotIterable(["src/routes/projects/$id.tsx", "src/routes/index.tsx"]);
    const serverFunctionSources = oneShotIterable([
      {
        fn: getProject,
        module: "/src/project/project.server.ts",
        exportName: "getProject",
      },
    ]);
    const actionSources = oneShotIterable([
      {
        action: RenameProject,
        module: "/src/project/project.actions.ts",
        exportName: "RenameProject",
      },
    ]);
    const plugin = effectUiStart({
      serverFunctionSources: serverFunctionSources.iterable,
      actionSources: actionSources.iterable,
      fileRoutes: fileRoutes.iterable,
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const config = plugin.config();
    const appGraphId = plugin.resolveId(appGraphVirtualModuleId);
    const diagnosticsId = plugin.resolveId(appGraphRuntimeDiagnosticsVirtualModuleId);
    const appGraphModule = appGraphId === null ? undefined : plugin.load(appGraphId);
    const diagnosticsModule = diagnosticsId === null ? undefined : plugin.load(diagnosticsId);

    expect(fileRoutes.iteratorCalls).toBe(1);
    expect(serverFunctionSources.iteratorCalls).toBe(1);
    expect(actionSources.iteratorCalls).toBe(1);
    expect(String(config.define?.__EFFECT_UI_APP_GRAPH__)).toContain(
      "Start.Project.one-shot-manifest",
    );
    expect(String(appGraphModule)).toContain("Start.Project.one-shot-manifest.rename");
    expect(String(diagnosticsModule)).toContain("src/routes/projects/$id.tsx");
  });

  it("normalizes one-shot manifest iterables once for diagnostics virtual module reloads", () => {
    const getProject = Server.fn<string, string>("Start.Project.diagnostics-one-shot", {
      handler: (id) => Effect.succeed(id),
    });
    const RenameProject = Action.define<string, string>({
      name: "Start.Project.diagnostics-one-shot.rename",
      run: (name) => Effect.succeed(name),
    });
    const fileRoutes = oneShotIterable(["src/routes/projects/$id.tsx", "src/routes/index.tsx"]);
    const serverFunctionSources = oneShotIterable([
      {
        fn: getProject,
        module: "/src/project/project.server.ts",
        exportName: "getProject",
      },
    ]);
    const actionSources = oneShotIterable([
      {
        action: RenameProject,
        module: "/src/project/project.actions.ts",
        exportName: "RenameProject",
      },
    ]);
    const plugin = effectUiStartVirtualModules({
      serverFunctionSources: serverFunctionSources.iterable,
      actionSources: actionSources.iterable,
      fileRoutes: fileRoutes.iterable,
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    plugin.configResolved({ root: process.cwd() });
    const diagnosticsId = plugin.resolveId(appGraphRuntimeDiagnosticsVirtualModuleId);
    const firstModule = diagnosticsId === null ? undefined : plugin.load(diagnosticsId);
    const secondModule = diagnosticsId === null ? undefined : plugin.load(diagnosticsId);

    expect(fileRoutes.iteratorCalls).toBe(1);
    expect(serverFunctionSources.iteratorCalls).toBe(1);
    expect(actionSources.iteratorCalls).toBe(1);
    expect(String(firstModule)).toContain("Start.Project.diagnostics-one-shot.rename");
    expect(String(secondModule)).toContain("Start.Project.diagnostics-one-shot.rename");
    expect(String(secondModule)).toContain("src/routes/projects/$id.tsx");
  });

  it("keeps route implementation imports behind the runtime diagnostics virtual module", () => {
    const plugin = effectUiStart({
      fileRoutes: ["src/routes/projects/$id.tsx", "src/routes/index.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const resolved = plugin.resolveId(appGraphRuntimeDiagnosticsVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(resolved).toBe(`\0${appGraphRuntimeDiagnosticsVirtualModuleId}`);
    expect(String(loaded)).toContain(
      "export const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {",
    );
    expect(String(loaded)).toContain('import { Resource, Route } from "@effect-ui/core";');
    expect(String(loaded)).toContain('import { Route as route_root } from "/src/routes/index.js";');
    expect(String(loaded)).toContain(
      'import { Route as route_projects_$id } from "/src/routes/projects/$id.js";',
    );
    expect(String(loaded)).toContain("routeModules: routeModuleCandidates,");
    expect(String(loaded)).toContain(
      "preloadResources: Route.describePreloadResources(route_projects_$id)",
    );
  });

  it("emits a resolved diagnostics policy guard in the runtime diagnostics virtual module", async () => {
    const plugin = effectUiStart({
      buildPolicy: {
        wireSchemas: false,
        diagnostics: {
          routePreloadResources: {
            requireDeclaredForPreload: true,
          },
          routePreloadCollections: {
            requireDeclaredForPreload: true,
          },
        },
      },
      fileRoutes: ["src/routes/projects/$id.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const resolved = plugin.resolveId(appGraphRuntimeDiagnosticsVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(String(loaded)).toMatchInlineSnapshot(`
      "import { Effect } from "effect";
      import { Resource, Route } from "@effect-ui/core";
      import { describeStartAppGraphRuntimeDiagnostics, startAppGraphCollectionDefinitions, validateStartAppGraphDiagnosticsPolicyExceptionEffect } from "@effect-ui/start";

      import { Route as route_projects_$id } from "/src/routes/projects/$id.js";

      export const graph = {"version":1,"routes":{"version":1,"routeDirectory":"src/routes","entries":[{"id":"projects/$id","routeId":"route_projects_$id","moduleId":"src/routes/projects/$id.tsx","filePath":"src/routes/projects/$id.tsx","routePath":"/projects/:id","segments":[{"_tag":"Static","value":"projects"},{"_tag":"Dynamic","name":"id","optional":false}],"params":[{"name":"id","optional":false}]}],"modules":[{"id":"projects/$id","kind":"Route","routeId":"route_projects_$id","moduleId":"src/routes/projects/$id.tsx","filePath":"src/routes/projects/$id.tsx","routePath":"/projects/:id","segments":[{"_tag":"Static","value":"projects"},{"_tag":"Dynamic","name":"id","optional":false}],"params":[{"name":"id","optional":false}],"exportName":"Route"}]},"serverFunctions":{"version":1,"rpcPath":"/__effect-ui/rpc","entries":[]},"actions":{"version":1,"actionPath":"/__effect-ui/action","entries":[]}};
      const resourceDiagnostics = Resource.diagnostics();
      const collectionDefinitions = startAppGraphCollectionDefinitions();
      const routeModuleCandidates = [
      {
          entry: graph.routes.entries[0],
          route: route_projects_$id,
          preloadResources: Route.describePreloadResources(route_projects_$id),
          preloadCollections: Route.describePreloadCollections(route_projects_$id)
        }
      ];
      export const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
        routeModules: routeModuleCandidates,
        resourceFamilies: resourceDiagnostics.families,
        resourceTags: resourceDiagnostics.tags,
        collectionDefinitions
      });
      const diagnosticsPolicy = {"routePreloadResources":{"requireDeclaredForPreload":true},"routePreloadCollections":{"requireDeclaredForPreload":true}};
      export const diagnosticsPolicyViolations = Effect.runSync(validateStartAppGraphDiagnosticsPolicyExceptionEffect(diagnostics, diagnosticsPolicy));
      export const routes = graph.routes;
      export const serverFunctions = graph.serverFunctions;
      export const actions = graph.actions;
      export default graph;"
    `);
    expect(String(loaded)).toContain('"routePreloadResources":{"requireDeclaredForPreload":true}');
    expect(String(loaded)).toContain(
      '"routePreloadCollections":{"requireDeclaredForPreload":true}',
    );
    expect(String(loaded)).toContain(
      "export const diagnosticsPolicyViolations = Effect.runSync(validateStartAppGraphDiagnosticsPolicyExceptionEffect(diagnostics, diagnosticsPolicy));",
    );
    expect(String(loaded)).not.toContain("formatStartAppGraphDiagnosticsPolicyViolation");
    expect(String(loaded)).not.toContain(
      "new Error(`Effect UI app graph diagnostics policy failed",
    );
  });

  it("serializes disabled resolved diagnostics policy through the runtime diagnostics virtual module", () => {
    const plugin = effectUiStart({
      buildPolicy: {
        wireSchemas: false,
        diagnostics: false,
      },
      fileRoutes: ["src/routes/projects/$id.tsx"],
      fileRouteOptions: {
        routeDirectory: "src/routes",
      },
    });
    const resolved = plugin.resolveId(appGraphRuntimeDiagnosticsVirtualModuleId);
    const loaded = resolved === null ? undefined : plugin.load(resolved);

    expect(String(loaded)).toContain("const diagnosticsPolicy = null;");
    expect(String(loaded)).toContain(
      "validateStartAppGraphDiagnosticsPolicyExceptionEffect(diagnostics, diagnosticsPolicy)",
    );
  });

  it("loads resolved app graph diagnostics through Vite for CI scripts", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-runner-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          'import { Resource, route } from "@effect-ui/core";',
          'import { Collection } from "@effect-ui/db";',
          "const ProjectById = Resource.family({",
          '  name: "Runner.Project.byId",',
          "  load: (id: string) => ({ id })",
          "});",
          "const Projects = Collection.define<{ readonly id: string }>({",
          '  name: "Runner.Projects",',
          "  getKey: (project) => project.id,",
          '  load: () => [{ id: "atlas" }]',
          "});",
          'export const Route = route("/", {',
          "  preloadResources: [ProjectById],",
          "  preloadCollections: [Projects],",
          "  preload: () => undefined",
          "});",
        ].join("\n"),
      );

      const result = await Effect.runPromise(
        loadStartAppGraphDiagnosticsEffect({
          root,
          configFile: false,
          start: {
            fileRoutes: ["src/routes/index.ts"],
            fileRouteOptions: {
              routeDirectory: "src/routes",
            },
            buildPolicy: {
              wireSchemas: false,
              diagnostics: {
                routePreloadResources: {
                  requireDeclaredForPreload: true,
                },
                routePreloadCollections: {
                  requireDeclaredForPreload: true,
                },
              },
            },
          },
          vite: startDiagnosticsRunnerViteConfig(),
        }),
      );

      expect(result.diagnosticsPolicyViolations).toEqual([]);
      expect(result.diagnostics.routeModules).toEqual([
        expect.objectContaining({
          routePath: "/",
          preload: "present",
          preloadResources: {
            status: "declared",
            families: ["Runner.Project.byId"],
          },
          preloadCollections: {
            status: "declared",
            collections: ["Runner.Projects"],
          },
        }),
      ]);
      expect(result.diagnostics.resourceFamilies).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Runner.Project.byId" })]),
      );
      expect(result.diagnostics.collectionDefinitions).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Runner.Projects" })]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("borrows caller-owned Vite diagnostics servers without closing them", async () => {
    const graph = JSON.parse(serializeStartAppGraph({ fileRoutes: [] }));
    let closeCalls = 0;
    const server = {
      ssrLoadModule: async () => ({
        graph,
        diagnostics: describeStartAppGraph(graph),
        diagnosticsPolicyViolations: [],
      }),
      close: async () => {
        closeCalls += 1;
      },
    };

    const loaded = await Effect.runPromise(loadStartAppGraphDiagnosticsFromServerEffect(server));
    const withServerLoaded = await Effect.runPromise(
      loadStartAppGraphDiagnosticsWithServerEffect(server),
    );

    expect(loaded.diagnostics.routeCount).toBe(0);
    expect(withServerLoaded.diagnostics.routeCount).toBe(0);
    expect(closeCalls).toBe(0);
  });

  it("reports owned Vite diagnostics server close failures as typed load errors", async () => {
    const graph = JSON.parse(serializeStartAppGraph({ fileRoutes: [] }));
    let closeCalls = 0;
    const exit = await Effect.runPromiseExit(
      loadStartAppGraphDiagnosticsWithOwnedServerEffect(
        Effect.succeed({
          ssrLoadModule: async () => ({
            graph,
            diagnostics: describeStartAppGraph(graph),
            diagnosticsPolicyViolations: [],
          }),
          close: async () => {
            closeCalls += 1;
            throw new Error("diagnostics close failed");
          },
        }),
      ),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(closeCalls).toBe(1);
    expect(failure).toBeInstanceOf(StartAppGraphDiagnosticsRunnerError);
    expect(failure).toMatchObject({
      message: "Could not close the temporary Vite server for Effect UI app graph diagnostics.",
    });
  });

  it("allows resolved app graph diagnostics policy opt-outs through Vite", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-runner-opt-out-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/", {',
          "  preload: () => undefined",
          "});",
        ].join("\n"),
      );

      const result = await Effect.runPromise(
        loadStartAppGraphDiagnosticsEffect({
          root,
          configFile: false,
          start: {
            fileRoutes: ["src/routes/index.ts"],
            fileRouteOptions: {
              routeDirectory: "src/routes",
            },
            buildPolicy: {
              wireSchemas: false,
              diagnostics: {
                routePreloadResources: {
                  requireDeclaredForPreload: false,
                },
                routePreloadCollections: false,
              },
            },
          },
          vite: startDiagnosticsRunnerViteConfig(),
        }),
      );

      expect(result.diagnosticsPolicyViolations).toEqual([]);
      expect(result.diagnostics.unknownRoutePreloadResources).toHaveLength(1);
      expect(result.diagnostics.unknownRoutePreloadCollections).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("loads diagnostics from an inline Start Vite plugin without separate Start options", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-inline-start-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/index.ts"),
        ['import { route } from "@effect-ui/core";', 'export const Route = route("/", {});'].join(
          "\n",
        ),
      );

      const result = await Effect.runPromise(
        loadStartAppGraphDiagnosticsEffect({
          root,
          configFile: false,
          vite: {
            ...startDiagnosticsRunnerViteConfig(),
            plugins: [
              effectUiStart({
                fileRoutes: ["src/routes/index.ts"],
                fileRouteOptions: {
                  routeDirectory: "src/routes",
                },
              }),
            ],
          },
        }),
      );

      expect(result.diagnostics.routePaths).toEqual(["/"]);
      expect(result.graph.routes.entries).toEqual([
        expect.objectContaining({
          routePath: "/",
          moduleId: "src/routes/index.ts",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("prefers explicit Start diagnostics options over config-file Start plugins", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-explicit-start-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "src/routes/config.ts"),
        [
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/config", {});',
        ].join("\n"),
      );
      writeFileSync(
        join(root, "src/routes/explicit.ts"),
        [
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/explicit", {});',
        ].join("\n"),
      );
      writeFileSync(
        join(root, "vite.config.ts"),
        [
          'import { effectUiStart } from "@effect-ui/start/vite";',
          "export default {",
          "  plugins: [effectUiStart({",
          '    fileRoutes: ["src/routes/config.ts"],',
          '    fileRouteOptions: { routeDirectory: "src/routes" }',
          "  })]",
          "};",
        ].join("\n"),
      );

      const result = await Effect.runPromise(
        loadStartAppGraphDiagnosticsEffect({
          root,
          start: {
            fileRoutes: ["src/routes/explicit.ts"],
            fileRouteOptions: {
              routeDirectory: "src/routes",
            },
          },
          vite: startDiagnosticsRunnerViteConfig(),
        }),
      );

      expect(result.diagnostics.routePaths).toEqual(["/explicit"]);
      expect(result.graph.routes.entries).toEqual([
        expect.objectContaining({
          routePath: "/explicit",
          moduleId: "src/routes/explicit.ts",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("rejects loaded diagnostics that are not coherent with their graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-incoherent-"));

    try {
      const startOptions = {
        fileRoutes: ["src/routes/index.ts"],
        fileRouteOptions: {
          routeDirectory: "src/routes",
        },
      };
      const graph = await Effect.runPromise(makeStartBuildAppGraphEffect(startOptions));
      const diagnostics = {
        ...describeStartAppGraph(graph),
        routePaths: ["/wrong"],
      };
      const resolvedDiagnosticsId = `\0${appGraphRuntimeDiagnosticsVirtualModuleId}`;

      await expect(
        Effect.runPromise(
          loadStartAppGraphDiagnosticsEffect({
            root,
            configFile: false,
            vite: {
              plugins: [
                {
                  name: "effect-ui-start-test-incoherent-diagnostics",
                  resolveId(id) {
                    return id === appGraphRuntimeDiagnosticsVirtualModuleId
                      ? resolvedDiagnosticsId
                      : null;
                  },
                  load(id) {
                    return id === resolvedDiagnosticsId
                      ? [
                          `export const graph = ${serializeStartAppGraph(startOptions)};`,
                          `export const diagnostics = ${JSON.stringify(diagnostics)};`,
                          "export const diagnosticsPolicyViolations = [];",
                          "export default graph;",
                        ].join("\n")
                      : null;
                  },
                },
              ],
            },
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "StartAppGraphDiagnosticsRunnerError",
        message: expect.stringContaining("coherent"),
      });
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
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/", {',
          "  preload: () => undefined",
          "});",
        ].join("\n"),
      );

      await expect(
        Effect.runPromise(
          loadStartAppGraphDiagnostics({
            root,
            configFile: false,
            start: {
              fileRoutes: ["src/routes/index.ts"],
              fileRouteOptions: {
                routeDirectory: "src/routes",
              },
              buildPolicy: {
                wireSchemas: false,
                diagnostics: {
                  routePreloadResources: {
                    requireDeclaredForPreload: true,
                  },
                  routePreloadCollections: {
                    requireDeclaredForPreload: true,
                  },
                },
              },
            },
            vite: startDiagnosticsRunnerViteConfig(),
          }),
        ),
      ).rejects.toMatchObject({
        name: "StartAppGraphDiagnosticsPolicyError",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("fails the Vite build diagnostics gate without importing the app graph virtual module", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-diagnostics-build-gate-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "index.html"),
        [
          "<!doctype html>",
          "<html>",
          "  <body>",
          '    <script type="module" src="/src/main.ts"></script>',
          "  </body>",
          "</html>",
        ].join("\n"),
      );
      writeFileSync(join(root, "src/main.ts"), "export const mounted = true;\n");
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/", {',
          "  preload: () => undefined",
          "});",
        ].join("\n"),
      );

      let buildError: unknown;
      try {
        await build({
          root,
          configFile: false,
          logLevel: "silent",
          ...startDiagnosticsRunnerViteConfig(),
          plugins: [
            effectUiStart({
              fileRoutes: ["src/routes/index.ts"],
              fileRouteOptions: {
                routeDirectory: "src/routes",
              },
              buildPolicy: {
                wireSchemas: false,
                diagnostics: {
                  routePreloadResources: {
                    requireDeclaredForPreload: true,
                  },
                  routePreloadCollections: {
                    requireDeclaredForPreload: true,
                  },
                },
              },
            }),
          ],
        });
      } catch (error) {
        buildError = error;
      }

      expect(buildError).toBeDefined();
      expect(String(buildError)).toContain("preloadResources");
      expect(String(buildError)).toContain("preloadCollections");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it("skips the Vite build diagnostics gate when diagnostics policy is disabled", async () => {
    const root = mkdtempSync(join(process.cwd(), ".tmp-effect-ui-diagnostics-build-gate-opt-out-"));

    try {
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(
        join(root, "index.html"),
        [
          "<!doctype html>",
          "<html>",
          "  <body>",
          '    <script type="module" src="/src/main.ts"></script>',
          "  </body>",
          "</html>",
        ].join("\n"),
      );
      writeFileSync(join(root, "src/main.ts"), "export const mounted = true;\n");
      writeFileSync(
        join(root, "src/routes/index.ts"),
        [
          'import { route } from "@effect-ui/core";',
          'export const Route = route("/", {',
          "  preload: () => undefined",
          "});",
        ].join("\n"),
      );

      await expect(
        build({
          root,
          configFile: false,
          logLevel: "silent",
          ...startDiagnosticsRunnerViteConfig(),
          plugins: [
            effectUiStart({
              fileRoutes: ["src/routes/index.ts"],
              fileRouteOptions: {
                routeDirectory: "src/routes",
              },
              buildPolicy: {
                wireSchemas: false,
                diagnostics: false,
              },
            }),
          ],
        }),
      ).resolves.toBeDefined();
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
        "--pretty",
      ]),
    ).toEqual({
      _tag: "Diagnostics",
      options: {
        root: "app",
        configFile: false,
        mode: "ci",
        json: true,
        pretty: true,
      },
    });
    expect(
      parseStartDiagnosticsCliArgs([
        "--root",
        "app",
        "--config=false",
        "--mode",
        "ci",
        "diagnostics",
        "--pretty",
      ]),
    ).toEqual({
      _tag: "Diagnostics",
      options: {
        root: "app",
        configFile: false,
        mode: "ci",
        json: true,
        pretty: true,
      },
    });
    expect(
      parseStartDiagnosticsCliArgs([
        "diagnostics",
        "--root=-app",
        "--config=-vite.config.ts",
        "--mode=-ci",
        "--json",
      ]),
    ).toEqual({
      _tag: "Diagnostics",
      options: {
        root: "-app",
        configFile: "-vite.config.ts",
        mode: "-ci",
        json: true,
        pretty: false,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "route", "/projects/:id", "--json"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "route",
          text: "/projects/:id",
        },
        json: true,
        pretty: false,
        verbose: false,
      },
    });
    expect(
      parseStartDiagnosticsCliArgs(["graph", "action", "Project.rename", "--verbose"]),
    ).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "action",
          text: "Project.rename",
        },
        json: false,
        pretty: false,
        verbose: true,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "--verbose", "route", "/projects/:id"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "route",
          text: "/projects/:id",
        },
        json: false,
        pretty: false,
        verbose: true,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "route", "--verbose", "/projects/:id"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "route",
          text: "/projects/:id",
        },
        json: false,
        pretty: false,
        verbose: true,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "route", "/projects/:id", "--verbose"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "route",
          text: "/projects/:id",
        },
        json: false,
        pretty: false,
        verbose: true,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "--query=--root"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          text: "--root",
        },
        json: false,
        pretty: false,
        verbose: false,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["graph", "route", "--query=--root", "--json"])).toEqual({
      _tag: "Graph",
      options: {
        query: {
          kind: "route",
          text: "--root",
        },
        json: true,
        pretty: false,
        verbose: false,
      },
    });
    expect(
      parseStartDiagnosticsCliArgs(["impact", "action", "Project.rename", "--root", "app"]),
    ).toEqual({
      _tag: "Impact",
      options: {
        root: "app",
        query: {
          kind: "action",
          text: "Project.rename",
        },
        json: false,
        pretty: false,
      },
    });
    expect(parseStartDiagnosticsCliArgs(["impact", "--query=--root", "--root", "app"])).toEqual({
      _tag: "Impact",
      options: {
        root: "app",
        query: {
          text: "--root",
        },
        json: false,
        pretty: false,
      },
    });
    expect(
      parseStartDiagnosticsCliArgs(["impact", "route", "--query=--root", "--root", "app"]),
    ).toEqual({
      _tag: "Impact",
      options: {
        root: "app",
        query: {
          kind: "route",
          text: "--root",
        },
        json: false,
        pretty: false,
      },
    });
    for (const kind of startAgentGraphQueryKinds) {
      expect(
        parseStartDiagnosticsCliArgs([
          "graph",
          kind,
          startAgentGraphCliQueryTextByKind[kind],
          "--json",
        ]),
      ).toEqual({
        _tag: "Graph",
        options: {
          query: {
            kind,
            text: startAgentGraphCliQueryTextByKind[kind],
          },
          json: true,
          pretty: false,
          verbose: false,
        },
      });
      expect(
        parseStartDiagnosticsCliArgs([
          "impact",
          kind,
          startAgentGraphCliQueryTextByKind[kind],
          "--root",
          "app",
        ]),
      ).toEqual({
        _tag: "Impact",
        options: {
          root: "app",
          query: {
            kind,
            text: startAgentGraphCliQueryTextByKind[kind],
          },
          json: false,
          pretty: false,
        },
      });
    }
    expect(parseStartDiagnosticsCliArgs([])).toEqual({ _tag: "Help" });
    expect(parseStartDiagnosticsCliArgs(["diagnostics", "--help"])).toEqual({ _tag: "Help" });

    const helpStdout: string[] = [];
    const helpStderr: string[] = [];
    const helpResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["--help"], {
        stdout: (text) => helpStdout.push(text),
        stderr: (text) => helpStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(helpResult.exitCode).toBe(0);
    expect(helpStderr).toEqual([]);
    expect(helpStdout.join("\n")).toContain("USAGE");
    expect(helpStdout.join("\n")).toContain("effect-ui-start <subcommand> [flags]");

    const graphHelpStdout: string[] = [];
    const graphHelpStderr: string[] = [];
    const graphHelpResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["graph", "--help"], {
        stdout: (text) => graphHelpStdout.push(text),
        stderr: (text) => graphHelpStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(graphHelpResult.exitCode).toBe(0);
    expect(graphHelpStderr).toEqual([]);
    const graphHelp = graphHelpStdout.join("\n");
    expect(graphHelp).toContain("effect-ui-start graph [flags] <query...>");
    expect(graphHelp).toContain("Optional graph kind and query text.");
    expect(graphHelp).not.toContain("graph <subcommand>");

    const impactHelpStdout: string[] = [];
    const impactHelpStderr: string[] = [];
    const impactHelpResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["impact", "--help"], {
        stdout: (text) => impactHelpStdout.push(text),
        stderr: (text) => impactHelpStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(impactHelpResult.exitCode).toBe(0);
    expect(impactHelpStderr).toEqual([]);
    const impactHelp = impactHelpStdout.join("\n");
    expect(impactHelp).toContain("effect-ui-start impact [flags] <query...>");
    expect(impactHelp).toContain("Required impact query text with optional kind");
    expect(impactHelp).not.toContain("impact <subcommand>");

    const versionStdout: string[] = [];
    const versionStderr: string[] = [];
    const versionResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["--version"], {
        stdout: (text) => versionStdout.push(text),
        stderr: (text) => versionStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(versionResult.exitCode).toBe(0);
    expect(versionStderr).toEqual([]);
    expect(versionStdout.join("\n")).toContain("effect-ui-start v0.0.0-alpha.0");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["diagnostics", "--json"], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () =>
          Effect.succeed({
            graph: {
              version: 1,
              routes: { version: 1, entries: [], modules: [], routeDirectory: "src/routes" },
              serverFunctions: { version: 1, rpcPath: "/__effect-ui/rpc", entries: [] },
              actions: { version: 1, actionPath: "/__effect-ui/action", entries: [] },
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
                actions: { total: 0, input: 0, output: 0, error: 0 },
              },
              missingSchemas: [],
              unknownActionBehavior: [],
              unknownRoutePreloadResources: [],
              unknownRoutePreloadCollections: [],
            },
            diagnosticsPolicyViolations: [],
          }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      diagnostics: {
        routeCount: 0,
      },
      diagnosticsPolicyViolations: [],
    });
  });

  it("prints a queryable Start agent graph from the CLI", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["graph", "route", "/projects/:id"], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () =>
          Effect.succeed({
            graph: {
              version: 1,
              routes: { version: 1, entries: [], modules: [], routeDirectory: "src/routes" },
              serverFunctions: { version: 1, rpcPath: "/__effect-ui/rpc", entries: [] },
              actions: { version: 1, actionPath: "/__effect-ui/action", entries: [] },
            },
            diagnostics: {
              version: 1,
              routeCount: 1,
              serverFunctionCount: 0,
              actionCount: 0,
              routePaths: ["/projects/:id"],
              routeModules: [
                {
                  routeId: "route_projects_$id",
                  routePath: "/projects/:id",
                  moduleId: "src/routes/projects/$id.tsx",
                  filePath: "src/routes/projects/$id.tsx",
                  pathParamCount: 1,
                  hasPathParams: true,
                  params: [{ name: "id", optional: false }],
                  paramsSchema: "present",
                  searchSchema: "absent",
                  preload: "present",
                  preloadResources: {
                    status: "declared",
                    families: ["Project.byId"],
                  },
                  preloadCollections: {
                    status: "declared",
                    collections: ["ProjectRows"],
                  },
                  component: "present",
                },
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
                actions: { total: 0, input: 0, output: 0, error: 0 },
              },
              missingSchemas: [],
              unknownActionBehavior: [],
              unknownRoutePreloadResources: [],
              unknownRoutePreloadCollections: [],
            },
            diagnosticsPolicyViolations: [],
          }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Query: route /projects/:id");
    expect(stdout.join("\n")).toContain("Route /projects/:id");
    expect(stdout.join("\n")).toContain("Status: pass");
    expect(stdout.join("\n")).toContain("Edit: src/routes/projects/$id.tsx");
    expect(stdout.join("\n")).toContain("Params: id");
    expect(stdout.join("\n")).toContain(
      "Preloads: resources Project.byId; collections ProjectRows",
    );
    expect(stdout.join("\n")).toContain("Related: module: src/routes/projects/$id.tsx");
    expect(stdout.join("\n")).not.toContain("route:route_projects_$id");
  });

  it("runs every Start agent graph query kind through the CLI parser/runtime seam", async () => {
    const loadDiagnosticsEffect = () =>
      Effect.succeed({
        graph: {
          version: 1 as const,
          routes: { version: 1 as const, entries: [], modules: [], routeDirectory: "src/routes" },
          serverFunctions: { version: 1 as const, rpcPath: "/__effect-ui/rpc", entries: [] },
          actions: { version: 1 as const, actionPath: "/__effect-ui/action", entries: [] },
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
              moduleId: "src/routes/projects/$id.tsx",
              filePath: "src/routes/projects/$id.tsx",
              pathParamCount: 1,
              hasPathParams: true,
              params: [{ name: "id", optional: false }],
              paramsSchema: "present" as const,
              searchSchema: "absent" as const,
              preload: "present" as const,
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"],
              },
              preloadCollections: {
                status: "declared" as const,
                collections: ["ProjectRows"],
              },
              component: "present" as const,
            },
          ],
          serverFunctionModules: [
            {
              id: "sf_project-load",
              name: "Project.load",
              server: {
                module: "/src/project/project.server.ts",
                exportName: "loadProject",
                moduleKind: "server-only" as const,
              },
              client: {
                _tag: "Import" as const,
                module: "/src/project/project.contract.ts",
                exportName: "loadProject",
              },
              wire: {
                inputSchema: true,
                outputSchema: true,
                errorSchema: false,
                complete: false,
              },
            },
          ],
          actionModules: [
            {
              id: "act_project-rename",
              name: "Project.rename",
              server: {
                module: "/src/project/project.actions.ts",
                exportName: "RenameProject",
                moduleKind: "shared" as const,
              },
              client: {
                _tag: "Import" as const,
                module: "/src/project/project.actions.ts",
                exportName: "RenameProject",
              },
              wire: {
                inputSchema: true,
                outputSchema: true,
                errorSchema: true,
                complete: true,
              },
              behavior: {
                invalidates: true,
                optimistic: false,
                retry: true,
                concurrency: "latest" as const,
              },
            },
          ],
          resourceFamilies: [
            {
              name: "Project.byId",
              inputSchema: true,
              outputSchema: true,
              errorSchema: false,
              providesTags: true,
              policy: {
                retry: false,
              },
            },
          ],
          resourceTags: [
            {
              name: "Project.updated",
              keyed: true,
            },
          ],
          collectionDefinitions: [
            {
              name: "ProjectRows",
              readOnly: false,
              inputSchema: false,
              outputSchema: false,
              initialData: false,
              indexes: [],
              load: false,
              handlers: {
                insert: false,
                update: false,
                delete: false,
              },
              policy: {
                retry: false,
              },
              persistence: {
                enabled: false,
                hydrate: false,
                restoreOnPreload: false,
                loadAfterRestore: false,
                persistOnLoad: false,
                persistOnMutation: false,
                persistOnWrite: false,
              },
            },
          ],
          serverOnlyModules: ["/src/project/project.server.ts"],
          browserClientModules: [
            "/src/project/project.contract.ts",
            "/src/project/project.actions.ts",
          ],
          rpcPath: "/__effect-ui/rpc",
          actionPath: "/__effect-ui/action",
          schemaCoverage: {
            serverFunctions: { total: 1, input: 1, output: 1, error: 0 },
            actions: { total: 1, input: 1, output: 1, error: 1 },
          },
          missingSchemas: [
            {
              kind: "serverFunction" as const,
              name: "Project.load",
              input: true,
              output: true,
              error: false,
            },
          ],
          unknownActionBehavior: [],
          unknownRoutePreloadResources: [],
          unknownRoutePreloadCollections: [],
        },
        diagnosticsPolicyViolations: [],
      });

    for (const kind of startAgentGraphQueryKinds) {
      const graphStdout: string[] = [];
      const graphStderr: string[] = [];
      const graphResult = await Effect.runPromise(
        runStartDiagnosticsCliEffect(
          ["graph", kind, startAgentGraphCliQueryTextByKind[kind], "--json"],
          {
            stdout: (text) => graphStdout.push(text),
            stderr: (text) => graphStderr.push(text),
            loadDiagnosticsEffect,
          },
        ),
      );
      const graphPayload = JSON.parse(graphStdout[0] ?? "{}") as {
        readonly result?: {
          readonly query?: {
            readonly kind?: string;
          };
          readonly nodes?: readonly unknown[];
        };
      };

      expect(graphResult.exitCode).toBe(0);
      expect(graphStderr).toEqual([]);
      expect(graphPayload.result?.query?.kind).toBe(kind);
      expect(graphPayload.result?.nodes?.length).toBeGreaterThan(0);

      const impactStdout: string[] = [];
      const impactStderr: string[] = [];
      const impactResult = await Effect.runPromise(
        runStartDiagnosticsCliEffect(
          [
            "impact",
            kind,
            startAgentGraphCliQueryTextByKind[kind],
            "--root",
            "examples/project-console",
            "--config",
            "vite.config.ts",
            "--mode",
            "ci",
            "--json",
          ],
          {
            stdout: (text) => impactStdout.push(text),
            stderr: (text) => impactStderr.push(text),
            loadDiagnosticsEffect,
          },
        ),
      );
      const impactPayload = JSON.parse(impactStdout[0] ?? "{}") as {
        readonly query?: {
          readonly kind?: string;
        };
        readonly matches?: number;
        readonly items?: readonly {
          readonly verify?: readonly string[];
        }[];
      };

      expect(impactResult.exitCode).toBe(0);
      expect(impactStderr).toEqual([]);
      expect(impactPayload.query?.kind).toBe(kind);
      expect(impactPayload.matches).toBeGreaterThan(0);
      expect(impactPayload.items?.[0]?.verify).toEqual([
        "effect-ui-start diagnostics --root=examples/project-console --config=vite.config.ts --mode=ci",
        `effect-ui-start graph --root=examples/project-console --config=vite.config.ts --mode=ci ${kind} ${startAgentGraphCliQueryTextByKind[kind]}`,
      ]);
    }
  });

  it("includes diagnostics load options in JSON impact verify commands", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const loadOptions: unknown[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(
        [
          "impact",
          "route",
          "/project spaces/:id",
          "--root",
          "examples/project console",
          "--config",
          "vite config.ts",
          "--mode",
          "ci mode",
          "--json",
        ],
        {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
          loadDiagnosticsEffect: (options) => {
            loadOptions.push(options);
            return Effect.succeed({
              graph: {
                version: 1,
                routes: { version: 1, entries: [], modules: [], routeDirectory: "src/routes" },
                serverFunctions: { version: 1, rpcPath: "/__effect-ui/rpc", entries: [] },
                actions: { version: 1, actionPath: "/__effect-ui/action", entries: [] },
              },
              diagnostics: {
                version: 1,
                routeCount: 1,
                serverFunctionCount: 0,
                actionCount: 0,
                routePaths: ["/project spaces/:id"],
                routeModules: [
                  {
                    routeId: "route_project_spaces_$id",
                    routePath: "/project spaces/:id",
                    moduleId: "src/routes/project spaces/$id.tsx",
                    filePath: "src/routes/project spaces/$id.tsx",
                    pathParamCount: 1,
                    hasPathParams: true,
                    params: [{ name: "id", optional: false }],
                    paramsSchema: "present",
                    searchSchema: "absent",
                    preload: "absent",
                    preloadResources: {
                      status: "none",
                      families: [],
                    },
                    preloadCollections: {
                      status: "none",
                      collections: [],
                    },
                    component: "present",
                  },
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
                  actions: { total: 0, input: 0, output: 0, error: 0 },
                },
                missingSchemas: [],
                unknownActionBehavior: [],
                unknownRoutePreloadResources: [],
                unknownRoutePreloadCollections: [],
              },
              diagnosticsPolicyViolations: [],
            });
          },
        },
      ),
    );
    const payload = JSON.parse(stdout[0] ?? "{}") as {
      readonly items?: readonly {
        readonly verify?: readonly string[];
      }[];
    };

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(loadOptions).toEqual([
      {
        root: "examples/project console",
        configFile: "vite config.ts",
        mode: "ci mode",
      },
    ]);
    expect(payload.items?.[0]?.verify).toEqual([
      "effect-ui-start diagnostics --root='examples/project console' --config='vite config.ts' --mode='ci mode'",
      "effect-ui-start graph --root='examples/project console' --config='vite config.ts' --mode='ci mode' route '/project spaces/:id'",
    ]);
    expect(
      parseStartDiagnosticsCliArgs(shellSplitStartCliArgs(payload.items?.[0]?.verify?.[1] ?? "")),
    ).toEqual({
      _tag: "Graph",
      options: {
        root: "examples/project console",
        configFile: "vite config.ts",
        mode: "ci mode",
        query: {
          kind: "route",
          text: "/project spaces/:id",
        },
        json: false,
        pretty: false,
        verbose: false,
      },
    });
  });

  it("protects impact verify command queries that look like CLI flags", () => {
    const query = { kind: "route" as const, text: "--root" };
    const commands = startDiagnosticsCliVerifyCommandsForQuery(query, {
      root: "examples/project-console",
    });

    expect(commands).toEqual([
      "effect-ui-start diagnostics --root=examples/project-console",
      "effect-ui-start graph --root=examples/project-console route --query=--root",
    ]);
    expect(parseStartDiagnosticsCliArgs(shellSplitStartCliArgs(commands[1] ?? ""))).toEqual({
      _tag: "Graph",
      options: {
        root: "examples/project-console",
        query,
        json: false,
        pretty: false,
        verbose: false,
      },
    });

    const textOnlyCommands = startDiagnosticsCliVerifyCommandsForQuery(
      { text: "--root" },
      { root: "examples/project-console" },
    );

    expect(textOnlyCommands).toEqual([
      "effect-ui-start diagnostics --root=examples/project-console",
      "effect-ui-start graph --root=examples/project-console --query=--root",
    ]);
    expect(parseStartDiagnosticsCliArgs(shellSplitStartCliArgs(textOnlyCommands[1] ?? ""))).toEqual(
      {
        _tag: "Graph",
        options: {
          root: "examples/project-console",
          query: {
            text: "--root",
          },
          json: false,
          pretty: false,
          verbose: false,
        },
      },
    );
  });

  it("protects impact verify command load options that look like CLI flags", () => {
    expect(
      startDiagnosticsCliVerifyCommandsForQuery(
        { kind: "route", text: "/projects/:id" },
        {
          root: "-app",
          configFile: "-vite.config.ts",
          mode: "-ci",
        },
      ),
    ).toEqual([
      "effect-ui-start diagnostics --root=-app --config=-vite.config.ts --mode=-ci",
      "effect-ui-start graph --root=-app --config=-vite.config.ts --mode=-ci route /projects/:id",
    ]);
  });

  it("prints a high-signal Start impact brief from the CLI", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(
        ["impact", "route", "/projects/:id", "--root", "examples/project-console"],
        {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
          loadDiagnosticsEffect: () =>
            Effect.succeed({
              graph: {
                version: 1,
                routes: { version: 1, entries: [], modules: [], routeDirectory: "src/routes" },
                serverFunctions: { version: 1, rpcPath: "/__effect-ui/rpc", entries: [] },
                actions: { version: 1, actionPath: "/__effect-ui/action", entries: [] },
              },
              diagnostics: {
                version: 1,
                routeCount: 1,
                serverFunctionCount: 0,
                actionCount: 0,
                routePaths: ["/projects/:id"],
                routeModules: [
                  {
                    routeId: "route_projects_$id",
                    routePath: "/projects/:id",
                    moduleId: "src/routes/projects/$id.tsx",
                    filePath: "src/routes/projects/$id.tsx",
                    pathParamCount: 1,
                    hasPathParams: true,
                    params: [{ name: "id", optional: false }],
                    paramsSchema: "present",
                    searchSchema: "absent",
                    preload: "present",
                    preloadResources: {
                      status: "declared",
                      families: ["Project.byId"],
                    },
                    preloadCollections: {
                      status: "declared",
                      collections: ["ProjectRows"],
                    },
                    component: "present",
                  },
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
                  actions: { total: 0, input: 0, output: 0, error: 0 },
                },
                missingSchemas: [],
                unknownActionBehavior: [],
                unknownRoutePreloadResources: [],
                unknownRoutePreloadCollections: [],
              },
              diagnosticsPolicyViolations: [],
            }),
        },
      ),
    );

    const text = stdout.join("\n");
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(text).toContain("Impact: route /projects/:id");
    expect(text).toContain("Contracts");
    expect(text).toContain("- preloads: resources Project.byId; collections ProjectRows");
    expect(text).toContain("Depends on");
    expect(text).toContain("- effect-ui-start diagnostics --root=examples/project-console");
    expect(text).toContain(
      "- effect-ui-start graph --root=examples/project-console route /projects/:id",
    );
    expect(text).not.toContain("route:route_projects_$id");
  });

  it("returns a usage result for invalid Start diagnostics CLI input", async () => {
    const stderr: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["unknown"], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain('Unknown subcommand "unknown" for "effect-ui-start"');

    const extraGraphStderr: string[] = [];
    const extraGraphResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["graph", "route", "/projects/:id", "extra"], {
        stdout: () => undefined,
        stderr: (text) => extraGraphStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(extraGraphResult.exitCode).toBe(1);
    expect(extraGraphStderr.join("\n")).toContain("at most a graph kind and one query");

    const missingImpactStderr: string[] = [];
    const missingImpactResult = await Effect.runPromise(
      runStartDiagnosticsCliEffect(["impact", "route"], {
        stdout: () => undefined,
        stderr: (text) => missingImpactStderr.push(text),
        loadDiagnosticsEffect: () => Effect.die("unreachable"),
      }),
    );
    expect(missingImpactResult.exitCode).toBe(1);
    expect(missingImpactStderr.join("\n")).toContain(
      "an impact query such as `impact route /projects/:id`",
    );
  });

  it("keeps Start diagnostics CLI bin write failures inside the Effect boundary", async () => {
    const stderr: string[] = [];
    const previousExitCode = process.exitCode;
    let observedExitCode: string | number | undefined;
    try {
      process.exitCode = undefined;
      await Effect.runPromise(
        runStartDiagnosticsCliMainEffect(["--help"], {
          stdout: () => Effect.fail("stdout unavailable"),
          stderr: (text) => {
            stderr.push(text);
          },
          loadDiagnosticsEffect: () => Effect.die("unreachable"),
        }),
      );
      observedExitCode = process.exitCode;
    } finally {
      process.exitCode = previousExitCode;
    }

    expect(observedExitCode).toBe(1);
    expect(stderr).toEqual(["Effect UI diagnostics CLI failed: Could not write stdout output."]);
  });

  it("keeps invalid diagnostics CLI loaders inside the Effect boundary", async () => {
    const syncCause = new Error("loader setup failed");
    const cases = [
      {
        label: "sync throw",
        loadDiagnosticsEffect: () => {
          throw syncCause;
        },
        message: "Diagnostics CLI loader threw before returning an Effect.",
      },
      {
        label: "Promise return",
        loadDiagnosticsEffect: () => Promise.resolve({}),
        message: "Diagnostics CLI loader returned Promise-shaped work instead of an Effect.",
      },
      {
        label: "plain return",
        loadDiagnosticsEffect: () => ({ graph: {} }),
        message: "Diagnostics CLI loader must return an Effect.",
      },
    ];

    for (const testCase of cases) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const result = await Effect.runPromise(
        runStartDiagnosticsCliEffect(["diagnostics"], {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
          loadDiagnosticsEffect: testCase.loadDiagnosticsEffect as never,
        }),
      );

      expect(result.exitCode, testCase.label).toBe(1);
      expect(stdout, testCase.label).toEqual([]);
      expect(stderr.join("\n"), testCase.label).toContain(
        `Effect UI Start diagnostics failed: ${testCase.message}`,
      );
    }
  });

  it("prints an agent-readable Start diagnostics repair report", async () => {
    const loadedDiagnostics = {
      graph: {
        version: 1 as const,
        routes: { version: 1 as const, entries: [], modules: [], routeDirectory: "src/routes" },
        serverFunctions: { version: 1 as const, rpcPath: "/__effect-ui/rpc", entries: [] },
        actions: { version: 1 as const, actionPath: "/__effect-ui/action", entries: [] },
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
              families: [],
            },
            preloadCollections: {
              status: "unknown" as const,
              collections: [],
            },
            component: "present" as const,
          },
        ],
        serverFunctionModules: [
          {
            id: "sf_project_load",
            name: "Project.load",
            server: {
              module: "src/project/project.server.ts",
              exportName: "loadProject",
              moduleKind: "server-only" as const,
              hasHandler: true,
            },
            client: {
              _tag: "Rpc" as const,
              rpcPath: "/__effect-ui/rpc",
            },
            wire: {
              inputSchema: true,
              outputSchema: false,
              errorSchema: false,
              complete: false,
              missing: ["output" as const, "error" as const],
            },
          },
        ],
        actionModules: [
          {
            id: "act_project_rename",
            name: "Project.rename",
            server: {
              module: "src/project/project.actions.ts",
              exportName: "renameProject",
              moduleKind: "server-only" as const,
            },
            client: {
              _tag: "Post" as const,
              actionPath: "/__effect-ui/action",
            },
            wire: {
              inputSchema: false,
              outputSchema: true,
              errorSchema: false,
              complete: false,
              missing: ["input" as const, "error" as const],
            },
            behavior: {
              invalidates: "unknown" as const,
              optimistic: "unknown" as const,
              retry: "present" as const,
              concurrency: "unknown" as const,
            },
          },
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
          actions: { total: 1, input: 0, output: 1, error: 0 },
        },
        missingSchemas: [
          {
            kind: "serverFunction" as const,
            name: "Project.load",
            input: true,
            output: false,
            error: false,
          },
          {
            kind: "action" as const,
            name: "Project.rename",
            input: false,
            output: true,
            error: false,
          },
        ],
        unknownActionBehavior: [
          {
            kind: "action" as const,
            name: "Project.rename",
            invalidates: "unknown" as const,
            optimistic: "unknown" as const,
            retry: "present" as const,
            concurrency: "unknown" as const,
          },
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
              families: [],
            },
          },
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
              collections: [],
            },
          },
        ],
      },
      diagnosticsPolicyViolations: [],
    };
    const report = createStartDiagnosticsReport(loadedDiagnostics);
    const formatted = formatStartDiagnosticsReport(report);
    const stdout: string[] = [];
    const result = await Effect.runPromise(
      runStartDiagnosticsCli(["diagnostics"], {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        loadDiagnosticsEffect: () => Effect.succeed(loadedDiagnostics),
      }),
    );

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
        families: [],
      },
    };
    const failure = Object.assign(new Error("Routes with preload must declare preloadResources."), {
      name: "StartAppGraphDiagnosticsPolicyError",
      violations: [
        {
          _tag: "UnknownRoutePreloadResources",
          message: "Routes with preload must declare preloadResources.",
          routes: [unknownPreloadRoute],
        },
      ],
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
              families: [],
            },
            preloadCollections: {
              status: "none" as const,
              collections: [],
            },
            component: "present" as const,
          },
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
          actions: { total: 0, input: 0, output: 0, error: 0 },
        },
        missingSchemas: [],
        unknownActionBehavior: [],
        unknownRoutePreloadResources: [unknownPreloadRoute],
        unknownRoutePreloadCollections: [],
      },
    });
    const result = await Effect.runPromise(
      runStartDiagnosticsCli(["diagnostics"], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
        loadDiagnosticsEffect: () => Effect.fail(failure),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Routes with preload must declare preloadResources.");
    expect(stderr.join("\n")).toContain("Effect UI Start Diagnostics Report");
    expect(stderr.join("\n")).toContain("Owner: src/routes/index.ts");
    expect(stderr.join("\n")).toContain("Add `preloadResources: [...]`");
    expect(stderr.join("\n")).toContain("Owner: StartBuildPolicy.diagnostics");
  });

  it("exposes typed static build policy validation over Start app graph manifests", async () => {
    const graph = await Effect.runPromise(
      makeStartBuildAppGraphEffect({
        serverFunctionManifest: [
          {
            name: "Start.Project.policy",
            module: "/src/project/project.server.ts",
            exportName: "getProject",
            inputSchema: true,
          },
        ],
        actionManifest: [
          {
            name: "Start.Project.policy.rename",
            module: "/src/project/project.actions.ts",
            exportName: "RenameProject",
            inputSchema: true,
            outputSchema: true,
          },
        ],
      }),
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
          output: false,
        },
      ],
    });
    await expect(
      Effect.runPromise(
        validateStartBuildPolicyEffect(graph, {
          wireSchemas: {
            requireInput: true,
            requireOutput: false,
          },
        }),
      ),
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
            outputSchema: true,
          },
        ],
      }),
    );
    const exit = await Effect.runPromiseExit(
      validateStartBuildPolicyEffect(graph, {
        wireSchemas: false,
        actionBehavior: {
          requireInvalidates: true,
          requireConcurrency: true,
        },
      }),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartAppGraphUnknownActionBehavior);
    expect(failure).toMatchObject({
      unknown: [
        {
          kind: "action",
          name: "Start.Project.policy.unknown-action",
          invalidates: "unknown",
          concurrency: "unknown",
        },
      ],
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
          inputSchema: true,
        },
      ],
    });

    expect(() => {
      plugin.config();
    }).toThrow(StartAppGraphMissingWireSchemas);
  });

  it("resolves default and named Start handlers", async () => {
    const defaultHandler = () => new Response("default");
    const namedHandler = () => new Response("named");

    expect(
      resolveStartHandler({ default: defaultHandler })(new Request("https://example.com")),
    ).toBeInstanceOf(Response);
    expect(resolveStartHandler({ handleRequest: namedHandler })).toBe(namedHandler);
    expect(resolveStartHandler({ custom: namedHandler }, { handlerExport: "custom" })).toBe(
      namedHandler,
    );
    expect(() => resolveStartHandler({})).toThrow(StartHandlerNotFound);
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
        handleSsrDevRequestEffect(server, new Request("https://example.com/projects/kepler")),
      ),
    ).resolves.toBeInstanceOf(Response);
  });

  it("does not finalize dev SSR request traces as success before host transform failures", async () => {
    const traces: DevtoolsRequestTrace[] = [];
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
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

    const exit = await Effect.runPromiseExit(
      handleSsrDevRequestEffect(server, new Request("https://example.com/")),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "transform-html" });
    expect(traces.map((trace) => trace.status)).toEqual(["failure"]);
    expect(traces[0]).toMatchObject({
      streams: [
        {
          name: "response",
          state: "errored",
        },
      ],
      teardown: {
        reason: "dev-ssr-host-transform",
      },
    });
  });

  it("reports dev SSR request aborts as cancelled traces while reading HTML", async () => {
    const controller = new AbortController();
    const started = Effect.runSync(Deferred.make<void>());
    const cancelled = Effect.runSync(Deferred.make<unknown>());
    const traces: DevtoolsRequestTrace[] = [];
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
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
      handleSsrDevRequestEffect(
        server,
        new Request("https://example.com/", { signal: controller.signal }),
      ),
    );

    await Effect.runPromise(Deferred.await(started));
    controller.abort("dev-client-disconnect");
    await expect(
      Effect.runPromise(Deferred.await(cancelled).pipe(Effect.timeout("1 second"))),
    ).resolves.toBe("dev-client-disconnect");
    const exit = await Effect.runPromise(Fiber.await(fiber));
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "read-html" });
    expect(traces.map((trace) => trace.status)).toEqual(["cancelled"]);
    expect(traces[0]).toMatchObject({
      streams: [
        {
          name: "response",
          state: "cancelled",
        },
      ],
      teardown: {
        reason: "dev-client-disconnect",
      },
    });
  });

  it("keeps dev SSR transform failures as failures when abort happens after HTML read", async () => {
    const controller = new AbortController();
    const traces: DevtoolsRequestTrace[] = [];
    const app = defineApp({
      routes: [route("/", {})] as const,
      client: {},
    });
    const handler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
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

    const exit = await Effect.runPromiseExit(
      handleSsrDevRequestEffect(
        server,
        new Request("https://example.com/", { signal: controller.signal }),
      ),
    );
    const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

    expect(failure).toBeInstanceOf(StartDevServerError);
    expect(failure).toMatchObject({ operation: "transform-html" });
    expect(traces.map((trace) => trace.status)).toEqual(["failure"]);
    expect(traces[0]).toMatchObject({
      streams: [
        {
          name: "response",
          state: "errored",
        },
      ],
      teardown: {
        reason: "dev-ssr-host-transform",
      },
    });
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
      handleSsrDevRequestEffect(
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
      handleSsrDevRequestEffect(server, new Request("https://example.com/scoped")),
    );

    await expect(response.text()).resolves.toContain("scoped");
    expect(finalized).toBe(true);
  });

  it("runs Vite dev SSR middleware handler Effects in the configured runtime", async () => {
    interface DevSsrToken {
      readonly value: string;
    }
    const DevSsrToken = Context.Service<DevSsrToken>("@effect-ui/start/test/DevSsrToken");
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
    const plugin = effectUiStart({
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
      await Effect.runPromise(runtime.disposeEffect);
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
    const plugin = effectUiStart({
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
      handleSsrDevRequestEffect(server, new Request("https://example.com/pass-through")),
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
          default: () => Effect.runPromise(Effect.succeed(new Response("promise"))),
        }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };

    const exit = await Effect.runPromiseExit(
      handleSsrDevRequestEffect(server, new Request("https://example.com/promise")),
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
      handleSsrDevRequestEffect(server, new Request("https://example.com/invalid")),
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
      handleSsrDevMiddlewareEffect(
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
        handleSsrDevMiddlewareEffect(
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
      handleSsrDevMiddlewareEffect(
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
      handleSsrDevMiddlewareEffect(
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
        {
          headers: {
            host: "internal.local",
            "x-forwarded-proto": "https",
            "x-forwarded-host": "public.example.com",
          },
          method: "GET",
          url: "/settings",
        } as IncomingMessage,
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
      handleSsrDevMiddlewareEffect(
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
        handleSsrDevMiddlewareEffect(
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
        handleSsrDevMiddlewareEffect(
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
