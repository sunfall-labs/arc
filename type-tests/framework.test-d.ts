import { Cause, Effect, Fiber, Metric, Request as EffectRequest, RequestResolver, Schema, Scope, Stream } from "effect";
import {
  Action,
  ActionInterrupted,
  ActionResult,
  Capability,
  EffectInputCallbackError,
  Form,
  Program,
  Resource,
  ResourceFailure,
  ResourceHydrationApplyError,
  ResourcePending,
  ResourceSnapshotCodecError,
  ResponseContext,
  Route,
  Server,
  Signal,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  buildRoutePath,
  cloneResourceSnapshotValue,
  defineApp,
  hrefForRouteInput,
  invokeEffectInput,
  isRouteParamName,
  makeActionSubmissionController,
  makeCoreDefinitionRegistry,
  makeCoreDefinitionRegistryAdapter,
  makeMemoryBrowserHistoryAdapter,
  makeResourceDefinitionRegistry,
  makeResourceStore,
  makeRuntime,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
  makeWindowBrowserHistoryAdapter,
  matchRoutePath,
  parseRoutePathSegments,
  read,
  route,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  toEffect,
  validateResourceHydrationInputEffect,
  type ActionSubmissionConcurrency,
  type ActionSubmissionState,
  type ActionResultInvalidationRequirements,
  type AnyEffectUiRuntime,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserRouterLinkClickDecision,
  type BrowserRouterLinkIgnoreReason,
  type BrowserRouterLinkPreloadDecision,
  type BrowserRouterLinkPreloadIdentity,
  type EffectUiRuntime,
  type EffectInput,
  type MemoryBrowserHistoryAdapter,
  type ParamsForPath,
  type ResourceSnapshotCodecOperation,
  type ResourceStore,
  type RuntimeUiScopeFrame,
  type UiScope
} from "@effect-ui/core";
// @ts-expect-error MutableResourceStore is an internal store implementation, not a root export.
import type { MutableResourceStore } from "@effect-ui/core";
// @ts-expect-error unsafeMutableResourceStore is an internal store implementation escape hatch, not a root export.
import { unsafeMutableResourceStore } from "@effect-ui/core";
// @ts-expect-error makeMutableResourceStore is an internal store constructor, not a root export.
import { makeMutableResourceStore } from "@effect-ui/core";
import {
  Collection,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  Query,
  CollectionSnapshotCodecError,
  CollectionStorageError,
  ReadonlyCollectionMutation,
  QueryEvaluationError,
  SQLitePersistenceInvalidTableName,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  makeCollectionReactivePreloadController,
  makeSQLitePersistenceStorage,
  serverCollectionOptions
} from "@effect-ui/db";
import { useCollection, useLiveQuery, type CollectionHandle, type LiveQueryHandle } from "@effect-ui/solid-db";
import {
  useCollection as useReactCollection,
  useLiveQuery as useReactLiveQuery,
  type CollectionHandle as ReactCollectionHandle,
  type LiveQueryHandle as ReactLiveQueryHandle
} from "@effect-ui/react-db";
import {
  createBrowserRouter,
  RouterContextMissing,
  RuntimeProvider,
  RouterProvider,
  RouterRouteNotRegistered,
  useAction,
  useResource,
  useResourceSuspense,
  useProgram,
  useRuntimeEffect,
  useStream,
  type BrowserNavigateArgs,
  type BrowserRouter,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterState,
  type ProgramHandle,
  type RouterLinkProps,
  type RouterOutletProps
} from "@effect-ui/solid";
import {
  createBrowserRouter as createReactBrowserRouter,
  RouterContextMissing as ReactRouterContextMissing,
  RouterProvider as ReactRouterProvider,
  RouterRouteNotRegistered as ReactRouterRouteNotRegistered,
  RuntimeProvider as ReactRuntimeProvider,
  useProgram as useReactProgram,
  useResource as useReactResource,
  useResourceSuspense as useReactResourceSuspense,
  useRuntimeEffect as useReactRuntimeEffect,
  useSignal as useReactSignal,
  useStream as useReactStream,
  type BrowserNavigateArgs as ReactBrowserNavigateArgs,
  type BrowserRouter as ReactBrowserRouter,
  type BrowserRouterPath as ReactBrowserRouterPath,
  type BrowserRouterRouteForPath as ReactBrowserRouterRouteForPath,
  type BrowserRouterState as ReactBrowserRouterState,
  type ProgramHandle as ReactProgramHandle,
  type RouterLinkProps as ReactRouterLinkProps,
  type RouterOutletProps as ReactRouterOutletProps,
  type ResourceHandle as ReactResourceHandle
} from "@effect-ui/react";
import {
  describeDevtoolsPanels,
  describeDevtoolsSummary,
  makeDevtoolsStore,
  normalizeAppGraphCollectionDefinitions,
  normalizeAppGraphUnknownRoutePreloadCollections,
  normalizeDevtoolsAppGraphDiagnostics,
  normalizeRouteModulePreloadCollections,
  type DevtoolsCollectionStoreEvent,
  type DevtoolsInvalidationPlan,
  type DevtoolsProgramEvent,
  type DevtoolsPanels,
  type DevtoolsRequestTrace,
  type DevtoolsRequestTraceTeardown,
  type DevtoolsRuntimeEvent,
  type DevtoolsSnapshot,
  type DevtoolsStartAppGraphCollectionDiagnostics,
  type DevtoolsStartAppGraphDiagnostics,
  type DevtoolsStartAppGraphRoutePreloadCollections,
  type DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry,
  type DevtoolsStore,
  type DevtoolsSummary
} from "@effect-ui/devtools";
import {
  Action as StartRootAction,
  defineApp as startRootDefineApp,
  createRequestHandler,
  createRequestHandlerEffect,
  createFileRouteDefinitionsModule,
  createFileRouteModuleReferences,
  createGeneratedFileRouteDefinitionsModule,
  createServerActionResponseEffect,
  createServerRpcResponseEffect,
  createStartAgentGraphImpact,
  createStartAgentGraphImpactEffect,
  createStartAgentGraph,
  createStartAgentGraphEffect,
  createStartStreamedHtmlResponseEffect,
  defaultGeneratedFileRouteDefinitionsHeader,
  defineFileRoute,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier,
  hydrateFromDocument,
  hydrateFromDocumentEffect,
  hydrateStartHydrationChunksFromDocument,
  hydrateStartHydrationChunksFromDocumentEffect,
  makeStartEffectRpcGroup,
  makeRpcClient,
  makeRpcClientLayer,
  preloadRequest,
  preloadRequestEffect,
  formatStartAgentGraphImpact,
  queryStartAgentGraph,
  queryStartAgentGraphEffect,
  readStartHydrationChunks,
  read as startRootRead,
  Resource as StartRootResource,
  route as startRootRoute,
  Route as StartRootRoute,
  serverFunctionToEffectRpc,
  Server as StartRootServer,
  Signal as StartRootSignal,
  StartAction,
  startActionForm,
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric,
  startTransportEndpointEnvelopeEffect,
  formatStartAgentGraph,
  type StartAgentGraph,
  type StartAgentGraphEdge,
  type StartAgentGraphEdgeKind,
  type StartAgentGraphFormatOptions,
  type StartAgentGraphImpact,
  type StartAgentGraphImpactItem,
  type StartAgentGraphImpactOptions,
  type StartAgentGraphImpactRelation,
  type StartAgentGraphImpactRelationKind,
  type StartAgentGraphInput,
  type StartAgentGraphNode,
  type StartAgentGraphNodeKind,
  type StartAgentGraphNodeStatus,
  type StartAgentGraphQuery,
  type StartAgentGraphQueryKind,
  type StartAgentGraphQueryResult,
  type StartAgentGraphSelfReview,
  type StartAgentGraphSummary,
  type FileRouteDefinitionsModuleOptions,
  type FileRouteManifest,
  type GeneratedFileRouteDefinitionsModuleOptions,
  type StartActionInvalidationPlan,
  type StartEffectRpcCompatibilityArtifact,
  type StartHydrationError,
  type StartRequestHandler,
  type StartRequestHandlerError,
  type StartRequestTrace,
  type StartRequestTraceTeardown,
  type StartAppGraphDiagnostics,
  type StartFetch,
  type StartStreamedHtmlResponseOptions,
  type StartTransportDiagnosticsOptions,
  type StartTransportEndpointEnvelope,
  streamHydrationConsumedAttribute,
  submitStartActionEffect
} from "@effect-ui/start";
import {
	  effectUiStart,
	  FileRouteDefinitionsFileWriteError,
	  handleSsrDevRequestEffect,
	  loadStartAppGraphDiagnostics,
	  loadStartAppGraphDiagnosticsEffect,
	  startDevServerFromVite,
	  StartDevServerError,
	  StartHandlerNotFound,
	  writeFileRouteDefinitionsFileEffect,
	  type EffectUiStartPlugin,
	  type FileRouteDefinitionsFileWriteFailure,
	  type FileRouteDefinitionsFileWriteResult,
	  type LoadedStartAppGraphDiagnostics,
	  type LoadStartAppGraphDiagnosticsOptions,
	  type StartDevServer,
	  type StartAppGraphDiagnosticsLoadError,
	  type StartSsrRequestHandler
	} from "@effect-ui/start/vite";
import {
  createStartDiagnosticsReport as createSubpathStartDiagnosticsReport,
  formatStartDiagnosticsReport as formatSubpathStartDiagnosticsReport,
  type StartDiagnosticsReport as SubpathStartDiagnosticsReport,
  type StartDiagnosticsReportFinding as SubpathStartDiagnosticsReportFinding,
  type StartDiagnosticsReportFindingKind as SubpathStartDiagnosticsReportFindingKind,
  type StartDiagnosticsReportInput as SubpathStartDiagnosticsReportInput,
  type StartDiagnosticsReportOwnerGroup as SubpathStartDiagnosticsReportOwnerGroup,
  type StartDiagnosticsReportStatus as SubpathStartDiagnosticsReportStatus,
  type StartDiagnosticsReportSummary as SubpathStartDiagnosticsReportSummary
} from "@effect-ui/start/diagnostics-report";
import type { StartDiagnosticsCliIo as FrameworkStartDiagnosticsCliIo } from "@effect-ui/start/cli";
import "@effect-ui/start/virtual";
	import {
	  createNodeHandler,
	  createNodeHandlerEffect,
	  createNodeServerHandler,
	  nodeRequestOrigin,
	  nodeRequestToWebRequest,
	  nodeRequestToWebRequestEffect,
	  toFetchHandler,
	  toFetchHandlerEffect,
	  writeNodeResponse,
	  writeNodeResponseEffect,
	  type StartFetchHandler,
	  type StartFetchHandlerEffect,
	  type StartFetchPromiseHandler,
	  type StartFetchPromiseHandlerOptions,
	  type StartFetchPromiseHandlerRuntimeOptions,
	  type StartForkRuntime,
	  type StartNodeAdapterError,
	  type StartNodeHandler,
	  type StartNodeHandlerEffect,
	  type StartNodeOriginPolicy,
	  type StartNodeRequestOptions,
	  type StartNodeServerHandlerOptions,
	  type StartNodeServerHandlerRuntimeOptions,
	  type WriteNodeResponseOptions
	} from "@effect-ui/start/adapters";
	import {
	  createFetchHandler as createSubpathFetchHandler,
	  toFetchHandler as toSubpathFetchHandler,
	  toFetchHandlerEffect as toSubpathFetchHandlerEffect,
	  type StartFetchHandler as SubpathStartFetchHandler,
	  type StartFetchHandlerEffect as SubpathStartFetchHandlerEffect,
	  type StartFetchPromiseHandler as SubpathStartFetchPromiseHandler,
	  type StartFetchPromiseHandlerOptions as SubpathStartFetchPromiseHandlerOptions,
	  type StartFetchPromiseHandlerRuntimeOptions as SubpathStartFetchPromiseHandlerRuntimeOptions
	} from "@effect-ui/start/fetch-adapter";
	import {
	  createNodeHandler as createSubpathNodeHandler,
	  createNodeHandlerEffect as createSubpathNodeHandlerEffect,
	  createNodeServerHandler as createSubpathNodeServerHandler,
	  nodeRequestOrigin as subpathNodeRequestOrigin,
	  nodeRequestToWebRequest as subpathNodeRequestToWebRequest,
	  nodeRequestToWebRequestEffect as subpathNodeRequestToWebRequestEffect,
	  writeNodeResponse as subpathWriteNodeResponse,
	  writeNodeResponseEffect as subpathWriteNodeResponseEffect,
	  type StartForkRuntime as SubpathStartForkRuntime,
	  type StartNodeHandler as SubpathStartNodeHandler,
	  type StartNodeHandlerEffect as SubpathStartNodeHandlerEffect,
	  type StartNodeOriginPolicy as SubpathStartNodeOriginPolicy,
	  type StartNodeRequestOptions as SubpathStartNodeRequestOptions,
	  type StartNodeServerHandler as SubpathStartNodeServerHandler,
	  type StartNodeServerHandlerOptions as SubpathStartNodeServerHandlerOptions,
	  type StartNodeServerHandlerRuntimeOptions as SubpathStartNodeServerHandlerRuntimeOptions,
	  type WriteNodeResponseOptions as SubpathWriteNodeResponseOptions
	} from "@effect-ui/start/node-adapter";
	import {
	  createFetchHandler as createPackagedFetchHandler,
	  toFetchHandler as toPackagedFetchHandler,
	  toFetchHandlerEffect as toPackagedFetchHandlerEffect,
	  type StartFetchHandler as PackagedStartFetchHandler,
	  type StartFetchHandlerEffect as PackagedStartFetchHandlerEffect,
	  type StartFetchPromiseHandler as PackagedStartFetchPromiseHandler,
	  type StartFetchPromiseHandlerOptions as PackagedStartFetchPromiseHandlerOptions,
	  type StartFetchPromiseHandlerRuntimeOptions as PackagedStartFetchPromiseHandlerRuntimeOptions
	} from "@effect-ui/start-fetch";
	import {
	  createNodeHandler as createPackagedNodeHandler,
	  createNodeHandlerEffect as createPackagedNodeHandlerEffect,
	  createNodeServerHandler as createPackagedNodeServerHandler,
	  nodeRequestOrigin as packagedNodeRequestOrigin,
	  nodeRequestToWebRequest as packagedNodeRequestToWebRequest,
	  nodeRequestToWebRequestEffect as packagedNodeRequestToWebRequestEffect,
	  writeNodeResponse as packagedWriteNodeResponse,
	  writeNodeResponseEffect as packagedWriteNodeResponseEffect,
	  type StartForkRuntime as PackagedStartForkRuntime,
	  type StartNodeHandler as PackagedStartNodeHandler,
	  type StartNodeHandlerEffect as PackagedStartNodeHandlerEffect,
	  type StartNodeOriginPolicy as PackagedStartNodeOriginPolicy,
	  type StartNodeRequestOptions as PackagedStartNodeRequestOptions,
	  type StartNodeServerHandlerOptions as PackagedStartNodeServerHandlerOptions,
	  type StartNodeServerHandlerRuntimeOptions as PackagedStartNodeServerHandlerRuntimeOptions,
	  type WriteNodeResponseOptions as PackagedWriteNodeResponseOptions
	} from "@effect-ui/start-node";
import effectUiTsrxDefault, {
  effectUiTsrx,
  type EffectUiTsrxOptions
} from "@effect-ui/tsrx";
import type { PluginOption } from "vite";
import {
  makeProjectId as makeProjectConsoleProjectId
} from "../examples/project-console/src/domain.contract.js";
import "@effect-ui/start/virtual";
import {
  diagnosticsPolicyViolations as virtualDiagnosticsPolicyViolations
} from "virtual:effect-ui/app-graph";
import {
  hrefById as virtualHrefByIdForRoute,
  hrefByPath as virtualHrefByPathForRoute,
  isRoutePathMatch as isVirtualRoutePathMatch,
  layoutsByPath as virtualLayoutsByPath,
  metadataById as virtualMetadataById,
  routeIdByPath as virtualRouteIdByPath,
  routeById as virtualRouteById,
  routeByPath as virtualRouteByPath,
  routes as virtualFileRoutes,
  type FileRouteLayouts as VirtualFileRouteLayouts,
  type FileRouteMetadataModules as VirtualFileRouteMetadataModules,
  type Href as VirtualHref,
  type HrefArgs as VirtualHrefArgs,
  type HrefById as VirtualHrefById,
  type HrefByPath as VirtualHrefByPath,
  type FileRouteId as VirtualFileRouteId,
  type FileRoutePath as VirtualFileRoutePath,
  type Match as VirtualMatch,
  type ParamsById as VirtualParamsById,
  type RouteId as VirtualRouteId,
  type RoutePath as VirtualRoutePath,
  type SearchByPath as VirtualSearchByPath
} from "virtual:effect-ui/routes";
import type {
  FileRouteHrefOptionsById as ProjectConsoleFileRouteHrefOptionsById,
	  FileRouteHrefOptionsByPath as ProjectConsoleFileRouteHrefOptionsByPath,
	  FileRouteLayouts as ProjectConsoleFileRouteLayouts,
	  FileRouteMetadataModules as ProjectConsoleFileRouteMetadataModules,
	  FileRouteId as ProjectConsoleFileRouteId,
	  FileRouteParamsById as ProjectConsoleFileRouteParamsById,
	  FileRoutePath as ProjectConsoleFileRoutePath,
	  FileRouteSearchByPath as ProjectConsoleFileRouteSearchByPath,
  Href as ProjectConsoleHref,
  HrefArgs as ProjectConsoleHrefArgs,
  HrefById as ProjectConsoleHrefById,
  HrefByPath as ProjectConsoleHrefByPath,
  Match as ProjectConsoleMatch,
	  ParamsById as ProjectConsoleParamsById,
	  RouteIdByPath as ProjectConsoleRouteIdByPath,
	  RouteId as ProjectConsoleRouteId,
	  RoutePath as ProjectConsoleRoutePath,
	  RouteTree as ProjectConsoleRouteTree
	} from "../examples/project-console/src/routeTree.gen.js";
	import {
	  layoutsByPath as projectConsoleLayoutsByPath,
	  metadataById as projectConsoleMetadataById,
	  hrefById as projectConsoleHrefById,
	  hrefByPath as projectConsoleHrefByPath,
	  isRoutePathMatch as isProjectConsoleRoutePathMatch,
	  routeIdByPath as projectConsoleRouteIdByPath,
	  routeByPath as projectConsoleRouteByPath
	} from "../examples/project-console/src/routeTree.gen.js";

const tsrxOptions: EffectUiTsrxOptions = {
  optimizeDeps: {
    noDiscovery: false
  }
};
const tsrxPlugins: PluginOption[] = effectUiTsrx(tsrxOptions);
const defaultTsrxPlugins: PluginOption[] = effectUiTsrxDefault();
void tsrxPlugins;
void defaultTsrxPlugins;
const startRootAction: typeof Action = StartRootAction;
const startRootResource: typeof Resource = StartRootResource;
const startRootRouteNamespace: typeof Route = StartRootRoute;
const startRootRouteHelper: typeof route = startRootRoute;
const startRootServer: typeof Server = StartRootServer;
const startRootSignal: typeof Signal = StartRootSignal;
const startRootAppHelper: typeof defineApp = startRootDefineApp;
const startRootReadHelper: typeof read = startRootRead;
const startRootRpcEndpointHelper: typeof createServerRpcResponseEffect =
  createServerRpcResponseEffect;
const startRootActionEndpointHelper: typeof createServerActionResponseEffect =
  createServerActionResponseEffect;
const startTransportEnvelopeOptions: StartTransportDiagnosticsOptions = { requestId: "req-type" };
const startTransportEnvelopeEffect: Effect.Effect<StartTransportEndpointEnvelope> =
  startTransportEndpointEnvelopeEffect(
    "rpc",
    new Request("https://example.com/__effect-ui/rpc"),
    startTransportEnvelopeOptions
  );
void startRootAction;
void startRootResource;
void startRootRouteNamespace;
void startRootRouteHelper;
void startRootServer;
void startRootSignal;
void startRootAppHelper;
void startRootReadHelper;
void startRootRpcEndpointHelper;
void startRootActionEndpointHelper;
void startTransportEnvelopeEffect;

const ProjectTab = Schema.Literals(["overview", "activity"]);
const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
type ProjectId = typeof ProjectId.Type;
const atlasProjectId = Schema.decodeUnknownSync(ProjectId)("atlas");

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String
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
// @ts-expect-error direct EffectInput values cannot be Promise-shaped
toEffect(promisedProject);
// @ts-expect-error ActionResult.fromEffect rejects Promise-shaped direct values
ActionResult.fromEffect(promisedProject);
// @ts-expect-error ActionResult.fromValidationEffect rejects Promise-shaped direct values
ActionResult.fromValidationEffect(promisedProject);

type ProjectError = {
  readonly _tag: "ProjectError";
  readonly message: string;
};

// @ts-expect-error direct EffectInput values cannot include Promise-shaped union members
toEffect<typeof maybePromisedProject>(maybePromisedProject);
// @ts-expect-error ActionResult.fromEffect rejects Promise-shaped union success values
ActionResult.fromEffect<typeof maybePromisedProject>(maybePromisedProject);
// @ts-expect-error ActionResult.fromValidationEffect rejects Promise-shaped union success values
ActionResult.fromValidationEffect<typeof maybePromisedProject, ProjectError>(maybePromisedProject);
// @ts-expect-error invokeEffectInput rejects callbacks whose success type includes Promise-shaped union members
invokeEffectInput<[], typeof maybePromisedProject>("test.callback", () => maybePromisedProject);

const coreDefinitionRegistry = makeCoreDefinitionRegistry({
  actions: [{ name: "Project.rename", effect: Effect.void }],
  serverFunctions: new Map([
    ["Project.get", { name: "Project.get", method: "GET" as const }]
  ])
});
const coreDefinitionRegistryAction = coreDefinitionRegistry.actions.get("Project.rename");
const coreDefinitionRegistryServer = coreDefinitionRegistry.serverFunctions.get("Project.get");
const coreDefinitionRegistryAdapter = makeCoreDefinitionRegistryAdapter<
  { readonly name: string; readonly effect: Effect.Effect<void> },
  { readonly name: string; readonly method: "GET" | "POST" }
>({ duplicates: "keep-first" });
const coreActionRegistration = coreDefinitionRegistryAdapter.registerAction({
  name: "Project.rename",
  effect: Effect.void
});
const coreDuplicateActionRegistration = coreDefinitionRegistryAdapter.registerAction({
  name: "Project.rename",
  effect: Effect.void
});
const coreServerRegistration = coreDefinitionRegistryAdapter.registerServerFunction({
  name: "Project.get",
  method: "GET"
});
const coreDefinitionDiagnostics = coreDefinitionRegistryAdapter.diagnostics();
const coreDefinitionDuplicatePolicy: "keep-first" | "replace" =
  coreDefinitionDiagnostics.duplicates[0]?.policy ?? "replace";
const actionSubmissionConcurrency: ActionSubmissionConcurrency = "exhaust";
const actionSubmissionIdleState: ActionSubmissionState<{ readonly id: string }, Project, ProjectError> = {
  _tag: "Idle"
};
const actionSubmissionSuccessState: ActionSubmissionState<{ readonly id: string }, Project, ProjectError> = {
  _tag: "Success",
  input: { id: "atlas" },
  value: { id: "atlas", name: "Atlas" }
};
const actionSubmissionController = makeActionSubmissionController<
  { readonly id: string },
  Project,
  ProjectError
>({
  actionName: "Project.rename",
  concurrency: actionSubmissionConcurrency
});
const actionSubmissionState: ActionSubmissionState<{ readonly id: string }, Project, ProjectError> =
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

const ProjectRoute = route("/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) })
});
const OptionsFreeProjectRoute = route("/options-free-projects/:id");
Route.href(OptionsFreeProjectRoute, {
  params: { id: "atlas" }
});
// @ts-expect-error options-free routes still preserve inferred path params
Route.href(OptionsFreeProjectRoute, { params: {} });
void OptionsFreeProjectRoute;
const StaticProjectRoute = route("/static-projects");
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
  "/projects/atlas/tasks/rename"
);
const routeGrammarHref: string = buildRoutePath("/projects/:projectId/tasks/:taskId?", {
  projectId: "atlas"
});
const routeGrammarInputHref: string = hrefForRouteInput("/projects/atlas?tab=activity");
const routeGrammarInferredParams: ParamsForPath<"/projects/:projectId/tasks/:taskId?"> = {
  projectId: "atlas"
};
const routeGrammarInferredParamsWithOptional: ParamsForPath<"/projects/:projectId/tasks/:taskId?"> = {
  projectId: "atlas",
  taskId: "rename"
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
  search: { tab: "activity" }
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
  (props: { readonly params: { readonly slug: string } }) => undefined
);

// @ts-expect-error missing route param
Route.href(ProjectRoute, { params: {} });

declare const projectRouterFailure: Extract<
  BrowserRouterState<readonly [typeof ProjectRoute]>,
  { readonly _tag: "Failure" }
>;
const projectRouterFailureCause: Cause.Cause<Route.NavigationError> = projectRouterFailure.cause;
const projectRouterFailureError: Route.NavigationError | undefined = projectRouterFailure.error;
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
  initialHref: "/projects/atlas"
});
const browserHistoryAdapter: BrowserHistoryAdapter = memoryBrowserHistory;
const browserHistoryEntries: ReadonlyArray<string> = memoryBrowserHistory.entries();
memoryBrowserHistory.externalNavigate("/projects/grace");
declare const browserHistoryWindow: BrowserHistoryWindow | undefined;
const windowBrowserHistory: BrowserHistoryAdapter = makeWindowBrowserHistoryAdapter(() => browserHistoryWindow);
const browserHistoryCurrentHref: string = windowBrowserHistory.currentHref("/");
const browserHistoryCommittedHref: string = browserHistoryAdapter.commit("/projects/ada", { replace: true });
void browserHistoryEntries;
void browserHistoryCurrentHref;
void browserHistoryCommittedHref;
const projectRouterFailureRenderer: NonNullable<RouterOutletProps<ProjectError>["failure"]> = (state) => {
  const cause: Cause.Cause<Route.NavigationError | ProjectError> = state.cause;
  const error: Route.NavigationError | ProjectError | undefined = state.error;
  void cause;
  void error;
  return undefined;
};
void projectRouterFailureRenderer;
const projectRouterOutletProps: RouterOutletProps<readonly [typeof ProjectRoute], ProjectError> = {
  pending: (state) => {
    const match: Route.Match<typeof ProjectRoute> = state.match;
    match.params.id.toUpperCase();
    return undefined;
  },
  failure: (state) => {
    const match: Route.Match<typeof ProjectRoute> | undefined = state.match;
    const cause: Cause.Cause<Route.NavigationError | ProjectError> = state.cause;
    match?.params.id.toUpperCase();
    void cause;
    return undefined;
  }
};
const projectBrowserRouter: BrowserRouter<readonly [typeof ProjectRoute]> = createBrowserRouter(
  [ProjectRoute] as const,
  { initialHref: "/projects/atlas", history: browserHistoryAdapter }
);
projectBrowserRouter.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" }
});
projectBrowserRouter.navigate(ProjectRoute, {
  params: { id: "atlas" },
  search: {}
});
const projectBrowserRouterPreload: Effect.Effect<void, Route.NavigationError> =
  projectBrowserRouter.preloadEffect(ProjectRoute, {
    params: { id: "atlas" },
    search: {}
  });
const coreRouterLinkPreloadDecision: BrowserRouterLinkPreloadDecision =
  browserRouterLinkPreloadDecision({
    defaultPrevented: false,
    preload: true,
    canHandleRoute: true,
    target: "_self"
  });
const coreRouterLinkPreloadIdentity: BrowserRouterLinkPreloadIdentity =
  browserRouterLinkPreloadIdentity({
    href: "/projects/atlas",
    preload: true,
    canHandleRoute: true,
    target: "_self"
  });
const coreRouterLinkClickDecision: BrowserRouterLinkClickDecision =
  browserRouterLinkClickDecision({
    event: {
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      defaultPrevented: false
    },
    href: "/projects/atlas",
    replace: true,
    canHandleRoute: true
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
const mixedProjectBrowserRouter = createBrowserRouter([StaticProjectRoute, ProjectRoute] as const, {
  initialHref: "/projects/atlas"
});
type MixedProjectRouterPath = BrowserRouterPath<readonly [typeof StaticProjectRoute, typeof ProjectRoute]>;
const mixedProjectRouterPath: MixedProjectRouterPath = "/projects/:id";
const mixedStaticRouterPath: MixedProjectRouterPath = "/static-projects";
// @ts-expect-error browser router paths are drawn from the configured route tuple
const badMixedProjectRouterPath: MixedProjectRouterPath = "/missing";
type MixedProjectRouteByPath = BrowserRouterRouteForPath<
  readonly [typeof StaticProjectRoute, typeof ProjectRoute],
  "/projects/:id"
>;
const mixedProjectRouteByPath: MixedProjectRouteByPath = ProjectRoute;
const projectBrowserNavigateArgs: BrowserNavigateArgs<typeof ProjectRoute> = [{
  params: { id: "atlas" },
  search: {}
}];
const staticBrowserNavigateArgs: BrowserNavigateArgs<typeof StaticProjectRoute> = [];
mixedProjectBrowserRouter.hrefByPath("/static-projects");
mixedProjectBrowserRouter.hrefByPath("/projects/:id", {
  params: { id: "atlas" },
  search: { tab: "activity" }
});
mixedProjectBrowserRouter.navigate(StaticProjectRoute);
mixedProjectBrowserRouter.navigateByPath("/static-projects");
mixedProjectBrowserRouter.navigateByPath("/projects/:id", {
  params: { id: "atlas" },
  search: {}
}, { replace: true });
const mixedProjectBrowserRouterPreload: Effect.Effect<void, Route.NavigationError> =
  mixedProjectBrowserRouter.preloadByPathEffect("/projects/:id", {
    params: { id: "atlas" },
    search: {}
  });
const mixedProjectBrowserRouterMatch = mixedProjectBrowserRouter.matchByPath("/projects/:id");
if (mixedProjectBrowserRouterMatch) {
  const id: string = mixedProjectBrowserRouterMatch.params.id;
  const tab: "overview" | "activity" | undefined = mixedProjectBrowserRouterMatch.search.tab;
  void id;
  void tab;
}
// @ts-expect-error browser router path helpers reject unknown route paths
mixedProjectBrowserRouter.hrefByPath("/missing");
// @ts-expect-error browser router path helpers preserve route params
mixedProjectBrowserRouter.hrefByPath("/projects/:id", { params: {} });
// @ts-expect-error browser router path helpers preserve static route params
mixedProjectBrowserRouter.hrefByPath("/static-projects", { params: { id: "atlas" } });
// @ts-expect-error browser router href preserves route params
projectBrowserRouter.href(ProjectRoute, { params: {} });
const projectRouterLinkProps: RouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  options: {
    params: { id: "atlas" },
    search: { tab: "activity" }
  },
  class: "projectLink"
};
const staticRouterLinkProps: RouterLinkProps<typeof StaticProjectRoute> = {
  route: StaticProjectRoute
};
const badProjectRouterLinkProps: RouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  // @ts-expect-error RouterLink preserves route params
  options: { params: {} }
};
void projectRouterOutletProps;
void projectBrowserRouterPreload;
void mixedProjectRouterPath;
void mixedStaticRouterPath;
void badMixedProjectRouterPath;
void mixedProjectRouteByPath;
void projectBrowserNavigateArgs;
void staticBrowserNavigateArgs;
void mixedProjectBrowserRouterPreload;
void projectRouterLinkProps;
void staticRouterLinkProps;
void badProjectRouterLinkProps;
declare const reactProjectRouterFailure: Extract<
  ReactBrowserRouterState<readonly [typeof ProjectRoute]>,
  { readonly _tag: "Failure" }
>;
const reactProjectRouterFailureCause: Cause.Cause<Route.NavigationError> = reactProjectRouterFailure.cause;
const reactProjectRouterFailureError: Route.NavigationError | undefined = reactProjectRouterFailure.error;
void reactProjectRouterFailureCause;
void reactProjectRouterFailureError;
const reactRouterContextMissing = new ReactRouterContextMissing({ hook: "useRouter" });
const reactRouterContextMissingHook: string = reactRouterContextMissing.hook;
const reactRouterRouteNotRegistered = new ReactRouterRouteNotRegistered({ path: "/outside" });
const reactRouterRouteNotRegisteredPath: string = reactRouterRouteNotRegistered.path;
void reactRouterContextMissingHook;
void reactRouterRouteNotRegisteredPath;
const reactProjectRouterOutletProps: ReactRouterOutletProps<readonly [typeof ProjectRoute], ProjectError> = {
  pending: (state) => {
    const match: Route.Match<typeof ProjectRoute> = state.match;
    match.params.id.toUpperCase();
    return undefined;
  },
  failure: (state) => {
    const match: Route.Match<typeof ProjectRoute> | undefined = state.match;
    const cause: Cause.Cause<Route.NavigationError | ProjectError> = state.cause;
    match?.params.id.toUpperCase();
    void cause;
    return undefined;
  }
};
const reactProjectBrowserRouter: ReactBrowserRouter<readonly [typeof ProjectRoute]> = createReactBrowserRouter(
  [ProjectRoute] as const,
  { initialHref: "/projects/atlas", history: browserHistoryAdapter }
);
const reactProjectRouterState: ReactBrowserRouterState<readonly [typeof ProjectRoute]> =
  useReactSignal(reactProjectBrowserRouter.state);
reactProjectBrowserRouter.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" }
});
reactProjectBrowserRouter.navigate(ProjectRoute, {
  params: { id: "atlas" },
  search: {}
});
const reactMixedProjectBrowserRouter = createReactBrowserRouter([StaticProjectRoute, ProjectRoute] as const, {
  initialHref: "/projects/atlas"
});
type ReactMixedProjectRouterPath = ReactBrowserRouterPath<readonly [typeof StaticProjectRoute, typeof ProjectRoute]>;
const reactMixedProjectRouterPath: ReactMixedProjectRouterPath = "/projects/:id";
type ReactMixedProjectRouteByPath = ReactBrowserRouterRouteForPath<
  readonly [typeof StaticProjectRoute, typeof ProjectRoute],
  "/projects/:id"
>;
const reactMixedProjectRouteByPath: ReactMixedProjectRouteByPath = ProjectRoute;
const reactProjectBrowserNavigateArgs: ReactBrowserNavigateArgs<typeof ProjectRoute> = [{
  params: { id: "atlas" },
  search: {}
}];
reactMixedProjectBrowserRouter.hrefByPath("/static-projects");
reactMixedProjectBrowserRouter.hrefByPath("/projects/:id", {
  params: { id: "atlas" },
  search: { tab: "activity" }
});
reactMixedProjectBrowserRouter.navigateByPath("/projects/:id", {
  params: { id: "atlas" },
  search: {}
}, { replace: true });
const reactMixedProjectBrowserRouterPreload: Effect.Effect<void, Route.NavigationError> =
  reactMixedProjectBrowserRouter.preloadByPathEffect("/projects/:id", {
    params: { id: "atlas" },
    search: {}
  });
const reactProjectRouterLinkProps: ReactRouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  options: {
    params: { id: "atlas" },
    search: { tab: "activity" }
  },
  className: "projectLink"
};
const reactBadProjectRouterLinkProps: ReactRouterLinkProps<typeof ProjectRoute> = {
  route: ProjectRoute,
  // @ts-expect-error React RouterLink preserves route params
  options: { params: {} }
};
// @ts-expect-error React browser router path helpers reject unknown route paths
reactMixedProjectBrowserRouter.hrefByPath("/missing");
// @ts-expect-error React browser router href preserves route params
reactProjectBrowserRouter.href(ProjectRoute, { params: {} });
void reactProjectRouterOutletProps;
void reactProjectRouterState;
void reactMixedProjectRouterPath;
void reactMixedProjectRouteByPath;
void reactProjectBrowserNavigateArgs;
void reactMixedProjectBrowserRouterPreload;
void reactProjectRouterLinkProps;
void reactBadProjectRouterLinkProps;

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error invalid search literal
  search: { tab: "settings" }
});

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error unknown search key
  search: { sort: "name" }
});

const BrandedProjectRoute = route("/branded-projects/:id", {
  params: Schema.Struct({ id: ProjectId })
});
const brandedRouterLinkProps: RouterLinkProps<typeof BrandedProjectRoute> = {
  route: BrandedProjectRoute,
  options: { params: { id: atlasProjectId } }
};
const badBrandedRouterLinkProps: RouterLinkProps<typeof BrandedProjectRoute> = {
  route: BrandedProjectRoute,
  options: {
    params: {
      // @ts-expect-error RouterLink preserves branded route params
      id: "atlas"
    }
  }
};

Route.href(BrandedProjectRoute, {
  params: { id: atlasProjectId }
});
void brandedRouterLinkProps;
void badBrandedRouterLinkProps;

// @ts-expect-error branded route params reject accidental plain strings
Route.href(BrandedProjectRoute, { params: { id: "atlas" } });

const OptionalProjectRoute = route("/optional-projects/:id?", {});

Route.href(OptionalProjectRoute);
Route.href(OptionalProjectRoute, { params: {} });
Route.href(OptionalProjectRoute, { params: { id: "atlas" } });

// @ts-expect-error optional route params still reject unknown keys
Route.href(OptionalProjectRoute, { params: { slug: "atlas" } });

const generatedRouteTree = [
  defineFileRoute("/")({}),
  defineFileRoute("/generated-projects/:id")({})
] as const;
const generatedRouteById = {
  route_root: generatedRouteTree[0],
  route_generated_projects_$id: generatedRouteTree[1]
} as const;

Route.href(generatedRouteById.route_generated_projects_$id, {
  params: { id: "atlas" }
});

// @ts-expect-error generated route values use the canonical href param checks
Route.href(generatedRouteById.route_generated_projects_$id, { params: {} });

const projectConsoleRouteId: ProjectConsoleFileRouteId = "route_projects_$id";
const projectConsoleRoutePath: ProjectConsoleFileRoutePath = "/projects/:id";
const projectConsoleFriendlyRouteId: ProjectConsoleRouteId = projectConsoleRouteId;
const projectConsoleFriendlyRoutePath: ProjectConsoleRoutePath = projectConsoleRoutePath;
const projectConsoleRouteParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = {
  id: makeProjectConsoleProjectId("atlas")
};
const projectConsoleFriendlyRouteParams: ProjectConsoleParamsById["route_projects_$id"] =
  projectConsoleRouteParams;
const projectConsoleRouteSearch: ProjectConsoleFileRouteSearchByPath["/projects/:id"] = {
  tab: "activity"
};
const projectConsoleHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  params: projectConsoleRouteParams,
  search: projectConsoleRouteSearch
};
const projectConsoleHrefOptionsByPath: ProjectConsoleFileRouteHrefOptionsByPath["/projects/:id"] = {
  params: projectConsoleRouteParams,
  search: projectConsoleRouteSearch
};
const projectConsoleFriendlyHrefById: ProjectConsoleHrefById["route_projects_$id"] =
  projectConsoleHrefOptions;
const projectConsoleFriendlyHrefByPath: ProjectConsoleHrefByPath["/projects/:id"] =
  projectConsoleHrefOptionsByPath;
const projectConsoleFriendlyHref: ProjectConsoleHref<"route_projects_$id"> =
  projectConsoleHrefOptions;
const projectConsoleFriendlyHrefArgs: ProjectConsoleHrefArgs<"route_projects_$id"> = [
  projectConsoleHrefOptions
];

Route.href(projectConsoleRouteByPath["/projects/:id"], projectConsoleHrefOptionsByPath);
projectConsoleHrefById("route_projects_$id", projectConsoleHrefOptions);
projectConsoleHrefByPath("/projects/:id", projectConsoleHrefOptionsByPath);
projectConsoleHrefById("route_root");
projectConsoleHrefByPath("/");
const projectConsoleRouteIdForPath: ProjectConsoleRouteIdByPath["/projects/:id"] =
  projectConsoleRouteIdByPath["/projects/:id"];
const projectConsoleLayouts: ProjectConsoleFileRouteLayouts<"route_projects_$id"> =
  projectConsoleLayoutsByPath("/projects/:id");
const projectConsoleMetadataModules: ProjectConsoleFileRouteMetadataModules<"route_projects_$id"> =
  projectConsoleMetadataById("route_projects_$id");
void projectConsoleRouteIdForPath;
void projectConsoleLayouts;
void projectConsoleMetadataModules;
declare const projectConsoleBroadMatch: Route.Match<ProjectConsoleRouteTree[number]> | undefined;
if (isProjectConsoleRoutePathMatch("/projects/:id", projectConsoleBroadMatch)) {
  const match: ProjectConsoleMatch<"/projects/:id"> = projectConsoleBroadMatch;
  void match;
  projectConsoleBroadMatch.params.id;
  // @ts-expect-error generated route-match narrowing exposes only declared params
  projectConsoleBroadMatch.params.slug;
}

const virtualRouteList: readonly Route.Definition<string, unknown, unknown, any>[] = virtualFileRoutes;
const virtualRouteByIdMap: Readonly<Record<string, Route.Definition<string, unknown, unknown, any>>> =
  virtualRouteById;
const virtualRouteByPathMap: Readonly<Record<string, Route.Definition<string, unknown, unknown, any>>> =
  virtualRouteByPath;
const virtualFileRouteId: VirtualFileRouteId = "route_anything";
const virtualFileRoutePath: VirtualFileRoutePath = "/anything";
const virtualRouteId: VirtualRouteId = virtualFileRouteId;
const virtualRoutePath: VirtualRoutePath = virtualFileRoutePath;
const virtualParamsById: VirtualParamsById = {};
const virtualSearchByPath: VirtualSearchByPath = {};
const virtualHrefById: VirtualHrefById = {};
const virtualHrefByPath: VirtualHrefByPath = {};
const virtualRouteIdByPathMap: Readonly<Record<string, string>> = virtualRouteIdByPath;
const virtualLayouts: VirtualFileRouteLayouts<VirtualRouteId> =
  virtualLayoutsByPath(virtualRoutePath);
const virtualMetadataModules: VirtualFileRouteMetadataModules<VirtualRouteId> =
  virtualMetadataById(virtualRouteId);
declare const virtualHref: VirtualHref<VirtualRouteId>;
declare const virtualHrefArgs: VirtualHrefArgs<VirtualRouteId>;
declare const virtualMatch: Route.Match<typeof virtualFileRoutes[number]> | undefined;
if (isVirtualRoutePathMatch(virtualRoutePath, virtualMatch)) {
  const narrowed: VirtualMatch<VirtualRoutePath> = virtualMatch;
  void narrowed;
}
virtualHrefByIdForRoute(virtualRouteId, ...virtualHrefArgs);
virtualHrefByPathForRoute(virtualRoutePath, ...virtualHrefArgs);
void virtualRouteIdByPathMap;
void virtualLayouts;
void virtualMetadataModules;
const emptyFileRouteManifest: FileRouteManifest = {
  version: 1,
  entries: [],
  modules: []
};
const fileRouteDefinitionsOptions: FileRouteDefinitionsModuleOptions = {
  generatedFile: "src/routeTree.gen.ts",
  importMode: "relative",
  routeModuleExportName: "Route"
};
const generatedFileRouteModule: string = createFileRouteDefinitionsModule(
  emptyFileRouteManifest,
  fileRouteDefinitionsOptions
);
const generatedFileRouteReferences = createFileRouteModuleReferences(
  emptyFileRouteManifest,
  fileRouteDefinitionsOptions
);
const generatedFileRouteDefinitionsOptions: GeneratedFileRouteDefinitionsModuleOptions = {
  generatedFile: "src/routeTree.gen.ts",
  header: "// generated by effect-ui"
};
const generatedFileRouteDefinitionsModule: string = createGeneratedFileRouteDefinitionsModule(
  emptyFileRouteManifest,
  generatedFileRouteDefinitionsOptions
);
const generatedFileRouteWriteEffect: Effect.Effect<
  FileRouteDefinitionsFileWriteResult | undefined,
  FileRouteDefinitionsFileWriteFailure
> = writeFileRouteDefinitionsFileEffect(".", emptyFileRouteManifest, {
  outputFile: false
});
const generatedFileRouteHeader: string = defaultGeneratedFileRouteDefinitionsHeader;
const invalidFileRouteExportName = new FileRouteDefinitionsModuleInvalidExportName({ exportName: "1Route" });
const invalidFileRouteIdentifier = new FileRouteDefinitionsModuleInvalidIdentifier({
  routeId: "route-with-dash",
  routePath: "/"
});
const startDiagnosticsLoadOptions: LoadStartAppGraphDiagnosticsOptions = {
  root: ".",
  configFile: false
};
const startDiagnosticsLoadEffect: Effect.Effect<
  LoadedStartAppGraphDiagnostics,
  StartAppGraphDiagnosticsLoadError
> = loadStartAppGraphDiagnostics(startDiagnosticsLoadOptions);
const startDiagnosticsLoadEffectAlias: Effect.Effect<
  LoadedStartAppGraphDiagnostics,
  StartAppGraphDiagnosticsLoadError
> = loadStartAppGraphDiagnosticsEffect(startDiagnosticsLoadOptions);
declare const loadedStartDiagnostics: LoadedStartAppGraphDiagnostics;
const startDiagnosticsReportInput: SubpathStartDiagnosticsReportInput = {
  diagnostics: loadedStartDiagnostics.diagnostics,
  diagnosticsPolicyViolations: loadedStartDiagnostics.diagnosticsPolicyViolations
};
const startDiagnosticsReport: SubpathStartDiagnosticsReport =
  createSubpathStartDiagnosticsReport(startDiagnosticsReportInput);
const startDiagnosticsReportText: string = formatSubpathStartDiagnosticsReport(startDiagnosticsReport);
const startDiagnosticsReportStatus: SubpathStartDiagnosticsReportStatus = startDiagnosticsReport.status;
const startDiagnosticsReportSummary: SubpathStartDiagnosticsReportSummary = startDiagnosticsReport.summary;
const startDiagnosticsReportFinding: SubpathStartDiagnosticsReportFinding | undefined =
  startDiagnosticsReport.findings[0];
const startDiagnosticsReportFindingKind: SubpathStartDiagnosticsReportFindingKind | undefined =
  startDiagnosticsReportFinding?.kind;
const startDiagnosticsReportOwnerGroup: SubpathStartDiagnosticsReportOwnerGroup | undefined =
  startDiagnosticsReport.groups[0];
const startAgentGraphInput: StartAgentGraphInput = {
  diagnostics: loadedStartDiagnostics.diagnostics,
  diagnosticsPolicyViolations: loadedStartDiagnostics.diagnosticsPolicyViolations
};
const startAgentGraph: StartAgentGraph = createStartAgentGraph(startAgentGraphInput);
const startAgentGraphEffect: Effect.Effect<StartAgentGraph> =
  createStartAgentGraphEffect(startAgentGraphInput);
const startAgentGraphQueryKind: StartAgentGraphQueryKind = "route";
const startAgentGraphQuery: StartAgentGraphQuery = {
  kind: startAgentGraphQueryKind,
  text: "/projects"
};
const startAgentGraphQueryResult: StartAgentGraphQueryResult =
  queryStartAgentGraph(startAgentGraph, startAgentGraphQuery);
const startAgentGraphQueryEffect: Effect.Effect<StartAgentGraphQueryResult> =
  queryStartAgentGraphEffect(startAgentGraph, startAgentGraphQuery);
const startAgentGraphFormatOptions: StartAgentGraphFormatOptions = {
  query: startAgentGraphQuery,
  verbose: false
};
const startAgentGraphText: string =
  formatStartAgentGraph(startAgentGraph, startAgentGraphFormatOptions);
const startAgentGraphImpactOptions: StartAgentGraphImpactOptions = {
  root: "examples/project-console"
};
const startAgentGraphImpact: StartAgentGraphImpact =
  createStartAgentGraphImpact(startAgentGraph, startAgentGraphQuery, startAgentGraphImpactOptions);
const startAgentGraphImpactEffect: Effect.Effect<StartAgentGraphImpact> =
  createStartAgentGraphImpactEffect(startAgentGraph, startAgentGraphQuery);
const startAgentGraphImpactText: string =
  formatStartAgentGraphImpact(startAgentGraphImpact);
const startAgentGraphImpactItem: StartAgentGraphImpactItem | undefined =
  startAgentGraphImpact.items[0];
const startAgentGraphImpactRelation: StartAgentGraphImpactRelation | undefined =
  startAgentGraphImpactItem?.dependencies[0];
const startAgentGraphImpactRelationKind: StartAgentGraphImpactRelationKind | undefined =
  startAgentGraphImpactRelation?.kind;
const startAgentGraphSummary: StartAgentGraphSummary = startAgentGraph.summary;
const startAgentGraphSelfReview: StartAgentGraphSelfReview = startAgentGraph.selfReview;
const startAgentGraphNode: StartAgentGraphNode | undefined = startAgentGraph.nodes[0];
const startAgentGraphEdge: StartAgentGraphEdge | undefined = startAgentGraph.edges[0];
const startAgentGraphNodeKind: StartAgentGraphNodeKind | undefined = startAgentGraphNode?.kind;
const startAgentGraphNodeStatus: StartAgentGraphNodeStatus | undefined = startAgentGraphNode?.status;
const startAgentGraphEdgeKind: StartAgentGraphEdgeKind | undefined = startAgentGraphEdge?.kind;
void startDiagnosticsReportText;
void startDiagnosticsReportStatus;
void startDiagnosticsReportSummary;
void startDiagnosticsReportFindingKind;
void startDiagnosticsReportOwnerGroup;
void startAgentGraphEffect;
void startAgentGraphQueryResult;
void startAgentGraphQueryEffect;
void startAgentGraphText;
void startAgentGraphImpactEffect;
void startAgentGraphImpactText;
void startAgentGraphImpactRelationKind;
void startAgentGraphSummary;
void startAgentGraphSelfReview;
void startAgentGraphNodeKind;
void startAgentGraphNodeStatus;
void startAgentGraphEdgeKind;
void projectConsoleRouteId;
void projectConsoleRoutePath;
void projectConsoleFriendlyRouteId;
void projectConsoleFriendlyRoutePath;
void projectConsoleHrefOptions;
void projectConsoleFriendlyRouteParams;
void projectConsoleFriendlyHrefById;
void projectConsoleFriendlyHrefByPath;
void projectConsoleFriendlyHref;
void projectConsoleFriendlyHrefArgs;
void virtualRouteList;
void virtualRouteByIdMap;
void virtualRouteByPathMap;
void virtualFileRouteId;
void virtualFileRoutePath;
void virtualRouteId;
void virtualRoutePath;
void virtualParamsById;
void virtualSearchByPath;
void virtualHrefById;
void virtualHrefByPath;
void virtualHref;
void virtualHrefArgs;
void generatedFileRouteModule;
void generatedFileRouteReferences;
void generatedFileRouteDefinitionsOptions;
void generatedFileRouteDefinitionsModule;
void generatedFileRouteWriteEffect;
void generatedFileRouteHeader;
void invalidFileRouteExportName;
void invalidFileRouteIdentifier;
void startDiagnosticsLoadEffect;
void startDiagnosticsLoadEffectAlias;
void startDiagnosticsReportInput;
void startDiagnosticsReport;
void startDiagnosticsReportText;
void startDiagnosticsReportStatus;
void startDiagnosticsReportSummary;
void startDiagnosticsReportFindingKind;
void startDiagnosticsReportOwnerGroup;

// @ts-expect-error generated routeByPath keeps canonical href param checks
Route.href(projectConsoleRouteByPath["/projects/:id"], { params: {} });

// @ts-expect-error generated href helper keeps canonical href param checks
projectConsoleHrefByPath("/projects/:id", { params: {} });

// @ts-expect-error generated href helper keeps route id union checked
projectConsoleHrefById("route_missing", {});

// @ts-expect-error generated route id union rejects unknown ids
const projectConsoleUnknownRouteId: ProjectConsoleFileRouteId = "route_missing";

// @ts-expect-error generated route path union rejects unknown paths
const projectConsoleUnknownRoutePath: ProjectConsoleFileRoutePath = "/missing";

// @ts-expect-error generated params preserve branded project ids
const projectConsolePlainParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = { id: "atlas" };

const projectConsoleBadHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  // @ts-expect-error generated href options reject missing route params
  params: {},
  search: { tab: "activity" }
};

const projectConsoleBadSearch: ProjectConsoleFileRouteSearchByPath["/projects/:id"] = {
  // @ts-expect-error generated search options preserve schema literals
  tab: "timeline"
};

const GetProject = Server.contract<{ readonly id: string }, Project, ProjectError>("Project.get", {
  input: Schema.Struct({ id: Schema.String }),
  output: ProjectSchema
});

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
  Effect.succeed({ id: input.slug, name: "Mock Project" })
);

Server.implement(GetProject, ({ id }) => Effect.succeed({ id, name: "Server Project" }));

const GetProjectWithResponseContext = Server.implement(GetProject, ({ id }) =>
  Effect.gen(function* () {
    const response = yield* ResponseContext;
    yield* response.setHeader("x-project-id", id);
    return { id, name: "Server Project" };
  })
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

const LooseServerContract = Server.contract("Loose.server");
Server.implement(LooseServerContract, () => "ok");
Server.mock(LooseServerContract, () => "ok");

// @ts-expect-error broad server implementations must still reject Promise-shaped values
Server.implement(LooseServerContract, () => promisedString);

// @ts-expect-error broad server mocks must still reject Promise-shaped values
Server.mock(LooseServerContract, () => promisedString);

// @ts-expect-error unannotated server functions must return Effect or a pure value, not Promise
Server.fn("Project.promiseServer", {
  handler: () => promisedProject
});

// @ts-expect-error unannotated server functions must not return unions containing Promise
Server.fn("Project.unionPromiseServer", {
  handler: () => maybePromisedProject
});

const ProjectTag = Resource.tag<{ readonly id: string }>("Project", {
  key: ({ id }) => id
});
const ProjectsTag = Resource.tag("Projects");

// @ts-expect-error keyed resource tags require key options
Resource.tag<{ readonly id: string }>("Project.missingOptions");

ProjectTag({ id: "atlas" });

// @ts-expect-error resource tag input must match the tag definition
ProjectTag({ slug: "atlas" });

const ProjectById = Resource.family<string, Project, ProjectError | Server.ClientError>({
  name: "Project.byId",
  input: Schema.String,
  output: ProjectSchema,
  load: (id) => getProject.effect({ id }),
  provides: (project) => [ProjectTag({ id: project.id })]
});

const resourceDefinitionRegistry = makeResourceDefinitionRegistry({ duplicates: "keep-first" });
const resourceFamilyRegistration = resourceDefinitionRegistry.registerFamily(ProjectById.family.options.name, ProjectById.family);
const resourceTagRegistration = resourceDefinitionRegistry.registerTag(ProjectTag.name, {
  name: ProjectTag.name,
  keyed: true
});
const resourceDefinitionDiagnostics = resourceDefinitionRegistry.diagnostics();
const resourceDefinitionDuplicatePolicy: "keep-first" | "replace" =
  resourceDefinitionDiagnostics.duplicates[0]?.policy ?? "replace";
const adapterResourceStore = makeResourceStore();
const typedAdapterResourceStore: ResourceStore = adapterResourceStore;
adapterResourceStore.moduleRegistry.register(Symbol("adapter-module"), {
  disposeEffect: Effect.void
});
const adapterResourceStoreModuleCount: Effect.Effect<number> = adapterResourceStore.diagnostics.moduleCountEffect;
const adapterResourceStoreEventBusShutdown: Effect.Effect<boolean> =
  adapterResourceStore.diagnostics.eventBusShutdownEffect;
const publicResourceStoreRuntime = makeRuntime();
// @ts-expect-error ResourceStore internals are intentionally not public.
publicResourceStoreRuntime.resourceStore.entries;
// @ts-expect-error ResourceStore internals are intentionally not public.
publicResourceStoreRuntime.resourceStore.fibers;
const resourceSnapshotOperation: ResourceSnapshotCodecOperation = "hydrate";
const clonedResourceSnapshotValue: Project = cloneResourceSnapshotValue({
  id: "atlas",
  name: "Atlas"
});
const resourceSnapshot: Resource.Snapshot<string, Project> = {
  name: ProjectById.family.options.name,
  key: ProjectById("atlas").key,
  input: "atlas",
  state: {
    _tag: "Success",
    waiting: false,
    value: clonedResourceSnapshotValue,
    updatedAt: 1
  }
};
const validatedResourceSnapshotsEffect: Effect.Effect<
  ReadonlyArray<Resource.Snapshot>,
  ResourceSnapshotCodecError
> = validateResourceHydrationInputEffect({ resources: [resourceSnapshot] }, resourceSnapshotOperation);
void resourceFamilyRegistration;
void resourceTagRegistration;
void resourceDefinitionDiagnostics;
void resourceDefinitionDuplicatePolicy;
void adapterResourceStoreModuleCount;
void adapterResourceStoreEventBusShutdown;
void typedAdapterResourceStore;
void validatedResourceSnapshotsEffect;

Resource.prefetchEffect(ProjectById("atlas"));
const deleteProjectEffect: Effect.Effect<void> = Resource.deleteEffect(ProjectById("atlas"));
const projectReadEffect: Effect.Effect<
  Project,
  Resource.ReadError<string, Project, ProjectError | Server.ClientError>,
  ProjectApi
> = Resource.readEffect(ProjectById("atlas"));
const projectRead: Project = Resource.read(ProjectById("atlas"));
const projectReadViaHelper: Project = read(ProjectById("atlas"));
const projectSuspenseRead: Project = useResourceSuspense(ProjectById("atlas"))();
const projectResourcePending = new ResourcePending({
  ref: ProjectById("atlas"),
  state: "Pending",
  previous: undefined as Project | undefined,
  hasPrevious: true,
  guidance: "Preload before reading."
});
const projectResourcePendingState: "Initial" | "Pending" | "Collected" = projectResourcePending.state;
const projectResourcePendingPrevious: Project | undefined = projectResourcePending.previous;
const projectResourcePendingHasPrevious: boolean = projectResourcePending.hasPrevious;
const projectResourceFailure = new ResourceFailure({
  ref: ProjectById("atlas"),
  error: { _tag: "ProjectError", message: "not found" } as ProjectError | Server.ClientError,
  previous: undefined as Project | undefined,
  hasPrevious: true
});
const projectResourceFailureError: ProjectError | Server.ClientError = projectResourceFailure.error;
const projectResourceFailureHasPrevious: boolean = projectResourceFailure.hasPrevious;
void projectRead;
void projectReadViaHelper;
void projectSuspenseRead;
void projectResourcePendingState;
void projectResourcePendingPrevious;
void projectResourcePendingHasPrevious;
void projectResourceFailureError;
void projectResourceFailureHasPrevious;
void deleteProjectEffect;

Resource.family<string, Project>({
  name: "Project.asyncResource",
  // @ts-expect-error resource loaders must return Effect or a pure value, not Promise
  load: () => promisedProject
});

Resource.family({
  name: "Project.asyncResourceInferred",
  // @ts-expect-error unannotated resource loaders must return Effect or a pure value, not Promise
  load: () => promisedProject
});

const BrandedProjectById = Resource.family<ProjectId, Project, ProjectError>({
  name: "Project.byBrandedId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => Effect.succeed({ id, name: "Branded" })
});

Resource.prefetchEffect(BrandedProjectById(atlasProjectId));

// @ts-expect-error branded resource inputs reject accidental plain strings
Resource.prefetchEffect(BrandedProjectById("atlas"));

const resourceHydrateEffect: Effect.Effect<
  void,
  ResourceSnapshotCodecError | ResourceHydrationApplyError | EffectInputCallbackError
> =
  Resource.hydrateEffect({ resources: [] });
const resourceDecodeEffect: Effect.Effect<Resource.HydrationPayload, ResourceSnapshotCodecError> =
  Resource.decodeHydrationPayloadEffect("{\"resources\":[]}");
const resourceDehydrateEffect: Effect.Effect<ReadonlyArray<Resource.Snapshot>, ResourceSnapshotCodecError> =
  Resource.dehydrateEffect([]);
const resourceHydrationPayloadEffect: Effect.Effect<Resource.HydrationPayload, ResourceSnapshotCodecError> =
  Resource.hydrationPayloadEffect([]);
void resourceDehydrateEffect;
void resourceHydrationPayloadEffect;

interface ProjectRequest extends EffectRequest.Request<Project, ProjectError> {
  readonly _tag: "ProjectRequest";
  readonly id: ProjectId;
}
const ProjectRequest = EffectRequest.tagged<ProjectRequest>("ProjectRequest");
declare const projectRequestResolver: RequestResolver.RequestResolver<ProjectRequest>;
const ProjectByRequest = Resource.requestFamily({
  name: "Project.byRequest",
  input: ProjectId,
  output: ProjectSchema,
  request: (id: ProjectId) => ProjectRequest({ id }),
  resolver: projectRequestResolver
});
Effect.map(Resource.prefetchEffect(ProjectByRequest(atlasProjectId)), (project) => {
  project.id.toUpperCase();
  project.name.toUpperCase();
});

// @ts-expect-error Resource.requestFamily preserves the request input type
ProjectByRequest("atlas");

const ServicefulProjectResource = Resource.family<string, Project, ProjectError | Server.ClientError, ProjectApi>({
  name: "Project.servicefulInvalidation",
  load: (id) => ProjectApi.use((api) => api.get(id))
});
const servicefulInvalidationEffect: Effect.Effect<void, never, ProjectApi> =
  Resource.invalidateEffect(ServicefulProjectResource("atlas"));
// @ts-expect-error Resource invalidation preserves service requirements from direct ref targets
const servicefulInvalidationWithoutService: Effect.Effect<void> =
  Resource.invalidateEffect(ServicefulProjectResource("atlas"));
const servicefulInvalidationPlan = Resource.planInvalidation(ServicefulProjectResource("atlas"));
const servicefulInvalidationPlanEffect: Effect.Effect<void, never, ProjectApi> =
  Resource.runInvalidationPlanEffect(servicefulInvalidationPlan);
const servicefulProjectReadViaHelper: Project = read(ServicefulProjectResource("atlas"));
void servicefulInvalidationEffect;
void servicefulInvalidationWithoutService;
void servicefulInvalidationPlanEffect;
void servicefulProjectReadViaHelper;

const InferredProjectById = Resource.family({
  name: "Project.inferredById",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })]
});
const inferredProjectEffect: Effect.Effect<
  Project,
  Resource.LoadError<ProjectError | Server.ClientError>,
  ProjectApi
> = Resource.prefetchEffect(InferredProjectById(atlasProjectId));
void inferredProjectEffect;

// @ts-expect-error inferred branded resource inputs reject accidental plain strings
InferredProjectById("atlas");

const ProjectsCollection = Collection.define<Project, string, ProjectError | Server.ClientError, ProjectApi>({
  name: "Projects.collection",
  output: Schema.Array(ProjectSchema),
  getKey: (project) => project.id,
  indexes: {
    byName: {
      key: (project) => project.name,
      unique: true
    }
  },
  load: () => ProjectApi.use((api) => Effect.map(api.get("atlas"), (project) => [project])),
  onUpdate: (updates, context) =>
    ProjectApi.use((api) => {
      context.transaction.mutations.map((mutation) => mutation.key);
      return api.rename({
        id: updates[0]!.key,
        name: updates[0]!.value.name
      }).pipe(Effect.asVoid);
    })
});

Collection.rows(ProjectsCollection).map((project) => {
  project.name;
  project.$synced;
  // @ts-expect-error live collection rows preserve row shape
  project.slug;
});
ProjectsCollection.index("byName", "Atlas").map((project) => project.name.toUpperCase());
Collection.firstByIndex(ProjectsCollection, "byName", "Atlas")?.name.toUpperCase();

const InferredProjectsCollection = Collection.define({
  name: "Projects.inferredCollection",
  output: Schema.Array(ProjectSchema),
  getKey: (project) => project.id,
  load: () => ProjectApi.use((api) => Effect.map(api.get("atlas"), (project) => [project])),
  onUpdate: (updates) =>
    ProjectApi.use((api) =>
      api.rename({
        id: updates[0]!.key,
        name: updates[0]!.value.name
      }).pipe(Effect.asVoid)
    )
});
const inferredCollectionPreload: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | EffectInputCallbackError,
  ProjectApi
> = InferredProjectsCollection.preloadEffect();
void inferredCollectionPreload;
InferredProjectsCollection.writeInsertEffect({ id: "atlas", name: "Atlas" });

// @ts-expect-error inferred collections preserve row shape
InferredProjectsCollection.writeInsertEffect({ id: "atlas" });

const projectsSnapshot = ProjectsCollection.snapshot();
projectsSnapshot.rows.map((row) => {
  row.key.toUpperCase();
  row.value.name.toUpperCase();
  // @ts-expect-error collection snapshots preserve row value shape
  row.value.slug;
});
projectsSnapshot.pendingMutations.map((pending) =>
  pending.transaction.mutations.map((mutation) => mutation.key.toUpperCase())
);

Effect.map(ProjectsCollection.snapshotEffect(), (snapshot) =>
  snapshot.rows.map((row) => row.value.name)
);
Effect.map(ProjectsCollection.pendingMutationsEffect(), (pending) =>
  pending.map((entry) => entry.transaction.id)
);
ProjectsCollection.pendingMutations().map((pending) => pending.attempts.toFixed());
Effect.map(ProjectsCollection.flushPendingMutationsEffect(), (transactions) =>
  transactions.map((transaction) => transaction.mutations.map((mutation) => mutation.key.toUpperCase()))
);
Collection.flushPendingMutationsEffect(ProjectsCollection);
const projectHydrateEffect: Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =
  ProjectsCollection.hydrateEffect(projectsSnapshot);
void projectHydrateEffect;

const projectMemoryStorage = Collection.memoryStorage();
ProjectsCollection.persistEffect(projectMemoryStorage, { key: "projects" });
ProjectsCollection.restoreEffect(projectMemoryStorage, { key: "projects", replace: false });
Collection.persistEffect(ProjectsCollection, projectMemoryStorage);
Collection.restoreEffect(ProjectsCollection, projectMemoryStorage);
const collectionStoreEffect: Effect.Effect<Collection.Store> = Collection.storeEffect();
Effect.map(collectionStoreEffect, (store) => {
  const diagnostics: Collection.StoreDiagnosticsSnapshot = store.diagnostics.snapshot();
  const diagnosticsEffect: Effect.Effect<Collection.StoreDiagnosticsSnapshot> =
    store.diagnostics.snapshotEffect;
  diagnostics.collectionCount.toFixed();
  diagnostics.rowCount.toFixed();
  diagnostics.pendingMutationCount.toFixed();
  void diagnosticsEffect;
});
const projectBrowserStorage = Collection.storage({
  getItem: () => null,
  setItem: () => undefined
});
const projectBrowserPersistEffect: Effect.Effect<void, CollectionStorageError | CollectionSnapshotCodecError | EffectInputCallbackError> =
  Collection.persistEffect(ProjectsCollection, projectBrowserStorage);
void projectBrowserPersistEffect;

const ListProjectsForCollection = Server.fn<void, readonly Project[], ProjectError>("Projects.collection.list", {
  handler: () => Effect.succeed([{ id: "atlas", name: "Atlas" }])
});

const ServerProjectsCollection = Collection.define(serverCollectionOptions<Project, string, ProjectError>({
  id: "Projects.serverCollection",
  getKey: (project) => project.id,
  load: ListProjectsForCollection,
  update: (payload) => {
    payload.updates[0]!.key.toUpperCase();
    payload.transaction.mutations.map((mutation) => mutation.key.toUpperCase());
    return Effect.void;
  }
}));

declare const projectRowsEffect: Effect.Effect<readonly Project[]>;
declare const projectRowsPromise: Promise<readonly Project[]>;
declare const promisedBoolean: Promise<boolean>;
declare const promisedStorageText: Promise<string | null>;
declare const promisedSqliteRow: Promise<Collection.SQLiteStorageRow | null>;
declare const promisedChangeFeedSubscription: Promise<Collection.ChangeFeedSubscription>;
Collection.define(Collection.serverOptions<Project>({
  name: "Projects.serverNamespaceCollection",
  getKey: (project) => project.id,
  load: () => projectRowsEffect
}));
Collection.define(Collection.serverOptions<Project>({
  name: "Projects.promiseServerNamespaceCollection",
  getKey: (project) => project.id,
  // @ts-expect-error server collection loaders must return Effect or a pure value, not Promise
  load: () => projectRowsPromise
}));
const syncAdapter: Collection.SyncAdapter<Project> = {
  name: "projects-sync",
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
  update: (payload) => {
    payload.updates.map((update) => update.key.toUpperCase());
    payload.transaction.id.toUpperCase();
  }
};
const promiseSyncAdapter: Collection.SyncAdapter<Project> = {
  name: "projects-promise-sync",
  // @ts-expect-error sync adapter loaders must return Effect or a pure value, not Promise
  load: () => projectRowsPromise
};
Collection.define(Collection.syncOptions<Project, string, Server.ClientError>({
  name: "Projects.syncCollection",
  getKey: (project) => project.id,
  sync: syncAdapter
}));
Collection.define(Collection.syncOptions<Project, string, Server.ClientError>({
  name: "Projects.serverSyncCollection",
  getKey: (project) => project.id,
  sync: Collection.serverSyncAdapter<Project>({
    name: "Projects.serverSyncCollection",
    getKey: (project) => project.id,
    load: () => projectRowsEffect
  })
}));
const ProjectRowsResource = Resource.family<void, ReadonlyArray<Project>, ProjectError>({
  name: "Project.rows",
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }])
});
Collection.define(Collection.syncOptions<Project, string, Resource.LoadError<ProjectError>>({
  name: "Projects.resourceSyncCollection",
  getKey: (project) => project.id,
  sync: Collection.resourceSyncAdapter({
    ref: ProjectRowsResource(undefined),
    update: (payload) => {
      payload.updates.map((update) => update.value.name.toUpperCase());
    }
  })
}));
const querySyncClient: Collection.QuerySyncClient<Project> = {
  fetchQuery: ({ queryKey, queryFn }) => {
    queryKey.map((part) => String(part));
    return queryFn();
  },
  invalidateQueries: ({ queryKey }) => {
    queryKey.map((part) => String(part));
  }
};
const promiseQuerySyncClient: Collection.QuerySyncClient<Project> = {
  // @ts-expect-error query sync clients must return Effect or a pure value, not Promise
  fetchQuery: () => projectRowsPromise,
  // @ts-expect-error query invalidation must return Effect or a pure value, not Promise
  invalidateQueries: () => promisedVoid
};
Collection.define(Collection.syncOptions<Project, string, EffectInputCallbackError>({
  name: "Projects.querySyncCollection",
  getKey: (project) => project.id,
  sync: Collection.querySyncAdapter({
    queryKey: ["projects"],
    queryFn: () => [{ id: "atlas", name: "Atlas" }],
    queryClient: querySyncClient,
    invalidateOnMutation: false,
    mutationInvalidation: "rollback-on-failure" satisfies Collection.QuerySyncMutationInvalidationPolicy,
    update: (payload) => {
      payload.updates.map((update) => update.value.name.toUpperCase());
    }
  })
}));

Collection.define(serverCollectionOptions<Project>({
  name: "Projects.badServerCollection",
  getKey: (project) => project.id,
  // @ts-expect-error server collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
}));

const flushAllProjectsEffect: Effect.Effect<
  ReadonlyArray<Collection.FlushAllPendingMutationsResult>,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | EffectInputCallbackError,
  ProjectApi
> = Collection.flushAllPendingMutationsEffect([ProjectsCollection, ServerProjectsCollection]);
Effect.map(flushAllProjectsEffect, (results) =>
  results.map((result) => result.transactions.map((transaction) => transaction.collection))
);
const backgroundSyncAdapter: Collection.BackgroundSyncAdapter = {
  name: "online",
  shouldFlush: (context) => {
    context.trigger.toUpperCase();
    context.collections.map((collection) => collection.toUpperCase());
    context.pending.map((pending) =>
      pending.transactions.map((transaction) => transaction.collection)
    );
    return true;
  }
};
const promiseBackgroundSyncAdapter: Collection.BackgroundSyncAdapter = {
  name: "promise-online",
  // @ts-expect-error background sync adapters must return Effect or a pure value, not Promise
  shouldFlush: () => promisedBoolean
};
const backgroundSyncProjectsEffect: Effect.Effect<
  Collection.BackgroundSyncResult,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | EffectInputCallbackError,
  ProjectApi
> = Collection.backgroundSyncPendingMutationsEffect([ProjectsCollection], {
  trigger: "online",
  adapter: backgroundSyncAdapter
});
Effect.map(backgroundSyncProjectsEffect, (result) => {
  result.trigger.toUpperCase();
  result.pending.map((pending) => pending.collection.toUpperCase());
  return result.results.map((flushResult) => flushResult._tag);
});
Effect.map(Collection.backgroundSyncPendingMutationsEffect([ProjectsCollection], {
  trigger: "online",
  adapter: backgroundSyncAdapter
}), (result) => {
  result.trigger.toUpperCase();
  result.pending.map((pending) => pending.collection.toUpperCase());
  return result.results.map((flushResult) => flushResult._tag);
});
const collectionChanges: ReadonlyArray<Collection.Change<Project, string>> = [
  { _tag: "Upsert", value: { id: "atlas", name: "Atlas" } },
  { _tag: "Delete", key: "lumen" }
];
Collection.applyChangesEffect(ProjectsCollection, collectionChanges, {
  origin: "remote",
  synced: true
});
const changeFeedAdapter: Collection.ChangeFeedAdapter<
  Project,
  string,
  never,
  never,
  ProjectError | Server.ClientError,
  ProjectApi
> = {
  name: "projects-feed",
  subscribe: (context) => {
    context.collection.toUpperCase();
    const emitted: EffectInput<
      void,
      ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError,
      ProjectApi
    > = context.emit([{ _tag: "Upsert", value: { id: "atlas", name: "Atlas" } }]);
    void emitted;
    context.emitChanges([{ _tag: "Upsert", value: { id: "atlas", name: "Atlas" } }]);
    return {
      unsubscribe: () => undefined
    };
  }
};
const promiseChangeFeedAdapter: Collection.ChangeFeedAdapter<Project> = {
  name: "projects-promise-feed",
  // @ts-expect-error change feed subscriptions must return Effect or a pure value, not Promise
  subscribe: () => promisedChangeFeedSubscription
};
const changeFeedSubscriptionEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError,
  Scope.Scope | ProjectApi
> = Collection.subscribeChangesEffect(ProjectsCollection, changeFeedAdapter);
void changeFeedSubscriptionEffect;
Effect.map(flushCollectionsPendingMutationsEffect([ProjectsCollection], {
  skip: ({ collection }) => collection.name === "Projects.collection"
}), (results) => results.map((result) => result._tag));

const sqliteStorage = Collection.sqliteStorage({
  table: () => ({
    get: (key) => {
      key.namespace.toUpperCase();
      return null;
    },
    upsert: (row) => {
      row.schemaVersion.toFixed();
      row.updatedAt.toFixed();
    },
    delete: (key) => {
      key.key.toUpperCase();
    }
  })
}, { namespace: "workspace:a", schemaVersion: 1 });
const promisePersistenceCollection = Collection.define(Collection.persistedOptions<Project>({
  name: "Projects.promisePersistence",
  getKey: (project) => project.id,
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
  persistence: {
    storage: {
      // @ts-expect-error persistence storage reads must return Effect or a pure value, not Promise
      getItem: () => promisedStorageText,
      setItem: () => undefined
    }
  }
}));
const invalidSqliteTableStorage = Collection.sqliteStorage({
  table: () => ({
    get: () => null,
    upsert: () => undefined
  })
}, { tableName: "" });
const invalidSqliteTableGetEffect: Effect.Effect<
  string | null,
  EffectInputCallbackError | SQLitePersistenceInvalidTableName
> = toEffect(invalidSqliteTableStorage.getItem("projects"));
void invalidSqliteTableGetEffect;
const sqliteStorageTopLevel = makeSQLitePersistenceStorage({
  table: () => ({
    get: () => null,
    upsert: () => undefined
  })
});
const sqliteStatementStorage = Collection.sqliteStorage(Collection.sqliteStatementDriver({
  execute: (_sql, params) => {
    params?.map((param) => param?.valueOf());
  },
  select: (_sql, params) => {
    params?.map((param) => param?.valueOf());
    return [];
  }
}));
const promiseSqliteStorage = Collection.sqliteStorage({
  table: () => ({
    // @ts-expect-error SQLite table reads must return Effect or a pure value, not Promise
    get: () => promisedSqliteRow,
    upsert: () => undefined
  })
});
const promiseSqliteStatementStorage = Collection.sqliteStorage(Collection.sqliteStatementDriver({
  // @ts-expect-error SQLite statement execution must return Effect or a pure value, not Promise
  execute: () => promisedVoid,
  select: () => []
}));
const sqlitePreparedStatementDatabase = Collection.sqlitePreparedStatementDatabase({
  prepare: (sql) => {
    sql.toUpperCase();
    return {
      run: (...params) => {
        params.map((param) => param?.valueOf());
      },
      all: (...params) => {
        params.map((param) => param?.valueOf());
        return [];
      }
    };
  }
});
const sqlitePreparedStatementStorage = Collection.sqliteStorage(
  Collection.sqliteStatementDriver(sqlitePreparedStatementDatabase)
);
const sqliteMemoryStatementDatabase = Collection.sqliteMemoryStatementDatabase();
const sqliteMemoryStatementStorage = Collection.sqliteStorage(Collection.sqliteStatementDriver(sqliteMemoryStatementDatabase));
sqliteMemoryStatementDatabase.tableRows("collection_snapshots").map((row) => row.schemaVersion.toFixed());
ProjectsCollection.persistEffect(sqliteStorage);
ProjectsCollection.restoreEffect(sqliteStorageTopLevel);
ProjectsCollection.restoreEffect(sqliteStatementStorage);
ProjectsCollection.restoreEffect(sqlitePreparedStatementStorage);
ProjectsCollection.restoreEffect(sqliteMemoryStatementStorage);

const PersistedProjectsCollection = Collection.define(Collection.persistedOptions<
  Project,
  string,
  never,
  never,
  EffectInputCallbackError | SQLitePersistenceInvalidTableName
>({
  name: "Projects.persistedCollection",
  getKey: (project) => project.id,
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
  persistence: {
    storage: sqliteStorage,
    key: "projects",
    loadAfterRestore: true
  }
}));
PersistedProjectsCollection.preloadEffect();
PersistedProjectsCollection.writeInsertEffect({ id: "atlas", name: "Atlas" });

Collection.define(Collection.persistedOptions<
  Project,
  string,
  never,
  never,
  EffectInputCallbackError | SQLitePersistenceInvalidTableName
>({
  name: "Projects.badPersistedCollection",
  getKey: (project) => project.id,
  persistence: {
    storage: sqliteStorage
  },
  // @ts-expect-error persisted collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
}));

const collectionPayload = Collection.dehydrate([ProjectsCollection]);
const collectionDehydrateEffect: Effect.Effect<Collection.HydrationPayload, CollectionSnapshotCodecError | EffectInputCallbackError> =
  Collection.dehydrateEffect([ProjectsCollection]);
const collectionHydratePayloadEffect: Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =
  Collection.hydratePayloadEffect([ProjectsCollection], collectionPayload);
const collectionValidateHydrationPayloadEffect: Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =
  Collection.validateHydrationPayloadEffect([ProjectsCollection], collectionPayload, { replace: false });
void collectionDehydrateEffect;
void collectionHydratePayloadEffect;
void collectionValidateHydrationPayloadEffect;
Effect.map(Collection.collectEffect(ProjectsCollection.preloadEffect()), (collected) => {
  collected.value;
  collected.definitions.map((definition) => definition.name);
});

const StartApp = defineApp({
  routes: [ProjectRoute] as const,
  client: {}
});
const requestTraceHandler = (trace: StartRequestTrace) => {
  const devtoolsTrace: DevtoolsRequestTrace = trace;
  const teardownStartedAt: number | undefined = trace.teardown?.startedAt;
  const teardownCompletedAt: number | undefined = trace.teardown?.completedAt;
  const teardownDurationMillis: number | undefined = trace.teardown?.durationMillis;
  const beforeDisposeFiberCount: number | undefined = trace.teardown?.beforeDispose?.fiberCount;
  const afterDisposeModuleCount: number | undefined = trace.teardown?.afterDispose?.moduleCount;
  void teardownStartedAt;
  void teardownCompletedAt;
  void teardownDurationMillis;
  void beforeDisposeFiberCount;
  void afterDisposeModuleCount;
  void devtoolsTrace;
  return Effect.void.pipe(Effect.asVoid);
};
const startRequestTraceTeardown: StartRequestTraceTeardown = {
  runtimeDisposed: true,
  reason: "response-end",
  startedAt: 10,
  completedAt: 17,
  durationMillis: 7,
  beforeDispose: {
    fiberCount: 2,
    familyCount: 1,
    moduleCount: 1,
    tagCount: 1
  },
  afterDispose: {
    fiberCount: 0,
    familyCount: 1,
    moduleCount: 0,
    tagCount: 1
  }
};
const devtoolsRequestTraceTeardown: DevtoolsRequestTraceTeardown = startRequestTraceTeardown;
void devtoolsRequestTraceTeardown;
createRequestHandler(StartApp, {
  collections: [ProjectsCollection],
  onRequestTrace: requestTraceHandler,
  render: ({ collections, collectionPreload, hydration }) => {
    collections.collections.map((snapshot) => snapshot.name);
    collectionPreload.routeTouchedCollections.map((collection) => collection.name);
    collectionPreload.routeDeclaredCollections.map((collection) => collection.name);
    collectionPreload.registeredCollections.map((collection) => collection.name);
    collectionPreload.dehydratedCollections.map((collection) => collection.name);
    collectionPreload.hydration.collections.map((snapshot) => snapshot.rows.length);
    hydration.collections?.map((snapshot) => snapshot.rows.length);
    return "";
  }
});
virtualDiagnosticsPolicyViolations.map((violation) => {
  violation.message.toUpperCase();
  violation.routes.map((route) => route.routePath.toUpperCase());
  if (violation._tag === "UnknownRoutePreloadResources") {
    violation.routes.map((route) => route.preloadResources.families.length);
  }
  if (violation._tag === "UnknownRoutePreloadCollections") {
    violation.routes.map((route) => route.preloadCollections.collections.length);
  }
});
createRequestHandler(StartApp, {
  // @ts-expect-error Start render callbacks must return Effect or a pure value, not Promise
  render: () => promisedString
});
createRequestHandler(StartApp, {
  // @ts-expect-error request trace handlers must return Effect or a pure value, not Promise
  onRequestTrace: () => promisedVoid
});
const promiseStartDiagnosticsCliIo: FrameworkStartDiagnosticsCliIo = {
  // @ts-expect-error diagnostics CLI writers must return EffectInput, not host async work
  stdout: () => promisedVoid
};
declare const startResponsePromise: Promise<Response>;
// @ts-expect-error root Start request handlers must return Effect, not Promise
const promiseStartRequestHandler: StartRequestHandler = () => startResponsePromise;
const startRequestHandler: StartRequestHandler = () => Effect.succeed(new Response("ok"));
// @ts-expect-error root Start request handlers must return Effect, not plain Response
const syncStartRequestHandler: StartRequestHandler = () => new Response("ok");
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
const startVitePlugin: EffectUiStartPlugin = effectUiStart();
startVitePlugin.resolveId("virtual:effect-ui/app-graph");
startVitePlugin.transform("", "/src/domain.server.ts", { ssr: true });
Metric.value(startRequestCountMetric).pipe(Effect.map((state) => state.count.toFixed()));
Metric.value(startRequestDurationMetric).pipe(Effect.map((state) => state.count.toFixed()));
Metric.value(startRequestStatusMetric).pipe(Effect.map((state) => state.occurrences.size.toFixed()));
const streamedHtmlResponseOptions: StartStreamedHtmlResponseOptions = {
  shell: "<html><body>",
  hydrationPlan: { streamedResourceChunks: [] },
  tail: "</body></html>"
};
const streamedHtmlResponseEffect: Effect.Effect<Response> =
  createStartStreamedHtmlResponseEffect(streamedHtmlResponseOptions);
void streamedHtmlResponseEffect;
const effectRpc = serverFunctionToEffectRpc(
  Server.fn("Project.effectRpc", {
    input: ProjectSchema,
    output: ProjectSchema,
    error: Schema.String,
    handler: (project) => project
  })
);
effectRpc._tag.toUpperCase();
makeStartEffectRpcGroup([]);
declare const effectRpcCompatibility: StartEffectRpcCompatibilityArtifact;
effectRpcCompatibility.procedures.map((procedure) => procedure.schemas.payload.valueOf());
void startRequestHandler;
void syncStartRequestHandler;
void viteStartSsrRequestHandler;
void promiseViteStartSsrRequestHandler;
void scopedViteStartSsrRequestHandler;
void serviceViteStartSsrRequestHandler;
void startVitePlugin;
preloadRequestEffect(StartApp, new Request("https://example.com/projects/atlas"), {
  collections: [ProjectsCollection]
});
Effect.map(preloadRequest(StartApp, new Request("https://example.com/projects/atlas")), (result) =>
  result.routePlan.href
);
toFetchHandlerEffect(createRequestHandlerEffect(StartApp));
createNodeHandlerEffect(createRequestHandlerEffect(StartApp));
createNodeServerHandler(createRequestHandlerEffect(StartApp), {
  onError: (_error, _request, response) =>
    Effect.sync(() => {
      response.statusCode = 500;
    })
});
	createNodeServerHandler(createRequestHandlerEffect(StartApp), {
	  // @ts-expect-error Node server error hooks must return Effect or a pure value, not Promise
	  onError: () => promisedVoid
	});
	declare const nodeIncomingMessage: import("node:http").IncomingMessage;
	declare const nodeServerResponse: import("node:http").ServerResponse;
	declare const startForkRuntime: StartForkRuntime;
	const rootNodeOriginPolicy: StartNodeOriginPolicy = { trustForwardedHeaders: false };
	const rootNodeRequestOptions: StartNodeRequestOptions = {
	  ...rootNodeOriginPolicy,
	  origin: "https://example.com"
	};
	const rootWriteNodeOptions: WriteNodeResponseOptions = { headOnly: false };
	const rootNodeServerOptions: StartNodeServerHandlerOptions = {
	  ...rootNodeRequestOptions,
	  runtime: startForkRuntime
	};
	const rootNodeRuntimeOptions: StartNodeServerHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	nodeRequestOrigin(nodeIncomingMessage, rootNodeRequestOptions).toUpperCase();
	const rootNodeWebRequest: Request = nodeRequestToWebRequest(nodeIncomingMessage, rootNodeRequestOptions);
	nodeRequestToWebRequestEffect(nodeIncomingMessage, rootNodeRequestOptions).pipe(
	  Effect.map((request) => request.url)
	);
	writeNodeResponseEffect(nodeServerResponse, new Response("ok"), rootWriteNodeOptions).pipe(
	  Effect.map(() => undefined)
	);
	writeNodeResponse(nodeServerResponse, new Response(null, { status: 204 }), { headOnly: true }).pipe(
	  Effect.map(() => undefined)
	);
	const rootFetchHandlerEffect: StartFetchHandlerEffect<Scope.Scope> = toFetchHandlerEffect(createRequestHandlerEffect(StartApp));
	const rootFetchHandler: StartFetchHandler<Scope.Scope> = toFetchHandler(createRequestHandlerEffect(StartApp));
	const rootFetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
	const rootFetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	declare const rootFetchPromiseHandler: StartFetchPromiseHandler;
	const rootFetchPromise: Promise<Response> = rootFetchPromiseHandler(new Request("https://example.com/projects/atlas"));
	const rootNodeHandlerEffect: StartNodeHandlerEffect<Scope.Scope> = createNodeHandlerEffect(createRequestHandlerEffect(StartApp));
	const rootNodeHandler: StartNodeHandler<Scope.Scope> = createNodeHandler(createRequestHandlerEffect(StartApp));
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
	const packagedFetchHandlerEffect: PackagedStartFetchHandlerEffect<Scope.Scope> = toPackagedFetchHandlerEffect(
	  createRequestHandlerEffect(StartApp)
	);
	const packagedFetchHandlerAlias: PackagedStartFetchHandler<Scope.Scope> = toPackagedFetchHandler(
	  createRequestHandlerEffect(StartApp)
	);
	packagedFetchHandlerEffect(new Request("https://example.com/projects/atlas")).pipe(
	  Effect.map((response) => response.status)
	);
	packagedFetchHandlerAlias(new Request("https://example.com/projects/atlas")).pipe(
	  Effect.map((response) => response.status)
	);
	const packagedFetchHandler = toPackagedFetchHandler(createRequestHandlerEffect(StartApp));
	packagedFetchHandler(new Request("https://example.com/projects/atlas")).pipe(
	  Effect.map((response) => response.status)
	);
	const packagedFetchPromiseHandler = createPackagedFetchHandler(createRequestHandlerEffect(StartApp));
	const packagedFetchPromiseOptions: PackagedStartFetchPromiseHandlerOptions = {};
	const packagedFetchRuntimeOptions: PackagedStartFetchPromiseHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	declare const packagedFetchPromiseHandlerType: PackagedStartFetchPromiseHandler;
	void packagedFetchPromiseHandler;
	void packagedFetchPromiseOptions;
	void packagedFetchRuntimeOptions;
	void packagedFetchPromiseHandlerType;
	const subpathFetchHandlerEffect: SubpathStartFetchHandlerEffect<Scope.Scope> = toSubpathFetchHandlerEffect(
	  createRequestHandlerEffect(StartApp)
	);
	const subpathFetchHandlerAlias: SubpathStartFetchHandler<Scope.Scope> = toSubpathFetchHandler(
	  createRequestHandlerEffect(StartApp)
	);
	subpathFetchHandlerEffect(new Request("https://example.com/projects/atlas")).pipe(
	  Effect.map((response) => response.status)
	);
	subpathFetchHandlerAlias(new Request("https://example.com/projects/atlas")).pipe(
	  Effect.map((response) => response.status)
	);
	const subpathFetchPromiseHandler = createSubpathFetchHandler(createRequestHandlerEffect(StartApp));
	const subpathFetchPromiseOptions: SubpathStartFetchPromiseHandlerOptions = {};
	const subpathFetchRuntimeOptions: SubpathStartFetchPromiseHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	declare const subpathFetchPromiseHandlerType: SubpathStartFetchPromiseHandler;
	void subpathFetchPromiseHandler;
	void subpathFetchPromiseOptions;
	void subpathFetchRuntimeOptions;
	void subpathFetchPromiseHandlerType;
	const packagedNodeHandlerEffect: PackagedStartNodeHandlerEffect<Scope.Scope> = createPackagedNodeHandlerEffect(
	  createRequestHandlerEffect(StartApp)
	);
	const packagedNodeHandlerAlias: PackagedStartNodeHandler<Scope.Scope> = createPackagedNodeHandler(
	  createRequestHandlerEffect(StartApp)
	);
	packagedNodeHandlerEffect(
	  nodeIncomingMessage,
	  nodeServerResponse
	).pipe(Effect.map((response) => response.status));
	packagedNodeHandlerAlias(nodeIncomingMessage, nodeServerResponse).pipe(Effect.map((response) => response.status));
	const packagedNodeOriginPolicy: PackagedStartNodeOriginPolicy = { trustForwardedHeaders: true };
	const packagedNodeRequestOptions: PackagedStartNodeRequestOptions = { ...packagedNodeOriginPolicy };
	const packagedWriteNodeOptions: PackagedWriteNodeResponseOptions = { headOnly: true };
	const packagedNodeServerOptions: PackagedStartNodeServerHandlerOptions = { runtime: startForkRuntime };
	const packagedNodeRuntimeOptions: PackagedStartNodeServerHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	packagedNodeRequestOrigin(nodeIncomingMessage, packagedNodeRequestOptions);
	packagedNodeRequestToWebRequest(nodeIncomingMessage, packagedNodeRequestOptions);
	packagedNodeRequestToWebRequestEffect(nodeIncomingMessage, packagedNodeRequestOptions);
	packagedWriteNodeResponseEffect(nodeServerResponse, new Response("ok"), packagedWriteNodeOptions);
	packagedWriteNodeResponse(nodeServerResponse, new Response("ok"), packagedWriteNodeOptions);
	declare const packagedStartForkRuntime: PackagedStartForkRuntime;
	void packagedNodeServerOptions;
	void packagedNodeRuntimeOptions;
	void packagedStartForkRuntime;
	const packagedNodeHandler = createPackagedNodeHandler(createRequestHandlerEffect(StartApp));
	packagedNodeHandler(
	  nodeIncomingMessage,
	  nodeServerResponse
	).pipe(Effect.map((response) => response.status));
	const packagedNodeServerHandler = createPackagedNodeServerHandler(createRequestHandlerEffect(StartApp));
	void packagedNodeServerHandler;
	const subpathNodeHandlerEffect: SubpathStartNodeHandlerEffect<Scope.Scope> = createSubpathNodeHandlerEffect(
	  createRequestHandlerEffect(StartApp)
	);
	const subpathNodeHandler: SubpathStartNodeHandler<Scope.Scope> = createSubpathNodeHandler(
	  createRequestHandlerEffect(StartApp)
	);
	const subpathNodeOriginPolicy: SubpathStartNodeOriginPolicy = { trustForwardedHeaders: true };
	const subpathNodeRequestOptions: SubpathStartNodeRequestOptions = { ...subpathNodeOriginPolicy };
	const subpathWriteNodeOptions: SubpathWriteNodeResponseOptions = { headOnly: false };
	const subpathNodeServerOptions: SubpathStartNodeServerHandlerOptions = { runtime: startForkRuntime };
	const subpathNodeRuntimeOptions: SubpathStartNodeServerHandlerRuntimeOptions<Scope.Scope> = {
	  runtime: makeRuntime()
	};
	subpathNodeRequestOrigin(nodeIncomingMessage, subpathNodeRequestOptions);
	subpathNodeRequestToWebRequest(nodeIncomingMessage, subpathNodeRequestOptions);
	subpathNodeRequestToWebRequestEffect(nodeIncomingMessage, subpathNodeRequestOptions);
	subpathWriteNodeResponseEffect(nodeServerResponse, new Response("ok"), subpathWriteNodeOptions);
	subpathWriteNodeResponse(nodeServerResponse, new Response("ok"), subpathWriteNodeOptions);
	subpathNodeHandlerEffect(nodeIncomingMessage, nodeServerResponse);
	subpathNodeHandler(nodeIncomingMessage, nodeServerResponse);
	declare const subpathStartForkRuntime: SubpathStartForkRuntime;
	void subpathNodeServerOptions;
	void subpathNodeRuntimeOptions;
	void subpathStartForkRuntime;
	const subpathNodeServerHandler: SubpathStartNodeServerHandler = createSubpathNodeServerHandler(
	  createRequestHandlerEffect(StartApp)
	);
void subpathNodeServerHandler;
Effect.map(preloadRequestEffect(StartApp, new Request("https://example.com/projects/atlas")), (result) =>
  result.collectionPreload.routeDeclaredCollections.map((collection) => collection.name)
);
const hydrationDocument: Pick<Document, "getElementById"> = {
  getElementById: () => null
};
hydrateFromDocument(hydrationDocument, undefined, {
  collections: [ProjectsCollection]
});
const hydrationRuntime = makeRuntime();
hydrateFromDocument(hydrationDocument, undefined, {
  collections: [ProjectsCollection],
  runtime: hydrationRuntime
});
interface RuntimeDocumentService {
  readonly readDocument: () => string;
}
const RuntimeDocumentService = Capability.define<RuntimeDocumentService>("RuntimeDocumentService");
interface RuntimeMissingService {
  readonly readMissing: () => string;
}
const RuntimeMissingService = Capability.define<RuntimeMissingService>("RuntimeMissingService");
const typedRuntime = makeRuntime(
  RuntimeDocumentService.layer({
    readDocument: () => "ok"
  })
);
const runtimeProvidedEffect: Effect.Effect<string> = typedRuntime.provide(
  RuntimeDocumentService.useSync((service) => service.readDocument())
);
const runtimeMissingRequirementEffect: Effect.Effect<string, never, RuntimeMissingService> = typedRuntime.provide(
  RuntimeMissingService.useSync((service) => service.readMissing())
);
// @ts-expect-error Runtime Spine provide preserves services that are not in the runtime
const runtimeMissingRequirementErased: Effect.Effect<string> = typedRuntime.provide(
  RuntimeMissingService.useSync((service) => service.readMissing())
);
RuntimeProvider({ runtime: typedRuntime });
RuntimeProvider({
  source: RuntimeDocumentService.layer({
    readDocument: () => "ok"
  }),
  onDisposeFailure: (error) => {
    void error;
    return Effect.void;
  }
});
// @ts-expect-error RuntimeProvider ownership must choose either runtime or source
RuntimeProvider({
  runtime: typedRuntime,
  source: RuntimeDocumentService.layer({
    readDocument: () => "ok"
  })
});
RuntimeProvider({
  source: RuntimeDocumentService.layer({
    readDocument: () => "ok"
  }),
  // @ts-expect-error RuntimeProvider dispose observers must return EffectInput, not Promise work
  onDisposeFailure: () => promisedVoid
});
// @ts-expect-error host-owned runtime providers do not own disposal, so they do not accept disposal observers
RuntimeProvider({
  runtime: typedRuntime,
  onDisposeFailure: () => Effect.void
});
// @ts-expect-error RuntimeProvider source creates provider-owned runtimes; existing runtimes use the runtime prop
RuntimeProvider({ source: typedRuntime });
typedRuntime.runSync(RuntimeDocumentService.useSync((service) => service.readDocument()));
// @ts-expect-error Runtime Spine cannot run an effect with services it does not provide
typedRuntime.runSync(RuntimeMissingService.useSync((service) => service.readMissing()));
// @ts-expect-error Runtime Spine cannot fork an effect with services it does not provide
typedRuntime.runFork(RuntimeMissingService.useSync((service) => service.readMissing()));
declare const erasedRuntime: AnyEffectUiRuntime<never>;
const erasedRuntimeProvidedEffect: Effect.Effect<string> = erasedRuntime.provide(
  RuntimeMissingService.useSync((service) => service.readMissing())
);
erasedRuntime.runSync(RuntimeMissingService.useSync((service) => service.readMissing()));
const runtimeUiScope: UiScope = makeRuntimeUiScope(erasedRuntime);
const runtimeUiScopeFrame: RuntimeUiScopeFrame = makeRuntimeUiScopeFrame(erasedRuntime);
void runtimeUiScope;
void runtimeUiScopeFrame;
const viteDevServer = startDevServerFromVite({
  ssrLoadModule: () => promisedStartDevModule,
  transformIndexHtml: () => promisedString
});
const viteDevSsrEffect: Effect.Effect<
  Response,
  StartHandlerNotFound | StartDevServerError
> = handleSsrDevRequestEffect(viteDevServer, new Request("https://example.com/"));
const servicefulDevServer: StartDevServer<RuntimeMissingService> = {
  ssrLoadModule: () =>
    RuntimeMissingService.useSync(() => ({
      default: () => new Response("ok")
    })),
  transformIndexHtml: (_url, html) =>
    RuntimeMissingService.useSync(() => html)
};
const servicefulDevSsrEffect: Effect.Effect<
  Response,
  StartHandlerNotFound | StartDevServerError,
  RuntimeMissingService
> = handleSsrDevRequestEffect(servicefulDevServer, new Request("https://example.com/"));
void viteDevSsrEffect;
void servicefulDevSsrEffect;
// @ts-expect-error Runtime Spine exposes provide/runFork/runSync, not Promise runners
hydrationRuntime.runPromise(Effect.void);
hydrationRuntime.runSync(hydrateFromDocumentEffect(hydrationDocument, undefined, {
  collections: [ProjectsCollection]
}));
const startHydrationEffect: Effect.Effect<unknown, StartHydrationError> =
  hydrateFromDocumentEffect(hydrationDocument, undefined, {
    collections: [ProjectsCollection]
  });
void startHydrationEffect;
const streamHydrationDocument = {
  querySelectorAll: () => [
    {
      textContent: "{\"resources\":[]}",
      getAttribute: (name: string) =>
        name === streamHydrationConsumedAttribute ? null : "0",
      setAttribute: (_name: string, _value: string) => {}
    }
  ]
};
readStartHydrationChunks(streamHydrationDocument, { includeConsumed: true });
hydrateStartHydrationChunksFromDocument(streamHydrationDocument, {
  collections: [ProjectsCollection],
  runtime: hydrationRuntime
});
hydrationRuntime.runSync(
  hydrateStartHydrationChunksFromDocumentEffect(streamHydrationDocument, {
    collections: [ProjectsCollection],
    markConsumed: false
  })
);

ProjectsCollection.updateEffect("atlas", { name: "Atlas Revenue" });

// @ts-expect-error collection key type is preserved
ProjectsCollection.updateEffect(123, { name: "Atlas Revenue" });

Collection.define<Project>({
  name: "Projects.badCollection",
  getKey: (project) => project.id,
  // @ts-expect-error collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
});

Collection.define<Project>({
  name: "Projects.asyncCollection",
  getKey: (project) => project.id,
  // @ts-expect-error collection loaders must return Effect or a pure value, not Promise
  load: () => promisedProjects
});

const ProjectNames = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .where(({ project }) => eq(project.id, "atlas"))
    .select(({ project }) => project.name)
);
const projectNamesPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | QueryEvaluationError,
  ProjectApi
> = ProjectNames.preloadEffect();
const projectNamesRefetchEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | QueryEvaluationError,
  ProjectApi
> = ProjectNames.refetchEffect();
const projectNamesOnceEffect: Effect.Effect<
  ReadonlyArray<string>,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | QueryEvaluationError,
  ProjectApi
> = Query.onceEffect((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name)
);
void projectNamesPreloadEffect;
void projectNamesRefetchEffect;
void projectNamesOnceEffect;
const projectNamesState = ProjectNames.state.get();
if (projectNamesState._tag === "Failure") {
  const projectNamesError:
    | ProjectError
    | Server.ClientError
    | CollectionSnapshotCodecError
    | Schema.SchemaError
    | QueryEvaluationError = projectNamesState.error;
  void projectNamesError;
}

ProjectNames.data.get().map((name) => name.toUpperCase());

// @ts-expect-error live query select result is string
ProjectNames.data.get().map((name) => name.toFixed());
// @ts-expect-error serviceful query factories must spell their error/requirement channels
const defaultTypedProjectNameFactory: Query.Factory<string> = (query) => query.from({ project: ProjectsCollection }).select(({ project }) => project.name);
const servicefulProjectNameFactory: Query.Factory<string, unknown, ProjectApi> = (query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name);
void defaultTypedProjectNameFactory;
void servicefulProjectNameFactory;

const ProjectNameCards = Collection.liveQuery<
  { readonly id: string; readonly name: string },
  string,
  unknown,
  ProjectApi
>({
  name: "ProjectNameCards.collection",
  getKey: (project) => project.id,
  query: (query) =>
    query
      .from({ project: ProjectsCollection })
      .select(({ project }) => ({
        id: project.id,
        name: project.name
      }))
});
const solidProjects = useCollection(ProjectsCollection, {
  preload: false,
  onPreloadFailure: (error) => {
    const typedError: ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError = error;
    void typedError;
    return Effect.void;
  }
});
useCollection(ProjectsCollection, {
  // @ts-expect-error Solid DB collection preload observers must return EffectInput, not Promise work.
  onPreloadFailure: () => promisedVoid
});
const solidProjectsHandle: CollectionHandle<
  Project,
  string,
  ProjectError | Server.ClientError,
  never
> = solidProjects;
const solidProjectResource = useResource(ProjectById("atlas"));
const solidProjectResourceValue: Project | undefined = solidProjectResource.value();
const solidProjectResourcePrefetch: Effect.Effect<Project, Resource.LoadError<ProjectError | Server.ClientError>> =
  solidProjectResource.prefetchEffect();
interface SolidRuntimeStartupError {
  readonly _tag: "SolidRuntimeStartupError";
}
const solidProjectResourceWithRuntimeError = useResource<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi,
  SolidRuntimeStartupError
>(ProjectById("atlas"), {
  onPreloadFailure: (error) => {
    const typedError: Resource.LoadError<ProjectError | Server.ClientError> | SolidRuntimeStartupError = error;
    void typedError;
  }
});
useResource(ProjectById("atlas"), {
  // @ts-expect-error resource preload failure observers must return values or Effects, not Promises
  onPreloadFailure: () => promisedVoid
});
const solidProjectResourceRuntimeErrorPrefetch: Effect.Effect<
  Project,
  Resource.LoadError<ProjectError | Server.ClientError> | SolidRuntimeStartupError
> = solidProjectResourceWithRuntimeError.prefetchEffect();
const solidProjectResourcePreloadFailure:
  | Resource.LoadError<ProjectError | Server.ClientError>
  | SolidRuntimeStartupError
  | undefined = solidProjectResourceWithRuntimeError.preloadFailure();
void solidProjectResourceValue;
void solidProjectResourcePrefetch;
void solidProjectResourceRuntimeErrorPrefetch;
void solidProjectResourcePreloadFailure;
interface ReactRuntimeStartupError {
  readonly _tag: "ReactRuntimeStartupError";
}
const reactProjectResource = useReactResource(ProjectById("atlas"));
const reactProjectResourceHandle: ReactResourceHandle<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi,
  never
> = reactProjectResource;
const reactProjectResourceValue: Project | undefined = reactProjectResource.value;
const reactProjectResourcePrefetch: Effect.Effect<Project, Resource.LoadError<ProjectError | Server.ClientError>> =
  reactProjectResource.prefetchEffect();
const reactProjectResourceWithRuntimeError = useReactResource<
  string,
  Project,
  ProjectError | Server.ClientError,
  ProjectApi,
  ReactRuntimeStartupError
>(ProjectById("atlas"), {
  onPreloadFailure: (error) => {
    const typedError: Resource.LoadError<ProjectError | Server.ClientError> | ReactRuntimeStartupError = error;
    void typedError;
  }
});
useReactResource(ProjectById("atlas"), {
  // @ts-expect-error resource preload failure observers must return values or Effects, not Promises
  onPreloadFailure: () => promisedVoid
});
const reactProjectResourceRuntimeErrorPrefetch: Effect.Effect<
  Project,
  Resource.LoadError<ProjectError | Server.ClientError> | ReactRuntimeStartupError
> = reactProjectResourceWithRuntimeError.prefetchEffect();
const reactProjectResourcePreloadFailure:
  | Resource.LoadError<ProjectError | Server.ClientError>
  | ReactRuntimeStartupError
  | undefined = reactProjectResourceWithRuntimeError.preloadFailure;
const reactProjectSuspenseValue: Project = useReactResourceSuspense(ProjectById("atlas"));
const reactProjectSignalValue: Project = useReactSignal(Signal.make({ id: "atlas", name: "Atlas" }));
const reactProjectStreamValue: Project = useReactStream(
  Stream.suspend(() => Stream.fromEffect(ProjectApi.use((api) => api.get("atlas")).pipe(Effect.orDie))),
  { id: "loading", name: "Loading" }
);
const reactRuntimeEffect = useReactRuntimeEffect<ReactRuntimeStartupError>();
const reactRuntimeEffectFiber: Fiber.Fiber<Project, ReactRuntimeStartupError> = reactRuntimeEffect(
  Effect.succeed({ id: "atlas", name: "Atlas" })
);
void ReactRuntimeProvider;
void reactProjectResourceHandle;
void reactProjectResourceValue;
void reactProjectResourcePrefetch;
void reactProjectResourceRuntimeErrorPrefetch;
void reactProjectResourcePreloadFailure;
void reactProjectSuspenseValue;
void reactProjectSignalValue;
void reactProjectStreamValue;
void reactRuntimeEffectFiber;
const solidProjectPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError
> = solidProjects.preloadEffect();
const solidProjectPreloadFailure:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | undefined = solidProjects.preloadFailure();
solidProjects.pendingMutations().map((pending) => pending.transaction.id);
const solidProjectInsertEffect: Effect.Effect<
  Collection.Transaction<Project, string>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
> = solidProjects.insertEffect({ id: "lumen", name: "Lumen" });
const solidProjectUpdateEffect: Effect.Effect<
  Collection.Transaction<Project, string>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
  | CollectionRowNotFound
  | CollectionRowKeyChanged
> = solidProjects.updateEffect("atlas", { name: "Atlas Revenue" });
const solidProjectDeleteEffect: Effect.Effect<
  Collection.Transaction<Project, string>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
  | CollectionRowNotFound
> = solidProjects.deleteEffect("atlas");
const solidProjectWriteInsertEffect: Effect.Effect<
  void,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
> = solidProjects.writeInsertEffect({ id: "orion", name: "Orion" });
const solidProjectWriteUpdateEffect: Effect.Effect<
  void,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
  | CollectionRowNotFound
  | CollectionRowKeyChanged
> = solidProjects.writeUpdateEffect("orion", { name: "Orion Prime" });
const solidProjectWriteDeleteEffect: Effect.Effect<
  void,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
> = solidProjects.writeDeleteEffect("orion");
const solidProjectFlushEffect: Effect.Effect<
  ReadonlyArray<Collection.Transaction<Project, string>>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
> = solidProjects.flushPendingMutationsEffect();
void solidProjectPreloadEffect;
void solidProjectPreloadFailure;
void solidProjectInsertEffect;
void solidProjectUpdateEffect;
void solidProjectDeleteEffect;
void solidProjectWriteInsertEffect;
void solidProjectWriteUpdateEffect;
void solidProjectWriteDeleteEffect;
void solidProjectFlushEffect;
const solidProjectsWithRuntimeError = useCollection<
  Project,
  string,
  ProjectError | Server.ClientError,
  ProjectApi,
  SolidRuntimeStartupError
>(ProjectsCollection, { preload: false });
const solidProjectPreloadRuntimeErrorEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | SolidRuntimeStartupError
> = solidProjectsWithRuntimeError.preloadEffect();
const solidProjectInsertRuntimeErrorEffect: Effect.Effect<
  Collection.Transaction<Project, string>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
  | SolidRuntimeStartupError
> = solidProjectsWithRuntimeError.insertEffect({ id: "lumen", name: "Lumen" });
void solidProjectPreloadRuntimeErrorEffect;
void solidProjectInsertRuntimeErrorEffect;
const solidProjectNames = useLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name),
  {
    preload: false,
    onPreloadFailure: (error) => {
      const typedError:
        | ProjectError
        | Server.ClientError
        | CollectionSnapshotCodecError
        | Schema.SchemaError
        | QueryEvaluationError = error;
      void typedError;
      return Effect.void;
    }
  }
);
useLiveQuery<string, ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError, ProjectApi>(
  (query) => query.from({ project: ProjectsCollection }).select(({ project }) => project.name),
  {
    // @ts-expect-error Solid DB live-query preload observers must return EffectInput, not Promise work.
    onPreloadFailure: () => promisedVoid
  }
);
const solidProjectNamesHandle: LiveQueryHandle<
  string,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError,
  never
> = solidProjectNames;
const solidProjectNamesWithDeps = useLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name),
  {
    preload: false,
    deps: () => "atlas"
  }
);
const solidProjectStream = useStream(
  Stream.suspend(() => Stream.fromEffect(ProjectApi.use((api) => api.get("atlas")).pipe(Effect.orDie))),
  { id: "loading", name: "Loading" }
);
const solidProjectStreamValue: Project = solidProjectStream();
void solidProjectNamesWithDeps;
void solidProjectStreamValue;
const solidProjectNamesPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | QueryEvaluationError
> = solidProjectNames.preloadEffect();
const solidProjectNamesError:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | undefined = solidProjectNames.error();
const solidProjectNamesPreloadFailure:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | undefined = solidProjectNames.preloadFailure();
void solidProjectNamesPreloadEffect;
void solidProjectNamesError;
void solidProjectNamesPreloadFailure;
const solidProjectNamesWithRuntimeError = useLiveQuery<
  string,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError,
  ProjectApi,
  SolidRuntimeStartupError
>((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name),
  { preload: false }
);
const solidProjectNamesRuntimeErrorPreloadEffect: Effect.Effect<
  void,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | SolidRuntimeStartupError
> = solidProjectNamesWithRuntimeError.preloadEffect();
void solidProjectNamesRuntimeErrorPreloadEffect;
const reactProjects = useReactCollection(ProjectsCollection, {
  preload: false,
  onPreloadFailure: (error) => {
    const typedError: ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError = error;
    void typedError;
    return Effect.void;
  }
});
useReactCollection(ProjectsCollection, {
  // @ts-expect-error React DB collection preload observers must return EffectInput, not Promise work.
  onPreloadFailure: () => promisedVoid
});
const reactProjectsHandle: ReactCollectionHandle<
  Project,
  string,
  ProjectError | Server.ClientError,
  never
> = reactProjects;
const reactProjectRows: ReadonlyArray<Collection.Row<Project, string>> = reactProjects.rows;
const reactProjectPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError
> = reactProjects.preloadEffect();
const reactProjectPreloadFailure:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | undefined = reactProjects.preloadFailure;
reactProjects.pendingMutations.map((pending) => pending.transaction.id);
const reactProjectInsertEffect: Effect.Effect<
  Collection.Transaction<Project, string>,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | EffectInputCallbackError
> = reactProjects.insertEffect({ id: "lumen", name: "Lumen" });
const reactProjectsWithRuntimeError = useReactCollection<
  Project,
  string,
  ProjectError | Server.ClientError,
  ProjectApi,
  ReactRuntimeStartupError
>(ProjectsCollection, { preload: false });
const reactProjectPreloadRuntimeErrorEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | ReactRuntimeStartupError
> = reactProjectsWithRuntimeError.preloadEffect();
const reactProjectNames = useReactLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name),
  {
    preload: false,
    onPreloadFailure: (error) => {
      const typedError:
        | ProjectError
        | Server.ClientError
        | CollectionSnapshotCodecError
        | Schema.SchemaError
        | QueryEvaluationError = error;
      void typedError;
      return Effect.void;
    }
  }
);
useReactLiveQuery<string, ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError, ProjectApi>(
  (query) => query.from({ project: ProjectsCollection }).select(({ project }) => project.name),
  {
    // @ts-expect-error React DB live-query preload observers must return EffectInput, not Promise work.
    onPreloadFailure: () => promisedVoid
  }
);
makeCollectionReactivePreloadController({
  runtime: null as unknown as AnyEffectUiRuntime<never>,
  onSuccess: () => Effect.void,
  onFailure: () => Effect.void
});
makeCollectionReactivePreloadController({
  runtime: null as unknown as AnyEffectUiRuntime<never>,
  // @ts-expect-error Shared DB preload success observers must return EffectInput, not Promise work.
  onSuccess: () => promisedVoid,
  onFailure: () => Effect.void
});
const reactProjectNamesHandle: ReactLiveQueryHandle<
  string,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError,
  never
> = reactProjectNames;
const reactProjectNamesWithDeps = useReactLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name),
  {
    preload: false,
    deps: ["atlas"] as const
  }
);
const reactProjectNamesPreloadEffect: Effect.Effect<
  void,
  ProjectError | Server.ClientError | CollectionSnapshotCodecError | Schema.SchemaError | QueryEvaluationError
> = reactProjectNames.preloadEffect();
const reactProjectNamesError:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | undefined = reactProjectNames.error;
const reactProjectNamesPreloadFailure:
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | undefined = reactProjectNames.preloadFailure;
void reactProjectsHandle;
void reactProjectRows;
void reactProjectPreloadEffect;
void reactProjectPreloadFailure;
void reactProjectInsertEffect;
void reactProjectPreloadRuntimeErrorEffect;
void reactProjectNamesHandle;
void reactProjectNamesWithDeps;
void reactProjectNamesPreloadEffect;
void reactProjectNamesError;
void reactProjectNamesPreloadFailure;

ProjectNameCards.rows().map((project) => {
  project.name.toUpperCase();
  project.$synced.valueOf();
});
Effect.map(ProjectNameCards.updateEffect("atlas", { name: "Atlas Prime" }), () => undefined);

const TopLevelProjectNameCards = createLiveQueryCollection({
  name: "ProjectNameCards.topLevel",
  getKey: (project: { readonly id: string; readonly name: string }) => project.id,
  query: (query) =>
    query
      .from({ project: ProjectsCollection })
      .select(({ project }) => ({
        id: project.id,
        name: project.name
      }))
});

TopLevelProjectNameCards.rows().map((project) => project.name.toUpperCase());
const topLevelProjectNameCardsPreload: Effect.Effect<
  void,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | ReadonlyCollectionMutation,
  ProjectApi
> = TopLevelProjectNameCards.preloadEffect();
const solidTopLevelProjectNameCards = useCollection(TopLevelProjectNameCards, { preload: false });
const solidTopLevelProjectNameCardsHandle: CollectionHandle<
  { readonly id: string; readonly name: string },
  string,
  | ProjectError
  | Server.ClientError
  | CollectionSnapshotCodecError
  | Schema.SchemaError
  | QueryEvaluationError
  | ReadonlyCollectionMutation,
  never
> = solidTopLevelProjectNameCards;
void solidProjectsHandle;
void solidProjectNamesHandle;
void topLevelProjectNameCardsPreload;
void solidTopLevelProjectNameCardsHandle;

interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
}

const TasksCollection = Collection.define<Task>({
  name: "Tasks.collection",
  getKey: (task) => task.id,
  indexes: {
    byProject: (task) => task.projectId
  }
});

const ProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.projectId)
    .select(({ project, task }) => `${project.name}:${task.title}`)
);

ProjectTaskTitles.data.get().map((title) => title.toUpperCase());

const IndexedProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .joinIndexed("task", TasksCollection, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}:${task.title}`)
);

IndexedProjectTaskTitles.data.get().map((title) => title.toUpperCase());

const ProjectTaskRows = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.projectId)
);

ProjectTaskRows.data.get().map(({ project, task }) => `${project.name}:${task.title}`);

Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    // @ts-expect-error joined row fields are type checked
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.missing)
);

const ProjectCounts = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .groupBy(
      ({ project }) => ({ name: project.name }),
      {
        count: Query.count(),
        nameLength: Query.sum(({ project }) => project.name.length)
      }
    )
    .where((group) => group.count > 0)
    .select((group) => ({
      name: group.name,
      count: group.count,
      nameLength: group.nameLength
    }))
);

ProjectCounts.data.get().map((group) => group.count.toFixed());

Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .groupBy(
      ({ project }) => ({ name: project.name }),
      {
        // @ts-expect-error aggregate selectors are type checked
        total: Query.sum(({ project }) => project.missing)
      }
    )
);

const projectsHandle = useCollection(ProjectsCollection);
projectsHandle.rows().map((project) => project.name);
projectsHandle.get("atlas")?.name.toUpperCase();
projectsHandle.index("byName", "Atlas").map((project) => project.name.toUpperCase());
projectsHandle.firstByIndex("byName", "Atlas")?.name.toUpperCase();

const projectNamesHandle = useLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name)
);
projectNamesHandle.data().map((name) => name.toUpperCase());

const ProjectRoutePlan = Route.planNavigationEffect([ProjectRoute] as const, "/projects/atlas");
Effect.map(ProjectRoutePlan, (plan) => {
  if (plan._tag === "Matched") {
    plan.match.params.id;
    plan.refs.map((ref) => ref.key);
    plan.resources.resources.map((snapshot) => snapshot.name);
  }
});

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project, ProjectError | Server.ClientError>;
  readonly rename: (input: { readonly id: string; readonly name: string }) => Effect.Effect<Project, ProjectError | Server.ClientError>;
}

const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

ProjectApi.layer({
  get: (id) => getProject.effect({ id }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name })
});

ProjectApi.mock({
  get: (id) => Effect.succeed({ id, name: "Mock Project" }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name })
});

// @ts-expect-error capability implementation must include all service methods
ProjectApi.layer({
  get: (id) => Effect.succeed({ id, name: "Incomplete" })
});

ProjectApi.use((api) => api.get("atlas"));
ProjectApi.useEffect((api) => api.get("atlas"));
ProjectApi.useEffect(() => ({ id: "atlas", name: "Pure Project" }));
const projectProgramRuntime = makeRuntime(
  ProjectApi.layer({
    get: (id) => Effect.succeed({ id, name: "Runtime Project" }),
    rename: (input) => Effect.succeed({ id: input.id, name: input.name })
  })
);
const runUiEffect = useRuntimeEffect<RuntimeStartupError>();
const uiEffectJoin: Effect.Effect<
  Project,
  ProjectError | Server.ClientError | RuntimeStartupError
> = Fiber.join(runUiEffect(ProjectApi.use((api) => api.get("atlas"))));
void uiEffectJoin;

type ProjectProgramModel = { readonly selected: Project | undefined; readonly loading: boolean };
type ProjectProgramMessage =
  | { readonly _tag: "Load"; readonly id: string }
  | { readonly _tag: "Loaded"; readonly project: Project }
  | { readonly _tag: "Refresh" };

const ProjectProgram = Program.define<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError,
  ProjectApi
>({
  name: "ProjectProgram",
  timeline: { limit: 50 },
  initial: { selected: undefined, loading: false },
  update: (model, message) => {
    switch (message._tag) {
      case "Load":
        return Program.next(
          { ...model, loading: true },
          Program.command(
            ProjectApi.use((api) =>
              Effect.map(api.get(message.id), (project) => ({ _tag: "Loaded", project }) as const)
            )
          )
        );
      case "Loaded":
        return { selected: message.project, loading: false };
      case "Refresh":
        return model.selected
          ? Program.next(model, Program.dispatch({ _tag: "Load", id: model.selected.id }))
          : model;
    }
  },
  subscriptions: (model) =>
    model.selected ? Stream.succeed<ProjectProgramMessage>({ _tag: "Refresh" }) : undefined
});

// @ts-expect-error serviceful Program.start requires an explicit runtime carrying Program services
Program.start(ProjectProgram);
const projectProgramStartOptions: Program.StartOptions<ProjectApi> = { runtime: projectProgramRuntime };
type ProjectProgramRemainingRuntimeRequirements =
  Program.RuntimeRemainingRequirements<ProjectApi | RuntimeMissingService, ProjectApi>;
const missingProgramRuntimeRequirement = null as unknown as ProjectProgramRemainingRuntimeRequirements;
const projectProgram = Program.start(ProjectProgram, { runtime: projectProgramRuntime });
read(projectProgram.model).selected?.name.toUpperCase();
const projectProgramTimeline: ReadonlyArray<
  Program.Event<
    ProjectProgramModel,
    ProjectProgramMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError
  >
> = read(projectProgram.timeline);
projectProgramTimeline.map((event) => event.sequence.toFixed());
projectProgram.clearTimeline();
const projectProgramDispatchEffect: Effect.Effect<
  void,
  Program.Failure<ProjectProgramMessage, ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed>
> = projectProgram.dispatchEffect({ _tag: "Load", id: "atlas" });
void projectProgramDispatchEffect;
projectProgram.dispatch({ _tag: "Refresh" });
// @ts-expect-error Program dispatch messages keep payloads typed
projectProgram.dispatch({ _tag: "Load" });
const ProjectProgramWithMissingService = Program.define<
  ProjectProgramModel,
  ProjectProgramMessage,
  never,
  ProjectApi | RuntimeMissingService
>({
  initial: { selected: undefined, loading: false },
  update: (model) =>
    Program.next(
      model,
      Program.effect(
        RuntimeMissingService.useSync((service) => service.readMissing()).pipe(Effect.asVoid)
      )
    )
});
Program.start(ProjectProgramWithMissingService, {
  // @ts-expect-error runtime-bound Program start cannot erase services the runtime does not provide
  runtime: projectProgramRuntime
});
interface ProgramRuntimeStartupError {
  readonly _tag: "ProgramRuntimeStartupError";
}
declare const projectProgramRuntimeWithStartupError: EffectUiRuntime<ProjectApi, ProgramRuntimeStartupError>;
const projectProgramWithRuntimeError = Program.start(ProjectProgram, {
  runtime: projectProgramRuntimeWithStartupError
});
const projectProgramRuntimeErrorDispatch: Effect.Effect<
  void,
  Program.Failure<
    ProjectProgramMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed | ProgramRuntimeStartupError
  >
> = projectProgramWithRuntimeError.dispatchEffect({ _tag: "Load", id: "atlas" });
const projectProgramStep: Effect.Effect<
  Program.Step<ProjectProgramModel, ProjectProgramMessage, ProjectError | Server.ClientError, ProjectApi>,
  Program.Failure<ProjectProgramMessage, ProjectError | Server.ClientError | EffectInputCallbackError>,
  ProjectApi
> = Program.step(ProjectProgram, { selected: undefined, loading: false }, { _tag: "Load", id: "atlas" });
void projectProgramStep;
const projectProgramStory: Program.Story<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError,
  ProjectApi
> = Program.story(ProjectProgram);
const projectProgramStoryEntry: Effect.Effect<
  Program.StoryEntry<ProjectProgramModel, ProjectProgramMessage, ProjectError | Server.ClientError, ProjectApi>,
  Program.Failure<ProjectProgramMessage, ProjectError | Server.ClientError | EffectInputCallbackError>,
  ProjectApi
> = projectProgramStory.send({ _tag: "Load", id: "atlas" });
void projectProgramStoryEntry;
void projectProgramRuntimeErrorDispatch;
void projectProgramStartOptions;
void missingProgramRuntimeRequirement;
const solidProjectProgram: ProgramHandle<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError | EffectInputCallbackError,
  ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed
> = useProgram(ProjectProgram);
solidProjectProgram.model().selected?.id.toUpperCase();
solidProjectProgram.failures().map((failure) => failure.phase);
solidProjectProgram.timeline().map((event) => event._tag);
solidProjectProgram.clearTimeline();
// @ts-expect-error Solid Program dispatch messages keep payloads typed
solidProjectProgram.dispatch({ _tag: "Loaded" });
const solidProjectProgramWithRuntimeError = useProgram<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError,
  ProjectApi,
  SolidRuntimeStartupError
>(ProjectProgram);
const solidProjectProgramRuntimeErrorDispatch: Effect.Effect<
  void,
  Program.Failure<
    ProjectProgramMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed | SolidRuntimeStartupError
  >
> = solidProjectProgramWithRuntimeError.dispatchEffect({ _tag: "Load", id: "atlas" });
void solidProjectProgramRuntimeErrorDispatch;
const reactProjectProgram: ReactProgramHandle<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError | EffectInputCallbackError,
  ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed
> = useReactProgram(ProjectProgram);
reactProjectProgram.model.selected?.id.toUpperCase();
reactProjectProgram.clearTimeline();
const reactProjectProgramWithRuntimeError = useReactProgram<
  ProjectProgramModel,
  ProjectProgramMessage,
  ProjectError | Server.ClientError,
  ProjectApi,
  ReactRuntimeStartupError
>(ProjectProgram);
const reactProjectProgramRuntimeErrorDispatch: Effect.Effect<
  void,
  Program.Failure<
    ProjectProgramMessage,
    ProjectError | Server.ClientError | EffectInputCallbackError | Program.Disposed | ReactRuntimeStartupError
  >
> = reactProjectProgramWithRuntimeError.dispatchEffect({ _tag: "Load", id: "atlas" });
void reactProjectProgramRuntimeErrorDispatch;

Program.define<number, "bad">({
  initial: 0,
  // @ts-expect-error Program updates must return Effect or a pure update, not Promise
  update: () => promisedNumber
});

// @ts-expect-error service method input remains typed
ProjectApi.use((api) => api.rename({ id: "atlas" }));

// @ts-expect-error capability callbacks must return Effect or a pure value, not Promise
ProjectApi.useEffect(() => promisedProject);

Resource.family<string, Project>({
  name: "Project.bad",
  // @ts-expect-error resource loader output must satisfy the resource value type
  load: (id) => ({ id })
});

route("/promise-preload", {
  // @ts-expect-error route preload must return Effect or a pure value, not Promise
  preload: () => promisedVoid
});

defineFileRoute("/promise-file-preload")({
  // @ts-expect-error file route preload must return Effect or a pure value, not Promise
  preload: () => promisedVoid
});

interface RoutePreloadApi {
  readonly warm: (id: string) => Effect.Effect<void>;
}

const RoutePreloadApi = Capability.define<RoutePreloadApi>("RoutePreloadApi");
const ServicePreloadRoute = route("/service-projects/:id", {
  preload: ({ params }) =>
    RoutePreloadApi.use((api) => api.warm(params.id))
});
const FileRoutePreloadBuilder = defineFileRoute("/file-preload-helper/:id");
const FileRoutePreloadHelperRoute = FileRoutePreloadBuilder({
  ...FileRoutePreloadBuilder.preload(
    {
      resources: [
        FileRoutePreloadBuilder.resource(ProjectById, ({ params }) => params.id)
      ],
      collections: [ProjectsCollection]
    },
    ({ params }) => RoutePreloadApi.use((api) => api.warm(params.id))
  )
});
const fileRoutePreloadHelperRequirements: Route.PreloadRequirements<typeof FileRoutePreloadHelperRoute> =
  {} as ProjectApi | RoutePreloadApi;
declare const fileRoutePreloadHelperMatch: Route.Match<typeof FileRoutePreloadHelperRoute>;
const fileRoutePreloadHelperEffect: Effect.Effect<
  void,
  Route.PreloadError,
  ProjectApi | RoutePreloadApi
> = Route.preloadEffect(fileRoutePreloadHelperMatch);
const NamedFileRoutePreloadBuilder = defineFileRoute("/file-preload-helper-named");
const NamedFileRoutePreloadHelperRoute = NamedFileRoutePreloadBuilder({
  ...NamedFileRoutePreloadBuilder.preload(
    {
      collections: [ProjectsCollection.name, { name: ProjectsCollection.name }]
    },
    () => RoutePreloadApi.use((api) => api.warm("atlas"))
  )
});
const namedFileRoutePreloadHelperRequirements: Route.PreloadRequirements<typeof NamedFileRoutePreloadHelperRoute> =
  {} as RoutePreloadApi;
FileRoutePreloadBuilder.resource(ProjectById, ({ params }) => params.id);
// @ts-expect-error file route preload helper rejects Promise-shaped preload work
FileRoutePreloadBuilder.preload({},
  () => promisedVoid
);
FileRoutePreloadBuilder.resource(ProjectById, ({ params }) => {
  // @ts-expect-error path params remain typed for helper resource selectors
  params.missing;
  return params.id;
});
FileRoutePreloadBuilder.resource(ProjectById, () =>
  // @ts-expect-error resource selector input must match the resource family input
  123
);
const BrandedFileRoutePreloadBuilder = defineFileRoute("/file-preload-branded/:id");
const BrandedFileRoutePreloadHelperRoute = BrandedFileRoutePreloadBuilder({
  ...BrandedFileRoutePreloadBuilder.preload(
    {
      params: Schema.Struct({ id: ProjectId }),
      search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
      resources: ({ resource }) => [
        resource(BrandedProjectById, ({ params, search }) => {
          const id: ProjectId = params.id;
          const tab: "overview" | "activity" | undefined = search.tab;
          return id;
        })
      ],
      collections: [ProjectsCollection]
    },
    ({ params }) => RoutePreloadApi.use((api) => api.warm(params.id))
  )
});
const brandedFileRoutePreloadHelperRequirements: Route.PreloadRequirements<typeof BrandedFileRoutePreloadHelperRoute> =
  {} as ProjectApi | RoutePreloadApi;
const brandedFileRouteHref: Route.HrefOptions<typeof BrandedFileRoutePreloadHelperRoute> = {
  params: { id: atlasProjectId },
  search: { tab: "overview" }
};
void brandedFileRoutePreloadHelperRequirements;
void brandedFileRouteHref;

const SpreadFreeFileRoutePreloadRoute = BrandedFileRoutePreloadBuilder.preload(
  {
    params: Schema.Struct({ id: ProjectId }),
    search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
    resources: ({ resource }) => [
      resource(BrandedProjectById, ({ params }) => params.id)
    ],
    collections: [ProjectsCollection]
  },
  ({ params }) => RoutePreloadApi.use((api) => api.warm(params.id))
).route({
  component: () => undefined
});
const spreadFreeFileRoutePreloadRequirements: Route.PreloadRequirements<typeof SpreadFreeFileRoutePreloadRoute> =
  {} as ProjectApi | RoutePreloadApi;
const spreadFreeFileRouteHref: Route.HrefOptions<typeof SpreadFreeFileRoutePreloadRoute> = {
  params: { id: atlasProjectId },
  search: { tab: "overview" }
};
BrandedFileRoutePreloadBuilder.preload({
  params: Schema.Struct({ id: ProjectId })
}).route({
  // @ts-expect-error spread-free file-route preload keeps params/search on the preload definition
  params: Schema.Struct({ id: Schema.String })
});
void spreadFreeFileRoutePreloadRequirements;
void spreadFreeFileRouteHref;

BrandedFileRoutePreloadBuilder.preload({
  params: Schema.Struct({ id: ProjectId }),
  resources: ({ resource }) => [
    resource(BrandedProjectById, () =>
      // @ts-expect-error schema-aware resource selectors reject plain strings for branded inputs
      "atlas"
    )
  ]
});

const badBrandedFileRouteHref: Route.HrefOptions<typeof BrandedFileRoutePreloadHelperRoute> = {
  params: {
    // @ts-expect-error schema-aware file-route helper carries branded params into route hrefs
    id: "atlas"
  }
};
void badBrandedFileRouteHref;
declare const servicePreloadMatch: Route.Match<typeof ServicePreloadRoute>;
const serviceRoutePreloadRequirements: Route.PreloadRequirements<typeof ServicePreloadRoute> =
  {} as RoutePreloadApi;
const serviceRoutePreload: Effect.Effect<void, Route.PreloadError, RoutePreloadApi> =
  Route.preloadEffect(servicePreloadMatch);
const serviceRoutePreloadPlan: Effect.Effect<
  Route.PreloadPlan<typeof ServicePreloadRoute>,
  Route.PreloadError,
  RoutePreloadApi
> = Route.planPreloadEffect(servicePreloadMatch);
const serviceRouteNavigationPlan: Effect.Effect<
  Route.NavigationPlan<typeof ServicePreloadRoute>,
  Route.NavigationError,
  RoutePreloadApi
> = Route.planNavigationEffect([ServicePreloadRoute] as const, "/service-projects/atlas");
const routePreloadMissingStartApp = defineApp({
  routes: [ServicePreloadRoute] as const,
  client: {},
  server: typedRuntime
});
const routePreloadMissingStartEffect: Effect.Effect<
  unknown,
  unknown,
  RoutePreloadApi
> = preloadRequestEffect(
  routePreloadMissingStartApp,
  new Request("https://example.com/service-projects/atlas")
);
const routePreloadMissingStartHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = createRequestHandlerEffect(routePreloadMissingStartApp)(
  new Request("https://example.com/service-projects/atlas")
);
const routePreloadMissingFetchAdapterEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = toFetchHandlerEffect(createRequestHandlerEffect(routePreloadMissingStartApp))(
  new Request("https://example.com/service-projects/atlas")
);
const routePreloadMissingSubpathFetchAdapterEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = toSubpathFetchHandlerEffect(createRequestHandlerEffect(routePreloadMissingStartApp))(
  new Request("https://example.com/service-projects/atlas")
);
const routePreloadMissingNodeAdapterEffect: Effect.Effect<
  Response,
  StartNodeAdapterError | StartRequestHandlerError,
  Scope.Scope | RoutePreloadApi
> = createNodeHandlerEffect(createRequestHandlerEffect(routePreloadMissingStartApp))(
  { method: "GET", url: "/", headers: {} } as import("node:http").IncomingMessage,
  {} as import("node:http").ServerResponse
);
// @ts-expect-error bare fetch handler aliases default to service-free, so route preload services stay visible
const erasedRoutePreloadFetchHandler: SubpathStartFetchHandlerEffect =
  toSubpathFetchHandlerEffect(createRequestHandlerEffect(routePreloadMissingStartApp));
// @ts-expect-error bare Node handler aliases default to service-free, so route preload services stay visible
const erasedRoutePreloadNodeHandler: SubpathStartNodeHandlerEffect =
  createNodeHandlerEffect(createRequestHandlerEffect(routePreloadMissingStartApp));
// @ts-expect-error Promise-shaped fetch facades must receive a runtime for non-Scope handler requirements
createSubpathFetchHandler(createRequestHandlerEffect(routePreloadMissingStartApp));
// @ts-expect-error Node callback facades must receive a runtime for non-Scope handler requirements
createSubpathNodeServerHandler(createRequestHandlerEffect(routePreloadMissingStartApp));
// @ts-expect-error effect-first fetch adapters cannot hide requirements through partial generics
toSubpathFetchHandlerEffect<StartRequestHandlerError>(createRequestHandlerEffect(routePreloadMissingStartApp));
// @ts-expect-error effect-first Node adapters cannot hide requirements through partial generics
createNodeHandlerEffect<StartRequestHandlerError>(createRequestHandlerEffect(routePreloadMissingStartApp));
const routePreloadRuntime = makeRuntime(
  RoutePreloadApi.layer({
    warm: () => Effect.void
  })
);
createBrowserRouter([ServicePreloadRoute] as const, {
  initialHref: "/service-projects/atlas",
  runtime: routePreloadRuntime
});
createBrowserRouter([ServicePreloadRoute] as const, {
  initialHref: "/service-projects/atlas",
  // @ts-expect-error serviceful browser router preloads require a runtime carrying preload services
  runtime: makeRuntime()
});
RouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas",
  runtime: routePreloadRuntime
});
// @ts-expect-error serviceful RouterProvider routes require an explicit preload-capable runtime
RouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas"
});
RouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas",
  // @ts-expect-error serviceful RouterProvider runtime must carry preload services
  runtime: makeRuntime()
});
createReactBrowserRouter([ServicePreloadRoute] as const, {
  initialHref: "/service-projects/atlas",
  runtime: routePreloadRuntime
});
createReactBrowserRouter([ServicePreloadRoute] as const, {
  initialHref: "/service-projects/atlas",
  // @ts-expect-error serviceful React browser router preloads require a runtime carrying preload services
  runtime: makeRuntime()
});
ReactRouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas",
  runtime: routePreloadRuntime
});
// @ts-expect-error serviceful React RouterProvider routes require an explicit preload-capable runtime
ReactRouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas"
});
ReactRouterProvider({
  routes: [ServicePreloadRoute] as const,
  initialHref: "/service-projects/atlas",
  // @ts-expect-error serviceful React RouterProvider runtime must carry preload services
  runtime: makeRuntime()
});
const routePreloadProvidedStartApp = defineApp({
  routes: [ServicePreloadRoute] as const,
  client: {},
  server: routePreloadRuntime
});
const routePreloadProvidedStartEffect: Effect.Effect<unknown, unknown> =
  preloadRequestEffect(
    routePreloadProvidedStartApp,
    new Request("https://example.com/service-projects/atlas")
  );
const routePreloadProvidedStartHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope
> = createRequestHandlerEffect(routePreloadProvidedStartApp)(
  new Request("https://example.com/service-projects/atlas")
);
const routePreloadFetchFacade = createSubpathFetchHandler(
  createRequestHandlerEffect(routePreloadMissingStartApp),
  { runtime: routePreloadRuntime }
);
const routePreloadNodeFacade = createSubpathNodeServerHandler(
  createRequestHandlerEffect(routePreloadMissingStartApp),
  { runtime: routePreloadRuntime }
);
const RegistryReadDocumentAction = Action.define<any, string, never, RuntimeDocumentService>({
  name: "RuntimeDocument.registryAction",
  run: () => RuntimeDocumentService.useSync((service) => service.readDocument())
});
const RegistryReadDocumentRpc = Server.fn<void, string, never, RuntimeDocumentService>("RuntimeDocument.registryRpc", {
  handler: () => RuntimeDocumentService.useSync((service) => service.readDocument())
});
const startRegistryMissingApp = defineApp({
  routes: [] as const,
  client: {},
  registry: {
    actions: new Map([["RuntimeDocument.registryAction", RegistryReadDocumentAction]]),
    serverFunctions: new Map([["RuntimeDocument.registryRpc", RegistryReadDocumentRpc]])
  }
});
const startRegistryMissingHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RuntimeDocumentService
> = createRequestHandlerEffect(startRegistryMissingApp)(
  new Request("https://example.com/__effect-ui/rpc")
);
const startRegistryProvidedApp = defineApp({
  routes: [] as const,
  client: {},
  server: typedRuntime,
  registry: {
    actions: new Map([["RuntimeDocument.registryAction", RegistryReadDocumentAction]]),
    serverFunctions: new Map([["RuntimeDocument.registryRpc", RegistryReadDocumentRpc]])
  }
});
const startRegistryProvidedHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope
> = createRequestHandlerEffect(startRegistryProvidedApp)(
  new Request("https://example.com/__effect-ui/rpc")
);
const startOptionsActionHandlerEffect: Effect.Effect<
  Response,
  StartRequestHandlerError,
  Scope.Scope | RuntimeDocumentService
> = createRequestHandlerEffect(
  defineApp({
    routes: [] as const,
    client: {}
  }),
  { actions: [RegistryReadDocumentAction] }
)(new Request("https://example.com/__effect-ui/action"));
void serviceRoutePreloadRequirements;
void serviceRoutePreload;
void serviceRoutePreloadPlan;
void serviceRouteNavigationPlan;
void routePreloadMissingStartEffect;
void routePreloadMissingStartHandlerEffect;
void routePreloadMissingFetchAdapterEffect;
void routePreloadMissingSubpathFetchAdapterEffect;
void routePreloadMissingNodeAdapterEffect;
void erasedRoutePreloadFetchHandler;
void erasedRoutePreloadNodeHandler;
void routePreloadProvidedStartEffect;
void routePreloadProvidedStartHandlerEffect;
void routePreloadFetchFacade;
void routePreloadNodeFacade;
void startRegistryMissingHandlerEffect;
void startRegistryProvidedHandlerEffect;
void startOptionsActionHandlerEffect;

const TouchProject = Action.define<{ readonly id: string }, Project>({
  name: "Project.touch",
  optimistic: ({ id }, transaction) =>
    Effect.gen(function* () {
      const label = Signal.make("idle");
      yield* transaction.signal(label, id);
      // @ts-expect-error optimistic patches must match the target signal value type
      yield* transaction.signal(label, 123);
      return Effect.void;
    }),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })]
});

Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" });
Action.planInvalidationEffect(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }).pipe(
  Effect.map((plan) => plan.targets.length)
);
const touch = Action.use(TouchProject);
touch.invalidationPlan.get()?.entries.map((entry) => entry.ref.key);
const PureServicefulInvalidationAction = Action.define({
  name: "Project.pureServicefulInvalidation",
  run: (input: { readonly id: string }) => ({ id: input.id, name: "Touched" }),
  invalidates: (_project, input) => [ServicefulProjectResource(input.id)]
});
const pureServicefulInvalidationSubmit: Effect.Effect<
  Project,
  EffectInputCallbackError | ActionInterrupted,
  ProjectApi
> = Action.use(PureServicefulInvalidationAction).submitEffect({ id: "atlas" });
// @ts-expect-error action invalidation requirements from serviceful Resources stay visible
const pureServicefulInvalidationSubmitErased: Effect.Effect<Project> =
  Action.use(PureServicefulInvalidationAction).submitEffect({ id: "atlas" });
const pureServicefulInvalidationPlan = Action.planInvalidation(
  PureServicefulInvalidationAction,
  { id: "atlas", name: "Atlas" },
  { id: "atlas" }
);
const pureServicefulInvalidationPlanRun: Effect.Effect<void, never, ProjectApi> =
  Resource.runInvalidationPlanEffect(pureServicefulInvalidationPlan);
const ResultServicefulInvalidationAction = Action.define({
  name: "Project.resultServicefulInvalidation",
  run: (input: { readonly id: string }) =>
    ActionResult.success(
      { id: input.id, name: "Touched" },
      { invalidates: [ServicefulProjectResource(input.id)] }
    )
});
const resultServicefulInvalidationSubmit: Effect.Effect<
  unknown,
  EffectInputCallbackError | ActionInterrupted,
  ProjectApi
> = Action.use(ResultServicefulInvalidationAction).submitEffect({ id: "atlas" });
// @ts-expect-error ActionResult invalidation requirements stay visible through Action.use
const resultServicefulInvalidationSubmitErased: Effect.Effect<unknown> =
  Action.use(ResultServicefulInvalidationAction).submitEffect({ id: "atlas" });
const resultWithServicefulInvalidation = ActionResult.withInvalidation(
  ActionResult.success({ id: "atlas", name: "Atlas" }),
  [ServicefulProjectResource("atlas")]
);
const resultWithServicefulInvalidationRequirement: ActionResultInvalidationRequirements<
  typeof resultWithServicefulInvalidation
> = {} as ProjectApi;
const fieldErrorWithServicefulInvalidation = ActionResult.fieldError<
  { readonly id: string },
  "id",
  string,
  ProjectApi
>("id", "Required", {
  invalidates: [ServicefulProjectResource("atlas")]
});
const fieldErrorWithServicefulInvalidationRequirement: ActionResultInvalidationRequirements<
  typeof fieldErrorWithServicefulInvalidation
> = {} as ProjectApi;
Effect.map(
  ActionResult.successEffect({ id: "atlas", name: "Atlas" }, {
    invalidates: [ServicefulProjectResource("atlas")]
  }),
  (result) => {
    const requirement: ActionResultInvalidationRequirements<typeof result> =
      {} as ProjectApi;
    return requirement;
  }
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
  run: () => RuntimeDocumentService.useSync((service) => service.readDocument())
});
const readDocumentAction = Action.use(ReadDocumentAction);
const readDocumentActionSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted,
  RuntimeDocumentService
> = readDocumentAction.submitEffect(undefined);
const readDocumentRuntimeAction = Action.use(ReadDocumentAction, { runtime: typedRuntime });
const readDocumentRuntimeActionSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted
> = readDocumentRuntimeAction.submitEffect(undefined);
const readDocumentRuntimeActionDefinitionRun: EffectInput<
  string,
  never,
  RuntimeDocumentService
> = readDocumentRuntimeAction.definition.run(undefined);
const ReadDocumentAndMissingAction = Action.define<void, string, never, RuntimeDocumentService | RuntimeMissingService>({
  name: "RuntimeDocument.readAndMissingAction",
  run: () =>
    Effect.zipWith(
      RuntimeDocumentService.useSync((service) => service.readDocument()),
      RuntimeMissingService.useSync((service) => service.readMissing()),
      (document, missing) => `${document}:${missing}`
    )
});
const readDocumentAndMissingRuntimeAction = Action.use(ReadDocumentAndMissingAction, { runtime: typedRuntime });
const readDocumentAndMissingRuntimeActionSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted,
  RuntimeMissingService
> = readDocumentAndMissingRuntimeAction.submitEffect(undefined);
// @ts-expect-error runtime-bound actions still preserve services not supplied by the runtime
const readDocumentAndMissingRuntimeActionSubmitErased: Effect.Effect<string> =
  readDocumentAndMissingRuntimeAction.submitEffect(undefined);
interface RuntimeStartupError {
  readonly _tag: "RuntimeStartupError";
}
declare const runtimeWithStartupError: EffectUiRuntime<RuntimeDocumentService, RuntimeStartupError>;
const readDocumentRuntimeErrorAction = Action.use(ReadDocumentAction, {
  runtime: runtimeWithStartupError
});
const readDocumentRuntimeErrorSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted | RuntimeStartupError
> = readDocumentRuntimeErrorAction.submitEffect(undefined);
const solidReadDocumentAction = useAction(ReadDocumentAction);
const solidReadDocumentActionSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted
> = solidReadDocumentAction.submitEffect(undefined);
const solidReadDocumentRuntimeErrorAction = useAction<
  void,
  string,
  never,
  RuntimeDocumentService,
  RuntimeStartupError
>(ReadDocumentAction);
const solidReadDocumentRuntimeErrorSubmit: Effect.Effect<
  string,
  EffectInputCallbackError | ActionInterrupted | RuntimeStartupError
> = solidReadDocumentRuntimeErrorAction.submitEffect(undefined);
void readDocumentActionSubmit;
void readDocumentRuntimeActionSubmit;
void readDocumentRuntimeActionDefinitionRun;
void readDocumentRuntimeErrorSubmit;
void solidReadDocumentActionSubmit;
void solidReadDocumentRuntimeErrorSubmit;
const solidTouchProject = useAction(TouchProject);
solidTouchProject.submitEffect({ id: "atlas" }).pipe(
  Effect.map((project) => project.name.toUpperCase())
);
// @ts-expect-error Solid action hook preserves action input type
solidTouchProject.submitEffect({ slug: "atlas" });

const InferredTouchProject = Action.define({
  name: "Project.inferredTouch",
  input: Schema.Struct({ id: Schema.String, name: Schema.String }),
  output: ProjectSchema,
  optimistic: ({ id }, transaction) =>
    Effect.gen(function* () {
      const label = Signal.make("idle");
      yield* transaction.signal(label, id);
      return Effect.void;
    }),
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project, input) => [
    ProjectTag({ id: project.id }),
    ProjectTag({ id: input.id })
  ]
});
const inferredTouch = Action.use(InferredTouchProject);
const inferredTouchSubmit: Effect.Effect<
  Project,
  ProjectError | Server.ClientError | EffectInputCallbackError | ActionInterrupted,
  ProjectApi
> = inferredTouch.submitEffect({ id: "atlas", name: "Atlas" });
void inferredTouchSubmit;

// @ts-expect-error inferred actions preserve schema input
inferredTouch.submitEffect({ id: "atlas" });

const TouchProjectWithResultInvalidation = Action.define<{ readonly id: string }, ActionResult<Project>>({
  name: "Project.touchResult",
  run: ({ id }) =>
    Effect.succeed(
      ActionResult.success(
        { id, name: "Touched" },
        { invalidates: [ProjectsTag, ProjectTag({ id })] }
      )
    )
});

Action.planInvalidation(
  TouchProjectWithResultInvalidation,
  ActionResult.success(
    { id: "atlas", name: "Atlas" },
    { invalidates: [ProjectTag({ id: "atlas" })] }
  ),
  { id: "atlas" }
);

submitStartActionEffect(TouchProject, { id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
    result.hydration?.resources.map((resource) => resource.key.toUpperCase());
    result.invalidation?.entries.map((entry) => entry.ref.family.toUpperCase());
  })
);
interface StartTransportEnv {
  readonly token: string;
}
declare const authenticatedStartFetch: StartFetch<never, StartTransportEnv>;
declare const startTransportRuntime: EffectUiRuntime<StartTransportEnv, never>;
const startActionTransportRequirementsEffect: Effect.Effect<
  StartAction.Result<typeof TouchProject>,
  Server.ClientError,
  StartTransportEnv
> = submitStartActionEffect(TouchProject, { id: "atlas" }, {
  fetch: authenticatedStartFetch
});
const startActionRuntimeProvidedEffect: Effect.Effect<
  StartAction.Result<typeof TouchProject>,
  Server.ClientError
> = submitStartActionEffect(TouchProject, { id: "atlas" }, {
  fetch: authenticatedStartFetch,
  transportRuntime: startTransportRuntime
});
const startActionHydrationRuntimeProvidedEffect: Effect.Effect<
  StartAction.Result<typeof TouchProject>,
  Server.ClientError
> = submitStartActionEffect(TouchProject, { id: "atlas" }, {
  fetch: authenticatedStartFetch,
  runtime: startTransportRuntime
});
const startActionWithServicefulTransport = StartAction.use(TouchProject, {
  fetch: authenticatedStartFetch
});
const startActionWithServicefulTransportSubmit: Effect.Effect<
  StartAction.Result<typeof TouchProject>,
  Server.ClientError | ActionInterrupted,
  StartTransportEnv
> = startActionWithServicefulTransport.submitEffect({ id: "atlas" });
const startActionWithProvidedTransport = StartAction.use(TouchProject, {
  fetch: authenticatedStartFetch,
  transportRuntime: startTransportRuntime,
  actionManifest: { actionPath: "/custom/action" }
});
const startActionWithProvidedTransportSubmit: Effect.Effect<
  StartAction.Result<typeof TouchProject>,
  Server.ClientError | ActionInterrupted
> = startActionWithProvidedTransport.submitEffect({ id: "atlas" });
// @ts-expect-error RPC ServerClient cannot hide a serviceful fetch without a transport runtime
makeRpcClient({ fetch: authenticatedStartFetch });
makeRpcClient({ fetch: authenticatedStartFetch, transportRuntime: startTransportRuntime });
makeRpcClient({
  fetch: authenticatedStartFetch,
  transportRuntime: startTransportRuntime,
  serverFunctionManifest: { rpcPath: "/custom/rpc" }
});
// @ts-expect-error RPC ServerClient layers cannot hide a serviceful fetch without a transport runtime
makeRpcClientLayer({ fetch: authenticatedStartFetch });
makeRpcClientLayer({ fetch: authenticatedStartFetch, transportRuntime: startTransportRuntime });
void startActionTransportRequirementsEffect;
void startActionRuntimeProvidedEffect;
void startActionHydrationRuntimeProvidedEffect;
void startActionWithServicefulTransportSubmit;
void startActionWithProvidedTransportSubmit;

// @ts-expect-error Start action submissions require the action input shape
submitStartActionEffect(TouchProject, { slug: "atlas" });

// @ts-expect-error Start action submissions reject wrong input value types
submitStartActionEffect(TouchProject, { id: 123 });

submitStartActionEffect(TouchProjectWithResultInvalidation, { id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
  })
);

const touchStart = StartAction.use(TouchProject);
touchStart.state.get()._tag;
touchStart.invalidation.get()?.entries.map((entry) => entry.ref.key.toUpperCase());
touchStart.hydration.get()?.resources.map((resource) => resource.key.toUpperCase());
touchStart.submitEffect({ id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
  })
);

// @ts-expect-error StartAction client instances preserve action input fields
touchStart.submitEffect({ slug: "atlas" });

startActionForm(TouchProject, {
  actionManifest: { actionPath: "/custom/action" },
  input: { id: "atlas" }
});

startActionForm(TouchProject, {
  // @ts-expect-error progressive action form defaults must match known action input fields
  input: { slug: "atlas" }
});

startActionForm(TouchProject, {
  // @ts-expect-error progressive action form defaults must match action input value types
  input: { id: 123 }
});

StartAction.form(TouchProject, {
  actionPath: "/custom/action",
  input: { id: "atlas" }
});

const touchStartActionForm: StartAction.Form<typeof TouchProject> = StartAction.form(TouchProject);
void touchStartActionForm;

StartAction.form(TouchProject, {
  // @ts-expect-error namespaced progressive action form defaults must match known action input fields
  input: { slug: "atlas" }
});

StartAction.form(TouchProject, {
  // @ts-expect-error namespaced progressive action form defaults must match action input value types
  input: { id: 123 }
});

const devtoolsStore: DevtoolsStore = makeDevtoolsStore();
const devtoolsProgramEvent: DevtoolsProgramEvent = projectProgramTimeline[0]!;
const devtoolsTrackProgramEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackProgramEffect(projectProgram);
declare const dbCollectionStoreEvent: Collection.StoreEvent;
declare const startRuntimeRequestTrace: StartRequestTrace;
const devtoolsRuntimeRequestTrace: DevtoolsRequestTrace = startRuntimeRequestTrace;
const devtoolsResourceRuntimeEvent: DevtoolsRuntimeEvent = {
  _tag: "ResourceStoreEvent",
  sequence: 1,
  event: {
    _tag: "ResourcePending",
    name: "Project.byId",
    key: "atlas",
    force: false,
    previous: false
  }
};
const devtoolsCollectionRuntimeEvent: DevtoolsRuntimeEvent = {
  _tag: "CollectionStoreEvent",
  event: dbCollectionStoreEvent
};
const devtoolsProgramRuntimeEvent: DevtoolsRuntimeEvent = {
  _tag: "ProgramEvent",
  event: devtoolsProgramEvent
};
const devtoolsRequestRuntimeEvent: DevtoolsRuntimeEvent = {
  _tag: "RequestTrace",
  trace: devtoolsRuntimeRequestTrace
};
const devtoolsRuntimeEvents: ReadonlyArray<DevtoolsRuntimeEvent> = [
  devtoolsResourceRuntimeEvent,
  devtoolsCollectionRuntimeEvent,
  devtoolsProgramRuntimeEvent,
  devtoolsRequestRuntimeEvent
];
const devtoolsRuntimeSnapshot: DevtoolsSnapshot = {
  resources: [],
  actions: [],
  invalidations: [],
  routePlans: [],
  events: devtoolsRuntimeEvents
};
devtoolsStore.recordRuntimeEvent(devtoolsResourceRuntimeEvent);
declare const startAppGraphDiagnostics: StartAppGraphDiagnostics;
const devtoolsStartAppGraphDiagnosticsFromStart: DevtoolsStartAppGraphDiagnostics = startAppGraphDiagnostics;
const devtoolsLoadedStartAppGraphDiagnostics: DevtoolsStartAppGraphDiagnostics = loadedStartDiagnostics.diagnostics;
const normalizedDevtoolsStartAppGraphDiagnostics: DevtoolsStartAppGraphDiagnostics =
  normalizeDevtoolsAppGraphDiagnostics(loadedStartDiagnostics.diagnostics);
const normalizedRouteModulePreloadCollections: DevtoolsStartAppGraphRoutePreloadCollections =
  normalizeRouteModulePreloadCollections(loadedStartDiagnostics.diagnostics.routeModules[0]!);
const normalizedAppGraphCollectionDefinitions: readonly DevtoolsStartAppGraphCollectionDiagnostics[] =
  normalizeAppGraphCollectionDefinitions(loadedStartDiagnostics.diagnostics);
const normalizedUnknownRoutePreloadCollections: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =
  normalizeAppGraphUnknownRoutePreloadCollections(loadedStartDiagnostics.diagnostics);
const devtoolsStartAppGraphSummary: DevtoolsSummary = describeDevtoolsSummary({
  appGraph: loadedStartDiagnostics.diagnostics
});
const devtoolsStartAppGraphPanels: DevtoolsPanels = describeDevtoolsPanels({
  appGraph: loadedStartDiagnostics.diagnostics
});
devtoolsStore.setAppGraphDiagnostics(loadedStartDiagnostics.diagnostics);
const devtoolsSetStartAppGraphDiagnosticsEffect: Effect.Effect<void> =
  devtoolsStore.setAppGraphDiagnosticsEffect(loadedStartDiagnostics.diagnostics);
const devtoolsCollectionStoreEvent: DevtoolsCollectionStoreEvent = dbCollectionStoreEvent;
devtoolsStore.recordCollectionEvent(devtoolsCollectionStoreEvent);
const serializedInvalidationPlan: DevtoolsInvalidationPlan = {
  targets: [
    {
      _tag: "Tag",
      key: "Project:atlas",
      name: "Project"
    }
  ],
  entries: [
    {
      ref: {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: "atlas"
      },
      causes: [
        {
          _tag: "Tag",
          key: "Project:atlas",
          name: "Project"
        }
      ]
    }
  ]
};
const startInvalidationPlan: StartActionInvalidationPlan = serializedInvalidationPlan;
const devtoolsInvalidationPlanFromStart: DevtoolsInvalidationPlan = startInvalidationPlan;
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan: startInvalidationPlan
});
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan: touchStart.invalidation.get()
});
devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" })
});
const devtoolsStartInvalidationIndex: number =
  devtoolsStore.recordSerializedInvalidation(devtoolsInvalidationPlanFromStart);
const devtoolsSerializedInvalidationIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedInvalidationEffect(startInvalidationPlan);
devtoolsStore.recordActionStateEffect("Project.touch", "Success", {
  serializedInvalidationPlan: startInvalidationPlan
});
devtoolsStore.recordStartAction(touchStart);
devtoolsStore.recordStartActionEffect(touchStart);
const devtoolsTrackStartActionEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackStartActionEffect(touchStart);

devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }),
  // @ts-expect-error devtools action state accepts either live or serialized invalidation plans, not both
  serializedInvalidationPlan
});
void devtoolsRuntimeSnapshot;
void devtoolsTrackProgramEffect;
void devtoolsStartAppGraphDiagnosticsFromStart;
void devtoolsLoadedStartAppGraphDiagnostics;
void normalizedDevtoolsStartAppGraphDiagnostics;
void normalizedRouteModulePreloadCollections;
void normalizedAppGraphCollectionDefinitions;
void normalizedUnknownRoutePreloadCollections;
void devtoolsStartAppGraphSummary;
void devtoolsStartAppGraphPanels;
void devtoolsSetStartAppGraphDiagnosticsEffect;
void devtoolsStartInvalidationIndex;
void devtoolsSerializedInvalidationIndexEffect;
void devtoolsTrackStartActionEffect;

// @ts-expect-error invalidation planning value must match the action output type
Action.planInvalidation(TouchProject, { id: "atlas" }, { id: "atlas" });

// @ts-expect-error invalidation planning input must match the action input type
Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { slug: "atlas" });

Action.define<{ readonly id: string }, Project>({
  name: "Project.badAction",
  // @ts-expect-error action output must satisfy the action success type
  run: ({ id }) => ({ id })
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.asyncAction",
  // @ts-expect-error actions must return Effect or a pure value, not Promise
  run: () => promisedProject
});

Action.define({
  name: "Project.asyncAction.inferred",
  // @ts-expect-error unannotated actions must return Effect or a pure value, not Promise
  run: () => promisedProject
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticInput",
  // @ts-expect-error optimistic input comes from the action input type
  optimistic: (input: { readonly slug: string }) => Effect.succeed(Effect.void),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" })
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticRollback",
  // @ts-expect-error optimistic must return a rollback Effect
  optimistic: ({ id }) => Effect.succeed(id),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" })
});

const ProjectFormSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  spend: Schema.Number
});
type ProjectFormValues = typeof ProjectFormSchema.Type;

ActionResult.fieldError<ProjectFormValues, "name", string>("name", "Required");
ActionResult.fields<ProjectFormValues, string>({
  spend: ["Must be positive"]
});
// @ts-expect-error validation field errors must target known form fields
ActionResult.fieldError<ProjectFormValues, "missing", string>("missing", "Required");
ActionResult.fields<ProjectFormValues, string>({
  // @ts-expect-error validation field maps reject unknown form fields
  missing: ["Required"]
});

const projectForm = Form.make({
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 }
});

Form.make({
  schema: ProjectFormSchema,
  // @ts-expect-error initial values must satisfy the schema type
  initial: { id: "atlas", name: "Atlas Billing", spend: "1200" }
});

Form.make({
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  // @ts-expect-error form validation must return Effect or a pure value, not Promise
  validate: () => promisedVoid
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
  tags: Schema.Array(Schema.String)
});
type ProjectFormDataValues = typeof ProjectFormDataSchema.Type;
const browserFormData = new FormData();
browserFormData.append("tags", "billing");
browserFormData.append("tags", "core");
Form.data(browserFormData, { omitFields: ["__effect_ui_action"] }).tags;
const projectFormDataDecode: Effect.Effect<
  ProjectFormDataValues,
  Form.ValidationError<ProjectFormDataValues, Schema.SchemaError>
> = Form.decodeFormDataEffect(ProjectFormDataSchema, browserFormData, {
  omitFields: new Set(["__effect_ui_action"])
});
void projectFormDataDecode;
