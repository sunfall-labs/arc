import { Cause, Context, Effect, Fiber, Option, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Action,
  ActionOutbox,
  ActionQueued,
  ActionTransport,
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
  type ActionConcurrency,
  type ActionDefinition,
  type ActionDurablePolicy,
  type ActionOutboxView,
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
  type BrowserNavigateOptions,
  type BrowserNavigateArgs,
  type BrowserRouterHostController,
  type ActionUseOptions,
  type AnySunfallArcRuntime,
  type DurationInput,
  type SunfallArcRuntime,
  type FormInstance,
  type ParamsForPath,
  type ResourceInvalidationPlan,
  type ResourceStatus,
  type ResourceTag,
  type ResourceTagDefinition,
  type MemoryBrowserHistoryAdapter,
  type ResourceSnapshotCodecOperation,
  type ResourceHydrationPayload,
  type BrowserRouterError,
  type RouteErrorSchema,
  type RoutePreloadFailureEncoding,
  type RoutePreloadFailureSnapshot,
  type ActionTransportResponse,
  type RouteView,
  type RouteWithComponent,
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
  startProgramOnRuntime,
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
} from "@sunfall/arc-core/internal";
// @ts-expect-error ResourceCollector is an internal preload planning service, not a root export.
type ResourceCollectorIsInternal = typeof import("@sunfall/arc-core").ResourceCollector;
// @ts-expect-error ResourceCollected is exposed as Resource.Collected, not as a root export.
type ResourceCollectedIsNamespaced = import("@sunfall/arc-core").ResourceCollected;

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
const coreProjectNotFoundSchema: RouteErrorSchema<CoreProjectNotFound> = CoreProjectNotFound;
const CoreTypedRoute = Route.define("/core-typed/:id", {
  error: coreProjectNotFoundSchema,
  preload: ({ params }) => Effect.fail(new CoreProjectNotFound({ id: params.id })),
});
declare const coreTypedPreloadError: RoutePreloadError<CoreProjectNotFound>;
const coreTypedFailureSnapshot: Effect.Effect<RoutePreloadFailureSnapshot> =
  Route.preloadFailureSnapshot(CoreTypedRoute, coreTypedPreloadError);
declare const coreTypedSnapshot: RoutePreloadFailureSnapshot;
const coreTypedSnapshotEncoding: RoutePreloadFailureEncoding = coreTypedSnapshot.failure;
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
const coreServiceErrorSchema: RouteErrorSchema = null as unknown as Schema.Codec<
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
const browserRouterInitialMatch = coreRoutes[0].match("/projects/atlas");
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
const coreActionConcurrency: ActionConcurrency = "exhaust";
const coreActionPolicy: ActionPolicy<never> = {
  concurrency: coreActionConcurrency,
};
const coreActionOptions: ActionOptions<string, string> = {
  name: "type-tests/core-action",
  policy: coreActionPolicy,
  run: (input) => Effect.succeed(input),
};
const coreActionDefinition: ActionDefinition<string, string> = Action.define(coreActionOptions);
const coreActionUseOptions: ActionUseOptions<never, never> = { runtime };
const coreActionInstance: ActionInstance<string, string> = Action.use(coreActionDefinition, {
  runtime,
});
const coreActionState: ActionState<string, string> = {
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
const actionPendingWithUndefinedPrevious: ActionState<string, void, string> = {
  result: AsyncResult.waiting(AsyncResult.success<void, string>(undefined, { timestamp: 1 })),
  input: Option.some("publish"),
};
const actionFailureWithUndefinedPrevious: ActionState<string, void, string> = {
  result: AsyncResult.fail<string, void>("failed", {
    previousSuccess: Option.some(AsyncResult.success(undefined, { timestamp: 1 })),
  }),
  input: Option.some("publish"),
};
// @ts-expect-error -- action submission state is an AsyncResult plus input, not a tagged union.
const actionStateIsNotTagged: ActionState<string, void, string> = { _tag: "Idle" };
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
const typeTestResourceHydrationPayload: ResourceHydrationPayload = {
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
  failure: () => "failure",
});

const profileSchema = Schema.Struct({ name: Schema.String });
const profileForm: FormInstance<{ readonly name: string }, "required"> = Form.make({
  schema: profileSchema,
  initial: { name: "" },
  validate: (values, errors) =>
    values.name.length === 0 ? Effect.fail(errors.field("name", "required")) : Effect.void,
});
const profileValidationEffect = Form.validate(profileForm);
const profileFormData = Form.data(new FormData());

type CounterMessage = "increment" | "decrement";
const counterProgram = Program.define({
  initial: 0,
  update: (model: number, message: CounterMessage) =>
    Program.next<number, CounterMessage>(message === "increment" ? model + 1 : model - 1),
});
const counterStep = Program.next(1, Program.commands(Program.emit<CounterMessage>("increment")));
const counterCommand: Program.Command<CounterMessage> = Program.emit(Effect.void);
const counterCommands = Program.commands(
  Program.emit<CounterMessage>("increment"),
  Program.emit(Effect.void),
);
const counterSubscription = Program.subscription(Stream.empty as Stream.Stream<CounterMessage>);
const counterStory = Program.story(counterProgram);
const counterRuntimeError: Program.RuntimeError<never> =
  null as unknown as Program.RuntimeError<never>;
const counterDispatchError: Program.DispatchError<never> =
  null as unknown as Program.DispatchError<never>;
const counterInstance: Program.Instance<
  number,
  CounterMessage,
  Program.RuntimeError<never>,
  Program.DispatchError<never>
> = Program.start(counterProgram, { runtime });
type TaggedCounterModel = { readonly count: number; readonly loading: boolean };
type TaggedCounterMessage =
  | { readonly _tag: "Increment" }
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly amount: number };
const taggedCounterHandlers: Program.HandlerMap<TaggedCounterModel, TaggedCounterMessage> = {
  Increment: (model) => ({ ...model, count: model.count + 1 }),
  Load: (model) =>
    Program.next(
      { ...model, loading: true },
      Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
    ),
  Loaded: (model, message) => ({
    count: model.count + message.amount,
    loading: false,
  }),
};
const taggedCounterDefinition: Program.HandlerDefinition<TaggedCounterModel, TaggedCounterMessage> =
  {
    initial: { count: 0, loading: false },
    on: taggedCounterHandlers,
  };
const taggedCounterProgram = Program.define<TaggedCounterModel, TaggedCounterMessage>(
  taggedCounterDefinition,
);
const taggedCounterProgramFromUpdate = Program.define<TaggedCounterModel, TaggedCounterMessage>({
  initial: { count: 0, loading: false },
  update: Program.update<TaggedCounterModel, TaggedCounterMessage>(taggedCounterHandlers),
});
const taggedCounterImmediateCommand = Program.emit({ _tag: "Increment" } as const);
const taggedCounterImmediateStep: Program.Step<TaggedCounterModel, TaggedCounterMessage> =
  Program.next({ count: 0, loading: false }, Program.emit({ _tag: "Increment" } as const));
const taggedCounterStory = Program.story(taggedCounterProgramFromUpdate);
// @ts-expect-error Program handler maps must cover every tagged message.
const incompleteTaggedCounterHandlers: Program.HandlerMap<
  TaggedCounterModel,
  TaggedCounterMessage
> = {
  Increment: (model) => model,
  Load: (model) => model,
};
void taggedCounterProgram;
void taggedCounterImmediateCommand;
void taggedCounterImmediateStep;
void taggedCounterStory;
void incompleteTaggedCounterHandlers;

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
const cookieHeaderEffect = serializeResponseCookie("theme", "dark", { sameSite: "Lax" });

const codecOperation: ResourceSnapshotCodecOperation = "decode";
const codecError = new ResourceSnapshotCodecError({
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
  match: coreRoutes[0].match("/projects/atlas")!,
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
void counterStep;
void counterCommand;
void counterCommands;
void counterSubscription;
void counterStory;
void counterRuntimeError;
void counterDispatchError;
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
declare const coreActionTransportResponse: ActionTransportResponse<string, "rejected">;
const coreActionTransportApply: Effect.Effect<void, Server.ClientError> =
  coreActionTransportResponse.apply(true);
const coreActionTransportService: Context.Service<ActionTransport, ActionTransport> =
  ActionTransport;
void coreActionTransport;
void coreActionTransportApply;
void coreActionTransportService;

// Route components may be renderer component values; `withComponent` keeps the
// attached component's type for adapters to check.
declare const coreRouteView: RouteView<Route.Props<typeof coreTypedRoute>>;
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
const coreInternalProgram = startProgramOnRuntime(
  Program.define<number, "tick">({ initial: 0, update: (model) => model + 1 }),
  coreErasedRuntime,
);
void coreInternalAction;
void coreInternalProgram;

// Durable submissions: `durable` requires an input schema and adds
// `ActionQueued` to the Action's error type; non-durable Actions are unchanged.
const DurableAdvanceInput = Schema.Struct({ id: Schema.String });
const durablePolicy: ActionDurablePolicy = { maxAge: "1 day" };
const DurableAdvance = Action.define({
  name: "type-tests/durable-advance",
  input: DurableAdvanceInput,
  output: Schema.Number,
  durable: durablePolicy,
  run: ({ id }): Effect.Effect<number, "Rejected"> =>
    id.length > 0 ? Effect.succeed(1) : Effect.fail("Rejected"),
});
const durableAdvanceDefinition: ActionDefinition<
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
const durableNoOutputDefinition: ActionDefinition<{ readonly id: string }, string, ActionQueued> =
  DurableNoOutput;
const PlainAdvance = Action.define({
  name: "type-tests/plain-advance",
  input: DurableAdvanceInput,
  run: () => Effect.succeed(1),
});
const plainAdvanceDefinition: ActionDefinition<{ readonly id: string }, number, never> =
  PlainAdvance;
// @ts-expect-error -- a durable Action's error type includes ActionQueued.
const durableAdvanceWithoutQueued: ActionDefinition<{ readonly id: string }, number, "Rejected"> =
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
  "Rejected" | ActionQueued | Server.ClientError | ActionInterruptedError
> = durableInstance.submit({ id: "atlas" });
type ActionInterruptedError =
  Effect.Error<ReturnType<typeof durableInstance.submit>> extends infer E
    ? Extract<E, { readonly _tag: "ActionInterrupted" }>
    : never;
const outboxView: Effect.Effect<ActionOutboxView> = Action.outbox;
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
