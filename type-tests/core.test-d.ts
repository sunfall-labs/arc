import { Context, Effect, Schema, Stream } from "effect";
import {
  Action,
  ActionResult,
  Capability,
  Form,
  Program,
  RequestContext,
  Resource,
  ResourceSnapshotCodecError,
  ResponseContext,
  Route,
  Server,
  Signal,
  UiScope,
  applyResponseContext,
  applyResponseContextEffect,
  browserRouteRenderDecision,
  browserRouteRenderKey,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  buildRoutePath,
  compareRoutePathSegment,
  compareRoutePathSpecificity,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  defineApp,
  forkScoped,
  hrefForRouteInput,
  isPlainLeftClick,
  isRouteParamName,
  isRoutePathSegmentPrefix,
  makeRequestContext,
  makeRequestContextEffect,
  makeResponseContext,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  makeResourceStore,
  makeBrowserRouterLinkPreloader,
  makeRuntime,
  makeRuntimeUiScope,
  matchRoutePath,
  onDispose,
  onScopeDispose,
  opensOutsideRouter,
  parseRoutePathSegments,
  parseRouteUrl,
  provideRequest,
  provideResponse,
  resourceUiMatchState,
  route,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  scoped,
  serializeResponseCookie,
  serializeResponseCookieEffect,
  withResourceStore,
  type ActionResultBoundary,
  type ActionResultFailure,
  type ActionResultRedirect,
  type ActionResultSuccess,
  type ActionResultValidationFailure,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type BrowserRouteRenderDecision,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
  type BrowserRouterHostController,
  type BrowserRouterLinkClickDecision,
  type BrowserRouterLinkPreloader,
  type BrowserRouterLinkPreloadIdentity,
  type BrowserRouterLinkPreloaderOptions,
  type BrowserRouterLinkPreloaderRuntime,
  type BrowserRouterLinkPreloadDecision,
  type ActionSubmissionState,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type FormInstance,
  type ParamsForPath,
  type MemoryBrowserHistoryAdapter,
  type ResourceSnapshotCodecOperation,
  type ResourceUiAutoPreloadOptions,
  type ResourceUiBindingController,
  type ResourceUiBindingControllerOptions,
  type ResourceUiMatch,
  type ResourceUiPreloadFailure,
  type ResourceUiSuspensePreloadController,
  type ResourceUiSuspensePreloadFiber,
  type ResourceUiSuspensePreloadOptions
} from "@effect-ui/core";

const runtime = makeRuntime();
const requestRuntime = withResourceStore(runtime, makeResourceStore());
const coreRoutes = [route("/projects/:id", {})] as const;
declare const browserRouterKernelRuntime: AnyEffectUiRuntime<never>;
const browserRouterKernelOptions: BrowserRouterKernelOptions<typeof coreRoutes, never> = {
  runtime: browserRouterKernelRuntime,
  initialHref: "/projects/atlas"
};
const browserRouterKernel = createBrowserRouterKernel(coreRoutes, browserRouterKernelOptions);
const memoryHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/projects" });
const windowHistory = makeWindowBrowserHistoryAdapter();
const browserHistory: BrowserHistoryAdapter = memoryHistory;
const navigateOptions: BrowserNavigateOptions = { replace: true };
const historyWindow: BrowserHistoryWindow = {
  location: {
    pathname: "/projects",
    search: "?active=true"
  },
  history: {
    pushState: () => undefined,
    replaceState: () => undefined
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};
const coreExports: Array<unknown> = [
  Action,
  ActionResult,
  Capability,
  Form,
  Program,
  RequestContext,
  Resource,
  ResourceSnapshotCodecError,
  ResponseContext,
  Route,
  Server,
  Signal,
  UiScope,
  applyResponseContext,
  applyResponseContextEffect,
  browserRouteRenderDecision,
  browserRouteRenderKey,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  buildRoutePath,
  compareRoutePathSegment,
  compareRoutePathSpecificity,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  defineApp,
  forkScoped,
  hrefForRouteInput,
  isPlainLeftClick,
  isRouteParamName,
  isRoutePathSegmentPrefix,
  makeRequestContext,
  makeRequestContextEffect,
  makeResponseContext,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  route,
  makeRuntimeUiScope,
  matchRoutePath,
  onDispose,
  onScopeDispose,
  opensOutsideRouter,
  parseRoutePathSegments,
  parseRouteUrl,
  provideRequest,
  provideResponse,
  coreRoutes,
  browserRouterKernelRuntime,
  browserRouterKernel,
  browserRouterKernelOptions,
  memoryHistory,
  windowHistory,
  browserHistory,
  navigateOptions,
  historyWindow,
  runtime,
  requestRuntime,
  resourceUiMatchState,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  scoped,
  serializeResponseCookie,
  serializeResponseCookieEffect
];
const actionPendingWithUndefinedPrevious: ActionSubmissionState<string, void, string> = {
  _tag: "Pending",
  input: "publish",
  previous: undefined,
  hasPrevious: true
};
const actionFailureWithUndefinedPrevious: ActionSubmissionState<string, void, string> = {
  _tag: "Failure",
  input: "publish",
  error: "failed",
  previous: undefined,
  hasPrevious: true
};
const resourceUiMatchCases: ResourceUiMatch<void, string, string> = {
  initial: () => "initial",
  pending: (previous, meta) => `${String(previous)}:${String(meta.hasPrevious)}`,
  success: (value, meta) => `${String(value)}:${meta.state._tag}`,
  failure: (error, previous, meta) => `${error}:${String(previous)}:${String(meta.hasPrevious)}`
};
const matchedResourceState = resourceUiMatchState<void, string, string>({
  _tag: "Pending",
  waiting: true,
  previous: undefined
}, resourceUiMatchCases);
const typeTestResource = Resource.family<string, string, string>({
  name: "type-tests/core-resource-ui",
  load: (id) => Effect.succeed(id)
});
const typeTestResourceRef = typeTestResource("atlas");
const resourceUiBindingControllerOptions: ResourceUiBindingControllerOptions<string, string, string, never, never> = {
  runtime: browserRouterKernelRuntime,
  onPreloadFailureChange: () => undefined
};
const resourceUiBindingController: ResourceUiBindingController<string, string, string, never, never> =
  makeResourceUiBindingController(resourceUiBindingControllerOptions);
const resourceUiAutoPreloadOptions: ResourceUiAutoPreloadOptions<string, never> = {
  preload: true,
  onPreloadFailure: () => undefined
};
const resourceUiPreloadFailure: ResourceUiPreloadFailure<string, string, string, never, never> = {
  ref: typeTestResourceRef,
  error: "failed"
};
const resourceUiSuspensePreloadController: ResourceUiSuspensePreloadController<
  string,
  string,
  string,
  never,
  never,
  ResourceUiSuspensePreloadFiber<string, string, never>
> = makeResourceUiSuspensePreloadController(browserRouterKernelRuntime);
const resourceUiSuspensePreloadOptions: ResourceUiSuspensePreloadOptions<
  string,
  string,
  string,
  never,
  never,
  ResourceUiSuspensePreloadFiber<string, string, never>
> = {
  toHostToken: (fiber) => fiber
};
const resourceUiSuspensePreloadFiber =
  resourceUiSuspensePreloadController.hostToken(typeTestResourceRef, resourceUiSuspensePreloadOptions);
type RuntimeShape = EffectUiRuntime;
type AnyRuntimeShape = AnyEffectUiRuntime;
type RouterKernelShape = BrowserRouterKernel<typeof coreRoutes>;
type RouterKernelOptionsShape = BrowserRouterKernelOptions<typeof coreRoutes, never>;
type RouterHostShape = BrowserRouterHostController;
type BrowserHistoryShape = BrowserHistoryAdapter;
type MemoryHistoryShape = MemoryBrowserHistoryAdapter;
type BrowserHistoryWindowShape = BrowserHistoryWindow;
type BrowserNavigateOptionsShape = BrowserNavigateOptions;

const actionSuccess: ActionResultSuccess<number> = ActionResult.success(1);
const actionFailure: ActionResultFailure<"failed"> = ActionResult.failure("failed");
const actionRedirect: ActionResultRedirect = ActionResult.redirect("/login", { replace: true });
const actionValidation: ActionResultValidationFailure<{ readonly name: string }, "required"> =
  ActionResult.fieldError("name", "required");
const actionBoundary: ActionResultBoundary<{ readonly name: string }, "required", "failed"> =
  actionValidation;
const actionResultLabel: string = ActionResult.match(actionSuccess, {
  success: (value) => String(value),
  validation: () => "validation",
  redirect: () => "redirect",
  failure: () => "failure"
});

const appDefinition = defineApp({
  routes: coreRoutes,
  client: () => null,
  server: runtime
});

const profileSchema = Schema.Struct({ name: Schema.String });
const profileForm: FormInstance<{ readonly name: string }, "required"> = Form.make({
  schema: profileSchema,
  initial: { name: "" },
  validate: (values, errors) =>
    values.name.length === 0
      ? Effect.fail(errors.field("name", "required"))
      : Effect.void
});
const profileValidationEffect = Form.validateEffect(profileForm);
const profileFormData = Form.data(new FormData());

type CounterMessage = "increment" | "decrement";
const counterProgram = Program.define({
  initial: 0,
  update: (model: number, message: CounterMessage) =>
    Program.next<number, CounterMessage>(message === "increment" ? model + 1 : model - 1)
});
const counterStep = Program.next(1, Program.commands(Program.dispatch<CounterMessage>("increment")));
const counterCommand = Program.effect<CounterMessage>(Effect.void);
const counterSubscription = Program.subscription(Stream.empty as Stream.Stream<CounterMessage>);
const counterStory = Program.story(counterProgram);

const uiScope = new UiScope();
const runtimeUiScope = makeRuntimeUiScope(browserRouterKernelRuntime);
const scopedValue = scoped(() => "scoped");
onScopeDispose(() => Effect.void);
onDispose(() => undefined);

const request = new Request("https://effect-ui.test/projects/atlas?tab=overview");
const requestContext = makeRequestContext(request);
const requestContextEffect = makeRequestContextEffect(request);
const responseContext = makeResponseContext();
const appliedResponse = applyResponseContext(responseContext, new Response("ok"));
const appliedResponseEffect = applyResponseContextEffect(responseContext, appliedResponse);
const providedRequest = provideRequest(request)(Effect.succeed("ok"));
const providedResponse = provideResponse(responseContext)(Effect.succeed("ok"));
const cookieHeader = serializeResponseCookie("theme", "dark", { sameSite: "Lax" });
const cookieHeaderEffect = serializeResponseCookieEffect("theme", "dark");

const codecOperation: ResourceSnapshotCodecOperation = "decode";
const codecError = new ResourceSnapshotCodecError({
  operation: codecOperation,
  path: "$.resources[0]",
  reason: "Expected a Resource hydration snapshot"
});

const routeSegments = parseRoutePathSegments("/projects/:id/:tab?");
const firstRouteSegment = routeSegments[0]!;
const routePath = routePathFromSegments(routeSegments);
const routeParams = routeParamsFromSegments(routeSegments);
const routeSlug = routePathSlug("/projects/:id/:tab?");
const routeParamNameOk = isRouteParamName("id");
const routeSegmentComparison = compareRoutePathSegment(routeSegments[0], routeSegments[1]);
const routeSpecificityComparison = compareRoutePathSpecificity(routeSegments, parseRoutePathSegments("/projects/settings"));
const routeSegmentsMatch = routePathSegmentsEqual(firstRouteSegment, firstRouteSegment);
const routePrefix = isRoutePathSegmentPrefix(routeSegments.slice(0, 1), routeSegments);
const routeMatch = matchRoutePath("/projects/:id", "/projects/atlas");
const builtRoutePath = buildRoutePath("/projects/:id/:tab?", { id: "atlas" });
const parsedRouteUrl = parseRouteUrl("/projects/atlas?tab=overview");
const routeHref = hrefForRouteInput(parsedRouteUrl);

type ProjectRouteParams = ParamsForPath<"/projects/:id/:tab?">;
const projectRouteParams: ProjectRouteParams = { id: "atlas" };

const readyState = {
  _tag: "Ready",
  href: "/projects/atlas",
  match: coreRoutes[0].match("/projects/atlas")!
} as const;
const renderKey = browserRouteRenderKey(readyState);
const renderDecision: BrowserRouteRenderDecision<typeof coreRoutes, never> =
  browserRouteRenderDecision(readyState);
const preloadDecision: BrowserRouterLinkPreloadDecision = browserRouterLinkPreloadDecision({
  defaultPrevented: false,
  preload: true,
  canHandleRoute: true
});
interface CoreLinkPreloadApi {
  readonly warm: () => void;
}
const CoreLinkPreloadApi = Context.Service<CoreLinkPreloadApi>("CoreLinkPreloadApi");
const coreLinkPreloader = makeBrowserRouterLinkPreloader({
  runtime,
  enabled: () => true,
  preloadEffect: () => Effect.void
});
const coreLinkPreloaderShape: BrowserRouterLinkPreloader = coreLinkPreloader;
const coreLinkPreloadIdentity: BrowserRouterLinkPreloadIdentity = {
  key: "/projects/atlas\u0000true\u0000true\u0000\u0000",
  enabled: true
};
coreLinkPreloaderShape.bindPreloadIdentity(coreLinkPreloadIdentity);
const coreLinkPreloaderRuntime: BrowserRouterLinkPreloaderRuntime = runtime;
const coreLinkPreloaderOptions: BrowserRouterLinkPreloaderOptions = {
  runtime: coreLinkPreloaderRuntime,
  enabled: () => true,
  preloadEffect: () => Effect.void
};
makeBrowserRouterLinkPreloader({
  runtime,
  enabled: () => true,
  // @ts-expect-error router link preloads must be provided before reaching the Core preloader
  preloadEffect: () => CoreLinkPreloadApi.useSync((service) => service.warm())
});
const clickDecision: BrowserRouterLinkClickDecision = browserRouterLinkClickDecision({
  event: {
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false
  },
  href: "/projects/atlas",
  canHandleRoute: true
});

void coreExports;
void actionPendingWithUndefinedPrevious;
void actionFailureWithUndefinedPrevious;
void matchedResourceState;
void typeTestResourceRef;
void resourceUiBindingController;
void resourceUiAutoPreloadOptions;
void resourceUiPreloadFailure;
void resourceUiSuspensePreloadFiber;
void actionFailure;
void actionRedirect;
void actionBoundary;
void actionResultLabel;
void appDefinition;
void profileValidationEffect;
void profileFormData;
void counterStep;
void counterCommand;
void counterSubscription;
void counterStory;
void uiScope;
void runtimeUiScope;
void scopedValue;
void requestContext;
void requestContextEffect;
void responseContext;
void appliedResponseEffect;
void providedRequest;
void providedResponse;
void cookieHeader;
void cookieHeaderEffect;
void codecError;
void routePath;
void routeParams;
void routeSlug;
void routeParamNameOk;
void routeSegmentComparison;
void routeSpecificityComparison;
void routeSegmentsMatch;
void routePrefix;
void routeMatch;
void builtRoutePath;
void routeHref;
void projectRouteParams;
void renderKey;
void renderDecision;
void preloadDecision;
void coreLinkPreloader;
void coreLinkPreloaderShape;
void coreLinkPreloaderOptions;
void clickDecision;
type _RuntimeShape = RuntimeShape;
type _AnyRuntimeShape = AnyRuntimeShape;
type _RouterKernelShape = RouterKernelShape;
type _RouterKernelOptionsShape = RouterKernelOptionsShape;
type _RouterHostShape = RouterHostShape;
type _BrowserHistoryShape = BrowserHistoryShape;
type _MemoryHistoryShape = MemoryHistoryShape;
type _BrowserHistoryWindowShape = BrowserHistoryWindowShape;
type _BrowserNavigateOptionsShape = BrowserNavigateOptionsShape;
