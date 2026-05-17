import {
  ActionInterrupted,
  makeMemoryBrowserHistoryAdapter,
  route,
  type EffectInputCallbackError,
} from "@sunfall/arc-core";
import { Effect, Stream } from "effect";
import {
  Action,
  Program,
  Resource,
  Route,
  RuntimeContext,
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RouterRouteNotRegistered,
  RuntimeProvider,
  Signal,
  UiScope,
  createBrowserRouter,
  createComponentScope,
  createEffectRuntime,
  forkScoped,
  isPlainLeftClick,
  onDispose,
  read,
  useAction,
  useProgram,
  useResource,
  useResourceError,
  useResourceResult,
  useResourceSuspense,
  useResourceValue,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useSignal,
  useStream,
  watch,
  type ActionHandle,
  type BrowserNavigateArgs,
  type BrowserNavigateOptions,
  type BrowserRouter,
  type BrowserRouterPath,
  type BrowserRouterOptions,
  type BrowserRouterRouteForPath,
  type BrowserRouterState,
  type ProgramHandle,
  type ResourceHandle,
  type ResourceMatch,
  type ResourceSuccessMeta,
  type RouterLinkProps,
  type RouterProviderProps,
  type RouterOutletProps,
  type RuntimeEffectRunner,
  type RuntimeProviderProps,
  type UseResourceOptions,
} from "@sunfall/arc-solid";

interface SolidProject {
  readonly id: string;
  readonly name: string;
}

const solidRoutes = [route("/", {}), route("/projects/:id", {})] as const;
const solidHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const solidBrowserOptions: BrowserRouterOptions<typeof solidRoutes> = {
  history: solidHistory,
  hydrating: true,
};
const solidRouter: BrowserRouter<typeof solidRoutes> = createBrowserRouter(solidRoutes, {
  history: solidHistory,
  hydrating: true,
});
const solidRouterFromHook: BrowserRouter<typeof solidRoutes> = useRouter<typeof solidRoutes>();
const solidRouterState: BrowserRouterState<typeof solidRoutes> = solidRouter.state();
const solidRoutePath: BrowserRouterPath<typeof solidRoutes> = "/";
type SolidRouteForHome = BrowserRouterRouteForPath<typeof solidRoutes, typeof solidRoutePath>;
const solidRouteForPath: SolidRouteForHome = solidRoutes[0];
const solidRouteHref: string = Route.href(solidRoutes[0]);
const solidNavigateArgs: BrowserNavigateArgs<(typeof solidRoutes)[0]> = [];
const solidNavigateOptions: BrowserNavigateOptions = { replace: true };
const solidHrefByPath: string = solidRouter.hrefByPath("/projects/:id", {
  params: { id: "atlas" },
});
solidRouter.navigateByPath(
  "/projects/:id",
  {
    params: { id: "atlas" },
  },
  solidNavigateOptions,
);
const solidMatchByPath = solidRouter.matchByPath("/projects/:id");
const solidPreloadByPathEffect: Effect.Effect<void, Route.NavigationError> =
  solidRouter.preloadByPathEffect("/projects/:id", { params: { id: "atlas" } });
const solidPlainLeftClick: boolean = isPlainLeftClick({
  button: 0,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
});
const solidRouterLinkProps: RouterLinkProps<(typeof solidRoutes)[0]> = {
  route: solidRoutes[0],
  children: "Home",
};
const solidRouterLinkNode = RouterLink(solidRouterLinkProps);
const solidRouterOutletNode = RouterOutlet<typeof solidRoutes>({});
const solidContextMissing = new RouterContextMissing({ hook: "useRouter" });
const solidRouteNotRegistered = new RouterRouteNotRegistered({ path: "/" });
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  history: solidHistory,
  hydrating: true,
};
const solidCountSignal = Signal.make(0);
const solidReadSignalValue: number = read(solidCountSignal);
const solidUiScope = new UiScope();
const solidEffectRuntime = createEffectRuntime();
class SolidRuntimeProviderObserverError {
  readonly _tag = "SolidRuntimeProviderObserverError";
}
declare const solidRuntimeProviderObserverPromise: Promise<void>;
const solidRuntimeProviderFailingObserverProps: RuntimeProviderProps = {
  onDisposeFailure: () => Effect.fail(new SolidRuntimeProviderObserverError()),
};
const solidRuntimeProviderPromiseObserverProps: RuntimeProviderProps = {
  // @ts-expect-error RuntimeProvider disposal observers must return void or an Effect, not a Promise.
  onDisposeFailure: () => solidRuntimeProviderObserverPromise,
};
// @ts-expect-error host-owned RuntimeProvider instances do not accept disposal observers.
const solidRuntimeProviderHostOwnedObserverProps: RuntimeProviderProps = {
  runtime: solidEffectRuntime,
  onDisposeFailure: () => Effect.void,
};
const solidForkScoped: typeof forkScoped = forkScoped;
const solidOnDispose: typeof onDispose = onDispose;
const solidWatch: typeof watch = watch;
const solidCreateComponentScope: typeof createComponentScope = createComponentScope;
const solidSignalValue = useSignal(solidCountSignal);
const solidStreamValue = useStream(Stream.succeed("ready"), "idle");
const solidRuntime = useRuntime();
const solidRuntimeRunner: RuntimeEffectRunner = useRuntimeEffect();
const solidRuntimeFiber = solidRuntimeRunner(Effect.succeed("ready"));
const SolidProgram = Program.define<number, "tick">({
  initial: 0,
  update: (model) => Program.next(model + 1),
});
const solidProgramHandle: ProgramHandle<
  number,
  "tick",
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
> = useProgram<number, "tick">(SolidProgram);
solidProgramHandle.clearTimeline();
const solidUnknownProgramHandle = solidProgramHandle as ProgramHandle<
  number,
  unknown,
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
>;
// @ts-expect-error Solid Program handles cannot dispatch Promise-shaped messages
solidUnknownProgramHandle.dispatch(solidRuntimeProviderObserverPromise);
// @ts-expect-error Solid Program handles cannot Effect-dispatch Promise-shaped messages
solidUnknownProgramHandle.dispatchEffect(solidRuntimeProviderObserverPromise);
const SolidProjectById = Resource.family<string, SolidProject>({
  name: "Solid.type-test.project",
  load: (id) => Effect.succeed({ id, name: "Atlas" }),
});
const solidProjectRef = SolidProjectById("atlas");
const solidResourceOptions: UseResourceOptions<never> = { preload: false };
const solidResourceHandle: ResourceHandle<string, SolidProject, never> = useResource(
  solidProjectRef,
  solidResourceOptions,
);
const solidResourceState = useResourceResult(solidProjectRef);
const solidResourceValue = useResourceValue(solidProjectRef);
const solidResourceError = useResourceError(solidProjectRef);
const solidResourceSuccessMeta: ResourceSuccessMeta<SolidProject, Resource.LoadError<never>> = {
  refreshing: false,
  state: {
    _tag: "Success",
    waiting: false,
    value: { id: "atlas", name: "Atlas" },
    updatedAt: 0,
  },
};
const solidResourceMatch: ResourceMatch<SolidProject, Resource.LoadError<never>, string> = {
  initial: () => "initial",
  pending: () => "pending",
  success: (project) => project.name,
  failure: () => "failure",
};
const SolidAction = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
  name: "Solid.type-test.action",
  run: ({ id }) => Effect.succeed({ ok: id.length > 0 }),
});
const solidAction = useAction(SolidAction);
const solidActionHandle: ActionHandle<{ readonly id: string }, { readonly ok: boolean }> =
  solidAction;
const solidActionSubmit: Effect.Effect<
  { readonly ok: boolean },
  EffectInputCallbackError | ActionInterrupted
> = solidAction.submitEffect({ id: "atlas" });
const solidActionStateTag: "Idle" | "Pending" | "Success" | "Failure" = solidAction.state()._tag;
solidAction.instance.state.get()._tag;
solidAction.invalidationPlan()?.entries.map((entry) => entry.ref.key);
const solidExports: Array<unknown> = [
  Action,
  Program,
  Resource,
  Route,
  RuntimeContext,
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RouterRouteNotRegistered,
  RuntimeProvider,
  Signal,
  UiScope,
  createBrowserRouter,
  createComponentScope,
  createEffectRuntime,
  forkScoped,
  isPlainLeftClick,
  onDispose,
  read,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
  useResourceError,
  useResourceResult,
  useResourceValue,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useSignal,
  useStream,
  watch,
  solidRouter,
  solidRouterFromHook,
  solidRouterState,
  solidRoutePath,
  solidRouteForPath,
  solidRouteHref,
  solidNavigateArgs,
  solidNavigateOptions,
  solidHrefByPath,
  solidMatchByPath,
  solidPreloadByPathEffect,
  solidPlainLeftClick,
  solidRouterLinkProps,
  solidRouterLinkNode,
  solidRouterOutletNode,
  solidContextMissing,
  solidRouteNotRegistered,
  solidReadSignalValue,
  solidUiScope,
  solidEffectRuntime,
  solidRuntimeProviderFailingObserverProps,
  solidRuntimeProviderPromiseObserverProps,
  solidRuntimeProviderHostOwnedObserverProps,
  solidForkScoped,
  solidOnDispose,
  solidWatch,
  solidCreateComponentScope,
  solidRuntime,
  solidRuntimeFiber,
  solidProgramHandle,
  solidResourceHandle,
  solidResourceState,
  solidResourceValue,
  solidResourceError,
  solidResourceSuccessMeta,
  solidResourceHandle.match(solidResourceMatch),
  solidSignalValue,
  solidStreamValue,
  solidActionHandle,
  solidActionSubmit,
  solidActionStateTag,
  solidBrowserOptions,
  solidProviderProps,
];
type SolidRouter = BrowserRouter | RouterOutletProps;
type SolidRouterLinkProps = RouterLinkProps<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateArgs = BrowserNavigateArgs<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateOptions = BrowserNavigateOptions;
type SolidBrowserRouterPath = BrowserRouterPath<typeof solidRoutes>;
type SolidBrowserRouterRouteForPath = BrowserRouterRouteForPath<typeof solidRoutes, "/">;
type SolidBrowserRouterState = BrowserRouterState<typeof solidRoutes>;
type SolidBrowserRouterOptions = BrowserRouterOptions;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
type SolidRuntimeProviderProps = RuntimeProviderProps;
type SolidRouteHrefOptions = Route.HrefOptions<(typeof solidRoutes)[0]>;
type SolidUiScope = UiScope;
type SolidActionHandle = ActionHandle<{ readonly id: string }, { readonly ok: boolean }>;
type SolidProgramHandle = ProgramHandle<
  number,
  "tick",
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
>;
type SolidResourceHandle = ResourceHandle<string, SolidProject, never>;
type SolidUseResourceOptions = UseResourceOptions<never>;
type SolidRuntimeEffectRunner = RuntimeEffectRunner;
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidRouterLinkProps = SolidRouterLinkProps;
type _SolidBrowserNavigateArgs = SolidBrowserNavigateArgs;
type _SolidBrowserNavigateOptions = SolidBrowserNavigateOptions;
type _SolidBrowserRouterPath = SolidBrowserRouterPath;
type _SolidBrowserRouterRouteForPath = SolidBrowserRouterRouteForPath;
type _SolidBrowserRouterState = SolidBrowserRouterState;
type _SolidBrowserRouterOptions = SolidBrowserRouterOptions;
type _SolidRouterProviderProps = SolidRouterProviderProps;
type _SolidRuntimeProviderProps = SolidRuntimeProviderProps;
type _SolidRouteHrefOptions = SolidRouteHrefOptions;
type _SolidUiScope = SolidUiScope;
type _SolidActionHandle = SolidActionHandle;
type _SolidProgramHandle = SolidProgramHandle;
type _SolidResourceHandle = SolidResourceHandle;
type _SolidUseResourceOptions = SolidUseResourceOptions;
type _SolidRuntimeEffectRunner = SolidRuntimeEffectRunner;
