import * as HttpClient from "effect/http/HttpClient";
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  Metric,
  Request as EffectRequest,
  RequestResolver,
  Schema,
  Scope,
  Stream,
  Option,
} from "effect";
import type { KeyValueStore } from "effect/persistence";
import { AsyncResult } from "effect/reactivity";
import {
  Action,
  ActionInterrupted,
  ActionResult,
  type ActionTransport,
  EffectInputCallbackError,
  Form,
  State,
  Resource,
  ResourceFailure,
  ResourcePending,
  ResourceStoreDisposeError,
  ResourceUntypedFailure,
  ResponseContext,
  Route,
  RoutePreloadError,
  RoutePreloadUntypedFailure,
  RuntimeDisposeError,
  Server,
  Signal,
  disposeResourceStore,
  makeMemoryBrowserHistoryAdapter,
  makeResourceStore,
  makeRuntime,
  type AnySunfallArcRuntime,
  RouterRouteNotRegistered,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateArgs,
  type BrowserRouterError,
  type BrowserRouterHostController,
  type BrowserRouterState,
  type SunfallArcRuntime,
  type EffectInput,
  type MemoryBrowserHistoryAdapter,
  type ParamsForPath,
  type ResourceStore,
  Timeline,
  TimelineAlreadyRecording,
  TimelineEntryUnavailable,
} from "@sunfall/arc-core";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  buildRoutePath,
  cloneResourceSnapshotValue,
  hrefForRouteInput,
  invokeEffectInput,
  isRouteParamName,
  makeActionSubmissionController,
  makeCoreDefinitionRegistry,
  makeCoreDefinitionRegistryAdapter,
  makeResourceDefinitionRegistry,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
  makeWindowBrowserHistoryAdapter,
  matchRoutePath,
  parseRoutePathSegments,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  toEffect,
  type BrowserRouterLinkClickDecision,
  type BrowserRouterLinkIgnoreReason,
  type BrowserRouterLinkPreloadDecision,
  type BrowserRouterLinkPreloadIdentity,
  type RuntimeUiScopeFrame,
  type UiScope,
} from "@sunfall/arc-core/internal";
// @ts-expect-error MutableResourceStore is an internal store implementation, not a root export.
import type { MutableResourceStore } from "@sunfall/arc-core";
// @ts-expect-error unsafeMutableResourceStore is an internal store implementation escape hatch, not a root export.
import { unsafeMutableResourceStore } from "@sunfall/arc-core";
// @ts-expect-error makeMutableResourceStore is an internal store constructor, not a root export.
import { makeMutableResourceStore } from "@sunfall/arc-core";
import { Query, QueryEvaluationError } from "@sunfall/arc-db";
import {
  Component,
  RouterContextMissing,
  RouterProvider,
  useRouter,
  type BrowserRouter,
  type RouterLinkProps,
  type RouterOutletProps,
} from "@sunfall/arc-solid";
import { LiveQuery } from "@sunfall/arc-solid/live-query";
import { Devtools } from "@sunfall/arc-devtools";
import {
  App,
  createRequestHandler,
  hydrateFromDocument,
  StartAction,
  type StartHydrationError,
  type StartRequestHandler,
  type StartRequestHandlerError,
} from "@sunfall/arc-start";
import { makeActionTransportLayer } from "../packages/start/src/start-action-transport.js";
import { rpcClientLayer } from "../packages/start/src/start-rpc-client.js";
import { makeStartServerApp } from "../packages/start/src/start-server-app.js";
import {
  createFileRouteDefinitionsModule,
  createGeneratedFileRouteDefinitionsModule,
  defaultGeneratedFileRouteDefinitionsHeader,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier,
  type FileRouteDefinitionsModuleError,
  type FileRouteDefinitionsModuleOptions,
  type GeneratedFileRouteDefinitionsModuleOptions,
} from "../packages/start/src/file-route-modules.js";
import type { FileRouteManifest } from "../packages/start/src/file-routes.js";
import {
  createServerActionResponse,
  createServerRpcResponse,
} from "../packages/start/src/start-request-endpoints.js";
import {
  hydrateStartHydrationChunksFromDocument,
  readStartHydrationChunks,
  streamHydrationConsumedAttribute,
} from "../packages/start/src/hydration.js";
import { preloadRequest } from "../packages/start/src/start-request-preload.js";
import {
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
} from "../packages/start/src/request-trace.js";
import {
  startTransportEndpointEnvelope,
  type StartTransportDiagnosticsOptions,
  type StartTransportEndpointEnvelope,
} from "../packages/start/src/rpc.js";
import {
  sunfallArcStart,
  FileRouteDefinitionsFileWriteError,
  StartDevServerError,
  StartHandlerNotFound,
  type SunfallArcStartPlugin,
} from "@sunfall/arc-start/vite";
import {
  handleSsrDevRequest,
  startDevServerFromVite,
  type StartDevServer,
  type StartSsrRequestHandler,
} from "../packages/start/src/start-vite-dev-ssr.js";
import {
  writeFileRouteDefinitionsFile,
  type FileRouteDefinitionsFileWriteFailure,
  type FileRouteDefinitionsFileWriteResult,
} from "../packages/start/src/generated-route-definitions.js";
import {
  createFetchHandler,
  toFetchHandler,
  type StartFetchHandler,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions,
} from "@sunfall/arc-start/fetch";
import {
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  writeNodeResponse,
  type StartForkRuntime,
  type StartNodeAdapterError,
  type StartNodeHandler,
  type StartNodeOriginPolicy,
  type StartNodeRequestOptions,
  type StartNodeServerHandler,
  type StartNodeServerHandlerOptions,
  type StartNodeServerHandlerRuntimeOptions,
  type WriteNodeResponseOptions,
} from "@sunfall/arc-start/node";
import { sunfallArcTsrx, type SunfallArcTsrxOptions } from "@sunfall/arc-tsrx";
import type { PluginOption } from "vite";
import { makeProjectId as makeProjectConsoleProjectId } from "../examples/project-console/src/domain.contract.js";
import "@sunfall/arc-start/virtual";
import {
  layoutsById as virtualLayoutsById,
  metadataById as virtualMetadataById,
  routeById as virtualRouteById,
  routes as virtualFileRoutes,
  type FileRouteLayouts as VirtualFileRouteLayouts,
  type FileRouteMetadataModules as VirtualFileRouteMetadataModules,
  type FileRouteHrefOptions as VirtualHref,
  type FileRouteHrefArgs as VirtualHrefArgs,
  type FileRouteHrefOptionsById as VirtualHrefById,
  type FileRouteId as VirtualFileRouteId,
  type FileRouteParamsById as VirtualParamsById,
  type FileRouteId as VirtualRouteId,
} from "virtual:sunfall-arc/routes";
import type {
  FileRouteHrefOptionsById as ProjectConsoleFileRouteHrefOptionsById,
  FileRouteLayouts as ProjectConsoleFileRouteLayouts,
  FileRouteMetadataModules as ProjectConsoleFileRouteMetadataModules,
  FileRouteId as ProjectConsoleFileRouteId,
  FileRouteParamsById as ProjectConsoleFileRouteParamsById,
  FileRouteSearchById as ProjectConsoleFileRouteSearchById,
  FileRouteHrefOptions as ProjectConsoleHref,
  FileRouteHrefArgs as ProjectConsoleHrefArgs,
  FileRouteHrefOptionsById as ProjectConsoleHrefById,
  FileRouteParamsById as ProjectConsoleParamsById,
  FileRouteId as ProjectConsoleRouteId,
  RouteTree as ProjectConsoleRouteTree,
} from "../examples/project-console/src/routeTree.gen.js";
import {
  layoutsById as projectConsoleLayoutsById,
  metadataById as projectConsoleMetadataById,
  routeById as projectConsoleRouteById,
} from "../examples/project-console/src/routeTree.gen.js";

/** Type-level only: the value a setup-time binding produces inside a Component setup. */
const bound = <A>(_binding: Effect.Effect<A, any, any>): A => undefined as never;

const tsrxOptions: SunfallArcTsrxOptions = {
  optimizeDeps: {
    noDiscovery: false,
  },
};
const tsrxPlugins: PluginOption[] = sunfallArcTsrx(tsrxOptions);
void tsrxPlugins;
const startRootRpcEndpointHelper: typeof createServerRpcResponse = createServerRpcResponse;
const startRootActionEndpointHelper: typeof createServerActionResponse = createServerActionResponse;
const startTransportEnvelopeOptions: StartTransportDiagnosticsOptions = { requestId: "req-type" };
const startTransportEnvelopeEffect: Effect.Effect<StartTransportEndpointEnvelope> =
  startTransportEndpointEnvelope(
    "rpc",
    new Request("https://example.com/__sunfall-arc/rpc"),
    startTransportEnvelopeOptions,
  );
void startRootRpcEndpointHelper;
void startRootActionEndpointHelper;
void startTransportEnvelopeEffect;

const ProjectTab = Schema.Literals(["overview", "activity"]);
const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
type ProjectId = typeof ProjectId.Type;
const atlasProjectId = Schema.decodeUnknownSync(ProjectId)("atlas");

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

interface Project {
  readonly id: string;
  readonly name: string;
}

declare const promisedProject: Promise<Project>;
declare const promisedProjects: Promise<ReadonlyArray<Project>>;
declare const maybePromisedProject: Project | Promise<Project>;
declare const promisedString: Promise<string>;
declare const promisedNumber: Promise<number>;
declare const promisedVoid: Promise<void>;
declare const promisedStartDevModule: Promise<Record<string, unknown>>;
declare const effectNumberValue: Effect.Effect<number>;
declare const thenableProject: {
  readonly then: () => void;
  readonly id: string;
  readonly name: string;
};
declare const optionalThenableProject: {
  readonly then?: () => void;
  readonly id: string;
  readonly name: string;
};
// @ts-expect-error direct EffectInput values cannot be Promise-shaped
toEffect(promisedProject);
// @ts-expect-error direct EffectInput values cannot hide Promise-shaped values behind explicit unknown
toEffect<unknown>(promisedProject);
// @ts-expect-error direct EffectInput values cannot hide Promise-shaped values behind explicit any
toEffect<any>(promisedProject);
// @ts-expect-error direct EffectInput values cannot be callable-then-shaped
toEffect(thenableProject);
// @ts-expect-error direct EffectInput values cannot be optional callable-then-shaped
toEffect(optionalThenableProject);
// @ts-expect-error EffectInput Effects cannot succeed with Promise-shaped values
toEffect(Effect.succeed(promisedProject));
// @ts-expect-error EffectInput Effects cannot hide Promise-shaped successes behind explicit unknown
toEffect<unknown>(Effect.succeed(promisedProject));
// @ts-expect-error EffectInput Effects cannot succeed with callable-then-shaped values
toEffect(Effect.succeed(thenableProject));
// @ts-expect-error EffectInput Effects cannot succeed with optional callable-then-shaped values
toEffect(Effect.succeed(optionalThenableProject));
// @ts-expect-error direct EffectInput values cannot be Effect-shaped domain values; wrap them in Effect.succeed(...)
toEffect<Effect.Effect<number>>(effectNumberValue);
const wrappedEffectValue = toEffect<Effect.Effect<number>>(Effect.succeed(effectNumberValue));
const wrappedEffectValueCheck: Effect.Effect<Effect.Effect<number>> = wrappedEffectValue;
void wrappedEffectValueCheck;
// @ts-expect-error State.next models cannot be Effect-shaped values; wrap domain Effects in Effect.succeed(...)
State.next(effectNumberValue);
// @ts-expect-error State commands cannot emit Effect-shaped messages
State.emit<Effect.Effect<number>>(Effect.succeed(effectNumberValue));
// @ts-expect-error State subscriptions cannot emit Effect-shaped messages
State.subscription(Stream.succeed(effectNumberValue));
// @ts-expect-error State initial models cannot be Effect-shaped values
State.define<Effect.Effect<number>, { readonly _tag: "Noop" }>()({
  name: "Test",
  initial: effectNumberValue,
  on: { Noop: (model: Effect.Effect<number>) => model },
});
// @ts-expect-error State.next models cannot be Promise-shaped values
State.next(promisedProject);
// @ts-expect-error State.next models cannot hide Promise-shaped values behind explicit unknown
State.next<unknown, { readonly _tag: "Bad" }>(promisedProject);
// @ts-expect-error Effects cannot hide State.next Promise-shaped model values
Effect.succeed(State.next(promisedProject));
// @ts-expect-error State commands cannot emit Promise-shaped messages
State.emit<unknown>(Effect.succeed(promisedProject));
// @ts-expect-error State commands cannot emit Promise-shaped messages
State.emit(promisedProject);
// @ts-expect-error State subscriptions cannot emit Promise-shaped messages
State.subscription(Stream.succeed(promisedProject));
// @ts-expect-error State messages are tagged values, never Promise-shaped
State.define<number, typeof promisedNumber>()({ name: "Test", initial: 0, on: {} });
// @ts-expect-error State messages are tagged values, never undefined (the command no-message sentinel)
State.define<number, undefined>()({ name: "Test", initial: 0, on: {} });
// @ts-expect-error State messages are tagged values, never void (the command no-message sentinel)
State.define<number, void>()({ name: "Test", initial: 0, on: {} });
// @ts-expect-error State messages are tagged values, not bare strings
State.define<number, "tick">()({ name: "Test", initial: 0, on: {} });
// @ts-expect-error State dispatch commands cannot accept undefined messages
State.emit<undefined>(undefined);
// An Effect that completes with `void` is a command that emits nothing.
const stateBackgroundCommand: State.Command<{ readonly _tag: "Done" }> = State.emit(Effect.void);
void stateBackgroundCommand;
// @ts-expect-error State initial models cannot be Promise-shaped
State.define<typeof promisedNumber, { readonly _tag: "Noop" }>()({
  name: "Test",
  initial: promisedNumber,
  on: { Noop: (model: typeof promisedNumber) => model },
});
// @ts-expect-error EffectInput callbacks cannot hide Promise-shaped values behind explicit unknown
invokeEffectInput<[], unknown>("Project.promiseUnknown", () => promisedProject);
// @ts-expect-error ActionResult.fromEffect rejects Promise-shaped direct values
ActionResult.fromEffect(promisedProject);
// @ts-expect-error ActionResult.fromEffect rejects Effect successes that are Promise-shaped
ActionResult.fromEffect(Effect.succeed(promisedProject));
// @ts-expect-error ActionResult.fromEffect successes must be plain data, not Effect-shaped
ActionResult.fromEffect(Effect.succeed(effectNumberValue));
// @ts-expect-error ActionResult.fromEffect rejects Effect successes hidden behind explicit unknown
ActionResult.fromEffect<unknown>(Effect.succeed(promisedProject));
// @ts-expect-error ActionResult.fromEffect rejects Effect failures that are Promise-shaped
ActionResult.fromEffect<Project, typeof promisedProject>(Effect.fail(promisedProject));
// @ts-expect-error ActionResult.fromEffect rejects Effect failures that are Effect-shaped
ActionResult.fromEffect<Project, typeof effectNumberValue>(Effect.fail(effectNumberValue));
// @ts-expect-error ActionResult.fromValidation rejects Promise-shaped direct values
ActionResult.fromValidation(promisedProject);
// @ts-expect-error ActionResult.fromValidation rejects Effect successes that are Promise-shaped
ActionResult.fromValidation(Effect.succeed(promisedProject));
// @ts-expect-error ActionResult.fromValidation successes must be plain data, not Effect-shaped
ActionResult.fromValidation<Effect.Effect<number>, string>(Effect.succeed(effectNumberValue));
// @ts-expect-error ActionResult.success rejects Promise-shaped payloads
ActionResult.success(promisedProject);
// @ts-expect-error ActionResult.success rejects Effect-shaped payloads
ActionResult.success(effectNumberValue);
// @ts-expect-error ActionResult.success rejects Promise-shaped payloads hidden behind explicit unknown
ActionResult.success<unknown>(promisedProject);
// @ts-expect-error ActionResult.success rejects Promise-shaped payloads hidden behind explicit any
ActionResult.success<any>(promisedProject);
// @ts-expect-error ActionResult.failure rejects Promise-shaped errors
ActionResult.failure(promisedProject);
// @ts-expect-error ActionResult.failure rejects Effect-shaped errors
ActionResult.failure(effectNumberValue);
// @ts-expect-error ActionResult field validation errors cannot be Effect-shaped
ActionResult.validation<{ readonly name: string }, Effect.Effect<number>>({
  fieldErrors: { name: [effectNumberValue] },
});
ActionResult.validation<{ readonly name: string }, Project>({
  // @ts-expect-error ActionResult field error maps cannot contain Promise-shaped errors
  fieldErrors: { name: [promisedProject] },
});
// @ts-expect-error ActionResult validation inputs cannot contain Promise-shaped form errors
ActionResult.validation<{ readonly name: string }, Project>({ formErrors: [promisedProject] });

type ProjectError = {
  readonly _tag: "ProjectError";
  readonly message: string;
};

// @ts-expect-error direct EffectInput values cannot include Promise-shaped union members
toEffect<typeof maybePromisedProject>(maybePromisedProject);
// @ts-expect-error ActionResult.fromEffect rejects Promise-shaped union success values
ActionResult.fromEffect<typeof maybePromisedProject>(maybePromisedProject);
// @ts-expect-error ActionResult.fromValidation rejects Promise-shaped union success values
ActionResult.fromValidation<typeof maybePromisedProject, ProjectError>(maybePromisedProject);
// @ts-expect-error invokeEffectInput rejects callbacks whose success type includes Promise-shaped union members
invokeEffectInput<[], typeof maybePromisedProject>("test.callback", () => maybePromisedProject);

const coreDefinitionRegistry = makeCoreDefinitionRegistry({
  actions: [{ name: "Project.rename", effect: Effect.void }],
  serverFunctions: new Map([["Project.get", { name: "Project.get", method: "GET" as const }]]),
});
const coreDefinitionRegistryAction = coreDefinitionRegistry.actions.get("Project.rename");
const coreDefinitionRegistryServer = coreDefinitionRegistry.serverFunctions.get("Project.get");
const coreDefinitionRegistryAdapter = makeCoreDefinitionRegistryAdapter<
  { readonly name: string; readonly effect: Effect.Effect<void> },
  { readonly name: string; readonly method: "GET" | "POST" }
>({ duplicates: "keep-first" });
const coreActionRegistration = coreDefinitionRegistryAdapter.registerAction({
  name: "Project.rename",
  effect: Effect.void,
});
const coreDuplicateActionRegistration = coreDefinitionRegistryAdapter.registerAction({
  name: "Project.rename",
  effect: Effect.void,
});
const coreServerRegistration = coreDefinitionRegistryAdapter.registerServerFunction({
  name: "Project.get",
  method: "GET",
});
const coreDefinitionDiagnostics = coreDefinitionRegistryAdapter.diagnostics();
const coreDefinitionDuplicatePolicy: "keep-first" | "replace" =
  coreDefinitionDiagnostics.duplicates[0]?.policy ?? "replace";
const actionSubmissionConcurrency: Action.Concurrency = "exhaust";
const actionSubmissionIdleState: Action.State<{ readonly id: string }, Project, ProjectError> = {
  result: AsyncResult.initial(),
  input: Option.none(),
};
const actionSubmissionSuccessState: Action.State<{ readonly id: string }, Project, ProjectError> = {
  result: AsyncResult.success({ id: "atlas", name: "Atlas" }, { timestamp: 1 }),
  input: Option.some({ id: "atlas" }),
};
const actionSubmissionController = makeActionSubmissionController<
  { readonly id: string },
  Project,
  ProjectError
>({
  actionName: "Project.rename",
  concurrency: actionSubmissionConcurrency,
});
const actionSubmissionState: Action.State<{ readonly id: string }, Project, ProjectError> =
  actionSubmissionController.state.get();
void coreDefinitionRegistryAction;
void coreDefinitionRegistryServer;
void coreActionRegistration;
void coreDuplicateActionRegistration;
void coreServerRegistration;
void coreDefinitionDuplicatePolicy;
void actionSubmissionIdleState;
void actionSubmissionSuccessState;
void actionSubmissionState;

const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
});
const OptionsFreeProjectRoute = Route.define("/options-free-projects/:id");
Route.href(OptionsFreeProjectRoute, {
  params: { id: "atlas" },
});
// @ts-expect-error options-free routes still preserve inferred path params
Route.href(OptionsFreeProjectRoute, { params: {} });
void OptionsFreeProjectRoute;
const StaticProjectRoute = Route.define("/static-projects");
Route.href(StaticProjectRoute);
Route.href(StaticProjectRoute, {});

const routeGrammarSegments = parseRoutePathSegments("/projects/:projectId/tasks/:taskId?");
const routeGrammarPath: string = routePathFromSegments(routeGrammarSegments);
const routeGrammarParams = routeParamsFromSegments(routeGrammarSegments);
const routeGrammarParamName: string | undefined = routeGrammarParams[0]?.name;
const routeGrammarParamOptional: boolean | undefined = routeGrammarParams[1]?.optional;
const routeGrammarSlug: string = routePathSlug("/projects/:projectId/tasks/:taskId?");
const routeGrammarIsParam: boolean = isRouteParamName("projectId");
const routeGrammarMatch: Record<string, string> | undefined = matchRoutePath(
  "/projects/:projectId/tasks/:taskId?",
  "/projects/atlas/tasks/rename",
);
const routeGrammarHref: string = buildRoutePath("/projects/:projectId/tasks/:taskId?", {
  projectId: "atlas",
});
const routeGrammarInputHref: string = hrefForRouteInput("/projects/atlas?tab=activity");
const routeGrammarInferredParams: ParamsForPath<"/projects/:projectId/tasks/:taskId?"> = {
  projectId: "atlas",
};
const routeGrammarInferredParamsWithOptional: ParamsForPath<"/projects/:projectId/tasks/:taskId?"> =
  {
    projectId: "atlas",
    taskId: "rename",
  };
// @ts-expect-error route grammar params keep required path params required
const routeGrammarMissingParams: ParamsForPath<"/projects/:projectId/tasks/:taskId?"> = {};
void routeGrammarPath;
void routeGrammarParamName;
void routeGrammarParamOptional;
void routeGrammarSlug;
void routeGrammarIsParam;
void routeGrammarMatch;
void routeGrammarHref;
void routeGrammarInputHref;
void routeGrammarInferredParams;
void routeGrammarInferredParamsWithOptional;

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" },
});
Route.withComponent(ProjectRoute, (props) => {
  const id: string = props.params.id;
  const tab: "overview" | "activity" | undefined = props.search.tab;
  const match: Route.Match<typeof ProjectRoute> = props.match;
  void id;
  void tab;
  void match;
  return undefined;
});
Route.withComponent(
  ProjectRoute,
  // @ts-expect-error route components receive the route's typed params/search/match props
  (props: { readonly params: { readonly slug: string } }) => undefined,
);

// @ts-expect-error missing route param
Route.href(ProjectRoute, { params: {} });

declare const projectRouterFailure: Extract<
  BrowserRouterState<readonly [typeof ProjectRoute]>,
  { readonly _tag: "Failure" }
>;
const projectRouterFailureCause: Cause.Cause<BrowserRouterError<readonly [typeof ProjectRoute]>> =
  projectRouterFailure.cause;
const projectRouterFailureError: BrowserRouterError<readonly [typeof ProjectRoute]> | undefined =
  projectRouterFailure.error;
void projectRouterFailureCause;
void projectRouterFailureError;
const routerContextMissing = new RouterContextMissing({ hook: "useRouter" });
const routerContextMissingHook: string = routerContextMissing.hook;
const routerRouteNotRegistered = new RouterRouteNotRegistered({ path: "/outside" });
const routerRouteNotRegisteredPath: string = routerRouteNotRegistered.path;
const routerRouteNotRegisteredTag: "RouterRouteNotRegistered" = routerRouteNotRegistered._tag;
void routerContextMissingHook;
void routerRouteNotRegisteredPath;
void routerRouteNotRegisteredTag;
const memoryBrowserHistory: MemoryBrowserHistoryAdapter = makeMemoryBrowserHistoryAdapter({
  initialHref: "/projects/atlas",
});
const browserHistoryAdapter: BrowserHistoryAdapter = memoryBrowserHistory;
const browserHistoryEntries: ReadonlyArray<string> = memoryBrowserHistory.entries();
memoryBrowserHistory.externalNavigate("/projects/grace");
declare const browserHistoryWindow: BrowserHistoryWindow | undefined;
const windowBrowserHistory: BrowserHistoryAdapter = makeWindowBrowserHistoryAdapter(
  () => browserHistoryWindow,
);
const browserHistoryCurrentHref: string = windowBrowserHistory.currentHref("/");
const browserHistoryCommittedHref: string = browserHistoryAdapter.commit("/projects/ada", {
  replace: true,
});
void browserHistoryEntries;
void browserHistoryCurrentHref;
void browserHistoryCommittedHref;
const projectRouterFailureRenderer: NonNullable<
  RouterOutletProps<
    readonly Route.Definition<string, unknown, unknown, any>[],
    ProjectError
  >["failure"]
> = (state) => {
  const cause: Cause.Cause<
    BrowserRouterError<readonly Route.Definition<string, unknown, unknown, any>[]> | ProjectError
  > = state.cause;
  const error:
    | BrowserRouterError<readonly Route.Definition<string, unknown, unknown, any>[]>
    | ProjectError
    | undefined = state.error;
  void cause;
  void error;
  return undefined;
};
void projectRouterFailureRenderer;
const projectRouterOutletProps: Omit<
  RouterOutletProps<readonly [typeof ProjectRoute], ProjectError>,
  "router"
> = {
  pending: (state) => {
    const match: Route.Match<typeof ProjectRoute> = state.match;
    match.params.id.toUpperCase();
    return undefined;
  },
  failure: (state) => {
    const match: Route.Match<typeof ProjectRoute> | undefined = state.match;
    const cause: Cause.Cause<BrowserRouterError<readonly [typeof ProjectRoute]> | ProjectError> =
      state.cause;
    match?.params.id.toUpperCase();
    void cause;
    return undefined;
  },
};
// Route `error` schemas type the preload failure end to end.
class TypedProjectNotFound extends Schema.TaggedError<TypedProjectNotFound>()(
  "TypedProjectNotFound",
  { id: Schema.String },
) {}
class TypedProjectForbidden extends Schema.TaggedError<TypedProjectForbidden>()(
  "TypedProjectForbidden",
  { id: Schema.String },
) {}
const TypedProjectRoute = Route.define("/typed-projects/:id", {
  error: Schema.Union([TypedProjectNotFound, TypedProjectForbidden]),
  preload: ({ params }) =>
    params.id === "secret"
      ? Effect.fail(new TypedProjectForbidden({ id: params.id }))
      : Effect.fail(new TypedProjectNotFound({ id: params.id })),
});
const typedProjectRouteFailure: Route.PreloadFailure<typeof TypedProjectRoute> =
  new TypedProjectNotFound({ id: "atlas" });
// @ts-expect-error the route failure is exactly the error schema's type
const typedProjectRouteFailureWrong: Route.PreloadFailure<typeof TypedProjectRoute> = "missing";
const untypedPreloadRoute = Route.define("/untyped-projects/:id", {
  preload: () => Effect.fail("x"),
});
// Without an `error` schema only the failure's `_tag` crosses the wire.
const untypedProjectRouteFailure: [Route.PreloadFailure<typeof untypedPreloadRoute>] extends [
  RoutePreloadUntypedFailure,
]
  ? [RoutePreloadUntypedFailure] extends [Route.PreloadFailure<typeof untypedPreloadRoute>]
    ? true
    : false
  : false = true;
const staticRoute = Route.define("/static");
const staticRouteFailure: [Route.PreloadFailure<typeof staticRoute>] extends [never]
  ? true
  : false = true;
const typedProjectPreload: Effect.Effect<
  void,
  RoutePreloadError<TypedProjectNotFound | TypedProjectForbidden>
> = Route.preload(Route.match([TypedProjectRoute], "/typed-projects/atlas")!);
Route.define("/typed-projects/:id", {
  // @ts-expect-error preload may fail only with the route error schema's type
  error: TypedProjectNotFound,
  preload: () => Effect.fail(new TypedProjectForbidden({ id: "atlas" })),
});
Route.define("/typed-projects/:id", {
  // @ts-expect-error untyped failures are rejected when the route declares an error schema
  error: TypedProjectNotFound,
  preload: () => Effect.fail("missing"),
});
Route.define("/typed-projects/:id", {
  error: TypedProjectNotFound,
  preload: () => Effect.void,
});
const typedProjectOutletProps: Omit<
  RouterOutletProps<readonly [typeof TypedProjectRoute]>,
  "router"
> = {
  failure: (state) => {
    if (state.error?._tag === "RoutePreloadError") {
      const failure: TypedProjectNotFound | TypedProjectForbidden = state.error.cause;
      const id: string = state.error.cause.id;
      void failure;
      void id;
    }
    return undefined;
  },
};
void typedProjectRouteFailure;
void typedProjectRouteFailureWrong;
void untypedProjectRouteFailure;
void staticRouteFailure;
void typedProjectPreload;
void typedProjectOutletProps;
const projectBrowserRouter: BrowserRouter<readonly [typeof ProjectRoute]> =
  useRouter<readonly [typeof ProjectRoute]>();
const projectBrowserRouterCoreProjection: Omit<
  BrowserRouterHostController<readonly [typeof ProjectRoute]>,
  "state" | "match" | "start" | "dispose" | "dispose"
> = projectBrowserRouter;
const projectBrowserRouterState: BrowserRouterState<readonly [typeof ProjectRoute]> =
  projectBrowserRouter.state();
const projectBrowserRouterMatch: Route.Match<typeof ProjectRoute> | undefined =
  projectBrowserRouter.match();
projectBrowserRouter.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" },
});
projectBrowserRouter.navigate(ProjectRoute, {
  params: { id: "atlas" },
  search: {},
});
const projectBrowserRouterPreload: Effect.Effect<
  void,
  BrowserRouterError<readonly [typeof ProjectRoute]>
> = projectBrowserRouter.preload(ProjectRoute, {
  params: { id: "atlas" },
  search: {},
});
const coreRouterLinkPreloadDecision: BrowserRouterLinkPreloadDecision =
  browserRouterLinkPreloadDecision({
    defaultPrevented: false,
    preload: true,
    canHandleRoute: true,
    target: "_self",
  });
const coreRouterLinkPreloadIdentity: BrowserRouterLinkPreloadIdentity =
  browserRouterLinkPreloadIdentity({
    href: "/projects/atlas",
    preload: true,
    canHandleRoute: true,
    target: "_self",
  });
const coreRouterLinkClickDecision: BrowserRouterLinkClickDecision = browserRouterLinkClickDecision({
  event: {
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
  },
  href: "/projects/atlas",
  replace: true,
  canHandleRoute: true,
});
if (coreRouterLinkPreloadDecision._tag === "Ignore") {
  const reason: BrowserRouterLinkIgnoreReason = coreRouterLinkPreloadDecision.reason;
  void reason;
}
if (coreRouterLinkClickDecision._tag === "Navigate") {
  const href: string = coreRouterLinkClickDecision.href;
  const replace: boolean | undefined = coreRouterLinkClickDecision.options?.replace;
  void href;
  void replace;
}
const mixedProjectBrowserRouter =
  useRouter<readonly [typeof StaticProjectRoute, typeof ProjectRoute]>();
const projectBrowserNavigateArgs: BrowserNavigateArgs<typeof ProjectRoute> = [
  {
    params: { id: "atlas" },
    search: {},
  },
];
const staticBrowserNavigateArgs: BrowserNavigateArgs<typeof StaticProjectRoute> = [];
mixedProjectBrowserRouter.href(StaticProjectRoute);
mixedProjectBrowserRouter.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" },
});
mixedProjectBrowserRouter.navigate(StaticProjectRoute);
mixedProjectBrowserRouter.navigate(
  ProjectRoute,
  {
    params: { id: "atlas" },
    search: {},
  },
  { replace: true },
);
const mixedProjectBrowserRouterPreload: Effect.Effect<
  void,
  BrowserRouterError<readonly [typeof StaticProjectRoute, typeof ProjectRoute]>
> = mixedProjectBrowserRouter.preload(ProjectRoute, {
  params: { id: "atlas" },
  search: {},
});
// @ts-expect-error browser router hrefs preserve route params
mixedProjectBrowserRouter.href(ProjectRoute, { params: {} });
// @ts-expect-error browser router hrefs preserve static route params
mixedProjectBrowserRouter.href(StaticProjectRoute, { params: { id: "atlas" } });
// @ts-expect-error browser router href preserves route params
projectBrowserRouter.href(ProjectRoute, { params: {} });
const projectRouterLinkProps: RouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  options: {
    params: { id: "atlas" },
    search: { tab: "activity" },
  },
  class: "projectLink",
};
const staticRouterLinkProps: RouterLinkProps<typeof StaticProjectRoute> = {
  route: StaticProjectRoute,
};
const badProjectRouterLinkProps: RouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  // @ts-expect-error RouterLink preserves route params
  options: { params: {} },
};
void projectRouterOutletProps;
void projectBrowserRouterPreload;
void projectBrowserRouterCoreProjection;
void projectBrowserRouterState;
void projectBrowserRouterMatch;
void projectBrowserNavigateArgs;
void staticBrowserNavigateArgs;
void mixedProjectBrowserRouterPreload;
void projectRouterLinkProps;
void staticRouterLinkProps;
void badProjectRouterLinkProps;

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error invalid search literal
  search: { tab: "settings" },
});

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error unknown search key
  search: { sort: "name" },
});

const BrandedProjectRoute = Route.define("/branded-projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
});
const brandedRouterLinkProps: RouterLinkProps<typeof BrandedProjectRoute> = {
  route: BrandedProjectRoute,
  options: { params: { id: atlasProjectId } },
};
const badBrandedRouterLinkProps: RouterLinkProps<typeof BrandedProjectRoute> = {
  route: BrandedProjectRoute,
  options: {
    params: {
      // @ts-expect-error RouterLink preserves branded route params
      id: "atlas",
    },
  },
};

Route.href(BrandedProjectRoute, {
  params: { id: atlasProjectId },
});
void brandedRouterLinkProps;
void badBrandedRouterLinkProps;

// @ts-expect-error branded route params reject accidental plain strings
Route.href(BrandedProjectRoute, { params: { id: "atlas" } });

const OptionalProjectRoute = Route.define("/optional-projects/:id?", {});

Route.href(OptionalProjectRoute);
Route.href(OptionalProjectRoute, { params: {} });
Route.href(OptionalProjectRoute, { params: { id: "atlas" } });

// @ts-expect-error optional route params still reject unknown keys
Route.href(OptionalProjectRoute, { params: { slug: "atlas" } });

const generatedRouteTree = [
  Route.define("/", {}),
  Route.define("/generated-projects/:id", {}),
] as const;
const generatedRouteById = {
  route_root: generatedRouteTree[0],
  route_generated_projects_$id: generatedRouteTree[1],
} as const;

Route.href(generatedRouteById.route_generated_projects_$id, {
  params: { id: "atlas" },
});

// @ts-expect-error generated route values use the canonical href param checks
Route.href(generatedRouteById.route_generated_projects_$id, { params: {} });

const projectConsoleRouteId: ProjectConsoleFileRouteId = "route_projects_$id";
const projectConsoleFriendlyRouteId: ProjectConsoleRouteId = projectConsoleRouteId;
const projectConsoleRouteParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = {
  id: makeProjectConsoleProjectId("atlas"),
};
const projectConsoleFriendlyRouteParams: ProjectConsoleParamsById["route_projects_$id"] =
  projectConsoleRouteParams;
const projectConsoleRouteSearch: ProjectConsoleFileRouteSearchById["route_projects_$id"] = {
  tab: "activity",
};
const projectConsoleHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  params: projectConsoleRouteParams,
  search: projectConsoleRouteSearch,
};
const projectConsoleFriendlyHrefById: ProjectConsoleHrefById["route_projects_$id"] =
  projectConsoleHrefOptions;
const projectConsoleFriendlyHref: ProjectConsoleHref<"route_projects_$id"> =
  projectConsoleHrefOptions;
const projectConsoleFriendlyHrefArgs: ProjectConsoleHrefArgs<"route_projects_$id"> = [
  projectConsoleHrefOptions,
];

Route.href(projectConsoleRouteById.route_projects_$id, projectConsoleHrefOptions);
Route.href(projectConsoleRouteById.route_root);
const projectConsoleLayouts: ProjectConsoleFileRouteLayouts<"route_projects_$id"> =
  projectConsoleLayoutsById("route_projects_$id");
const projectConsoleMetadataModules: ProjectConsoleFileRouteMetadataModules<"route_projects_$id"> =
  projectConsoleMetadataById("route_projects_$id");
void projectConsoleLayouts;
void projectConsoleMetadataModules;
declare const projectConsoleBroadMatch: Route.Match<ProjectConsoleRouteTree[number]> | undefined;
if (Route.isMatch(projectConsoleRouteById.route_projects_$id, projectConsoleBroadMatch)) {
  projectConsoleBroadMatch.params.id;
  // @ts-expect-error route-match narrowing exposes only declared params
  projectConsoleBroadMatch.params.slug;
}

const virtualRouteList: readonly Route.Definition<string, unknown, unknown, any>[] =
  virtualFileRoutes;
const virtualRouteByIdMap: Readonly<
  Record<string, Route.Definition<string, unknown, unknown, any>>
> = virtualRouteById;
const virtualFileRouteId: VirtualFileRouteId = "route_anything";
const virtualRouteId: VirtualRouteId = virtualFileRouteId;
const virtualParamsById: VirtualParamsById = {};
const virtualHrefById: VirtualHrefById = {};
const virtualLayouts: VirtualFileRouteLayouts<VirtualRouteId> = virtualLayoutsById(virtualRouteId);
const virtualMetadataModules: VirtualFileRouteMetadataModules<VirtualRouteId> =
  virtualMetadataById(virtualRouteId);
declare const virtualHref: VirtualHref<VirtualRouteId>;
declare const virtualHrefArgs: VirtualHrefArgs<VirtualRouteId>;
void virtualLayouts;
void virtualMetadataModules;
const emptyFileRouteManifest: FileRouteManifest = {
  version: 1,
  entries: [],
  modules: [],
};
const fileRouteDefinitionsOptions: FileRouteDefinitionsModuleOptions = {
  generatedFile: "src/routeTree.gen.ts",
  importMode: "relative",
};
const generatedFileRouteModule: Effect.Effect<string, FileRouteDefinitionsModuleError> =
  createFileRouteDefinitionsModule(emptyFileRouteManifest, fileRouteDefinitionsOptions);
const generatedFileRouteDefinitionsOptions: GeneratedFileRouteDefinitionsModuleOptions = {
  generatedFile: "src/routeTree.gen.ts",
  header: "// generated by sunfall-arc",
};
const generatedFileRouteDefinitionsModule: Effect.Effect<string, FileRouteDefinitionsModuleError> =
  createGeneratedFileRouteDefinitionsModule(
    emptyFileRouteManifest,
    generatedFileRouteDefinitionsOptions,
  );
const generatedFileRouteWriteEffect: Effect.Effect<
  FileRouteDefinitionsFileWriteResult | undefined,
  FileRouteDefinitionsFileWriteFailure
> = writeFileRouteDefinitionsFile(".", emptyFileRouteManifest, {
  outputFile: false,
});
const generatedFileRouteHeader: string = defaultGeneratedFileRouteDefinitionsHeader;
const invalidFileRouteExportName = new FileRouteDefinitionsModuleInvalidExportName({
  exportName: "1Route",
});
const invalidFileRouteIdentifier = new FileRouteDefinitionsModuleInvalidIdentifier({
  routeId: "route-with-dash",
  routePath: "/",
});
void projectConsoleRouteId;
void projectConsoleFriendlyRouteId;
void projectConsoleHrefOptions;
void projectConsoleFriendlyRouteParams;
void projectConsoleFriendlyHrefById;
void projectConsoleFriendlyHref;
void projectConsoleFriendlyHrefArgs;
void virtualRouteList;
void virtualRouteByIdMap;
void virtualFileRouteId;
void virtualRouteId;
void virtualParamsById;
void virtualHrefById;
void virtualHref;
void virtualHrefArgs;
void generatedFileRouteModule;
void generatedFileRouteDefinitionsOptions;
void generatedFileRouteDefinitionsModule;
void generatedFileRouteWriteEffect;
void generatedFileRouteHeader;
void invalidFileRouteExportName;
void invalidFileRouteIdentifier;

// @ts-expect-error generated route definitions keep canonical href param checks
Route.href(projectConsoleRouteById.route_projects_$id, { params: {} });

// @ts-expect-error generated route id union rejects unknown ids
const projectConsoleUnknownRouteId: ProjectConsoleFileRouteId = "route_missing";

const projectConsolePlainParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = {
  // @ts-expect-error generated params preserve branded project ids
  id: "atlas",
};

const projectConsoleBadHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  // @ts-expect-error generated href options reject missing route params
  params: {},
  search: { tab: "activity" },
};

const projectConsoleBadSearch: ProjectConsoleFileRouteSearchById["route_projects_$id"] = {
  // @ts-expect-error generated search options preserve schema literals
  tab: "timeline",
};

const ProjectErrorSchema = Schema.Struct({
  _tag: Schema.Literal("ProjectError"),
  message: Schema.String,
});

const GetProject = Server.contract("Project.get", {
  input: Schema.Struct({ id: Schema.String }),
  output: ProjectSchema,
  error: ProjectErrorSchema,
});
// Contract types come from the schemas.
const getProjectContract: Server.Contract<{ readonly id: string }, Project, ProjectError> =
  GetProject;
void getProjectContract;

// @ts-expect-error server functions require an output schema
Server.contract("Project.missingOutput", { input: Schema.String });

// @ts-expect-error server functions require an input schema
Server.contract("Project.missingInput", { output: Schema.String });

const getProject = Server.client(GetProject);

getProject.effect({ id: "atlas" });

// @ts-expect-error missing server function input field
getProject.effect({});

// @ts-expect-error incorrect server function input field
getProject.effect({ slug: "atlas" });

Server.mock(GetProject, ({ id }) => Effect.succeed({ id, name: "Mock Project" }));

// @ts-expect-error plain mock output must satisfy the contract output type
Server.mock(GetProject, ({ id }) => ({ id }));

// @ts-expect-error mock input comes from the contract
Server.mock(GetProject, (input: { readonly slug: string }) =>
  Effect.succeed({ id: input.slug, name: "Mock Project" }),
);

Server.implement(GetProject, ({ id }) => Effect.succeed({ id, name: "Server Project" }));

const GetProjectWithResponseContext = Server.implement(GetProject, ({ id }) =>
  Effect.gen(function* () {
    const response = yield* ResponseContext;
    yield* response.setHeader("x-project-id", id);
    return { id, name: "Server Project" };
  }),
);
const getProjectWithResponseContextEffect: Effect.Effect<
  Project,
  ProjectError | Server.ClientError | EffectInputCallbackError,
  ResponseContext
> = GetProjectWithResponseContext.effect({ id: "atlas" });

// @ts-expect-error implementation output must satisfy the contract output type
Server.implement(GetProject, ({ id }) => ({ id }));

// @ts-expect-error server implementations must return Effect or a pure value, not Promise
Server.implement(GetProject, () => promisedProject);

const LooseServerContract = Server.contract("Loose.server", {
  input: Schema.Void,
  output: Schema.Unknown,
});
Server.implement(LooseServerContract, () => "ok");
Server.mock(LooseServerContract, () => "ok");

// @ts-expect-error broad server implementations must still reject Promise-shaped values
Server.implement(LooseServerContract, () => promisedString);

// @ts-expect-error broad server mocks must still reject Promise-shaped values
Server.mock(LooseServerContract, () => promisedString);

const ProjectTag = Resource.tag<{ readonly id: string }>("Project", {
  key: ({ id }) => id,
});
const ProjectsTag = Resource.tag("Projects");

// @ts-expect-error keyed resource tags require key options
Resource.tag<{ readonly id: string }>("Project.missingOptions");

ProjectTag({ id: "atlas" });

// @ts-expect-error resource tag input must match the tag definition
ProjectTag({ slug: "atlas" });

const ProjectById = Resource.define<string, Project, ProjectError | Server.ClientError>({
  name: "Project.byId",
  input: Schema.String,
  output: ProjectSchema,
  load: (id) => getProject.effect({ id }),
  provides: (project) => [ProjectTag({ id: project.id })],
});

const resourceDefinitionRegistry = makeResourceDefinitionRegistry({ duplicates: "keep-first" });
const resourceFamilyRegistration = resourceDefinitionRegistry.registerFamily(
  ProjectById.family.options.name,
  ProjectById.family,
);
const resourceTagRegistration = resourceDefinitionRegistry.registerTag(ProjectTag.name, {
  name: ProjectTag.name,
  keyed: true,
});
const resourceDefinitionDiagnostics = resourceDefinitionRegistry.diagnostics();
const resourceDefinitionDuplicatePolicy: "keep-first" | "replace" =
  resourceDefinitionDiagnostics.duplicates[0]?.policy ?? "replace";
const adapterResourceStore = makeResourceStore();
const typedAdapterResourceStore: ResourceStore = adapterResourceStore;
class AdapterCleanupError {
  readonly _tag = "AdapterCleanupError";
}
adapterResourceStore.moduleRegistry.register(Symbol("adapter-module"), {
  dispose: Effect.void,
});
adapterResourceStore.moduleRegistry.register(Symbol("adapter-cleanup-error"), {
  dispose: Effect.fail(new AdapterCleanupError()),
});
const adapterResourceStoreModuleCount: Effect.Effect<number> =
  adapterResourceStore.diagnostics.moduleCount;
const adapterResourceStoreEventBusShutdown: Effect.Effect<boolean> =
  adapterResourceStore.diagnostics.eventBusShutdown;
const adapterResourceStoreDispose: Effect.Effect<void, ResourceStoreDisposeError> =
  disposeResourceStore(adapterResourceStore);
const publicResourceStoreRuntime = makeRuntime();
// @ts-expect-error ResourceStore internals are intentionally not public.
publicResourceStoreRuntime.resourceStore.entries;
// @ts-expect-error ResourceStore internals are intentionally not public.
publicResourceStoreRuntime.resourceStore.fibers;
const resourceSnapshotOperation: Resource.SnapshotCodecOperation = "hydrate";
const clonedResourceSnapshotValue: Project = cloneResourceSnapshotValue({
  id: "atlas",
  name: "Atlas",
});
const resourceSnapshot: Resource.Snapshot<string, Project> = {
  name: ProjectById.family.options.name,
  key: ProjectById("atlas").key,
  input: "atlas",
  state: {
    _tag: "Success",
    value: clonedResourceSnapshotValue,
    waiting: false,
    timestamp: 1,
  },
};
const directResourceHydrationPayload: Resource.HydrationPayload = { resources: [resourceSnapshot] };
void resourceFamilyRegistration;
void resourceTagRegistration;
void resourceDefinitionDiagnostics;
void resourceDefinitionDuplicatePolicy;
void adapterResourceStoreModuleCount;
void adapterResourceStoreEventBusShutdown;
void adapterResourceStoreDispose;
void typedAdapterResourceStore;

Resource.preload(ProjectById("atlas"));
const deleteProjectEffect: Effect.Effect<void> = Resource.evict(ProjectById("atlas"));
const projectReadEffect: Effect.Effect<
  Project,
  Resource.ReadError<string, Project, ProjectError | Server.ClientError>,
  ProjectApi
> = Resource.read(ProjectById("atlas"));
const projectSuspenseRead: Project = bound(Component.resource(ProjectById))("atlas");
const projectResourcePending = new ResourcePending({
  ref: ProjectById("atlas"),
  reason: "Pending",
  result: AsyncResult.initial<Project, ProjectError | Server.ClientError>(true),
  guidance: "Preload before reading.",
});
const projectResourcePendingState: "Initial" | "Pending" | "Collected" =
  projectResourcePending.reason;
const projectResourcePendingPrevious: Option.Option<Project> = AsyncResult.value(
  projectResourcePending.result,
);
const projectResourcePendingHasPrevious: boolean = Option.isSome(projectResourcePendingPrevious);
const projectResourceFailure = new ResourceFailure({
  ref: ProjectById("atlas"),
  result: AsyncResult.fail<ProjectError | Server.ClientError, Project>({
    _tag: "ProjectError",
    message: "not found",
  } as ProjectError | Server.ClientError),
});
const projectResourceFailureError: Option.Option<ProjectError | Server.ClientError> =
  AsyncResult.error(projectResourceFailure.result);
const projectResourceFailureHasPrevious: boolean = Option.isSome(
  projectResourceFailure.result.previousSuccess,
);
const typedProjectResourceFailure: ResourceFailure<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi,
  ProjectError | Server.ClientError
> = projectResourceFailure;
const projectResourceFailureInput: string = typedProjectResourceFailure.ref.input;
const projectResourceFailureRef: Resource.Ref<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi
> = typedProjectResourceFailure.ref;
void projectSuspenseRead;
void projectResourcePendingState;
void projectResourcePendingPrevious;
void projectResourcePendingHasPrevious;
void projectResourceFailureError;
void projectResourceFailureHasPrevious;
void projectResourceFailureInput;
void projectResourceFailureRef;
void deleteProjectEffect;

Resource.define<string, Project>({
  name: "Project.asyncResource",
  // @ts-expect-error resource loaders must return Effect or a pure value, not Promise
  load: () => promisedProject,
});

Resource.define<string, Project>({
  name: "Project.asyncResourceEffect",
  // @ts-expect-error resource loaders cannot return Effects that succeed with Promise-shaped values
  load: () => Effect.succeed(promisedProject),
});

Resource.define<string, unknown>({
  name: "Project.asyncResourceUnknown",
  // @ts-expect-error resource loaders cannot hide Promise-shaped values behind explicit unknown
  load: () => promisedProject,
});

Resource.define<string, unknown>({
  name: "Project.asyncResourceUnknownEffect",
  // @ts-expect-error resource loaders cannot hide Effect Promise successes behind explicit unknown
  load: () => Effect.succeed(promisedProject),
});

Resource.define<string, Effect.Effect<number>>({
  name: "Project.effectValuedResource",
  // @ts-expect-error explicit Effect-valued resource outputs must be wrapped in Effect.succeed(...)
  load: () => effectNumberValue,
});

Resource.define<string, Effect.Effect<number>>({
  name: "Project.wrappedEffectValuedResource",
  load: () => Effect.succeed(effectNumberValue),
});

// @ts-expect-error unannotated resource loaders must return Effect or a pure value, not Promise
Resource.define({
  name: "Project.asyncResourceInferred",
  load: () => promisedProject,
});

// @ts-expect-error unannotated resource loaders cannot return callable-then-shaped values
Resource.define({
  name: "Project.thenableResourceInferred",
  load: () => thenableProject,
});

// @ts-expect-error unannotated resource loaders cannot return Effects that succeed with callable-then-shaped values
Resource.define({
  name: "Project.thenableResourceEffectInferred",
  load: () => Effect.succeed(thenableProject),
});

const BrandedProjectById = Resource.define<ProjectId, Project, ProjectError>({
  name: "Project.byBrandedId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => Effect.succeed({ id, name: "Branded" }),
});

Resource.preload(BrandedProjectById(atlasProjectId));

// @ts-expect-error branded resource inputs reject accidental plain strings
Resource.preload(BrandedProjectById("atlas"));

const resourceHydrateEffect: Effect.Effect<
  void,
  Resource.SnapshotCodecError | Resource.HydrationApplyError | EffectInputCallbackError
> = Resource.hydrate({ resources: [] });
// @ts-expect-error Resource hydration accepts payload objects, not raw snapshot arrays
Resource.hydrate([resourceSnapshot]);
const resourceDecodeEffect: Effect.Effect<Resource.HydrationPayload, Resource.SnapshotCodecError> =
  Resource.decodeHydrationPayload('{"resources":[]}');
const resourceHydrationPayload: Effect.Effect<
  Resource.HydrationPayload,
  Resource.SnapshotCodecError
> = Resource.hydrationPayload([]);
declare const frameworkResourceTagAlias: Resource.Tag;
declare const frameworkResourceInvalidationAlias: Resource.Invalidation;
declare const frameworkResourceInvalidationTargetAlias: Resource.InvalidationTarget;
declare const frameworkResourceInvalidationCauseAlias: Resource.InvalidationCause;
declare const frameworkResourceInvalidationPlanEntryAlias: Resource.InvalidationPlanEntry;
declare const frameworkResourceInvalidationPlanAlias: Resource.InvalidationPlan;
declare const frameworkResourceHydrationPayloadAlias: Resource.HydrationPayload;
declare const frameworkResourceHydrationOptionsAlias: Resource.HydrationOptions;
declare const frameworkResourceStatusAlias: Resource.Status<string, Project>;
void resourceHydrationPayload;
void directResourceHydrationPayload;
void frameworkResourceTagAlias;
void frameworkResourceInvalidationAlias;
void frameworkResourceInvalidationTargetAlias;
void frameworkResourceInvalidationCauseAlias;
void frameworkResourceInvalidationPlanEntryAlias;
void frameworkResourceInvalidationPlanAlias;
void frameworkResourceHydrationPayloadAlias;
void frameworkResourceHydrationOptionsAlias;
void frameworkResourceStatusAlias;

interface ProjectRequest extends EffectRequest.Request<Project, ProjectError> {
  readonly _tag: "ProjectRequest";
  readonly id: ProjectId;
}
const ProjectRequest = EffectRequest.tagged<ProjectRequest>("ProjectRequest");
declare const projectRequestResolver: RequestResolver.RequestResolver<ProjectRequest>;
const ProjectByRequest = Resource.define({
  name: "Project.byRequest",
  input: ProjectId,
  output: ProjectSchema,
  request: (id: ProjectId) => ProjectRequest({ id }),
  resolver: projectRequestResolver,
});
Effect.map(Resource.preload(ProjectByRequest(atlasProjectId)), (project) => {
  project.id.toUpperCase();
  project.name.toUpperCase();
});

// @ts-expect-error Resource.define preserves the request input type
ProjectByRequest("atlas");

const ServicefulProjectResource = Resource.define<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi
>({
  name: "Project.servicefulInvalidation",
  load: (id) => ProjectApi.use((api) => api.get(id)),
});
const servicefulInvalidationEffect: Effect.Effect<void, never, ProjectApi> = Resource.invalidate(
  ServicefulProjectResource("atlas"),
);
// @ts-expect-error Resource invalidation preserves service requirements from direct ref targets
const servicefulInvalidationWithoutService: Effect.Effect<void> = Resource.invalidate(
  ServicefulProjectResource("atlas"),
);
const servicefulInvalidationPlanEffect: Effect.Effect<void, never, ProjectApi> = Effect.flatMap(
  Resource.planInvalidation(ServicefulProjectResource("atlas")),
  Resource.runInvalidationPlan,
);
void servicefulInvalidationEffect;
void servicefulInvalidationWithoutService;
void servicefulInvalidationPlanEffect;

const InferredProjectById = Resource.define({
  name: "Project.inferredById",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
const inferredProjectEffect: Effect.Effect<Project, ProjectError | Server.ClientError, ProjectApi> =
  Resource.preload(InferredProjectById(atlasProjectId));
void inferredProjectEffect;

// @ts-expect-error inferred branded resource inputs reject accidental plain strings
InferredProjectById("atlas");

// A Resource with `rows`: its row callbacks are typed by the output's element.
const ProjectRows = Resource.define({
  name: "Projects.rows",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSchema),
  rows: { key: (project) => project.id, indexes: { byName: (project) => project.name } },
  load: () => ProjectApi.use((api) => Effect.map(api.get("atlas"), (project) => [project])),
});
const ProjectsRowsRef = ProjectRows("all");
const projectRowsPreload: Effect.Effect<
  ReadonlyArray<Project>,
  ProjectError | Server.ClientError,
  ProjectApi
> = Resource.preload(ProjectsRowsRef);
void projectRowsPreload;
// Remote changes stream through `rows.changes`; the feed's services join R.
declare const projectChangeStream: Stream.Stream<
  ReadonlyArray<Resource.RowChange<Project, string>>,
  ProjectError,
  RuntimeMissingService
>;
const ChangeFedProjectRows = Resource.define({
  name: "Projects.changeFedRows",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSchema),
  rows: { key: (project) => project.id, changes: () => projectChangeStream },
  load: () => Effect.succeed([] as ReadonlyArray<Project>),
});
const changeFedProjectsPreload: Effect.Effect<
  ReadonlyArray<Project>,
  never,
  RuntimeMissingService
> = Resource.preload(ChangeFedProjectRows("all"));
void changeFedProjectsPreload;

const StartRoot = Component.define("StartRoot", function* () {
  yield* Effect.void;
  return () => "start";
});
const StartApp = App.define({
  root: StartRoot,
  routes: [ProjectRoute] as const,
});
const StartServerApp = makeStartServerApp({ routes: [ProjectRoute] as const });
const startLaunchEffect: Effect.Effect<never, App.LaunchError> = App.launch(StartApp);
void startLaunchEffect;
createRequestHandler(StartApp, {
  document: ({ match, request }) => ({
    title: match?.href ?? request.url,
    meta: [{ name: "description", content: "Projects" }],
    links: [{ rel: "stylesheet", href: "/src/styles.css" }],
    headers: { "x-start": "yes" },
  }),
});
createRequestHandler(StartApp, {
  // @ts-expect-error Start document functions return a StartDocument, not a Promise
  document: () => promisedString,
});
declare const startResponsePromise: Promise<Response>;
// @ts-expect-error Start host adapters reject request handlers that return Promise
const promiseStartRequestHandler = toFetchHandler(() => startResponsePromise);
const startRequestHandler = toFetchHandler(() => Effect.succeed(new Response("ok")));
// @ts-expect-error Start host adapters reject request handlers that return a plain Response
const syncStartRequestHandler = toFetchHandler(() => new Response("ok"));
const builtStartRequestHandler: StartRequestHandler = createRequestHandler(StartApp);
const viteStartSsrRequestHandler: StartSsrRequestHandler = () => new Response("ok");
// @ts-expect-error Vite dev SSR handlers must return Response or Effect, not Promise
const promiseViteStartSsrRequestHandler: StartSsrRequestHandler = () => startResponsePromise;
declare const scopedStartSsrResponse: Effect.Effect<Response, never, Scope.Scope>;
const scopedViteStartSsrRequestHandler: StartSsrRequestHandler = () => scopedStartSsrResponse;
interface ViteDevSsrService {
  readonly value: string;
}
declare const serviceStartSsrResponse: Effect.Effect<Response, never, ViteDevSsrService>;
// @ts-expect-error Vite dev SSR handlers may require request Scope, but must provide app services before returning an Effect
const serviceViteStartSsrRequestHandler: StartSsrRequestHandler = () => serviceStartSsrResponse;
const startVitePlugin: SunfallArcStartPlugin = sunfallArcStart();
startVitePlugin.transform("", "/src/domain.server.ts", { ssr: true });
Metric.value(startRequestCountMetric).pipe(Effect.map((state) => state.count.toFixed()));
Metric.value(startRequestDurationMetric).pipe(Effect.map((state) => state.count.toFixed()));
Metric.value(startRequestStatusMetric).pipe(
  Effect.map((state) => state.occurrences.size.toFixed()),
);
void startRequestHandler;
void syncStartRequestHandler;
void viteStartSsrRequestHandler;
void promiseViteStartSsrRequestHandler;
void scopedViteStartSsrRequestHandler;
void serviceViteStartSsrRequestHandler;
void startVitePlugin;
Effect.map(
  preloadRequest(StartServerApp, new Request("https://example.com/projects/atlas")),
  (result) => result.routePlan.href,
);
toFetchHandler(createRequestHandler(StartApp));
createNodeHandler(createRequestHandler(StartApp));
createNodeServerHandler(createRequestHandler(StartApp), {
  onError: (_error, _request, response) =>
    Effect.sync(() => {
      response.statusCode = 500;
    }),
});
createNodeServerHandler(createRequestHandler(StartApp), {
  // @ts-expect-error Node server error hooks must return Effect or a pure value, not Promise
  onError: () => promisedVoid,
});
declare const nodeIncomingMessage: import("node:http").IncomingMessage;
declare const nodeServerResponse: import("node:http").ServerResponse;
declare const startForkRuntime: StartForkRuntime;
const rootNodeOriginPolicy: StartNodeOriginPolicy = { trustForwardedHeaders: false };
const rootNodeRequestOptions: StartNodeRequestOptions = {
  ...rootNodeOriginPolicy,
  origin: "https://example.com",
};
const rootWriteNodeOptions: WriteNodeResponseOptions = { headOnly: false };
const rootNodeServerOptions: StartNodeServerHandlerOptions = {
  ...rootNodeRequestOptions,
  runtime: startForkRuntime,
};
const rootNodeRuntimeOptions: StartNodeServerHandlerRuntimeOptions<Scope.Scope> = {
  runtime: makeRuntime(),
};
nodeRequestOrigin(nodeIncomingMessage, rootNodeRequestOptions).toUpperCase();
const rootNodeWebRequest: Request = nodeRequestToWebRequest(
  nodeIncomingMessage,
  rootNodeRequestOptions,
);
writeNodeResponse(nodeServerResponse, new Response("ok"), rootWriteNodeOptions).pipe(
  Effect.map(() => undefined),
);
writeNodeResponse(nodeServerResponse, new Response(null, { status: 204 }), { headOnly: true }).pipe(
  Effect.map(() => undefined),
);
const rootFetchHandlerEffect: StartFetchHandler<Scope.Scope> = toFetchHandler(
  createRequestHandler(StartApp),
);
const rootFetchHandler: StartFetchHandler<Scope.Scope> = toFetchHandler(
  createRequestHandler(StartApp),
);
const rootFetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
const rootFetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<Scope.Scope> = {
  runtime: makeRuntime(),
};
declare const rootFetchPromiseHandler: StartFetchPromiseHandler;
const rootFetchPromise: Promise<Response> = rootFetchPromiseHandler(
  new Request("https://example.com/projects/atlas"),
);
const rootNodeHandlerEffect: StartNodeHandler<Scope.Scope> = createNodeHandler(
  createRequestHandler(StartApp),
);
const rootNodeHandler: StartNodeHandler<Scope.Scope> = createNodeHandler(
  createRequestHandler(StartApp),
);
rootFetchHandlerEffect(new Request("https://example.com/projects/atlas"));
rootFetchHandler(new Request("https://example.com/projects/atlas"));
rootNodeHandlerEffect(nodeIncomingMessage, nodeServerResponse);
rootNodeHandler(nodeIncomingMessage, nodeServerResponse);
void rootNodeWebRequest;
void rootNodeServerOptions;
void rootNodeRuntimeOptions;
void rootFetchPromiseOptions;
void rootFetchRuntimeOptions;
void rootFetchPromise;
const hydrationDocument: Pick<Document, "getElementById"> = {
  getElementById: () => null,
};
const hydrationRuntime = makeRuntime();
hydrationRuntime.runSync(hydrateFromDocument(hydrationDocument));
interface RuntimeDocumentService {
  readonly readDocument: () => string;
}
const RuntimeDocumentService = Context.Service<RuntimeDocumentService>("RuntimeDocumentService");
interface RuntimeMissingService {
  readonly readMissing: () => string;
}
const RuntimeMissingService = Context.Service<RuntimeMissingService>("RuntimeMissingService");
const typedRuntime = makeRuntime(
  Layer.succeed(RuntimeDocumentService, {
    readDocument: () => "ok",
  }),
);
const runtimeProvidedEffect: Effect.Effect<string> = typedRuntime.provide(
  RuntimeDocumentService.useSync((service) => service.readDocument()),
);
const runtimeMissingRequirementEffect: Effect.Effect<string, never, RuntimeMissingService> =
  typedRuntime.provide(RuntimeMissingService.useSync((service) => service.readMissing()));
// @ts-expect-error Runtime Spine provide preserves services that are not in the runtime
const runtimeMissingRequirementErased: Effect.Effect<string> = typedRuntime.provide(
  RuntimeMissingService.useSync((service) => service.readMissing()),
);
const typedRuntimeDisposeEffect: Effect.Effect<void, RuntimeDisposeError> = typedRuntime.dispose;
typedRuntime.runSync(RuntimeDocumentService.useSync((service) => service.readDocument()));
// @ts-expect-error Runtime Spine cannot run an effect with services it does not provide
typedRuntime.runSync(RuntimeMissingService.useSync((service) => service.readMissing()));
// @ts-expect-error Runtime Spine cannot fork an effect with services it does not provide
typedRuntime.runFork(RuntimeMissingService.useSync((service) => service.readMissing()));
declare const erasedRuntime: AnySunfallArcRuntime<never>;
const erasedRuntimeDisposeEffect: Effect.Effect<void, RuntimeDisposeError> = erasedRuntime.dispose;
const erasedRuntimeProvidedEffect: Effect.Effect<string> = erasedRuntime.provide(
  RuntimeMissingService.useSync((service) => service.readMissing()),
);
erasedRuntime.runSync(RuntimeMissingService.useSync((service) => service.readMissing()));
const runtimeUiScope: UiScope = makeRuntimeUiScope(erasedRuntime);
const runtimeUiScopeFrame: RuntimeUiScopeFrame = makeRuntimeUiScopeFrame(erasedRuntime);
void runtimeProvidedEffect;
void runtimeMissingRequirementEffect;
void runtimeMissingRequirementErased;
void typedRuntimeDisposeEffect;
void erasedRuntimeDisposeEffect;
void erasedRuntimeProvidedEffect;
void runtimeUiScope;
void runtimeUiScopeFrame;
const viteDevServer = startDevServerFromVite({
  ssrLoadModule: () => promisedStartDevModule,
  transformIndexHtml: () => promisedString,
});
const viteDevSsrEffect: Effect.Effect<Response, StartHandlerNotFound | StartDevServerError> =
  handleSsrDevRequest(viteDevServer, new Request("https://example.com/"));
const servicefulDevServer: StartDevServer<RuntimeMissingService> = {
  ssrLoadModule: () =>
    RuntimeMissingService.useSync(() => ({
      default: () => new Response("ok"),
    })),
  transformIndexHtml: (_url, html) => RuntimeMissingService.useSync(() => html),
};
const servicefulDevSsrEffect: Effect.Effect<
  Response,
  StartHandlerNotFound | StartDevServerError,
  RuntimeMissingService
> = handleSsrDevRequest(servicefulDevServer, new Request("https://example.com/"));
void viteDevSsrEffect;
void servicefulDevSsrEffect;
// @ts-expect-error Runtime Spine exposes provide/runFork/runSync, not Promise runners
hydrationRuntime.runPromise(Effect.void);
hydrationRuntime.runSync(hydrateFromDocument(hydrationDocument));
const startHydrationEffect: Effect.Effect<unknown, StartHydrationError> =
  hydrateFromDocument(hydrationDocument);
void startHydrationEffect;
const streamHydrationDocument = {
  querySelectorAll: () => [
    {
      textContent: '{"resources":[]}',
      getAttribute: (name: string) => (name === streamHydrationConsumedAttribute ? null : "0"),
      setAttribute: (_name: string, _value: string) => {},
    },
  ],
};
readStartHydrationChunks(streamHydrationDocument, { includeConsumed: true });
hydrationRuntime.runSync(
  hydrateStartHydrationChunksFromDocument(streamHydrationDocument, {
    markConsumed: false,
  }),
);

// Actions patch Resource rows optimistically, typed by the Resource's row and key.
const RenameProjectRow = Action.define({
  name: "Projects.renameRow",
  input: Schema.Struct({ id: Schema.String, name: Schema.String }),
  output: ProjectSchema,
  optimistic: (input, transaction) =>
    Effect.gen(function* () {
      yield* transaction.update(ProjectsRowsRef, input.id, { name: input.name });
      yield* transaction.update(ProjectsRowsRef, input.id, (draft) => ({ ...draft, name: "x" }));
      yield* transaction.insert(ProjectsRowsRef, { id: input.id, name: input.name });
      yield* transaction.insert(ProjectsRowsRef, [{ id: input.id, name: input.name }]);
      yield* transaction.delete(ProjectsRowsRef, input.id);
      // @ts-expect-error the row key type is preserved
      yield* transaction.update(ProjectsRowsRef, 123, { name: input.name });
      // @ts-expect-error optimistic patches are checked against the row type
      yield* transaction.update(ProjectsRowsRef, input.id, { slug: input.name });
      // @ts-expect-error inserted rows must be complete rows
      yield* transaction.insert(ProjectsRowsRef, { id: input.id });
    }),
  run: (input) => ProjectApi.use((api) => api.rename(input)),
});
// Patches cannot fail: a rejected row is a defect, so `optimistic` adds nothing to E.
const renameProjectRowError: Action.Definition<
  { readonly id: string; readonly name: string },
  Project,
  ProjectError | Server.ClientError,
  ProjectApi
> = RenameProjectRow;
void renameProjectRowError;
// `Action.planOptimistic` describes the patch without applying it; it carries
// the definition's services and never fails.
const renameProjectRowPlan: Effect.Effect<
  ReadonlyArray<Action.OptimisticChange>,
  never,
  ProjectApi
> = Action.planOptimistic(RenameProjectRow, { id: "atlas", name: "Atlas" });
// @ts-expect-error the plan input is the Action's input type
Action.planOptimistic(RenameProjectRow, { id: "atlas" });
const renameProjectRowChange = (change: Action.OptimisticChange): unknown => {
  switch (change._tag) {
    case "Set":
      return change.value;
    case "Insert":
      return change.values;
    case "Update":
      return change.update;
    case "Delete":
      return change.key;
  }
};
void renameProjectRowPlan;
void renameProjectRowChange;

const ProjectNames = Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    .where(({ project }) => project.id === "atlas")
    .select(({ project }) => project.name),
);
const projectNamesPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | QueryEvaluationError,
  ProjectApi
> = ProjectNames.preload();
const projectNamesRefetchEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | QueryEvaluationError,
  ProjectApi
> = ProjectNames.refresh();
const projectNamesOnceEffect: Effect.Effect<
  ReadonlyArray<string>,
  ProjectError | Server.ClientError | QueryEvaluationError,
  ProjectApi
> = Query.once((query) =>
  query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name),
);
void projectNamesPreloadEffect;
void projectNamesRefetchEffect;
void projectNamesOnceEffect;
const projectNamesState = ProjectNames.state.get();
if (projectNamesState._tag === "Failure") {
  const projectNamesError: Option.Option<ProjectError | Server.ClientError | QueryEvaluationError> =
    AsyncResult.error(projectNamesState);
  const projectNamesLastGood: Option.Option<ReadonlyArray<string>> =
    AsyncResult.value(projectNamesState);
  void projectNamesError;
  void projectNamesLastGood;
}

ProjectNames.rows.get().map((name) => name.toUpperCase());

// @ts-expect-error live query select result is string
ProjectNames.rows.get().map((name) => name.toFixed());
const defaultTypedProjectNameFactory: Query.Factory<string> = (query) =>
  // @ts-expect-error serviceful query factories must spell their error/requirement channels
  query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name);
const servicefulProjectNameFactory: Query.Factory<string, unknown, ProjectApi> = (query) =>
  query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name);
const servicefulProjectNameDiagnostics: Query.PlanDiagnostics = Query.diagnostics(
  servicefulProjectNameFactory,
);
void defaultTypedProjectNameFactory;
void servicefulProjectNameFactory;
void servicefulProjectNameDiagnostics;

// A rows Resource reader adds row lookups typed by `rows`.
const solidProjectRows = bound(Component.resource(ProjectRows));
solidProjectRows("all").map((project) => project.name);
solidProjectRows.get("all", "atlas")?.name.toUpperCase();
solidProjectRows.index("all", "byName", "Atlas").map((project) => project.name.toUpperCase());
// @ts-expect-error only declared indexes
solidProjectRows.index("all", "byId", "atlas");
// A Resource family's render failure joins E and its services join R. This
// family declares no `error` schema, so a render reports only the failure's
// `_tag`, as `ResourceUntypedFailure`.
const solidProjectReaderBinding: Effect.Effect<
  Component.ResourceReader<string, Project, ResourceUntypedFailure>,
  ResourceUntypedFailure,
  ProjectApi
> = Component.resource(ProjectById);
const solidProjectReader = bound(solidProjectReaderBinding);
const solidProjectResourceValue: Project = solidProjectReader("atlas");
const solidProjectResourceFailure: Cause.Cause<ResourceUntypedFailure> | undefined =
  solidProjectReader.failure("atlas");
void solidProjectResourceValue;
void solidProjectResourceFailure;
// A live query's sources' load errors join E; services join R.
const solidProjectNamesBinding = LiveQuery.bind(
  (query) => query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name),
  { preload: false },
);
const solidProjectNamesServices: Effect.Effect<
  LiveQuery.Handle<string, ProjectError | Server.ClientError>,
  ProjectError | Server.ClientError,
  ProjectApi
> = solidProjectNamesBinding;
void solidProjectNamesServices;
const solidProjectNames = bound(solidProjectNamesBinding);
// Live queries and Resource readers share one status vocabulary.
const solidProjectNamesWaiting: boolean = solidProjectNames.waiting();
void solidProjectNamesWaiting;
LiveQuery.bind(
  (query) => query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name),
  {
    preload: false,
    // @ts-expect-error the query factory is tracked; signal/prop reads in it rebuild the query.
    deps: () => "atlas",
  },
);
const solidProjectStreamBinding: Effect.Effect<() => Project, never, ProjectApi> = Component.stream(
  "project",
  Stream.suspend(() =>
    Stream.fromEffect(ProjectApi.use((api) => api.get("atlas")).pipe(Effect.orDie)),
  ),
  { id: "loading", name: "Loading" },
);
const solidProjectStreamValue: Project = bound(solidProjectStreamBinding)();
void solidProjectStreamValue;
const solidProjectNamesPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | QueryEvaluationError
> = solidProjectNames.preload();
const solidProjectNamesFailure: Cause.Cause<ProjectError | Server.ClientError> | undefined =
  solidProjectNames.failure();
void solidProjectNamesPreloadEffect;
void solidProjectNamesFailure;

const TaskSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
});
const TaskRows = Resource.define({
  name: "Tasks.rows",
  input: Schema.Literal("all"),
  output: Schema.Array(TaskSchema),
  rows: { key: (task) => task.id, indexes: { byProject: (task) => task.projectId } },
  load: () => Effect.succeed([] as ReadonlyArray<typeof TaskSchema.Type>),
});
const TasksRowsRef = TaskRows("all");

const ProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    .join(
      "task",
      TasksRowsRef,
      ({ project }) => project.id,
      (task) => task.projectId,
    )
    .select(({ project, task }) => `${project.name}:${task.title}`),
);

ProjectTaskTitles.rows.get().map((title) => title.toUpperCase());

const IndexedProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    .joinIndexed("task", TasksRowsRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}:${task.title}`),
);
Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    // @ts-expect-error indexed joins name an index the source declares
    .joinIndexed("task", TasksRowsRef, ({ project }) => project.id, "byOwner"),
);

IndexedProjectTaskTitles.rows.get().map((title) => title.toUpperCase());

const ProjectTaskRows = Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).join(
    "task",
    TasksRowsRef,
    ({ project }) => project.id,
    (task) => task.projectId,
  ),
);

ProjectTaskRows.rows.get().map(({ project, task }) => `${project.name}:${task.title}`);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).join(
    "task",
    TasksRowsRef,
    ({ project }) => project.id,
    // @ts-expect-error joined row fields are type checked
    (task) => task.missing,
  ),
);

const ProjectCounts = Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    .groupBy(({ project }) => ({ name: project.name }), {
      count: Query.count(),
      nameLength: Query.sum(({ project }) => project.name.length),
    })
    .where((group) => group.count > 0)
    .select((group) => ({
      name: group.name,
      count: group.count,
      nameLength: group.nameLength,
    })),
);

ProjectCounts.rows.get().map((group) => group.count.toFixed());

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(({ project }) => ({ name: project.name }), {
    // @ts-expect-error aggregate selectors are type checked
    total: Query.sum(({ project }) => project.missing),
  }),
);

Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    // @ts-expect-error Query projections must stay synchronous
    .select(() => promisedProject),
);

Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    // @ts-expect-error Query projections must not contain nested Promise-shaped values
    .select(() => ({ nested: { value: promisedProject } })),
);

Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    // @ts-expect-error Query projections must not contain direct Effect-shaped values
    .select(() => effectNumberValue),
);

Query.live((query) =>
  query
    .from({ project: ProjectsRowsRef })
    // @ts-expect-error Query projections must not contain nested Effect-shaped values
    .select(() => ({ nested: { value: effectNumberValue } })),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(({ project }) => ({ name: project.name }), {
    // @ts-expect-error aggregate value callbacks must stay synchronous
    count: Query.count(() => promisedNumber),
  }),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(
    // @ts-expect-error Query group keys must not contain nested Promise-shaped values
    ({ project }) => ({ name: project.name, asyncKey: promisedString }),
    {
      count: Query.count(),
    },
  ),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(
    // @ts-expect-error Query group keys must not contain Effect-shaped values
    ({ project }) => ({ name: project.name, effectKey: effectNumberValue }),
    {
      count: Query.count(),
    },
  ),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(
    // @ts-expect-error Query group key Maps must not contain Promise-shaped values
    ({ project }) => ({ name: project.name, values: new Map([["async", promisedString]]) }),
    {
      count: Query.count(),
    },
  ),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(
    // @ts-expect-error Query group key Sets must not contain Promise-shaped values
    ({ project }) => ({ name: project.name, values: new Set([promisedString]) }),
    {
      count: Query.count(),
    },
  ),
);

Query.live((query) =>
  query.from({ project: ProjectsRowsRef }).groupBy(({ project }) => ({ name: project.name }), {
    // @ts-expect-error aggregate value callbacks must not return Effect-shaped values
    count: Query.count(() => effectNumberValue),
  }),
);

const frameworkGroupKeyAlias: Query.GroupKey<{
  readonly name: string;
  readonly tags: ReadonlySet<string>;
  readonly meta: ReadonlyMap<string, string>;
}> = {
  name: "Atlas",
  tags: new Set(["active"]),
  meta: new Map([["status", "active"]]),
};
void frameworkGroupKeyAlias;

const projectNamesHandle = bound(
  LiveQuery.bind((query) =>
    query.from({ project: ProjectsRowsRef }).select(({ project }) => project.name),
  ),
);
projectNamesHandle.rows().map((name) => name.toUpperCase());

const ProjectRoutePlan = Route.planNavigation([ProjectRoute] as const, "/projects/atlas");
Effect.map(ProjectRoutePlan, (plan) => {
  if (plan._tag === "Matched") {
    plan.match.params.id;
    plan.refs.map((ref) => ref.key);
    plan.resources.resources.map((snapshot) => snapshot.name);
  }
});

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project, ProjectError | Server.ClientError>;
  readonly rename: (input: {
    readonly id: string;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectError | Server.ClientError>;
}

const ProjectApi = Context.Service<ProjectApi>("ProjectApi");

Layer.succeed(ProjectApi, {
  get: (id) => getProject.effect({ id }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name }),
});

// @ts-expect-error service implementation must include all service methods
Layer.succeed(ProjectApi, {
  get: (id) => Effect.succeed({ id, name: "Incomplete" }),
});

ProjectApi.use((api) => api.get("atlas"));
ProjectApi.useSync(() => ({ id: "atlas", name: "Pure Project" }));
const serviceEffectReturn: Effect.Effect<number> = ProjectApi.use(() => effectNumberValue).pipe(
  Effect.provide(Layer.succeed(ProjectApi, {} as never)),
);
void serviceEffectReturn;
const projectStateRuntime = makeRuntime(
  Layer.succeed(ProjectApi, {
    get: (id) => Effect.succeed({ id, name: "Runtime Project" }),
    rename: (input) => Effect.succeed({ id: input.id, name: input.name }),
  }),
);
// Event handlers run Effects through `Component.callback`: services join R,
// and failures must be handled.
const uiCallback: Effect.Effect<(id: string) => void, never, ProjectApi> = Component.callback(
  "open",
  (id: string) => ProjectApi.use((api) => api.get(id)).pipe(Effect.ignore),
);
void uiCallback;

type ProjectStateModel = { readonly selected: Project | undefined; readonly loading: boolean };
type ProjectStateMessage =
  | { readonly _tag: "Load"; readonly id: string }
  | { readonly _tag: "Loaded"; readonly project: Project }
  | { readonly _tag: "Refresh" };

const ProjectState = State.define<ProjectStateModel, ProjectStateMessage>()({
  name: "ProjectState",
  initial: { selected: undefined, loading: false },
  on: {
    Load: (model, message) =>
      State.next(
        { ...model, loading: true },
        State.emit<ProjectStateMessage, ProjectError | Server.ClientError, ProjectApi>(
          ProjectApi.use((api) =>
            Effect.map(api.get(message.id), (project) => ({ _tag: "Loaded", project }) as const),
          ),
        ),
      ),
    Loaded: (_model, message) => ({ selected: message.project, loading: false }),
    Refresh: (model) =>
      model.selected
        ? State.next(
            model,
            State.emit<ProjectStateMessage>({ _tag: "Load", id: model.selected.id }),
          )
        : model,
  },
  subscriptions: (model) =>
    model.selected ? Stream.succeed<ProjectStateMessage>({ _tag: "Refresh" }) : undefined,
});

// @ts-expect-error serviceful State.start requires an explicit runtime carrying State services
State.start(ProjectState, { runtime: makeRuntime() });
const projectStateStartOptions: State.StartOptions<ProjectApi> = {
  runtime: projectStateRuntime,
};
type ProjectStateRemainingRuntimeRequirements = State.RuntimeRemainingRequirements<
  ProjectApi | RuntimeMissingService,
  ProjectApi
>;
const missingStateRuntimeRequirement = null as unknown as ProjectStateRemainingRuntimeRequirements;
const projectState = State.start(ProjectState, { runtime: projectStateRuntime });
projectState.model.get().selected?.name.toUpperCase();
const projectTimelineRecord: Effect.Effect<
  Timeline.Recording,
  TimelineAlreadyRecording,
  Scope.Scope
> = Timeline.record({ limit: 50 });
declare const projectTimeline: Timeline.Recording;
// A State's history is the app Timeline filtered to its model signal.
const projectStateHistory: ReadonlyArray<Timeline.Entry> = projectTimeline.entries
  .get()
  .filter((entry) => entry.changes.some((change) => change.signal === projectState.model));
projectStateHistory.map((entry) => entry.sequence.toFixed());
const projectTimelineLabel: string = Timeline.describe(projectStateHistory[0]!.cause);
// Every entry has a cause: writes outside a named transition never commit.
const projectTimelineCause: Timeline.Cause = projectStateHistory[0]!.cause;
void projectTimelineCause;
const projectTimelinePosition: number | undefined = projectTimeline.position.get();
const projectTimelineTravel: Effect.Effect<void, TimelineEntryUnavailable> =
  projectTimeline.travel(1);
const projectTimelineResume: Effect.Effect<void> = projectTimeline.resume();
// @ts-expect-error travel takes a recorded sequence number
projectTimeline.travel("1");
// @ts-expect-error Timeline entries are read-only
projectTimeline.entries.set([]);
const projectStateCause: Timeline.Cause | undefined = projectStateHistory[0]?.cause;
if (projectStateCause?._tag === "State") {
  const state: string = projectStateCause.state;
  const event: "message" | "failure" | "clearFailures" = projectStateCause.event;
  void state;
  void event;
}
const renameCause: Timeline.Cause = { _tag: "Transition", name: "ProjectPage.rename" };
// @ts-expect-error Timeline causes are a closed tagged union
const customCause: Timeline.Cause = { _tag: "Custom", label: "nope" };
// @ts-expect-error Signal is read-only: client state is a State
Signal.make(0, { name: "count" });
// @ts-expect-error Signal is read-only: writes belong to States, Actions, and the framework
Signal.batch(() => 1, { name: "ProjectPage.rename" });
// @ts-expect-error Signal is read-only
Signal.transaction(Effect.void, { name: "ProjectPage.rename" });
// @ts-expect-error Signal is read-only: a Stream's latest value is `Component.stream`
Signal.fromStream(Stream.make(1), 0, { name: "count" });
// @ts-expect-error Signal is read-only
Signal.updateAndGet;
void customCause;
// @ts-expect-error State history lives on the app Timeline, not on the State instance
projectState.clearTimeline();
State.define<number, { readonly _tag: "Tick" }>()({
  name: "Test",
  initial: 0,
  on: { Tick: (model) => model },
  // @ts-expect-error State definitions no longer carry per-program timeline retention
  timeline: false,
});
void projectTimelineRecord;
void projectTimelineLabel;
void projectTimelinePosition;
void projectTimelineTravel;
void projectTimelineResume;
const projectStateDispatchEffect: Effect.Effect<
  void,
  State.Failure<
    ProjectStateMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError | State.Disposed
  >
> = projectState.dispatch({ _tag: "Load", id: "atlas" });
void projectStateDispatchEffect;
void projectState.dispatch({ _tag: "Refresh" });
// @ts-expect-error State dispatch messages keep payloads typed
void projectState.dispatch({ _tag: "Load" });
const ProjectStateWithMissingService = State.define<ProjectStateModel, ProjectStateMessage>()({
  name: "ProjectStateWithMissingService",
  initial: { selected: undefined, loading: false },
  on: {
    Load: (model) =>
      State.next(
        model,
        State.emit(
          RuntimeMissingService.useSync((service) => service.readMissing()).pipe(Effect.asVoid),
        ),
      ),
    Loaded: (model) => model,
    Refresh: (model) => model,
  },
});
State.start(ProjectStateWithMissingService, {
  // @ts-expect-error runtime-bound State start cannot erase services the runtime does not provide
  runtime: projectStateRuntime,
});
interface StateRuntimeStartupError {
  readonly _tag: "StateRuntimeStartupError";
}
declare const projectStateRuntimeWithStartupError: SunfallArcRuntime<
  ProjectApi,
  StateRuntimeStartupError
>;
const projectStateWithRuntimeError = State.start(ProjectState, {
  runtime: projectStateRuntimeWithStartupError,
});
const projectStateRuntimeErrorDispatch: Effect.Effect<
  void,
  State.Failure<
    ProjectStateMessage,
    | ProjectError
    | Server.ClientError
    | EffectInputCallbackError
    | State.Disposed
    | StateRuntimeStartupError
  >
> = projectStateWithRuntimeError.dispatch({ _tag: "Load", id: "atlas" });
// `State.step` is pure and synchronous: no runtime, services, or errors.
const projectStateStep: State.Step<
  ProjectStateModel,
  ProjectStateMessage,
  ProjectError | Server.ClientError,
  ProjectApi
> = State.step(
  ProjectState,
  { selected: undefined, loading: false },
  { _tag: "Load", id: "atlas" },
);
// A command is an inspectable Effect description; running it needs its services.
const projectStateLoadCommand: Effect.Effect<
  ProjectStateMessage | void,
  ProjectError | Server.ClientError,
  ProjectApi
> = projectStateStep.commands[0]!.effect;
// @ts-expect-error State.step keeps message payloads typed
State.step(ProjectState, { selected: undefined, loading: false }, { _tag: "Load" });
void projectStateStep;
void projectStateLoadCommand;
void projectStateRuntimeErrorDispatch;
void projectStateStartOptions;
void missingStateRuntimeRequirement;
const solidProjectStateBinding: Effect.Effect<
  Component.StateHandle<ProjectStateModel, ProjectStateMessage, ProjectError | Server.ClientError>,
  never,
  ProjectApi
> = Component.state(ProjectState);
const solidProjectState = bound(solidProjectStateBinding);
solidProjectState.model().selected?.id.toUpperCase();
solidProjectState.failures().map((failure) => failure.phase);
// @ts-expect-error Solid State dispatch messages keep payloads typed
void solidProjectState.dispatch({ _tag: "Loaded" });
const solidProjectStateDispatch: Effect.Effect<
  void,
  State.Failure<
    ProjectStateMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError | State.Disposed
  >
> = solidProjectState.dispatch({ _tag: "Load", id: "atlas" });
void solidProjectStateDispatch;

type BadMessage = { readonly _tag: "Bad" };

State.define<number, BadMessage>()({
  name: "Test",
  initial: 0,
  // @ts-expect-error State handlers return a model or State.next(...), not a Promise
  on: { Bad: () => promisedNumber },
});

State.define<unknown, BadMessage>()({
  name: "Test",
  initial: {},
  // @ts-expect-error State handlers cannot hide Promise-shaped values behind explicit unknown
  on: { Bad: () => promisedProject },
});

State.define<number, BadMessage>()({
  name: "Test",
  initial: 0,
  // @ts-expect-error State handlers are pure: Effect work goes in commands
  on: { Bad: (model) => Effect.succeed(model + 1) },
});

State.define<number, BadMessage>()({
  name: "Test",
  initial: 0,
  on: { Bad: (model) => model + 1 },
  // @ts-expect-error State subscriptions cannot hide Promise-shaped values behind explicit unknown
  subscriptions: () => promisedProject,
});

State.define<number, BadMessage>()({
  name: "Test",
  initial: 0,
  on: { Bad: (model) => model + 1 },
  // @ts-expect-error State subscriptions cannot hide Effect Promise successes behind explicit unknown
  subscriptions: () => Effect.succeed(promisedProject),
});

// @ts-expect-error State handlers must use the `on` handler map
State.define<number, BadMessage>()({ name: "Test", initial: 0, update: (model: number) => model });

// @ts-expect-error service method input remains typed
ProjectApi.use((api) => api.rename({ id: "atlas" }));

// @ts-expect-error service use callbacks must return an Effect, not a Promise
ProjectApi.use(() => promisedProject);

Resource.define<string, Project>({
  name: "Project.bad",
  // @ts-expect-error resource loader output must satisfy the resource value type
  load: (id) => ({ id }),
});
Resource.define<string, Project>({
  name: "Project.promiseKey",
  // @ts-expect-error custom resource keys must return a string synchronously, not Promise
  key: () => promisedString,
  load: (id) => ({ id, name: "Atlas" }),
});
Resource.tag<{ readonly id: string }>("Project.promiseTagKey", {
  // @ts-expect-error custom resource tag keys must return a string synchronously, not Promise
  key: () => promisedString,
});
Resource.define<string, Project>({
  name: "Project.promiseProvides",
  load: (id) => ({ id, name: "Atlas" }),
  // @ts-expect-error resource provides callbacks must return tag metadata synchronously, not Promise
  provides: () => promisedProjects,
});

Route.define("/promise-preload", {
  // @ts-expect-error route preload must return Effect or a pure value, not Promise
  preload: () => promisedVoid,
});
// @ts-expect-error annotated route preload results still reject Promise-shaped values
const annotatedPromiseRoutePreloadResult: Route.PreloadResult = promisedVoid;

interface RoutePreloadApi {
  readonly warm: (id: string) => Effect.Effect<void>;
}

const RoutePreloadApi = Context.Service<RoutePreloadApi>("RoutePreloadApi");
const ServicePreloadRoute = Route.define("/service-projects/:id", {
  preload: ({ params }) => RoutePreloadApi.use((api) => api.warm(params.id)),
});
const FileRoutePreloadHelperRoute = Route.define("/file-preload-helper/:id", {
  preloadResources: [ProjectById, ProjectRows],
  preload: ({ params }) =>
    Effect.all(
      [
        Resource.preload(ProjectById(params.id)),
        Resource.preload(ProjectsRowsRef),
        RoutePreloadApi.use((api) => api.warm(params.id)),
      ],
      { discard: true },
    ),
});
const fileRoutePreloadHelperRequirements: Route.PreloadRequirements<
  typeof FileRoutePreloadHelperRoute
> = {} as ProjectApi | RoutePreloadApi;
declare const fileRoutePreloadHelperMatch: Route.Match<typeof FileRoutePreloadHelperRoute>;
const fileRoutePreloadHelperEffect: Effect.Effect<
  void,
  Route.PreloadPlanError,
  ProjectApi | RoutePreloadApi
> = Route.preload(fileRoutePreloadHelperMatch);
const BrandedFileRoutePreloadHelperRoute = Route.define("/file-preload-branded/:id", {
  params: Schema.Struct({ id: ProjectId }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
  preloadResources: [BrandedProjectById, ProjectRows],
  preload: ({ params, search }) => {
    const id: ProjectId = params.id;
    const tab: "overview" | "activity" | undefined = search.tab;
    void tab;
    return Effect.all(
      [
        Resource.preload(BrandedProjectById(id)),
        Resource.preload(ProjectsRowsRef),
        RoutePreloadApi.use((api) => api.warm(params.id)),
      ],
      { discard: true },
    );
  },
});
const brandedFileRoutePreloadHelperRequirements: Route.PreloadRequirements<
  typeof BrandedFileRoutePreloadHelperRoute
> = {} as ProjectApi | RoutePreloadApi;
const brandedFileRouteHref: Route.HrefOptions<typeof BrandedFileRoutePreloadHelperRoute> = {
  params: { id: atlasProjectId },
  search: { tab: "overview" },
};
const badBrandedFileRouteHref: Route.HrefOptions<typeof BrandedFileRoutePreloadHelperRoute> = {
  params: {
    // @ts-expect-error schema-aware file routes carry branded params into route hrefs
    id: "atlas",
  },
};
void brandedFileRoutePreloadHelperRequirements;
void brandedFileRouteHref;
void badBrandedFileRouteHref;
declare const servicePreloadMatch: Route.Match<typeof ServicePreloadRoute>;
const serviceRoutePreloadRequirements: Route.PreloadRequirements<typeof ServicePreloadRoute> =
  {} as RoutePreloadApi;
const serviceRoutePreload: Effect.Effect<void, Route.PreloadPlanError, RoutePreloadApi> =
  Route.preload(servicePreloadMatch);
const serviceRoutePreloadPlan: Effect.Effect<
  Route.PreloadPlan<typeof ServicePreloadRoute>,
  Route.PreloadPlanError,
  RoutePreloadApi
> = Route.planPreload(servicePreloadMatch);
const serviceRouteNavigationPlan: Effect.Effect<
  Route.NavigationPlan<typeof ServicePreloadRoute>,
  Route.NavigationPlanError,
  RoutePreloadApi
> = Route.planNavigation([ServicePreloadRoute] as const, "/service-projects/atlas");
const routePreloadStartApp = App.define({
  root: StartRoot,
  routes: [ServicePreloadRoute] as const,
});
// The server runtime lacks the route's preload service, so it stays a handler requirement.
const routePreloadMissingHandler = createRequestHandler(routePreloadStartApp, {
  server: typedRuntime,
});
const routePreloadMissingStartEffect: Effect.Effect<unknown, unknown, RoutePreloadApi> =
  preloadRequest(
    makeStartServerApp({ routes: [ServicePreloadRoute] as const, server: typedRuntime }),
    new Request("https://example.com/service-projects/atlas"),
  );
const routePreloadMissingStartHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = routePreloadMissingHandler(new Request("https://example.com/service-projects/atlas"));
const routePreloadMissingFetchAdapterEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = toFetchHandler(routePreloadMissingHandler)(
  new Request("https://example.com/service-projects/atlas"),
);
const routePreloadMissingNodeAdapterEffect: Effect.Effect<
  Response,
  StartNodeAdapterError | StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = createNodeHandler(routePreloadMissingHandler)(
  { method: "GET", url: "/", headers: {} } as import("node:http").IncomingMessage,
  {} as import("node:http").ServerResponse,
);
// @ts-expect-error bare fetch handler aliases default to service-free, so route preload services stay visible
const erasedRoutePreloadFetchHandler: StartFetchHandler = toFetchHandler(
  routePreloadMissingHandler,
);
// @ts-expect-error bare Node handler aliases default to service-free, so route preload services stay visible
const erasedRoutePreloadNodeHandler: StartNodeHandler = createNodeHandler(
  routePreloadMissingHandler,
);
// @ts-expect-error Promise-shaped fetch facades must receive a runtime for non-Scope handler requirements
createFetchHandler(routePreloadMissingHandler);
// @ts-expect-error Node callback facades must receive a runtime for non-Scope handler requirements
createNodeServerHandler(routePreloadMissingHandler);
// @ts-expect-error effect-first fetch adapters cannot hide requirements through partial generics
toFetchHandler<StartRequestHandlerError>(routePreloadMissingHandler);
// @ts-expect-error effect-first Node adapters cannot hide requirements through partial generics
createNodeHandler<StartRequestHandlerError>(routePreloadMissingHandler);
const routePreloadRuntime = makeRuntime(
  Layer.succeed(RoutePreloadApi, {
    warm: () => Effect.void,
  }),
);
// Route preload services join the Component that creates the router, so
// `launch` checks them against what is provided.
const ServicePreloadApp = Component.define("ServicePreloadApp", function* () {
  const router = yield* Component.router([ServicePreloadRoute] as const, {
    initialHref: "/service-projects/atlas",
  });
  return () => RouterProvider({ router });
});
declare const servicePreloadRoot: HTMLElement;
Component.launch(ServicePreloadApp, servicePreloadRoot, { runtime: routePreloadRuntime });
// @ts-expect-error a route's preload services must be provided before launch
Component.launch(ServicePreloadApp, servicePreloadRoot);
const routePreloadProvidedStartEffect: Effect.Effect<unknown, unknown> = preloadRequest(
  makeStartServerApp({ routes: [ServicePreloadRoute] as const, server: routePreloadRuntime }),
  new Request("https://example.com/service-projects/atlas"),
);
const routePreloadProvidedStartHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope
> = createRequestHandler(routePreloadStartApp, { server: routePreloadRuntime })(
  new Request("https://example.com/service-projects/atlas"),
);
const routePreloadFetchFacade = createFetchHandler(routePreloadMissingHandler, {
  runtime: routePreloadRuntime,
});
const routePreloadNodeFacade = createNodeServerHandler(routePreloadMissingHandler, {
  runtime: routePreloadRuntime,
});
const RegistryReadDocumentAction = Action.define<any, string, never, RuntimeDocumentService>({
  name: "RuntimeDocument.registryAction",
  run: () => RuntimeDocumentService.useSync((service) => service.readDocument()),
});
const RegistryReadDocumentRpc = Server.implement(
  Server.contract("RuntimeDocument.registryRpc", { input: Schema.Void, output: Schema.String }),
  () => RuntimeDocumentService.useSync((service) => service.readDocument()),
);
// The app's Actions and the handler's server functions run on the server, so
// the server runtime must provide their services, like the root's.
const startRegistryApp = App.define({
  root: StartRoot,
  routes: [] as const,
  actions: [RegistryReadDocumentAction],
});
// @ts-expect-error the server Layer must provide what served functions and Actions need
createRequestHandler(startRegistryApp, { serverFunctions: [RegistryReadDocumentRpc] });
const startRegistryProvidedHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope
> = createRequestHandler(startRegistryApp, {
  server: typedRuntime,
  serverFunctions: [RegistryReadDocumentRpc],
})(new Request("https://example.com/__sunfall-arc/rpc"));
const startOptionsActionHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RuntimeDocumentService
> = createRequestHandler(startRegistryApp)(new Request("https://example.com/__sunfall-arc/action"));
void serviceRoutePreloadRequirements;
void serviceRoutePreload;
void serviceRoutePreloadPlan;
void serviceRouteNavigationPlan;
void routePreloadMissingStartEffect;
void routePreloadMissingStartHandlerEffect;
void routePreloadMissingFetchAdapterEffect;
void routePreloadMissingNodeAdapterEffect;
void erasedRoutePreloadFetchHandler;
void erasedRoutePreloadNodeHandler;
void routePreloadProvidedStartEffect;
void routePreloadProvidedStartHandlerEffect;
void routePreloadFetchFacade;
void routePreloadNodeFacade;
void startRegistryProvidedHandlerEffect;
void startOptionsActionHandlerEffect;

declare const label: State.Ref<string>;
declare const unknownLabel: State.Ref<unknown>;
const TouchProject = Action.define<{ readonly id: string }, Project>({
  name: "Project.touch",
  optimistic: ({ id }, transaction) =>
    Effect.gen(function* () {
      yield* transaction.set(label, id);
      // @ts-expect-error optimistic patches must match the target State model type
      yield* transaction.set(label, 123);
      // @ts-expect-error optimistic signal values cannot hide Promise-shaped values behind unknown
      yield* transaction.set(unknownLabel, promisedProject);
      // @ts-expect-error optimistic signal updaters cannot hide Promise-shaped returns behind unknown
      yield* transaction.set<unknown>(unknownLabel, () => promisedProject);
    }),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});

// `transaction.set` patches a Resource entry: the updater receives the
// Resource's output type, and any family's ref works.
const RenameProjectEverywhere = Action.define<{ readonly id: string; readonly name: string }, void>(
  {
    name: "Project.renameEverywhere",
    optimistic: ({ id, name }, transaction) =>
      Effect.gen(function* () {
        yield* transaction.set(ProjectById(id), (project) => {
          const current: Project = project;
          return { ...current, name };
        });
        yield* transaction.set(ProjectsRowsRef, (projects) =>
          projects.map((project) => (project.id === id ? { ...project, name } : project)),
        );
        // A plain value replaces the entry's value.
        yield* transaction.set(ProjectById(id), { id, name });
        // The ref's load requirements are not needed to patch its entry.
        const serviceless: Effect.Effect<void> = transaction.set(
          ServicefulProjectResource(id),
          (project) => project,
        );
        yield* serviceless;
        // @ts-expect-error the updater must return the Resource's output type
        yield* transaction.set(ProjectById(id), (project) => project.name);
        // @ts-expect-error a plain value must be the Resource's output type
        yield* transaction.set(ProjectById(id), { id });
        // @ts-expect-error Resource patches cannot be Promise-shaped
        yield* transaction.set(ProjectById(id), () => promisedProject);
        // @ts-expect-error only writable Signals and Resource refs can be set
        yield* transaction.set(ProjectById, (project: Project) => project);
        const derivedLabel = Signal.derive(() => "label");
        // @ts-expect-error only writable Signals and Resource refs can be set
        yield* transaction.set(derivedLabel, "next");
        // @ts-expect-error only writable Signals and Resource refs can be set
        yield* transaction.set({ id, name }, { id, name });
      }),
    run: () => Effect.void,
  },
);
const renameProjectEverywhereChange = (change: Action.OptimisticChange): unknown =>
  change._tag === "Set" ? [change.target, change.value] : undefined;
void RenameProjectEverywhere;
void renameProjectEverywhereChange;

Effect.runSync(
  Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }),
);
Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }).pipe(
  Effect.map((plan) => plan.targets.length),
);
// Action instances run on an explicit runtime; services it lacks stay visible.
const emptyActionRuntime = makeRuntime();
const touch = Action.use(TouchProject, { runtime: emptyActionRuntime });
touch.invalidationPlan.get()?.entries.map((entry) => entry.ref.key);
const PureServicefulInvalidationAction = Action.define({
  name: "Project.pureServicefulInvalidation",
  run: (input: { readonly id: string }) => ({ id: input.id, name: "Touched" }),
  invalidates: (_project, input) => [ServicefulProjectResource(input.id)],
});
const pureServicefulInvalidationSubmit: Effect.Effect<
  Project,
  Action.ClientError | ActionInterrupted,
  ProjectApi
> = Action.use(PureServicefulInvalidationAction, { runtime: emptyActionRuntime }).submit({
  id: "atlas",
});
// @ts-expect-error action invalidation requirements from serviceful Resources stay visible
const pureServicefulInvalidationSubmitErased: Effect.Effect<Project> = Action.use(
  PureServicefulInvalidationAction,
  { runtime: emptyActionRuntime },
).submit({ id: "atlas" });
const pureServicefulInvalidationPlan = Effect.runSync(
  Action.planInvalidation(
    PureServicefulInvalidationAction,
    { id: "atlas", name: "Atlas" },
    { id: "atlas" },
  ),
);
const pureServicefulInvalidationPlanRun: Effect.Effect<void, never, ProjectApi> =
  Resource.runInvalidationPlan(pureServicefulInvalidationPlan);
const ResultServicefulInvalidationAction = Action.define({
  name: "Project.resultServicefulInvalidation",
  run: (input: { readonly id: string }) =>
    ActionResult.success(
      { id: input.id, name: "Touched" },
      { invalidates: [ServicefulProjectResource(input.id)] },
    ),
});
const resultServicefulInvalidationSubmit: Effect.Effect<
  unknown,
  Action.ClientError | ActionInterrupted,
  ProjectApi
> = Action.use(ResultServicefulInvalidationAction, { runtime: emptyActionRuntime }).submit({
  id: "atlas",
});
// @ts-expect-error ActionResult invalidation requirements stay visible through Action.use
const resultServicefulInvalidationSubmitErased: Effect.Effect<unknown> = Action.use(
  ResultServicefulInvalidationAction,
  { runtime: emptyActionRuntime },
).submit({ id: "atlas" });
const resultWithServicefulInvalidation = ActionResult.withInvalidation(
  ActionResult.success({ id: "atlas", name: "Atlas" }),
  [ServicefulProjectResource("atlas")],
);
const resultWithServicefulInvalidationRequirement: ActionResult.InvalidationRequirements<
  typeof resultWithServicefulInvalidation
> = {} as ProjectApi;
const fieldErrorWithServicefulInvalidation = ActionResult.validation<
  { readonly id: string },
  string,
  ProjectApi
>(
  { fieldErrors: { id: ["Required"] } },
  {
    invalidates: [ServicefulProjectResource("atlas")],
  },
);
const fieldErrorWithServicefulInvalidationRequirement: ActionResult.InvalidationRequirements<
  typeof fieldErrorWithServicefulInvalidation
> = {} as ProjectApi;
Effect.map(
  Effect.succeed(
    ActionResult.success(
      { id: "atlas", name: "Atlas" },
      {
        invalidates: [ServicefulProjectResource("atlas")],
      },
    ),
  ),
  (result) => {
    const requirement: ActionResult.InvalidationRequirements<typeof result> = {} as ProjectApi;
    return requirement;
  },
);
void pureServicefulInvalidationSubmit;
void pureServicefulInvalidationSubmitErased;
void pureServicefulInvalidationPlanRun;
void resultServicefulInvalidationSubmit;
void resultServicefulInvalidationSubmitErased;
void resultWithServicefulInvalidationRequirement;
void fieldErrorWithServicefulInvalidationRequirement;
const ReadDocumentAction = Action.define<void, string, never, RuntimeDocumentService>({
  name: "RuntimeDocument.readAction",
  run: () => RuntimeDocumentService.useSync((service) => service.readDocument()),
});
const readDocumentAction = Action.use(ReadDocumentAction, { runtime: emptyActionRuntime });
const readDocumentActionSubmit: Effect.Effect<
  string,
  Action.ClientError | ActionInterrupted,
  RuntimeDocumentService
> = readDocumentAction.submit(undefined);
const readDocumentRuntimeAction = Action.use(ReadDocumentAction, { runtime: typedRuntime });
const readDocumentRuntimeActionSubmit: Effect.Effect<
  string,
  Action.ClientError | ActionInterrupted
> = readDocumentRuntimeAction.submit(undefined);
const readDocumentRuntimeActionDefinitionRun: EffectInput<string, never, RuntimeDocumentService> =
  readDocumentRuntimeAction.definition.run(undefined);
const ReadDocumentAndMissingAction = Action.define<
  void,
  string,
  never,
  RuntimeDocumentService | RuntimeMissingService
>({
  name: "RuntimeDocument.readAndMissingAction",
  run: () =>
    Effect.zipWith(
      RuntimeDocumentService.useSync((service) => service.readDocument()),
      RuntimeMissingService.useSync((service) => service.readMissing()),
      (document, missing) => `${document}:${missing}`,
    ),
});
const readDocumentAndMissingRuntimeAction = Action.use(ReadDocumentAndMissingAction, {
  runtime: typedRuntime,
});
const readDocumentAndMissingRuntimeActionSubmit: Effect.Effect<
  string,
  Action.ClientError | ActionInterrupted,
  RuntimeMissingService
> = readDocumentAndMissingRuntimeAction.submit(undefined);
// @ts-expect-error runtime-bound actions still preserve services not supplied by the runtime
const readDocumentAndMissingRuntimeActionSubmitErased: Effect.Effect<string> =
  readDocumentAndMissingRuntimeAction.submit(undefined);
interface RuntimeStartupError {
  readonly _tag: "RuntimeStartupError";
}
declare const runtimeWithStartupError: SunfallArcRuntime<
  RuntimeDocumentService,
  RuntimeStartupError
>;
const readDocumentRuntimeErrorAction = Action.use(ReadDocumentAction, {
  runtime: runtimeWithStartupError,
});
const readDocumentRuntimeErrorSubmit: Effect.Effect<
  string,
  Action.ClientError | ActionInterrupted | RuntimeStartupError
> = readDocumentRuntimeErrorAction.submit(undefined);
// Component bindings: the definition's services join the Component's R, and
// submissions see the instance's context (no runtime errors: it has started).
const solidReadDocumentActionBinding: Effect.Effect<
  Component.ActionHandle<void, string, never>,
  never,
  RuntimeDocumentService
> = Component.action(ReadDocumentAction);
const solidReadDocumentAction = bound(solidReadDocumentActionBinding);
const solidReadDocumentActionSubmit: Effect.Effect<string, Action.ClientError | ActionInterrupted> =
  solidReadDocumentAction.submit(undefined);
void readDocumentActionSubmit;
void readDocumentRuntimeActionSubmit;
void readDocumentRuntimeActionDefinitionRun;
void readDocumentRuntimeErrorSubmit;
void solidReadDocumentActionSubmit;
const solidTouchProject = bound(Component.action(TouchProject));
solidTouchProject.submit({ id: "atlas" }).pipe(Effect.map((project) => project.name.toUpperCase()));
// @ts-expect-error Component action handles preserve the action input type
solidTouchProject.submit({ slug: "atlas" });
// Action handles report status with the Resource reader's names.
const solidTouchWaiting: boolean = solidTouchProject.waiting();
const solidTouchFailure: Cause.Cause<Action.ClientError> | undefined = solidTouchProject.failure();
void solidTouchWaiting;
void solidTouchFailure;
// @ts-expect-error a callback that breaks its contract is a defect, not part of the handle's errors
const solidTouchCallbackFailure: Cause.Cause<EffectInputCallbackError> =
  solidTouchProject.failure()!;
void solidTouchCallbackFailure;

const InferredTouchProject = Action.define({
  name: "Project.inferredTouch",
  input: Schema.Struct({ id: Schema.String, name: Schema.String }),
  output: ProjectSchema,
  optimistic: ({ id }, transaction) =>
    Effect.gen(function* () {
      yield* transaction.set(label, id);
    }),
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project, input) => [ProjectTag({ id: project.id }), ProjectTag({ id: input.id })],
});
const inferredTouch = Action.use(InferredTouchProject, { runtime: emptyActionRuntime });
const inferredTouchSubmit: Effect.Effect<
  Project,
  ProjectError | Server.ClientError | Action.ClientError | ActionInterrupted,
  ProjectApi
> = inferredTouch.submit({ id: "atlas", name: "Atlas" });
void inferredTouchSubmit;

// @ts-expect-error inferred actions preserve schema input
inferredTouch.submit({ id: "atlas" });

const TouchProjectWithResultInvalidation = Action.define<
  { readonly id: string },
  ActionResult<Project>
>({
  name: "Project.touchResult",
  run: ({ id }) =>
    Effect.succeed(
      ActionResult.success(
        { id, name: "Touched" },
        { invalidates: [ProjectsTag, ProjectTag({ id })] },
      ),
    ),
});

Action.define<{ readonly id: string }, ActionResult<Project>>({
  name: "Project.touchResultPromise",
  // @ts-expect-error ActionResult.success cannot hide Promise payloads inside Action.run
  run: () => ActionResult.success(promisedProject),
});

Effect.runSync(
  Action.planInvalidation(
    TouchProjectWithResultInvalidation,
    ActionResult.success(
      { id: "atlas", name: "Atlas" },
      { invalidates: [ProjectTag({ id: "atlas" })] },
    ),
    { id: "atlas" },
  ),
);

// Start's transports post through the runtime's `HttpClient` (`App.launch`
// provides the client Layer's, else `FetchHttpClient`): the ActionTransport
// routes served Actions to the server, and the server-function client is an
// `effect/rpc` `RpcClient`.
const startActionTransport: Layer.Layer<ActionTransport, never, HttpClient.HttpClient> =
  makeActionTransportLayer({ actions: [TouchProject] });
const startRpcClient: Layer.Layer<Server.Client, never, HttpClient.HttpClient> = rpcClientLayer;
// @ts-expect-error the Start transports need an HttpClient
const startActionTransportWithoutHttp: Layer.Layer<ActionTransport> = makeActionTransportLayer({
  actions: [TouchProject],
});
void startActionTransport;
void startRpcClient;
void startActionTransportWithoutHttp;

// The same Action handle submits locally or through the transport: the result
// and error types are the Action's own (plus transport failures).
const touchHandle = bound(Component.action(TouchProject));
touchHandle.submit({ id: "atlas" }).pipe(Effect.map((project) => project.name.toUpperCase()));
touchHandle.input().pipe(Option.map((input) => input.id.toUpperCase()));
// @ts-expect-error Action handles preserve action input fields
touchHandle.submit({ slug: "atlas" });
// @ts-expect-error StartAction no longer creates client instances; use Component.action
StartAction.use(TouchProject);

StartAction.form(TouchProject, {
  input: { id: "atlas" },
});

StartAction.form(TouchProject, {
  // @ts-expect-error the form action URL is always the Start action endpoint
  action: "/custom/action",
});

StartAction.form(TouchProject, {
  // @ts-expect-error progressive action form defaults must match known action input fields
  input: { slug: "atlas" },
});

StartAction.form(TouchProject, {
  // @ts-expect-error progressive action form defaults must match action input value types
  input: { id: 123 },
});

const touchStartActionForm: StartAction.Form<typeof TouchProject> = StartAction.form(TouchProject);
void touchStartActionForm;

StartAction.form(TouchProject, {
  // @ts-expect-error namespaced progressive action form defaults must match known action input fields
  input: { slug: "atlas" },
});

StartAction.form(TouchProject, {
  // @ts-expect-error namespaced progressive action form defaults must match action input value types
  input: { id: 123 },
});

const devtoolsStore: Devtools.Store = Devtools.makeStore();
const devtoolsTimelineCommit: Devtools.TimelineCommit = {
  sequence: 1,
  label: Timeline.describe(renameCause),
  cause: renameCause,
  changes: [{ signal: "Project.title", previous: "Atlas", next: "Apollo" }],
};
Effect.runSync(devtoolsStore.recordTimelineEntry(projectStateHistory[0]!));
const devtoolsTrackTimelineEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackTimeline(projectTimeline);
const devtoolsResourceRuntimeEvent: Devtools.RuntimeEvent = {
  _tag: "ResourceStoreEvent",
  sequence: 1,
  event: {
    _tag: "ResourcePending",
    name: "Project.byId",
    key: "atlas",
    force: false,
    previous: false,
  },
};
const devtoolsTimelineRuntimeEvent: Devtools.RuntimeEvent = {
  _tag: "TimelineCommit",
  commit: devtoolsTimelineCommit,
};
const devtoolsRuntimeEvents: ReadonlyArray<Devtools.RuntimeEvent> = [
  devtoolsResourceRuntimeEvent,
  devtoolsTimelineRuntimeEvent,
];
const devtoolsRuntimeSnapshot: Devtools.Snapshot = {
  resources: [],
  actions: [],
  invalidations: [],
  routePlans: [],
  events: devtoolsRuntimeEvents,
};
Effect.runSync(devtoolsStore.recordRuntimeEvent(devtoolsResourceRuntimeEvent));
const serializedInvalidationPlan: Devtools.InvalidationPlan = {
  targets: [
    {
      _tag: "Tag",
      key: "Project:atlas",
      name: "Project",
    },
  ],
  entries: [
    {
      ref: {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: "atlas",
      },
      causes: [
        {
          _tag: "Tag",
          key: "Project:atlas",
          name: "Project",
        },
      ],
    },
  ],
};
const startInvalidationPlan: StartAction.InvalidationPlan = serializedInvalidationPlan;
const devtoolsInvalidationPlanFromStart: Devtools.InvalidationPlan = startInvalidationPlan;
Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", {
    serializedInvalidationPlan: startInvalidationPlan,
  }),
);
Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", {
    invalidationPlan: Effect.runSync(
      Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }),
    ),
  }),
);
const devtoolsStartInvalidationIndex: number = Effect.runSync(
  devtoolsStore.recordSerializedInvalidation(devtoolsInvalidationPlanFromStart),
);
const devtoolsSerializedInvalidationIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedInvalidation(startInvalidationPlan);
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan: startInvalidationPlan,
});
const devtoolsTrackActionEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackAction(touch);

Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", {
    invalidationPlan: Effect.runSync(
      Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }),
    ),
    // @ts-expect-error devtools action state accepts either live or serialized invalidation plans, not both
    serializedInvalidationPlan,
  }),
);
void devtoolsRuntimeSnapshot;
void devtoolsTrackTimelineEffect;
void devtoolsStartInvalidationIndex;
void devtoolsSerializedInvalidationIndexEffect;
void devtoolsTrackActionEffect;

// @ts-expect-error invalidation planning value must match the action output type
Effect.runSync(Action.planInvalidation(TouchProject, { id: "atlas" }, { id: "atlas" }));

Effect.runSync(
  // @ts-expect-error invalidation planning input must match the action input type
  Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { slug: "atlas" }),
);

Action.define<{ readonly id: string }, Project>({
  name: "Project.badAction",
  // @ts-expect-error action output must satisfy the action success type
  run: ({ id }) => ({ id }),
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.asyncAction",
  // @ts-expect-error actions must return Effect or a pure value, not Promise
  run: () => promisedProject,
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.asyncActionEffect",
  // @ts-expect-error actions cannot return Effects that succeed with Promise-shaped values
  run: () => Effect.succeed(promisedProject),
});

Action.define<{ readonly id: string }, unknown>({
  name: "Project.asyncActionUnknown",
  // @ts-expect-error actions cannot hide Promise-shaped values behind explicit unknown
  run: () => promisedProject,
});

Action.define<{ readonly id: string }, unknown>({
  name: "Project.asyncActionUnknownEffect",
  // @ts-expect-error actions cannot hide Effect Promise successes behind explicit unknown
  run: () => Effect.succeed(promisedProject),
});

Action.define<{ readonly id: string }, Effect.Effect<number>>({
  name: "Project.effectValuedAction",
  // @ts-expect-error explicit Effect-valued action outputs must be wrapped in Effect.succeed(...)
  run: () => effectNumberValue,
});

Action.define<{ readonly id: string }, Effect.Effect<number>>({
  name: "Project.wrappedEffectValuedAction",
  run: () => Effect.succeed(effectNumberValue),
});

// @ts-expect-error unannotated actions must return Effect or a pure value, not Promise
Action.define({
  name: "Project.asyncAction.inferred",
  run: () => promisedProject,
});

// @ts-expect-error unannotated actions cannot return callable-then-shaped values
Action.define({
  name: "Project.thenableAction.inferred",
  run: () => thenableProject,
});

// @ts-expect-error unannotated actions cannot return Effects that succeed with callable-then-shaped values
Action.define({
  name: "Project.thenableActionEffect.inferred",
  run: () => Effect.succeed(thenableProject),
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.promiseOptimistic",
  // @ts-expect-error optimistic callbacks must return an Effect, not Promise
  optimistic: () => promisedVoid,
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.promiseInvalidates",
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
  // @ts-expect-error invalidation callbacks must return metadata synchronously, not Promise
  invalidates: () => promisedProjects,
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticInput",
  // @ts-expect-error optimistic input comes from the action input type
  optimistic: (input: { readonly slug: string }) => Effect.void,
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticFailure",
  // @ts-expect-error optimistic patches cannot fail: the transaction owns rollback
  optimistic: () => Effect.fail("patch-failed" as const),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
});

const ProjectFormSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  spend: Schema.Number,
});
type ProjectFormValues = typeof ProjectFormSchema.Type;

ActionResult.validation<ProjectFormValues, string>({
  fieldErrors: { name: ["Required"], spend: ["Must be positive"] },
});
ActionResult.validation<ProjectFormValues, string>({
  fieldErrors: {
    // @ts-expect-error validation field maps reject unknown form fields
    missing: ["Required"],
  },
});

const projectForm = Form.make({
  name: "projectForm",
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
});

Form.make({
  name: "projectForm",
  schema: ProjectFormSchema,
  // @ts-expect-error initial values must satisfy the schema type
  initial: { id: "atlas", name: "Atlas Billing", spend: "1200" },
});

Form.make({
  name: "projectForm",
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  // @ts-expect-error form validation must return Effect or a pure value, not Promise
  validate: () => promisedVoid,
});

Form.make<typeof ProjectFormSchema, ProjectFormValues, string>({
  name: "projectForm",
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  validate: (_values, validation) =>
    // @ts-expect-error form validation errors must be plain data, not Promise-shaped
    Effect.fail(validation.field("name", promisedString)),
});

Form.make<typeof ProjectFormSchema, ProjectFormValues, string>({
  name: "projectForm",
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  validate: (_values, validation) =>
    // @ts-expect-error form validation errors must be plain data, not Effect-shaped
    Effect.fail(validation.form(effectNumberValue)),
});

Form.make<typeof ProjectFormSchema, ProjectFormValues, string>({
  name: "projectForm",
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  validate: (_values, validation) =>
    Effect.fail(
      validation.fields({
        // @ts-expect-error form validation field maps must hold plain data, not Promise-shaped
        name: [promisedString],
      }),
    ),
});

projectForm.setField("name", "Atlas Revenue");
projectForm.setField("spend", 1400);

// @ts-expect-error form fields must exist on the schema type
projectForm.setField("missing", "value");

// @ts-expect-error form field values must match the schema type
projectForm.setField("spend", "1400");

const ProjectFormDataSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  spend: Schema.NumberFromString,
  tags: Schema.Array(Schema.String),
});
type ProjectFormDataValues = typeof ProjectFormDataSchema.Type;
const browserFormData = new FormData();
browserFormData.append("tags", "billing");
browserFormData.append("tags", "core");
Form.data(browserFormData, { omitFields: ["__sunfall_arc_action"] }).tags;
const projectFormDataDecode: Effect.Effect<
  ProjectFormDataValues,
  Form.ValidationError<ProjectFormDataValues, Schema.SchemaError>
> = Form.decodeFormData(ProjectFormDataSchema, browserFormData, {
  omitFields: new Set(["__sunfall_arc_action"]),
});
void projectFormDataDecode;
