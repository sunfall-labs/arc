import { Context, Effect, Schema, Stream } from "effect";
import {
  Action,
  ActionTypeId,
  ActionResult,
  Capability,
  Form,
  Program,
  RequestContext,
  Resource,
  ResourceStoreDisposeError,
  ResourceSnapshotCodecError,
  ResponseContext,
  Route,
  RuntimeDisposeError,
  Server,
  Signal,
  StableStringifyCircularData,
  StableStringifyEncodeFailure,
  StableStringifyInvalidDate,
  StableStringifyUnsupportedValue,
  UnsupportedDuration,
  UiScope,
  applyResponseContext,
  applyResponseContextEffect,
  browserRouteRenderDecision,
  browserRouteActiveRenderer,
  browserRouteRenderIdentity,
  browserRouteRenderKey,
  browserRouterInitialMatchedState,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  buildRoutePath,
  compareRoutePathSegment,
  compareRoutePathSpecificity,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  defineApp,
  disposeRuntimeProviderLifecycleEntryEffect,
  disposeRuntimeProviderLifecycleEffect,
  disposeResourceStoreEffect,
  forkScoped,
  hrefForRouteInput,
  isActionDefinition,
  isPlainLeftClick,
  isPromiseLikeValue,
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
  makeRuntimeProviderLifecycleEntry,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
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
  stableStringify,
  withResourceStore,
  type ActionConcurrency,
  type ActionDefinition,
  type ActionInstance,
  type ActionOptions,
  type ActionPolicy,
  type ActionResultBoundary,
  type ActionResultFailure,
  type ActionResultRedirect,
  type ActionResultSuccess,
  type ActionResultValidationFailure,
  type ActionState,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserRouterInitialMatchedHost,
  type BrowserRouterInitialMatchedStateOptions,
  type BrowserNavigateOptions,
  type BrowserNavigateArgs,
  type BrowserRouteOutletDefaultRenderers,
  type BrowserRouteOutletRenderers,
  type BrowserRouteReadyRenderProps,
  type BrowserRouteRenderDecision,
  type BrowserRouteRenderIdentityInput,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
  type BrowserRouterHostController,
  type BrowserRouterLinkClickDecision,
  type BrowserRouterLinkPreloader,
  type BrowserRouterLinkPreloadIdentity,
  type BrowserRouterLinkPreloadIdentityOptions,
  type BrowserRouterLinkPreloaderOptions,
  type BrowserRouterLinkPreloaderRuntime,
  type BrowserRouterLinkPreloadDecision,
  type ActionSubmissionState,
  type ActionUseOptions,
  type AnyEffectUiRuntime,
  type DisposeRuntimeProviderLifecycleOptions,
  type DurationInput,
  type EffectUiRuntime,
  type FormInstance,
  type ParamsForPath,
  type ResourceInvalidationPlan,
  type ResourceStatus,
  type ResourceTag,
  type ResourceTagDefinition,
  type MemoryBrowserHistoryAdapter,
  type ResourceSnapshotCodecOperation,
  type ResourceHydrationInput,
  type ResourceHydrationPayload,
  type ResourceUiAutoPreloadOptions,
  type ResourceUiBindingController,
  type ResourceUiBindingControllerOptions,
  type ResourceUiMatch,
  type ResourceUiPreloadFailure,
  type ResourceUiSuspensePreloadController,
  type ResourceUiSuspensePreloadFiber,
  type ResourceUiSuspensePreloadOptions,
  type RuntimeProviderDisposeObserver,
  type RuntimeProviderLifecycleEntry,
  type RuntimeProviderLifecycleOptions,
  type RuntimeUiScopeFrame
} from "@effect-ui/core";
// @ts-expect-error ResourceCollector is an internal preload planning service, not a root export.
type ResourceCollectorIsInternal = typeof import("@effect-ui/core").ResourceCollector;
// @ts-expect-error ResourceCollected is exposed as Resource.Collected, not as a root export.
type ResourceCollectedIsNamespaced = import("@effect-ui/core").ResourceCollected;

const runtime = makeRuntime();
const requestRuntime = withResourceStore(runtime, makeResourceStore());
const runtimeDisposeEffect: Effect.Effect<void, RuntimeDisposeError> = runtime.disposeEffect;
const runtimeProviderLifecycleOptions: RuntimeProviderLifecycleOptions = { runtime };
const runtimeProviderLifecycleEntry: RuntimeProviderLifecycleEntry =
  makeRuntimeProviderLifecycleEntry(runtimeProviderLifecycleOptions);
const runtimeProviderDisposeObserver: RuntimeProviderDisposeObserver = () => Effect.void;
const runtimeProviderDisposeOptions: DisposeRuntimeProviderLifecycleOptions = {
  observerOperation: "CoreTypeTestRuntimeProvider.onDisposeFailure",
  onDisposeFailure: runtimeProviderDisposeObserver
};
const runtimeProviderLifecycleDisposeEffect: Effect.Effect<void> =
  disposeRuntimeProviderLifecycleEffect(runtimeProviderLifecycleEntry, runtimeProviderDisposeOptions);
const runtimeProviderLifecycleTypedDisposeEffect: Effect.Effect<void, RuntimeDisposeError> =
  disposeRuntimeProviderLifecycleEntryEffect(runtimeProviderLifecycleEntry);
class CoreAdapterCleanupError {
  readonly _tag = "CoreAdapterCleanupError";
}
requestRuntime.resourceStore.moduleRegistry.register(Symbol("core-adapter-cleanup"), {
  disposeEffect: Effect.fail(new CoreAdapterCleanupError())
});
const requestRuntimeStoreDisposeEffect: Effect.Effect<void, ResourceStoreDisposeError> =
  disposeResourceStoreEffect(requestRuntime.resourceStore);
const coreRoutes = [route("/projects/:id", {})] as const;
declare const browserRouterKernelRuntime: AnyEffectUiRuntime<never>;
const browserRouterKernelOptions: BrowserRouterKernelOptions<typeof coreRoutes, never> = {
  runtime: browserRouterKernelRuntime,
  initialHref: "/projects/atlas"
};
const browserRouterKernel = createBrowserRouterKernel(coreRoutes, browserRouterKernelOptions);
const browserRouterKernelDisposeEffect: Effect.Effect<void> = browserRouterKernel.disposeEffect();
const browserRouterPath: BrowserRouterPath<typeof coreRoutes> = "/projects/:id";
type CoreProjectRoute = BrowserRouterRouteForPath<typeof coreRoutes, "/projects/:id">;
const browserNavigateArgs: BrowserNavigateArgs<CoreProjectRoute> = [{ params: { id: "atlas" } }];
const browserRouterInitialHost: BrowserRouterInitialMatchedHost = "browser";
const browserRouterInitialMatch = coreRoutes[0].match("/projects/atlas");
if (browserRouterInitialMatch) {
  const initialMatchedStateOptions: BrowserRouterInitialMatchedStateOptions<typeof coreRoutes> = {
    href: "/projects/atlas",
    match: browserRouterInitialMatch,
    host: browserRouterInitialHost,
    hydrating: true
  };
  browserRouterInitialMatchedState(initialMatchedStateOptions)._tag;
}
const memoryHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/projects" });
const browserRouterHostController = createBrowserRouterHostController(coreRoutes, {
  runtime: browserRouterKernelRuntime,
  history: memoryHistory
});
const browserRouterHostDisposeEffect: Effect.Effect<void> = browserRouterHostController.disposeEffect();
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
const coreActionConcurrency: ActionConcurrency = "exhaust";
const coreActionPolicy: ActionPolicy<never> = {
  concurrency: coreActionConcurrency
};
const coreActionOptions: ActionOptions<string, string> = {
  name: "type-tests/core-action",
  policy: coreActionPolicy,
  run: (input) => Effect.succeed(input)
};
const coreActionDefinition: ActionDefinition<string, string> = Action.define(coreActionOptions);
const coreActionUseOptions: ActionUseOptions<never, never> = { runtime };
const coreActionInstance: ActionInstance<string, string> =
  Action.use(coreActionDefinition, { runtime });
const coreActionState: ActionState<string, string> = {
  _tag: "Success",
  input: "publish",
  value: "ok"
};
const coreActionDefinitionCheck: boolean = isActionDefinition(coreActionDefinition);
const corePromiseLikeDetected: boolean = isPromiseLikeValue(null);
const stableIdentity: string = stableStringify(new Map([["project", "atlas"]]));
const stableCircularData = new StableStringifyCircularData({
  path: "$.self",
  referencePath: "$",
  guidance: "break cycles"
});
const stableUnsupportedValue = new StableStringifyUnsupportedValue({
  path: "$.fn",
  valueType: "function",
  guidance: "use data"
});
const stableInvalidDate = new StableStringifyInvalidDate({
  path: "$.createdAt",
  guidance: "use valid dates"
});
const stableEncodeFailure = new StableStringifyEncodeFailure({
  path: "$.host",
  cause: new Error("host read failed"),
  guidance: "use readable data"
});
declare const coreResourceTag: ResourceTag;
declare const coreResourceTagDefinition: ResourceTagDefinition<string>;
declare const coreResourceInvalidationPlan: ResourceInvalidationPlan;
declare const coreResourceStatus: ResourceStatus<string, { readonly id: string }>;
const coreResourceTagFromDefinition: ResourceTag = coreResourceTagDefinition("atlas");
const resourceStaleFor: DurationInput = "5 seconds";
const resourceUnsupportedDuration = new UnsupportedDuration({ duration: "forever" });
const coreExports: Array<unknown> = [
  Action,
  ActionTypeId,
  ActionResult,
  Capability,
  Form,
  Program,
  RequestContext,
  Resource,
  ResourceStoreDisposeError,
  ResourceSnapshotCodecError,
  ResponseContext,
  Route,
  RuntimeDisposeError,
  Server,
  Signal,
  StableStringifyCircularData,
  StableStringifyEncodeFailure,
  StableStringifyInvalidDate,
  StableStringifyUnsupportedValue,
  UnsupportedDuration,
  UiScope,
  applyResponseContext,
  applyResponseContextEffect,
  browserRouteActiveRenderer,
  browserRouteRenderDecision,
  browserRouteRenderIdentity,
  browserRouteRenderKey,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  buildRoutePath,
  compareRoutePathSegment,
  compareRoutePathSpecificity,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  defineApp,
  disposeResourceStoreEffect,
  forkScoped,
  hrefForRouteInput,
  isActionDefinition,
  isPlainLeftClick,
  isPromiseLikeValue,
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
  coreActionConcurrency,
  coreActionPolicy,
  coreActionOptions,
  coreActionDefinition,
  coreActionUseOptions,
  coreActionInstance,
  coreActionState,
  coreActionDefinitionCheck,
  corePromiseLikeDetected,
  runtime,
  requestRuntime,
  runtimeDisposeEffect,
  runtimeProviderLifecycleOptions,
  runtimeProviderLifecycleEntry,
  runtimeProviderDisposeOptions,
  runtimeProviderLifecycleDisposeEffect,
  requestRuntimeStoreDisposeEffect,
  resourceUiMatchState,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  scoped,
  serializeResponseCookie,
  serializeResponseCookieEffect,
  stableStringify,
  browserRouterPath,
  browserNavigateArgs,
  stableIdentity,
  stableCircularData,
  stableUnsupportedValue,
  stableInvalidDate,
  stableEncodeFailure,
  coreResourceTag,
  coreResourceTagDefinition,
  coreResourceInvalidationPlan,
  coreResourceStatus,
  coreResourceTagFromDefinition,
  resourceStaleFor,
  resourceUnsupportedDuration
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
const typeTestResourceSnapshot: Resource.Snapshot<string, string, string> = {
  name: typeTestResource.family.options.name,
  key: typeTestResourceRef.key,
  input: "atlas",
  state: {
    _tag: "Success",
    waiting: false,
    value: "atlas",
    updatedAt: 1
  }
};
const typeTestResourceHydrationPayload: ResourceHydrationPayload = {
  resources: [typeTestResourceSnapshot]
};
const typeTestResourceHydrationInput: ResourceHydrationInput = typeTestResourceHydrationPayload;
const typeTestResourceNamespacePayload: Resource.HydrationPayload = typeTestResourceHydrationInput;
const collectedResourceEffect: Effect.Effect<Resource.Collected<string>, Resource.LoadError<string>> =
  Resource.collectEffect(Resource.prefetchEffect(typeTestResourceRef));
Effect.map(collectedResourceEffect, (collected) => {
  const value: string = collected.value;
  collected.refs.map((ref) => ref.key);
  return value;
});
const resourceUiBindingControllerOptions: ResourceUiBindingControllerOptions<string, string, string, never, never> = {
  runtime: browserRouterKernelRuntime,
  onPreloadFailureChange: () => undefined
};
const resourceUiBindingController: ResourceUiBindingController<string, string, string, never, never> =
  makeResourceUiBindingController(resourceUiBindingControllerOptions);
const resourceUiBindingInterruptPreloadEffect: Effect.Effect<void> =
  resourceUiBindingController.interruptPreloadEffect();
const resourceUiBindingDisposeEffect: Effect.Effect<void> = resourceUiBindingController.disposeEffect();
const resourceUiAutoPreloadOptions: ResourceUiAutoPreloadOptions<string, never> = {
  preload: true,
  onPreloadFailure: () => undefined
};
const resourceUiAutoPreloadEffectOptions: ResourceUiAutoPreloadOptions<string, never> = {
  onPreloadFailure: () => Effect.void
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
const resourceUiSuspenseInterruptEffect: Effect.Effect<void> =
  resourceUiSuspensePreloadController.interruptEffect();
const resourceUiSuspenseDisposeEffect: Effect.Effect<void> =
  resourceUiSuspensePreloadController.disposeEffect();
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
const counterRuntimeError: Program.RuntimeError<never> = null as unknown as Program.RuntimeError<never>;
const counterDispatchError: Program.DispatchError<never> = null as unknown as Program.DispatchError<never>;
const counterInstance: Program.Instance<
  number,
  CounterMessage,
  Program.RuntimeError<never>,
  Program.DispatchError<never>
> = Program.start(counterProgram);

const uiScope = new UiScope();
const runtimeUiScope = makeRuntimeUiScope(browserRouterKernelRuntime);
const runtimeUiScopeFrame: RuntimeUiScopeFrame = makeRuntimeUiScopeFrame(browserRouterKernelRuntime);
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
const routeReadyProps: BrowserRouteReadyRenderProps<CoreProjectRoute> = {
  params: browserRouterInitialMatch!.params,
  search: browserRouterInitialMatch!.search,
  match: browserRouterInitialMatch!
};
const routeOutletRenderers: BrowserRouteOutletRenderers<typeof coreRoutes, never, string> = {
  pending: () => "pending"
};
const routeOutletDefaultRenderers: BrowserRouteOutletDefaultRenderers<typeof coreRoutes, never, string> = {
  pending: () => "pending",
  failure: () => "failure",
  notFound: () => "missing"
};
const routeRenderIdentityInput: BrowserRouteRenderIdentityInput<typeof coreRoutes, never, string> = {
  state: readyState,
  renderers: routeOutletRenderers,
  defaults: routeOutletDefaultRenderers
};
const routeActiveRenderer = browserRouteActiveRenderer(routeRenderIdentityInput);
const routeRenderIdentity: string = browserRouteRenderIdentity(routeRenderIdentityInput);
void routeReadyProps;
void routeActiveRenderer;
void routeRenderIdentity;
const preloadDecision: BrowserRouterLinkPreloadDecision = browserRouterLinkPreloadDecision({
  defaultPrevented: false,
  preload: true,
  canHandleRoute: true
});
const preloadIdentityOptions: BrowserRouterLinkPreloadIdentityOptions = {
  href: "/projects/atlas",
  preload: true,
  canHandleRoute: true
};
const preloadIdentity: BrowserRouterLinkPreloadIdentity =
  browserRouterLinkPreloadIdentity(preloadIdentityOptions);
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
const coreLinkPreloaderInterruptEffect: Effect.Effect<void> =
  coreLinkPreloaderShape.interruptEffect();
// @ts-expect-error Core Router Link Preloader exposes only full preload identity ownership facts
coreLinkPreloaderShape.bindTarget("/projects/atlas");
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
void typeTestResourceSnapshot;
void typeTestResourceHydrationPayload;
void typeTestResourceHydrationInput;
void typeTestResourceNamespacePayload;
void resourceUiBindingController;
void resourceUiBindingDisposeEffect;
void resourceUiAutoPreloadOptions;
void resourceUiAutoPreloadEffectOptions;
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
void counterRuntimeError;
void counterDispatchError;
void counterInstance;
void uiScope;
void runtimeUiScope;
void runtimeUiScopeFrame;
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
void browserRouterKernelDisposeEffect;
void browserRouterHostController;
void browserRouterHostDisposeEffect;
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
