import { Cause, Context, Effect, Fiber, Option, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Action,
  ActionOutbox,
  ActionQueued,
  ActionTransport,
  ActionTypeId,
  ActionResult,
  Form,
  Machine,
  Message,
  Model,
  State,
  RequestContext,
  Resource,
  ResourceStoreDisposeError,
  ResponseContext,
  Route,
  RouteLazyComponentLoadError,
  RouteLazyComponentPending,
  RoutePreloadError,
  RoutePreloadFailureCodecError,
  RuntimeDisposeError,
  Server,
  Signal,
  UnsupportedDuration,
  applyResponseContext,
  createBrowserRouterHostController,
  disposeResourceStore,
  isActionDefinition,
  isPromiseLikeValue,
  makeRequestContext,
  makeResponseContext,
  makeMemoryBrowserHistoryAdapter,
  makeResourceStore,
  makeRuntime,
  provideRequest,
  provideResponse,
  serializeResponseCookie,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type BrowserNavigateArgs,
  type BrowserRouterHostController,
  type AnySunfallArcRuntime,
  type DurationInput,
  type SunfallArcRuntime,
  type ParamsForPath,
  type MemoryBrowserHistoryAdapter,
  type BrowserRouterError,
} from "@sunfall/arc-core";
import {
  UiScope,
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
  forkScoped,
  hrefForRouteInput,
  isPlainLeftClick,
  isRouteParamName,
  isRoutePathSegmentPrefix,
  makeWindowBrowserHistoryAdapter,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  makeBrowserRouterLinkPreloader,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
  matchRoutePath,
  onDispose,
  opensOutsideRouter,
  parseRoutePathSegments,
  parseRouteUrl,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  scoped,
  withResourceStore,
  makeActionInstance,
  startStateOnRuntime,
  type BrowserRouterInitialMatchedHost,
  type BrowserRouterInitialMatchedStateOptions,
  type BrowserRouteOutletDefaultRenderers,
  type BrowserRouteOutletRenderers,
  type BrowserRouteReadyRenderProps,
  type BrowserRouteRenderDecision,
  type BrowserRouteRenderIdentityInput,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
  type BrowserRouterLinkClickDecision,
  type BrowserRouterLinkPreloader,
  type BrowserRouterLinkPreloadIdentity,
  type BrowserRouterLinkPreloadIdentityOptions,
  type BrowserRouterLinkPreloaderOptions,
  type BrowserRouterLinkPreloaderRuntime,
  type BrowserRouterLinkPreloadDecision,
  type ResourceUiAutoPreloadOptions,
  type ResourceUiBindingController,
  type ResourceUiBindingControllerOptions,
  type ResourceUiPreloadFailure,
  type ResourceUiSuspensePreloadController,
  type ResourceUiSuspensePreloadFiber,
  type ResourceUiSuspensePreloadOptions,
  type RuntimeUiScopeFrame,
  StableStringifyCircularData,
  StableStringifyEncodeFailure,
  StableStringifyInvalidDate,
  StableStringifyUnsupportedValue,
  stableStringify,
  type RouteWithComponent,
} from "@sunfall/arc-core/internal";
// @ts-expect-error ResourceCollector is an internal preload planning service, not a root export.
type ResourceCollectorIsInternal = typeof import("@sunfall/arc-core").ResourceCollector;
// @ts-expect-error ResourceCollected is exposed as Resource.Collected, not as a root export.
type ResourceCollectedIsNamespaced = import("@sunfall/arc-core").ResourceCollected;
// @ts-expect-error Capability was removed; app services are Effect services (`Context.Service`).
type CapabilityIsRemoved = typeof import("@sunfall/arc-core").Capability;

const runtime = makeRuntime();
const requestRuntime = withResourceStore(runtime, makeResourceStore());
const runtimeDisposeEffect: Effect.Effect<void, RuntimeDisposeError> = runtime.dispose;
class CoreAdapterCleanupError {
  readonly _tag = "CoreAdapterCleanupError";
}
requestRuntime.resourceStore.moduleRegistry.register(Symbol("core-adapter-cleanup"), {
  dispose: Effect.fail(new CoreAdapterCleanupError()),
});
const requestRuntimeStoreDisposeEffect: Effect.Effect<void, ResourceStoreDisposeError> =
  disposeResourceStore(requestRuntime.resourceStore);
const coreRoutes = [Route.define("/projects/:id", {})] as const;
const coreLazyRouteComponent = Route.lazyComponent(
  Effect.succeed({ default: (_props: Route.Props<(typeof coreRoutes)[0]>) => undefined }),
);
const coreNamedLazyRouteComponent = Route.lazyComponent(
  Effect.succeed({ Project: (_props: Route.Props<(typeof coreRoutes)[0]>) => undefined }),
  "Project",
);
class CoreLazyRouteImportError {
  readonly _tag = "CoreLazyRouteImportError";
}
const coreLazyRouteComponentWithImportError = Route.lazyComponent<
  Route.Component<(typeof coreRoutes)[0]>,
  CoreLazyRouteImportError
>(Effect.fail(new CoreLazyRouteImportError()));
const coreLazyRouteComponentShape: Route.LazyComponent<Route.Component<(typeof coreRoutes)[0]>> =
  coreLazyRouteComponent;
const coreLazyRouteComponentWithImportErrorShape: Route.LazyComponent<
  Route.Component<(typeof coreRoutes)[0]>,
  CoreLazyRouteImportError
> = coreLazyRouteComponentWithImportError;
const coreLazyRouteComponentPreloadEffect: Effect.Effect<
  Route.Component<(typeof coreRoutes)[0]>,
  RouteLazyComponentLoadError
> = coreLazyRouteComponent.preload();
const coreLazyRouteComponentImportErrorPreloadEffect: Effect.Effect<
  Route.Component<(typeof coreRoutes)[0]>,
  CoreLazyRouteImportError | RouteLazyComponentLoadError
> = coreLazyRouteComponentWithImportError.preload();
const coreLazyRoutePending = new RouteLazyComponentPending<CoreLazyRouteImportError>({
  exportName: "default",
  preload: coreLazyRouteComponentWithImportError.preload(),
});
const coreLazyRoutePendingEffect: Effect.Effect<
  unknown,
  CoreLazyRouteImportError | RouteLazyComponentLoadError
> = coreLazyRoutePending.preload;
const coreLazyRoutePendingExtractedEffect: Effect.Effect<
  unknown,
  CoreLazyRouteImportError | RouteLazyComponentLoadError
> = Route.lazyComponentPending<CoreLazyRouteImportError>(coreLazyRoutePending)!;
declare const coreLazyRouteSuspenseRuntime: Route.LazyComponentSuspenseRuntime<CoreAdapterCleanupError>;
const coreLazyRouteSuspenseFiber:
  | Fiber.Fiber<
      void,
      CoreLazyRouteImportError | RouteLazyComponentLoadError | CoreAdapterCleanupError
    >
  | undefined = Route.forkLazyComponentSuspense<CoreAdapterCleanupError, CoreLazyRouteImportError>(
  coreLazyRoutePending,
  coreLazyRouteSuspenseRuntime,
);
Route.isLazyComponent(coreLazyRouteComponent);
Route.readComponent(coreNamedLazyRouteComponent);
Route.withComponent(coreRoutes[0], coreLazyRouteComponent);
Route.withComponent(coreRoutes[0], coreLazyRouteComponentWithImportError);
void coreLazyRouteComponentWithImportErrorShape;
void coreLazyRouteComponentImportErrorPreloadEffect;
void coreLazyRoutePendingEffect;
void coreLazyRoutePendingExtractedEffect;
void coreLazyRouteSuspenseFiber;

class CoreProjectNotFound extends Schema.TaggedError<CoreProjectNotFound>()("CoreProjectNotFound", {
  id: Schema.String,
}) {}
const coreProjectNotFoundSchema: Resource.ErrorSchema<CoreProjectNotFound> = CoreProjectNotFound;
const CoreTypedRoute = Route.define("/core-typed/:id", {
  error: coreProjectNotFoundSchema,
  preload: ({ params }) => Effect.fail(new CoreProjectNotFound({ id: params.id })),
});
declare const coreTypedPreloadError: RoutePreloadError<CoreProjectNotFound>;
const coreTypedFailureSnapshot: Effect.Effect<Route.PreloadFailureSnapshot> =
  Route.preloadFailureSnapshot(CoreTypedRoute, coreTypedPreloadError);
declare const coreTypedSnapshot: Route.PreloadFailureSnapshot;
const coreTypedSnapshotEncoding: Route.PreloadFailureEncoding = coreTypedSnapshot.failure;
const coreTypedFailureCause: Cause.Cause<RoutePreloadError<CoreProjectNotFound>> =
  Route.preloadFailureCauseFromSnapshot(CoreTypedRoute, coreTypedSnapshot);
const coreTypedRouterError: BrowserRouterError<readonly [typeof CoreTypedRoute]> =
  coreTypedPreloadError;
const coreRouteFailureCodecError = new RoutePreloadFailureCodecError({
  path: "/core-typed/:id",
  href: "/core-typed/atlas",
  operation: "decode",
});
// @ts-expect-error route error schemas must decode and encode without services
const coreServiceErrorSchema: Resource.ErrorSchema = null as unknown as Schema.Codec<
  CoreProjectNotFound,
  unknown,
  "Service"
>;
void coreTypedFailureSnapshot;
void coreTypedSnapshotEncoding;
void coreTypedFailureCause;
void coreTypedRouterError;
void coreRouteFailureCodecError;
void coreServiceErrorSchema;
declare const browserRouterKernelRuntime: AnySunfallArcRuntime<never>;
const browserRouterKernelOptions: BrowserRouterKernelOptions<typeof coreRoutes, never> = {
  runtime: browserRouterKernelRuntime,
  initialHref: "/projects/atlas",
};
const browserRouterKernel = createBrowserRouterKernel(coreRoutes, browserRouterKernelOptions);
const browserRouterKernelDisposeEffect: Effect.Effect<void> = browserRouterKernel.dispose();
type CoreProjectRoute = (typeof coreRoutes)[0];
const browserNavigateArgs: BrowserNavigateArgs<CoreProjectRoute> = [{ params: { id: "atlas" } }];
const browserRouterInitialHost: BrowserRouterInitialMatchedHost = "browser";
const browserRouterInitialMatch = Route.match([coreRoutes[0]], "/projects/atlas");
if (browserRouterInitialMatch) {
  const initialMatchedStateOptions: BrowserRouterInitialMatchedStateOptions<typeof coreRoutes> = {
    href: "/projects/atlas",
    match: browserRouterInitialMatch,
    host: browserRouterInitialHost,
    hydrating: true,
  };
  browserRouterInitialMatchedState(initialMatchedStateOptions)._tag;
}
const memoryHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/projects" });
const browserRouterHostController = createBrowserRouterHostController(coreRoutes, {
  runtime: browserRouterKernelRuntime,
  history: memoryHistory,
});
const browserRouterHostDisposeEffect: Effect.Effect<void> = browserRouterHostController.dispose();
const windowHistory = makeWindowBrowserHistoryAdapter();
const browserHistory: BrowserHistoryAdapter = memoryHistory;
const navigateOptions: BrowserNavigateOptions = { replace: true };
const historyWindow: BrowserHistoryWindow = {
  location: {
    pathname: "/projects",
    search: "?active=true",
  },
  history: {
    pushState: () => undefined,
    replaceState: () => undefined,
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
const coreActionConcurrency: Action.Concurrency = "exhaust";
const coreActionPolicy: Action.Policy<never> = {
  concurrency: coreActionConcurrency,
};
const coreActionOptions: Action.Options<string, string> = {
  name: "type-tests/core-action",
  policy: coreActionPolicy,
  run: (input) => Effect.succeed(input),
};
const coreActionDefinition: Action.Definition<string, string> = Action.define(coreActionOptions);
const coreActionUseOptions: Action.UseOptions<never, never> = { runtime };
const coreActionInstance: Action.Instance<string, string> = Action.use(coreActionDefinition, {
  runtime,
});
const coreActionState: Action.State<string, string> = {
  result: AsyncResult.success("ok", { timestamp: 1 }),
  input: Option.some("publish"),
};
const coreActionDefinitionCheck: boolean = isActionDefinition(coreActionDefinition);
const corePromiseLikeDetected: boolean = isPromiseLikeValue(null);
const stableIdentity: string = stableStringify(new Map([["project", "atlas"]]));
const stableCircularData = new StableStringifyCircularData({
  path: "$.self",
  referencePath: "$",
  guidance: "break cycles",
});
const stableUnsupportedValue = new StableStringifyUnsupportedValue({
  path: "$.fn",
  valueType: "function",
  guidance: "use data",
});
const stableInvalidDate = new StableStringifyInvalidDate({
  path: "$.createdAt",
  guidance: "use valid dates",
});
const stableEncodeFailure = new StableStringifyEncodeFailure({
  path: "$.host",
  cause: new Error("host read failed"),
  guidance: "use readable data",
});
declare const coreResourceTag: Resource.Tag;
declare const coreResourceTagDefinition: Resource.TagDefinition<string>;
declare const coreResourceInvalidationPlan: Resource.InvalidationPlan;
declare const coreResourceStatus: Resource.Status<string, { readonly id: string }>;
const coreResourceTagFromDefinition: Resource.Tag = coreResourceTagDefinition("atlas");
const resourceStaleFor: DurationInput = "5 seconds";
const resourceUnsupportedDuration = new UnsupportedDuration({ duration: "forever" });
const coreExports: Array<unknown> = [
  Action,
  ActionTypeId,
  ActionResult,
  Form,
  State,
  RequestContext,
  Resource,
  ResourceStoreDisposeError,
  Resource.SnapshotCodecError,
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
  disposeResourceStore,
  forkScoped,
  hrefForRouteInput,
  isActionDefinition,
  isPlainLeftClick,
  isPromiseLikeValue,
  isRouteParamName,
  isRoutePathSegmentPrefix,
  makeRequestContext,
  makeResponseContext,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  Route.define,
  makeRuntimeUiScope,
  matchRoutePath,
  onDispose,
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
  requestRuntimeStoreDisposeEffect,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  scoped,
  serializeResponseCookie,
  stableStringify,
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
  resourceUnsupportedDuration,
];
const actionPendingWithUndefinedPrevious: Action.State<string, void, string> = {
  result: AsyncResult.waiting(AsyncResult.success<void, string>(undefined, { timestamp: 1 })),
  input: Option.some("publish"),
};
const actionFailureWithUndefinedPrevious: Action.State<string, void, string> = {
  result: AsyncResult.fail<string, void>("failed", {
    previousSuccess: Option.some(AsyncResult.success(undefined, { timestamp: 1 })),
  }),
  input: Option.some("publish"),
};
// @ts-expect-error -- action submission state is an AsyncResult plus input, not a tagged union.
const actionStateIsNotTagged: Action.State<string, void, string> = { _tag: "Idle" };
const actionFailureCause: Option.Option<Cause.Cause<string>> = AsyncResult.cause(
  actionFailureWithUndefinedPrevious.result,
);
const refreshingResourceResult = AsyncResult.waiting(
  AsyncResult.success<void, string>(undefined, { timestamp: 1 }),
) as AsyncResult.AsyncResult<void, string>;
const matchedResourceState: string = AsyncResult.builder(refreshingResourceResult)
  .onInitial(() => "initial")
  .onFailure((cause, failed) => `${String(Cause.squash(cause))}:${failed.previousSuccess._tag}`)
  .onSuccess((value, success) => `${String(value)}:${String(success.waiting)}`)
  .exhaustive();
const typeTestResource = Resource.define<string, string, string>({
  name: "type-tests/core-resource-ui",
  load: (id) => Effect.succeed(id),
});
const typeTestResourceRef = typeTestResource("atlas");
const typeTestResourceSnapshot: Resource.Snapshot<string, string> = {
  name: typeTestResource.family.options.name,
  key: typeTestResourceRef.key,
  input: "atlas",
  state: {
    _tag: "Success",
    value: "atlas",
    waiting: false,
    timestamp: 1,
  },
};
const typeTestResourceHydrationPayload: Resource.HydrationPayload = {
  resources: [typeTestResourceSnapshot],
};
const typeTestResourceNamespacePayload: Resource.HydrationPayload =
  typeTestResourceHydrationPayload;
const collectedResourceEffect: Effect.Effect<Resource.Collected<string>, string> = Resource.collect(
  Resource.preload(typeTestResourceRef),
);
Effect.map(collectedResourceEffect, (collected) => {
  const value: string = collected.value;
  collected.refs.map((ref) => ref.key);
  return value;
});
const resourceUiBindingControllerOptions: ResourceUiBindingControllerOptions<
  string,
  string,
  string,
  never,
  never
> = {
  runtime: browserRouterKernelRuntime,
  onPreloadFailureChange: () => undefined,
};
const resourceUiBindingController: ResourceUiBindingController<
  string,
  string,
  string,
  never,
  never
> = makeResourceUiBindingController(resourceUiBindingControllerOptions);
const resourceUiBindingInterruptPreloadEffect: Effect.Effect<void> =
  resourceUiBindingController.interruptPreload();
const resourceUiBindingDisposeEffect: Effect.Effect<void> = resourceUiBindingController.dispose();
const resourceUiAutoPreloadOptions: ResourceUiAutoPreloadOptions<string, never> = {
  preload: true,
  onPreloadFailure: () => undefined,
};
const resourceUiAutoPreloadEffectOptions: ResourceUiAutoPreloadOptions<string, never> = {
  onPreloadFailure: () => Effect.void,
};
declare const resourceUiPreloadObserverPromise: Promise<void>;
const resourceUiAutoPreloadPromiseOptions: ResourceUiAutoPreloadOptions<string, never> = {
  // @ts-expect-error Core Resource UI preload observers cannot return Promise-shaped work
  onPreloadFailure: () => resourceUiPreloadObserverPromise,
};
const resourceUiPreloadFailure: ResourceUiPreloadFailure<string, string, string, never, never> = {
  ref: typeTestResourceRef,
  error: "failed",
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
  toHostToken: (fiber) => fiber,
};
const resourceUiSuspensePreloadFiber = resourceUiSuspensePreloadController.hostToken(
  typeTestResourceRef,
  resourceUiSuspensePreloadOptions,
);
const resourceUiSuspenseInterruptEffect: Effect.Effect<void> =
  resourceUiSuspensePreloadController.interrupt();
const resourceUiSuspenseDisposeEffect: Effect.Effect<void> =
  resourceUiSuspensePreloadController.dispose();
type RuntimeShape = SunfallArcRuntime;
type AnyRuntimeShape = AnySunfallArcRuntime;
type RouterKernelShape = BrowserRouterKernel<typeof coreRoutes>;
type RouterKernelOptionsShape = BrowserRouterKernelOptions<typeof coreRoutes, never>;
type RouterHostShape = BrowserRouterHostController;
type BrowserHistoryShape = BrowserHistoryAdapter;
type MemoryHistoryShape = MemoryBrowserHistoryAdapter;
type BrowserHistoryWindowShape = BrowserHistoryWindow;
type BrowserNavigateOptionsShape = BrowserNavigateOptions;

const actionSuccess: ActionResult.Success<number> = ActionResult.success(1);
const actionFailure: ActionResult.Failure<"failed"> = ActionResult.failure("failed");
const actionRedirect: ActionResult.Redirect = ActionResult.redirect("/login", { replace: true });
const actionValidation: ActionResult.ValidationFailure<{ readonly name: string }, "required"> =
  ActionResult.validation({ fieldErrors: { name: ["required" as const] } });
const actionBoundary: ActionResult.Boundary<{ readonly name: string }, "required", "failed"> =
  actionValidation;
const actionResultLabel: string = ActionResult.match(actionSuccess, {
  success: (value) => String(value),
  validation: () => "validation",
  redirect: () => "redirect",
  failure: () => "failure",
});

const profileSchema = Schema.Struct({ name: Schema.String });
const profileForm: Form.Instance<{ readonly name: string }, "required"> = Form.make({
  name: "profileForm",
  schema: profileSchema,
  initial: { name: "" },
  validate: (values, errors) =>
    values.name.length === 0 ? Effect.fail(errors.field("name", "required")) : Effect.void,
});
const profileValidationEffect = profileForm.validate();
const profileFormData = Form.data(new FormData());

// States are effect-machine machines: schema-first variants and messages,
// transitions keyed by (variant, message).
const CounterModel = Model({ Counting: { count: Schema.Finite } });
const CounterMessage = Message({ Incremented: {}, Decremented: {} });
const counterMachine = Machine.make({
  state: CounterModel,
  event: CounterMessage,
  initial: CounterModel.Counting({ count: 0 }),
})
  .onAny(CounterMessage.Incremented, ({ state }) =>
    CounterModel.Counting({ count: state.count + 1 }),
  )
  .onAny(CounterMessage.Decremented, ({ state }) =>
    CounterModel.Counting({ count: state.count - 1 }),
  );
const counterState = State.define({ name: "counterState", machine: counterMachine });
type CounterModelType = State.Model<typeof counterState>;
type CounterMessageType = State.Message<typeof counterState>;
const counterModelCount: number = (null as unknown as CounterModelType).count;
const counterMessageTag: "Incremented" | "Decremented" = (null as unknown as CounterMessageType)
  ._tag;
// Pure transitions without a runtime: the machine replays messages.
const counterReplay: Effect.Effect<CounterModelType> = Machine.replay(counterMachine, [
  CounterMessage.Incremented,
]);
const counterInstance: State.Instance<CounterModelType, CounterMessageType> = State.start(
  counterState,
  { runtime },
);
const counterDispatch: Effect.Effect<
  void,
  State.Failure<CounterMessageType, State.DispatchError>
> = counterInstance.dispatch(CounterMessage.Incremented);
// @ts-expect-error A State only takes its own messages.
counterInstance.dispatch({ _tag: "Reset" });
const counterCan: boolean = counterInstance.can(CounterMessage.Decremented);
const counterFailures: ReadonlyArray<State.Failure<CounterMessageType, State.Error>> =
  counterInstance.failures.get();
const counterHistory: ReadonlyArray<State.History<CounterModelType, CounterMessageType>> =
  State.history(counterState, []);

const DownloadModel = Model({ Idle: {}, Downloading: { url: Schema.String } });
const DownloadMessage = Message({
  ClickedDownload: { url: Schema.String },
  FinishedDownload: {},
});
interface Downloader {
  readonly fetch: (url: string) => Effect.Effect<number, "Offline">;
}
const Downloader = Context.Service<Downloader>("@sunfall/arc-core/type-tests/Downloader");
// Work a variant owns: its failure must become a message (E = never), and its
// services join the State's `R`.
const downloadState = State.define({
  name: "download",
  machine: Machine.make({
    state: DownloadModel,
    event: DownloadMessage,
    initial: DownloadModel.Idle,
  })
    .on(DownloadModel.Idle, DownloadMessage.ClickedDownload, ({ event }) =>
      DownloadModel.Downloading({ url: event.url }),
    )
    .on(DownloadModel.Downloading, DownloadMessage.FinishedDownload, () => DownloadModel.Idle)
    .task(DownloadModel.Downloading, ({ state }) => Downloader.use((api) => api.fetch(state.url)), {
      onSuccess: () => DownloadMessage.FinishedDownload,
      onFailure: () => DownloadMessage.FinishedDownload,
    }),
});
const downloadRequirements: State.Definition<
  State.Model<typeof downloadState>,
  State.Message<typeof downloadState>,
  Downloader
> = downloadState;
// @ts-expect-error A State that needs Downloader cannot start on a runtime without it.
State.start(downloadState, { runtime });
Machine.make({ state: DownloadModel, event: DownloadMessage, initial: DownloadModel.Idle })
  // @ts-expect-error A transition handler cannot fail: expected failures become messages.
  .on(DownloadModel.Idle, DownloadMessage.ClickedDownload, () => Effect.fail("Offline"));
Machine.make({ state: DownloadModel, event: DownloadMessage, initial: DownloadModel.Idle })
  // @ts-expect-error A transition returns one of the model's variants.
  .on(DownloadModel.Idle, DownloadMessage.ClickedDownload, () => ({ _tag: "Exploded" }));
Machine.make({ state: DownloadModel, event: DownloadMessage, initial: DownloadModel.Idle })
  // @ts-expect-error A transition handles a message of the machine.
  .on(DownloadModel.Idle, CounterMessage.Incremented, () => DownloadModel.Idle);
// A persisted State needs the runtime's KeyValueStore.
const persistedCounter = State.define({
  name: "persistedCounter",
  machine: counterMachine,
  persist: { key: "counter" },
});
// @ts-expect-error A persisted State cannot start on a runtime without a KeyValueStore.
State.start(persistedCounter, { runtime });
type IncrementedFields = State.MessageFields<
  State.Message<typeof downloadState>,
  "ClickedDownload"
>;
const clickedDownloadFields: IncrementedFields = { url: "/report.pdf" };
void counterModelCount;
void counterMessageTag;
void counterReplay;
void counterDispatch;
void counterCan;
void counterFailures;
void counterHistory;
void downloadRequirements;
void clickedDownloadFields;

const uiScope = new UiScope();
const runtimeUiScope = makeRuntimeUiScope(browserRouterKernelRuntime);
const runtimeUiScopeFrame: RuntimeUiScopeFrame = makeRuntimeUiScopeFrame(
  browserRouterKernelRuntime,
);
const uiScopeDispose: Effect.Effect<void> = uiScope.dispose();
const runtimeUiScopeFrameDispose: Effect.Effect<void> = runtimeUiScopeFrame.dispose();
const scopedValue = scoped(() => "scoped");
onDispose(() => Effect.void);
onDispose(() => undefined);

const request = new Request("https://sunfall-arc.test/projects/atlas?tab=overview");
const requestContextEffect = makeRequestContext(request);
const responseContext = makeResponseContext();
const appliedResponseEffect = applyResponseContext(responseContext, new Response("ok"));
const providedRequest = provideRequest(request)(Effect.succeed("ok"));
const providedResponse = provideResponse(responseContext)(Effect.succeed("ok"));
const cookieHeaderEffect = serializeResponseCookie("theme", "dark", { sameSite: "lax" });

const codecOperation: Resource.SnapshotCodecOperation = "decode";
const codecError = new Resource.SnapshotCodecError({
  operation: codecOperation,
  path: "$.resources[0]",
  reason: "Expected a Resource hydration snapshot",
});

const routeSegments = parseRoutePathSegments("/projects/:id/:tab?");
const firstRouteSegment = routeSegments[0]!;
const routePath = routePathFromSegments(routeSegments);
const routeParams = routeParamsFromSegments(routeSegments);
const routeSlug = routePathSlug("/projects/:id/:tab?");
const routeParamNameOk = isRouteParamName("id");
const routeSegmentComparison = compareRoutePathSegment(routeSegments[0], routeSegments[1]);
const routeSpecificityComparison = compareRoutePathSpecificity(
  routeSegments,
  parseRoutePathSegments("/projects/settings"),
);
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
  match: Route.match([coreRoutes[0]], "/projects/atlas")!,
} as const;
const renderKey = browserRouteRenderKey(readyState);
const renderDecision: BrowserRouteRenderDecision<typeof coreRoutes, never> =
  browserRouteRenderDecision(readyState);
const routeReadyProps: BrowserRouteReadyRenderProps<CoreProjectRoute> = {
  params: browserRouterInitialMatch!.params,
  search: browserRouterInitialMatch!.search,
  match: browserRouterInitialMatch!,
};
const routeOutletRenderers: BrowserRouteOutletRenderers<typeof coreRoutes, never, string> = {
  pending: () => "pending",
};
const routeOutletDefaultRenderers: BrowserRouteOutletDefaultRenderers<
  typeof coreRoutes,
  never,
  string
> = {
  pending: () => "pending",
  failure: () => "failure",
  notFound: () => "missing",
};
const routeRenderIdentityInput: BrowserRouteRenderIdentityInput<typeof coreRoutes, never, string> =
  {
    state: readyState,
    renderers: routeOutletRenderers,
    defaults: routeOutletDefaultRenderers,
  };
const routeActiveRenderer = browserRouteActiveRenderer(routeRenderIdentityInput);
const routeRenderIdentity: string = browserRouteRenderIdentity(routeRenderIdentityInput);
void routeReadyProps;
void routeActiveRenderer;
void routeRenderIdentity;
const preloadDecision: BrowserRouterLinkPreloadDecision = browserRouterLinkPreloadDecision({
  defaultPrevented: false,
  preload: true,
  canHandleRoute: true,
});
const preloadIdentityOptions: BrowserRouterLinkPreloadIdentityOptions = {
  href: "/projects/atlas",
  preload: true,
  canHandleRoute: true,
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
  preload: () => Effect.void,
});
const coreLinkPreloaderShape: BrowserRouterLinkPreloader = coreLinkPreloader;
const coreLinkPreloadIdentity: BrowserRouterLinkPreloadIdentity = {
  key: "/projects/atlas\u0000true\u0000true\u0000\u0000",
  enabled: true,
};
coreLinkPreloaderShape.bindPreloadIdentity(coreLinkPreloadIdentity);
const coreLinkPreloaderInterruptEffect: Effect.Effect<void> = coreLinkPreloaderShape.interrupt();
// @ts-expect-error Core Router Link Preloader exposes only full preload identity ownership facts
coreLinkPreloaderShape.bindTarget("/projects/atlas");
const coreLinkPreloaderRuntime: BrowserRouterLinkPreloaderRuntime = runtime;
const coreLinkPreloaderOptions: BrowserRouterLinkPreloaderOptions = {
  runtime: coreLinkPreloaderRuntime,
  enabled: () => true,
  preload: () => Effect.void,
};
makeBrowserRouterLinkPreloader({
  runtime,
  enabled: () => true,
  // @ts-expect-error router link preloads must be provided before reaching the Core preloader
  preload: () => CoreLinkPreloadApi.use((service) => service.warm()),
});
const clickDecision: BrowserRouterLinkClickDecision = browserRouterLinkClickDecision({
  event: {
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
  },
  href: "/projects/atlas",
  canHandleRoute: true,
});

void coreExports;
void actionPendingWithUndefinedPrevious;
void actionFailureWithUndefinedPrevious;
void matchedResourceState;
void actionStateIsNotTagged;
void actionFailureCause;
void typeTestResourceRef;
void typeTestResourceSnapshot;
void typeTestResourceHydrationPayload;
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
void profileValidationEffect;
void profileFormData;
void counterInstance;
void uiScope;
void runtimeUiScope;
void runtimeUiScopeFrame;
void uiScopeDispose;
void runtimeUiScopeFrameDispose;
void scopedValue;
void requestContextEffect;
void responseContext;
void appliedResponseEffect;
void providedRequest;
void providedResponse;
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

// Action transport seam: a transport that serves an Action returns its decoded
// outcome plus the work that applies the response to the submitting runtime.
const coreActionTransport: ActionTransport = {
  submit: (_definition, _input) => Option.none(),
};
declare const coreActionTransportResponse: Action.TransportResponse<string, "rejected">;
const coreActionTransportApply: Effect.Effect<void, Action.ClientError> =
  coreActionTransportResponse.apply(true);
const coreActionTransportService: Context.Service<ActionTransport, ActionTransport> =
  ActionTransport;
void coreActionTransport;
void coreActionTransportApply;
void coreActionTransportService;

// Route components may be renderer component values; `withComponent` keeps the
// attached component's type for adapters to check.
declare const coreRouteView: Route.View<Route.Props<typeof coreTypedRoute>>;
const coreTypedRoute = Route.define("/core-view/:id", {});
const coreRouteWithView = Route.withComponent(coreTypedRoute, coreRouteView);
const coreRouteViewCarrier: RouteWithComponent<typeof coreRouteView> = coreRouteWithView;
const coreRouteViewOf: Route.ComponentOf<typeof coreRouteWithView> = coreRouteView;
void coreRouteViewCarrier;
void coreRouteViewOf;

// Internal adapter seams: instances on an erased runtime whose services the
// adapter checks elsewhere.
declare const coreErasedRuntime: AnySunfallArcRuntime<never>;
const coreInternalAction = makeActionInstance(
  Action.define({ name: "core.internal.action", run: (input: string) => input }),
  coreErasedRuntime,
);
const coreInternalState = startStateOnRuntime(counterState, coreErasedRuntime);
void coreInternalAction;
void coreInternalState;

// Durable submissions: `durable` requires an input schema and adds
// `ActionQueued` to the Action's error type; non-durable Actions are unchanged.
const DurableAdvanceInput = Schema.Struct({ id: Schema.String });
const durablePolicy: Action.DurablePolicy = { maxAge: "1 day" };
const DurableAdvance = Action.define({
  name: "type-tests/durable-advance",
  input: DurableAdvanceInput,
  output: Schema.Number,
  durable: durablePolicy,
  run: ({ id }): Effect.Effect<number, "Rejected"> =>
    id.length > 0 ? Effect.succeed(1) : Effect.fail("Rejected"),
});
const durableAdvanceDefinition: Action.Definition<
  { readonly id: string },
  number,
  "Rejected" | ActionQueued
> = DurableAdvance;
const DurableNoOutput = Action.define({
  name: "type-tests/durable-no-output",
  input: DurableAdvanceInput,
  durable: { maxAge: "5 minutes" },
  run: () => Effect.succeed("ok"),
});
const durableNoOutputDefinition: Action.Definition<{ readonly id: string }, string, ActionQueued> =
  DurableNoOutput;
const PlainAdvance = Action.define({
  name: "type-tests/plain-advance",
  input: DurableAdvanceInput,
  run: () => Effect.succeed(1),
});
const plainAdvanceDefinition: Action.Definition<{ readonly id: string }, number, never> =
  PlainAdvance;
// @ts-expect-error -- a durable Action's error type includes ActionQueued.
const durableAdvanceWithoutQueued: Action.Definition<{ readonly id: string }, number, "Rejected"> =
  DurableAdvance;
const durableWithoutSchema = Action.define({
  name: "type-tests/durable-without-schema",
  // @ts-expect-error -- durable submissions are stored schema-encoded: they need an input schema.
  durable: { maxAge: "1 day" },
  run: (id: string) => Effect.succeed(id),
});
const durableWithoutMaxAge = Action.define({
  name: "type-tests/durable-without-max-age",
  input: DurableAdvanceInput,
  // @ts-expect-error -- a durable Action declares how stale a replay may be.
  durable: {},
  run: () => Effect.succeed(1),
});
declare const durableRuntime: SunfallArcRuntime<never>;
const durableInstance = Action.use(DurableAdvance, { runtime: durableRuntime });
const durableSubmit: Effect.Effect<
  number,
  "Rejected" | ActionQueued | Action.ClientError | ActionInterruptedError
> = durableInstance.submit({ id: "atlas" });
type ActionInterruptedError =
  Effect.Error<ReturnType<typeof durableInstance.submit>> extends infer E
    ? Extract<E, { readonly _tag: "ActionInterrupted" }>
    : never;
const outboxView: Effect.Effect<Action.Outbox> = Action.outbox;
const outboxPendingCount: Effect.Effect<number> = Effect.map(
  Action.outbox,
  (outbox) => outbox.pending.get().length,
);
const outboxRestore: Effect.Effect<void> = Action.restoreOutbox();
const outboxRestoreSettled: Effect.Effect<void> = Action.restoreOutbox({
  settled: ["submission-1"],
});
void outboxRestoreSettled;
const outboxService: Effect.Effect<ActionOutbox, never, ActionOutbox> = Effect.gen(function* () {
  return yield* ActionOutbox;
});
void durableAdvanceDefinition;
void durableNoOutputDefinition;
void plainAdvanceDefinition;
void durableAdvanceWithoutQueued;
void durableWithoutSchema;
void durableWithoutMaxAge;
void durableSubmit;
void outboxView;
void outboxPendingCount;
void outboxRestore;
void outboxService;

// A ref's service requirements are covariant and checked the same way in every
// checker: a ref that needs a service never passes where none is provided.
interface RefVarianceService {
  readonly refVarianceService: true;
}
interface OtherRefVarianceService {
  readonly otherRefVarianceService: true;
}
declare const refNeedingService: Resource.Ref<"all", number, never, RefVarianceService>;
// @ts-expect-error the ref requires RefVarianceService
const refWithoutServices: Resource.Ref<"all", number, never, never> = refNeedingService;
const refWithServices: Resource.Ref<
  "all",
  number,
  never,
  RefVarianceService | OtherRefVarianceService
> = refNeedingService;
