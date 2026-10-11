import {
  Action,
  ActionInterrupted,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Program,
  Resource,
  route,
  Route,
  RouterRouteNotRegistered,
  Signal,
  type BrowserNavigateArgs,
  type BrowserNavigateOptions,
  type BrowserRouterError,
  type BrowserRouterPath,
  type BrowserRouterRouteForPath,
  type BrowserRouterState,
  type EffectInputCallbackError,
} from "@sunfall/arc-core";
import { Cause, Effect, Option, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Component,
  RuntimeContext,
  RuntimeContextMissing,
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RuntimeProvider,
  createComponentScope,
  isPlainLeftClick,
  useAction,
  useProgram,
  useResource,
  useResourceResult,
  useResourceSuspense,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useStream,
  type ActionHandle,
  type BrowserRouter,
  type ProgramHandle,
  type ProgramModelView,
  type ResourceHandle,
  type RouterLinkProps,
  type RouterProviderProps,
  type RouterOutletProps,
  type RuntimeEffectRunner,
  type RuntimeProviderProps,
  type UseProgramOptions,
  type UseResourceOptions,
} from "@sunfall/arc-solid";

interface SolidProject {
  readonly id: string;
  readonly name: string;
}

const solidRoutes = [route("/", {}), route("/projects/:id", {})] as const;
const solidHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const solidRouter: BrowserRouter<typeof solidRoutes> = useRouter<typeof solidRoutes>();
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
const solidPreloadByPathEffect: Effect.Effect<
  void,
  BrowserRouterError<typeof solidRoutes>
> = solidRouter.preloadByPathEffect("/projects/:id", { params: { id: "atlas" } });
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
const solidRuntimeContextMissing = new RuntimeContextMissing({ hook: "useRuntime" });
const solidRouteNotRegistered = new RouterRouteNotRegistered({ path: "/" });
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  history: solidHistory,
  hydrating: true,
};
const solidProviderRuntimeProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  // @ts-expect-error RouterProvider reads its runtime from RuntimeProvider context.
  runtime: makeRuntime(),
};
const solidCountSignal = Signal.make(0);
const solidReadSignalValue: number = solidCountSignal.get();
const solidEffectRuntime = makeRuntime();
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
const solidCreateComponentScope: typeof createComponentScope = createComponentScope;
const solidSignalValue = (): number => solidCountSignal.get();
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
const solidProgramCount: number = solidProgramHandle.model();
void solidProgramCount;

type SolidTypeEquals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const solidTypeEquals = <A, B>(proof: SolidTypeEquals<A, B>): typeof proof => proof;

interface SolidBoardModel {
  title: string;
  tags: Array<string>;
  rows: Array<{ id: number; label: string; meta: { done: boolean } }>;
  pair: [number, { at: Date }];
  owners: Map<string, { name: string }>;
  seen: Set<number>;
  selected: { id: number } | null;
  format: (value: number) => string;
}
type SolidBoardView = ProgramModelView<SolidBoardModel>;
solidTypeEquals<
  SolidBoardView,
  {
    readonly title: string;
    readonly tags: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<{
      readonly id: number;
      readonly label: string;
      readonly meta: { readonly done: boolean };
    }>;
    readonly pair: readonly [number, { readonly at: Date }];
    readonly owners: ReadonlyMap<string, { name: string }>;
    readonly seen: ReadonlySet<number>;
    readonly selected: { readonly id: number } | null;
    readonly format: (value: number) => string;
  }
>(true);
solidTypeEquals<ProgramModelView<number>, number>(true);
solidTypeEquals<ProgramModelView<"idle" | "busy">, "idle" | "busy">(true);
solidTypeEquals<ProgramModelView<string | undefined>, string | undefined>(true);
solidTypeEquals<ProgramModelView<unknown>, unknown>(true);
declare const solidBoardProgram: Program.Definition<SolidBoardModel, { readonly _tag: "Noop" }>;
const solidBoardOptions: UseProgramOptions = { key: (row) => ("id" in row ? row.id : undefined) };
const solidBoardHandle = useProgram(solidBoardProgram, solidBoardOptions);
const solidBoardView: SolidBoardView = solidBoardHandle.model();
const solidBoardLabel: string = solidBoardView.rows[0]!.label;
const solidBoardModelSignal: Signal.Readable<SolidBoardModel> = solidBoardHandle.instance.model;
// @ts-expect-error Program model views are read-only
solidBoardView.title = "renamed";
// @ts-expect-error nested Program model objects are read-only
solidBoardView.rows[0]!.meta.done = true;
// @ts-expect-error Program model arrays are read-only
solidBoardView.tags.push("new");
// @ts-expect-error Program model Maps are read-only
solidBoardView.owners.set("a", { name: "Ada" });
// @ts-expect-error Program model reconcile keys are property names, key functions, or null
const solidInvalidBoardOptions: UseProgramOptions = { key: 1 };
void solidBoardLabel;
void solidBoardModelSignal;
void solidInvalidBoardOptions;
useProgram(solidBoardProgram, { key: "id" });
useProgram(solidBoardProgram, { key: null });

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
const solidResourcePromiseObserverOptions: UseResourceOptions<never> = {
  // @ts-expect-error Solid Resource preload observers cannot return Promise-shaped work
  onPreloadFailure: () => solidRuntimeProviderObserverPromise,
};
const solidResourceHandle: ResourceHandle<string, SolidProject, never> = useResource(
  solidProjectRef,
  solidResourceOptions,
);
const solidResourceState: () => AsyncResult.AsyncResult<SolidProject, Resource.LoadError<never>> =
  useResourceResult(solidProjectRef);
const solidResourceValue: Option.Option<SolidProject> = AsyncResult.value(
  solidResourceHandle.result(),
);
const solidResourceError: Option.Option<Resource.LoadError<never>> = AsyncResult.error(
  solidResourceHandle.result(),
);
// @ts-expect-error -- the handle exposes one `result()` accessor, not value/error/match helpers.
void solidResourceHandle.value;
// Recommended render: handle failure before success so `previousSuccess` keeps its type.
const solidResourceRender: string = AsyncResult.builder(solidResourceHandle.result())
  .onInitial(() => "initial")
  .onFailure((cause, failed) =>
    Option.match(failed.previousSuccess, {
      onNone: () => String(Cause.squash(cause)),
      onSome: (stale) => `${stale.value.name} (stale)`,
    }),
  )
  .onSuccess((project, success) => (success.waiting ? `${project.name}…` : project.name))
  .exhaustive();
AsyncResult.builder(solidResourceHandle.result())
  .onSuccess((project) => project.name)
  .onFailure(
    (_cause, failed) =>
      // @ts-expect-error -- after onSuccess the builder narrows the success type to never.
      Option.getOrThrow(failed.previousSuccess).value.name,
  );
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
const solidActionStateTag: "Initial" | "Success" | "Failure" = solidAction.result()._tag;
const solidActionInput: Option.Option<{ readonly id: string }> = solidAction.input();
solidAction.instance.state.get().result._tag;
solidAction.invalidationPlan()?.entries.map((entry) => entry.ref.key);
const solidExports: Array<unknown> = [
  RuntimeContext,
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RuntimeProvider,
  createComponentScope,
  isPlainLeftClick,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
  useResourceResult,
  useRouter,
  useRuntime,
  useRuntimeEffect,
  useStream,
  solidRouter,
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
  solidRuntimeContextMissing,
  RuntimeContextMissing,
  solidRouteNotRegistered,
  solidReadSignalValue,
  solidEffectRuntime,
  solidRuntimeProviderFailingObserverProps,
  solidRuntimeProviderPromiseObserverProps,
  solidRuntimeProviderHostOwnedObserverProps,
  solidCreateComponentScope,
  solidRuntime,
  solidRuntimeFiber,
  solidProgramHandle,
  solidResourceHandle,
  solidResourceState,
  solidResourceValue,
  solidResourceError,
  solidResourceRender,
  solidActionInput,
  solidSignalValue,
  solidStreamValue,
  solidActionHandle,
  solidActionSubmit,
  solidActionStateTag,
  solidProviderProps,
  solidProviderRuntimeProps,
];
type SolidRouter = BrowserRouter | RouterOutletProps;
type SolidRouterLinkProps = RouterLinkProps<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateArgs = BrowserNavigateArgs<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateOptions = BrowserNavigateOptions;
type SolidBrowserRouterPath = BrowserRouterPath<typeof solidRoutes>;
type SolidBrowserRouterRouteForPath = BrowserRouterRouteForPath<typeof solidRoutes, "/">;
type SolidBrowserRouterState = BrowserRouterState<typeof solidRoutes>;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
type SolidRuntimeProviderProps = RuntimeProviderProps;
type SolidRouteHrefOptions = Route.HrefOptions<(typeof solidRoutes)[0]>;
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
// Full Component typing coverage lives in type-tests/component.test-d.ts.
const solidComponent: Component<{}> = Component.make("SolidTypeTest", function* () {
  yield* Effect.void;
  return () => "ok";
});
void Component.embed(solidComponent);
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidRouterLinkProps = SolidRouterLinkProps;
type _SolidBrowserNavigateArgs = SolidBrowserNavigateArgs;
type _SolidBrowserNavigateOptions = SolidBrowserNavigateOptions;
type _SolidBrowserRouterPath = SolidBrowserRouterPath;
type _SolidBrowserRouterRouteForPath = SolidBrowserRouterRouteForPath;
type _SolidBrowserRouterState = SolidBrowserRouterState;
type _SolidRouterProviderProps = SolidRouterProviderProps;
type _SolidRuntimeProviderProps = SolidRuntimeProviderProps;
type _SolidRouteHrefOptions = SolidRouteHrefOptions;
type _SolidActionHandle = SolidActionHandle;
type _SolidProgramHandle = SolidProgramHandle;
type _SolidResourceHandle = SolidResourceHandle;
type _SolidUseResourceOptions = SolidUseResourceOptions;
type _SolidRuntimeEffectRunner = SolidRuntimeEffectRunner;
