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
  createEffectRuntime,
  forkScoped,
  isPlainLeftClick,
  onDispose,
  read,
  useAction,
  useComponentScope,
  useProgram,
  useResource,
  useResourceError,
  useResourceResult,
  useResourceSuspense,
  useResourceValue,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useScoped,
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
} from "@sunfall/arc-react";
type ReactCommitScopeFactoryIsInternal =
  // @ts-expect-error React commit-scope frames are adapter internals, not root public exports.
  typeof import("@sunfall/arc-react").makeReactRuntimeUiScopeFrame;
// @ts-expect-error React commit-scope frame types are adapter internals, not root public exports.
type ReactCommitScopeFrameIsInternal = import("@sunfall/arc-react").ReactRuntimeUiScopeFrame<never>;

interface ReactProject {
  readonly id: string;
  readonly name: string;
}

const reactRoutes = [route("/", {})] as const;
const reactHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const reactBrowserOptions: BrowserRouterOptions<typeof reactRoutes> = {
  history: reactHistory,
  hydrating: true,
};
const reactRouter: BrowserRouter<typeof reactRoutes> = createBrowserRouter(reactRoutes, {
  history: reactHistory,
  hydrating: true,
});
const reactRouterFromHook: BrowserRouter<typeof reactRoutes> = useRouter<typeof reactRoutes>();
const reactRouterState: BrowserRouterState<typeof reactRoutes> = reactRouter.state.get();
const reactRoutePath: BrowserRouterPath<typeof reactRoutes> = "/";
type ReactRouteForHome = BrowserRouterRouteForPath<typeof reactRoutes, typeof reactRoutePath>;
const reactRouteForPath: ReactRouteForHome = reactRoutes[0];
const reactRouteHref: string = Route.href(reactRoutes[0]);
const reactNavigateArgs: BrowserNavigateArgs<(typeof reactRoutes)[0]> = [];
const reactNavigateOptions: BrowserNavigateOptions = { replace: true };
const reactPlainLeftClick: boolean = isPlainLeftClick({
  button: 0,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
});
const reactRouterLinkProps: RouterLinkProps<(typeof reactRoutes)[0]> = {
  route: reactRoutes[0],
  children: "Home",
};
const reactRouterLinkNode = RouterLink(reactRouterLinkProps);
const reactRouterOutletNode = RouterOutlet<typeof reactRoutes>({});
const reactContextMissing = new RouterContextMissing({ hook: "useRouter" });
const reactRouteNotRegistered = new RouterRouteNotRegistered({ path: "/" });
const reactProviderProps: RouterProviderProps<typeof reactRoutes> = {
  routes: reactRoutes,
  history: reactHistory,
  hydrating: true,
};
const reactCountSignal = Signal.make(0);
const reactReadSignalValue: number = read(reactCountSignal);
const reactUiScope = new UiScope();
const reactEffectRuntime = createEffectRuntime();
class ReactRuntimeProviderObserverError {
  readonly _tag = "ReactRuntimeProviderObserverError";
}
declare const reactRuntimeProviderObserverPromise: Promise<void>;
const reactRuntimeProviderFailingObserverProps: RuntimeProviderProps = {
  onDisposeFailure: () => Effect.fail(new ReactRuntimeProviderObserverError()),
};
const reactRuntimeProviderPromiseObserverProps: RuntimeProviderProps = {
  // @ts-expect-error RuntimeProvider disposal observers must return void or an Effect, not a Promise.
  onDisposeFailure: () => reactRuntimeProviderObserverPromise,
};
// @ts-expect-error host-owned RuntimeProvider instances do not accept disposal observers.
const reactRuntimeProviderHostOwnedObserverProps: RuntimeProviderProps = {
  runtime: reactEffectRuntime,
  onDisposeFailure: () => Effect.void,
};
const reactForkScoped: typeof forkScoped = forkScoped;
const reactOnDispose: typeof onDispose = onDispose;
const reactWatch: typeof watch = watch;
const reactUseComponentScope: typeof useComponentScope = useComponentScope;
const reactUseScoped: typeof useScoped = useScoped;
const reactSignalValue: number = useSignal(reactCountSignal);
const reactStreamValue: string = useStream(Stream.succeed("ready"), "idle");
const reactRuntime = useRuntime();
const reactRuntimeRunner: RuntimeEffectRunner = useRuntimeEffect();
const reactRuntimeFiber = reactRuntimeRunner(Effect.succeed("ready"));
const ReactProgram = Program.define<number, "tick">({
  initial: 0,
  update: (model) => Program.next(model + 1),
});
const reactProgramHandle: ProgramHandle<
  number,
  "tick",
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
> = useProgram<number, "tick">(ReactProgram);
reactProgramHandle.clearTimeline();
const reactUnknownProgramHandle = reactProgramHandle as ProgramHandle<
  number,
  unknown,
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
>;
// @ts-expect-error React Program handles cannot dispatch Promise-shaped messages
reactUnknownProgramHandle.dispatch(reactRuntimeProviderObserverPromise);
// @ts-expect-error React Program handles cannot Effect-dispatch Promise-shaped messages
reactUnknownProgramHandle.dispatchEffect(reactRuntimeProviderObserverPromise);
const ReactProjectById = Resource.family<string, ReactProject>({
  name: "React.type-test.project",
  load: (id) => Effect.succeed({ id, name: "Atlas" }),
});
const reactProjectRef = ReactProjectById("atlas");
const reactResourceOptions: UseResourceOptions<never> = { preload: false };
const reactResourceHandle: ResourceHandle<string, ReactProject, never> = useResource(
  reactProjectRef,
  reactResourceOptions,
);
const reactResourceState = useResourceResult(reactProjectRef);
const reactResourceValue = useResourceValue(reactProjectRef);
const reactResourceError = useResourceError(reactProjectRef);
const reactResourceSuccessMeta: ResourceSuccessMeta<ReactProject, Resource.LoadError<never>> = {
  refreshing: false,
  state: {
    _tag: "Success",
    waiting: false,
    value: { id: "atlas", name: "Atlas" },
    updatedAt: 0,
  },
};
const reactResourceMatch: ResourceMatch<ReactProject, Resource.LoadError<never>, string> = {
  initial: () => "initial",
  pending: () => "pending",
  success: (project) => project.name,
  failure: () => "failure",
};
const ReactAction = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
  name: "React.type-test.action",
  run: ({ id }) => Effect.succeed({ ok: id.length > 0 }),
});
const reactAction = useAction(ReactAction);
const reactActionHandle: ActionHandle<{ readonly id: string }, { readonly ok: boolean }> =
  reactAction;
const reactActionSubmit: Effect.Effect<
  { readonly ok: boolean },
  EffectInputCallbackError | ActionInterrupted
> = reactAction.submitEffect({ id: "atlas" });
const reactActionStateTag: "Idle" | "Pending" | "Success" | "Failure" = reactAction.state._tag;
reactAction.instance.state.get()._tag;
reactAction.invalidationPlan?.entries.map((entry) => entry.ref.key);
const reactExports: Array<unknown> = [
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
  createEffectRuntime,
  forkScoped,
  isPlainLeftClick,
  onDispose,
  read,
  useAction,
  useComponentScope,
  useProgram,
  useResource,
  useResourceSuspense,
  useResourceError,
  useResourceResult,
  useResourceValue,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useScoped,
  useSignal,
  useStream,
  watch,
  reactRouter,
  reactRouterFromHook,
  reactRouterState,
  reactRoutePath,
  reactRouteForPath,
  reactRouteHref,
  reactNavigateArgs,
  reactNavigateOptions,
  reactPlainLeftClick,
  reactRouterLinkProps,
  reactRouterLinkNode,
  reactRouterOutletNode,
  reactContextMissing,
  reactRouteNotRegistered,
  reactReadSignalValue,
  reactUiScope,
  reactEffectRuntime,
  reactRuntimeProviderFailingObserverProps,
  reactRuntimeProviderPromiseObserverProps,
  reactRuntimeProviderHostOwnedObserverProps,
  reactForkScoped,
  reactOnDispose,
  reactWatch,
  reactUseComponentScope,
  reactUseScoped,
  reactRuntime,
  reactRuntimeFiber,
  reactProgramHandle,
  reactResourceHandle,
  reactResourceState,
  reactResourceValue,
  reactResourceError,
  reactResourceSuccessMeta,
  reactResourceHandle.match(reactResourceMatch),
  reactSignalValue,
  reactStreamValue,
  reactActionHandle,
  reactActionSubmit,
  reactActionStateTag,
  reactBrowserOptions,
  reactProviderProps,
];
type ReactRouter = BrowserRouter | RouterOutletProps;
type ReactRouterLinkProps = RouterLinkProps<(typeof reactRoutes)[0]>;
type ReactBrowserNavigateArgs = BrowserNavigateArgs<(typeof reactRoutes)[0]>;
type ReactBrowserNavigateOptions = BrowserNavigateOptions;
type ReactBrowserRouterPath = BrowserRouterPath<typeof reactRoutes>;
type ReactBrowserRouterRouteForPath = BrowserRouterRouteForPath<typeof reactRoutes, "/">;
type ReactBrowserRouterState = BrowserRouterState<typeof reactRoutes>;
type ReactBrowserRouterOptions = BrowserRouterOptions;
type ReactRouterProviderProps = RouterProviderProps<typeof reactRoutes>;
type ReactRuntimeProviderProps = RuntimeProviderProps;
type ReactRouteHrefOptions = Route.HrefOptions<(typeof reactRoutes)[0]>;
type ReactUiScope = UiScope;
type ReactActionHandle = ActionHandle<{ readonly id: string }, { readonly ok: boolean }>;
type ReactProgramHandle = ProgramHandle<
  number,
  "tick",
  EffectInputCallbackError,
  EffectInputCallbackError | Program.Disposed
>;
type ReactResourceHandle = ResourceHandle<string, ReactProject, never>;
type ReactUseResourceOptions = UseResourceOptions<never>;
type ReactRuntimeEffectRunner = RuntimeEffectRunner;
void reactExports;
type _ReactRouter = ReactRouter;
type _ReactRouterLinkProps = ReactRouterLinkProps;
type _ReactBrowserNavigateArgs = ReactBrowserNavigateArgs;
type _ReactBrowserNavigateOptions = ReactBrowserNavigateOptions;
type _ReactBrowserRouterPath = ReactBrowserRouterPath;
type _ReactBrowserRouterRouteForPath = ReactBrowserRouterRouteForPath;
type _ReactBrowserRouterState = ReactBrowserRouterState;
type _ReactBrowserRouterOptions = ReactBrowserRouterOptions;
type _ReactRouterProviderProps = ReactRouterProviderProps;
type _ReactRuntimeProviderProps = ReactRuntimeProviderProps;
type _ReactRouteHrefOptions = ReactRouteHrefOptions;
type _ReactUiScope = ReactUiScope;
type _ReactActionHandle = ReactActionHandle;
type _ReactProgramHandle = ReactProgramHandle;
type _ReactResourceHandle = ReactResourceHandle;
type _ReactUseResourceOptions = ReactUseResourceOptions;
type _ReactRuntimeEffectRunner = ReactRuntimeEffectRunner;
