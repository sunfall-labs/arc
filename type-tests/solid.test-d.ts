import {
  Action,
  ActionInterrupted,
  Program,
  Resource,
  Signal,
  makeMemoryBrowserHistoryAdapter,
  route,
  type EffectInputCallbackError
} from "@effect-ui/core";
import { Effect, Stream } from "effect";
import {
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RouterRouteNotRegistered,
  RuntimeProvider,
  createBrowserRouter,
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
  type ActionHandle,
  type BrowserNavigateArgs,
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
  type UseResourceOptions
} from "@effect-ui/solid";

interface SolidProject {
  readonly id: string;
  readonly name: string;
}

const solidRoutes = [route("/", {})] as const;
const solidHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const solidBrowserOptions: BrowserRouterOptions<typeof solidRoutes> = {
  history: solidHistory,
  hydrating: true
};
const solidRouter: BrowserRouter<typeof solidRoutes> = createBrowserRouter(solidRoutes, {
  history: solidHistory,
  hydrating: true
});
const solidRouterFromHook: BrowserRouter<typeof solidRoutes> = useRouter<typeof solidRoutes>();
const solidRouterState: BrowserRouterState<typeof solidRoutes> = solidRouter.state();
const solidRoutePath: BrowserRouterPath<typeof solidRoutes> = "/";
type SolidRouteForHome = BrowserRouterRouteForPath<typeof solidRoutes, typeof solidRoutePath>;
const solidRouteForPath: SolidRouteForHome = solidRoutes[0];
const solidNavigateArgs: BrowserNavigateArgs<typeof solidRoutes[0]> = [];
const solidRouterLinkProps: RouterLinkProps<typeof solidRoutes[0]> = {
  route: solidRoutes[0],
  children: "Home"
};
const solidRouterLinkNode = RouterLink(solidRouterLinkProps);
const solidRouterOutletNode = RouterOutlet<typeof solidRoutes>({});
const solidContextMissing = new RouterContextMissing({ hook: "useRouter" });
const solidRouteNotRegistered = new RouterRouteNotRegistered({ path: "/" });
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  history: solidHistory,
  hydrating: true
};
const solidCountSignal = Signal.make(0);
const solidSignalValue = useSignal(solidCountSignal);
const solidStreamValue = useStream(Stream.succeed("ready"), "idle");
const solidRuntime = useRuntime();
const solidRuntimeRunner: RuntimeEffectRunner = useRuntimeEffect();
const solidRuntimeFiber = solidRuntimeRunner(Effect.succeed("ready"));
const SolidProgram = Program.define<number, "tick">({
  initial: 0,
  update: (model) => Program.next(model + 1)
});
const solidProgramHandle: ProgramHandle<number, "tick", EffectInputCallbackError, EffectInputCallbackError | Program.Disposed> =
  useProgram<number, "tick">(SolidProgram);
solidProgramHandle.clearTimeline();
const SolidProjectById = Resource.family<string, SolidProject>({
  name: "Solid.type-test.project",
  load: (id) => Effect.succeed({ id, name: "Atlas" })
});
const solidProjectRef = SolidProjectById("atlas");
const solidResourceOptions: UseResourceOptions<never> = { preload: false };
const solidResourceHandle: ResourceHandle<string, SolidProject, never> = useResource(
  solidProjectRef,
  solidResourceOptions
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
    updatedAt: 0
  }
};
const solidResourceMatch: ResourceMatch<SolidProject, Resource.LoadError<never>, string> = {
  initial: () => "initial",
  pending: () => "pending",
  success: (project) => project.name,
  failure: () => "failure"
};
const SolidAction = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
  name: "Solid.type-test.action",
  run: ({ id }) => Effect.succeed({ ok: id.length > 0 })
});
const solidAction = useAction(SolidAction);
const solidActionHandle: ActionHandle<
  { readonly id: string },
  { readonly ok: boolean }
> = solidAction;
const solidActionSubmit: Effect.Effect<
  { readonly ok: boolean },
  EffectInputCallbackError | ActionInterrupted
> = solidAction.submitEffect({ id: "atlas" });
const solidActionStateTag:
  | "Idle"
  | "Pending"
  | "Success"
  | "Failure" = solidAction.state()._tag;
solidAction.instance.state.get()._tag;
solidAction.invalidationPlan()?.entries.map((entry) => entry.ref.key);
const solidExports: Array<unknown> = [
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RouterRouteNotRegistered,
  RuntimeProvider,
  createBrowserRouter,
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
  solidRouter,
  solidRouterFromHook,
  solidRouterState,
  solidRoutePath,
  solidRouteForPath,
  solidNavigateArgs,
  solidRouterLinkProps,
  solidRouterLinkNode,
  solidRouterOutletNode,
  solidContextMissing,
  solidRouteNotRegistered,
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
  solidProviderProps
];
type SolidRouter = BrowserRouter | RouterOutletProps;
type SolidRouterLinkProps = RouterLinkProps<typeof solidRoutes[0]>;
type SolidBrowserNavigateArgs = BrowserNavigateArgs<typeof solidRoutes[0]>;
type SolidBrowserRouterPath = BrowserRouterPath<typeof solidRoutes>;
type SolidBrowserRouterRouteForPath = BrowserRouterRouteForPath<typeof solidRoutes, "/">;
type SolidBrowserRouterState = BrowserRouterState<typeof solidRoutes>;
type SolidBrowserRouterOptions = BrowserRouterOptions;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
type SolidActionHandle = ActionHandle<{ readonly id: string }, { readonly ok: boolean }>;
type SolidProgramHandle = ProgramHandle<number, "tick", EffectInputCallbackError, EffectInputCallbackError | Program.Disposed>;
type SolidResourceHandle = ResourceHandle<string, SolidProject, never>;
type SolidUseResourceOptions = UseResourceOptions<never>;
type SolidRuntimeEffectRunner = RuntimeEffectRunner;
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidRouterLinkProps = SolidRouterLinkProps;
type _SolidBrowserNavigateArgs = SolidBrowserNavigateArgs;
type _SolidBrowserRouterPath = SolidBrowserRouterPath;
type _SolidBrowserRouterRouteForPath = SolidBrowserRouterRouteForPath;
type _SolidBrowserRouterState = SolidBrowserRouterState;
type _SolidBrowserRouterOptions = SolidBrowserRouterOptions;
type _SolidRouterProviderProps = SolidRouterProviderProps;
type _SolidActionHandle = SolidActionHandle;
type _SolidProgramHandle = SolidProgramHandle;
type _SolidResourceHandle = SolidResourceHandle;
type _SolidUseResourceOptions = SolidUseResourceOptions;
type _SolidRuntimeEffectRunner = SolidRuntimeEffectRunner;
