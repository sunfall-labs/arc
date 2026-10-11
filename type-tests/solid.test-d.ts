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
  type ProgramFailure,
} from "@sunfall/arc-core";
import { Cause, Effect, Option, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Component,
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  isPlainLeftClick,
  useRouter,
  type BrowserRouter,
  type RouterLinkProps,
  type RouterOptions,
  type RouterProviderProps,
  type RouterOutletProps,
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
const solidRouteNotRegistered = new RouterRouteNotRegistered({ path: "/" });
const solidRouterOptions: RouterOptions = { history: solidHistory, hydrating: true };
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  router: solidRouter,
  notFound: () => "missing",
};
const solidProviderRoutesProps: RouterProviderProps<typeof solidRoutes> = {
  router: solidRouter,
  // @ts-expect-error RouterProvider renders a router from `Component.router(...)`, not routes.
  routes: solidRoutes,
};
const solidCountSignal = Signal.make(0);
const solidReadSignalValue: number = solidCountSignal.get();
const solidEffectRuntime = makeRuntime();
const solidSignalValue = (): number => solidCountSignal.get();
const solidStreamValue = Component.stream(Stream.succeed("ready"), "idle");
const SolidProgram = Program.define<number, "tick">({
  initial: 0,
  update: (model) => Program.next(model + 1),
});
declare const solidProgramHandle: Component.ProgramHandle<number, "tick", never>;
const solidProgramBinding: Effect.Effect<Component.ProgramHandle<number, "tick", never>> =
  Component.program(SolidProgram);
// @ts-expect-error Program history lives on the app Timeline, not on the Program handle.
solidProgramHandle.clearTimeline();
const solidProgramDispatch: Effect.Effect<
  void,
  ProgramFailure<"tick", EffectInputCallbackError | Program.Disposed>
> = solidProgramHandle.dispatchEffect("tick");
declare const solidUnknownProgramHandle: Component.ProgramHandle<number, unknown, never>;
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
type SolidBoardView = Component.ProgramModelView<SolidBoardModel>;
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
solidTypeEquals<Component.ProgramModelView<number>, number>(true);
solidTypeEquals<Component.ProgramModelView<"idle" | "busy">, "idle" | "busy">(true);
solidTypeEquals<Component.ProgramModelView<string | undefined>, string | undefined>(true);
solidTypeEquals<Component.ProgramModelView<unknown>, unknown>(true);
declare const solidBoardProgram: Program.Definition<SolidBoardModel, { readonly _tag: "Noop" }>;
const solidBoardOptions: Component.ProgramOptions = {
  key: (row) => ("id" in row ? row.id : undefined),
};
void Component.program(solidBoardProgram, solidBoardOptions);
declare const solidBoardHandle: Component.ProgramHandle<
  SolidBoardModel,
  { readonly _tag: "Noop" },
  never
>;
const solidBoardView: SolidBoardView = solidBoardHandle.model();
const solidBoardLabel: string = solidBoardView.rows[0]!.label;
const solidBoardModelSignal: Signal.Readable<SolidBoardModel> = solidBoardHandle.committed;
// @ts-expect-error Program model views are read-only
solidBoardView.title = "renamed";
// @ts-expect-error nested Program model objects are read-only
solidBoardView.rows[0]!.meta.done = true;
// @ts-expect-error Program model arrays are read-only
solidBoardView.tags.push("new");
// @ts-expect-error Program model Maps are read-only
solidBoardView.owners.set("a", { name: "Ada" });
// @ts-expect-error Program model reconcile keys are property names, key functions, or null
const solidInvalidBoardOptions: Component.ProgramOptions = { key: 1 };
void solidBoardLabel;
void solidBoardModelSignal;
void solidInvalidBoardOptions;
void Component.program(solidBoardProgram, { key: "id" });
void Component.program(solidBoardProgram, { key: null });

solidUnknownProgramHandle.dispatch("any message");
const SolidProjectById = Resource.family<string, SolidProject>({
  name: "Solid.type-test.project",
  load: (id) => Effect.succeed({ id, name: "Atlas" }),
});
declare const solidProjectReader: Component.ResourceReader<string, SolidProject, never>;
const solidProjectValue: SolidProject = solidProjectReader("atlas");
const solidProjectWaiting: boolean = solidProjectReader.waiting("atlas");
// @ts-expect-error -- content renders through the reader; status chrome carries no value.
void solidProjectReader.result;
void Component.resource(SolidProjectById);
// Status UI renders well with AsyncResult builders: handle failure before
// success so `previousSuccess` keeps its type.
declare const solidResult: AsyncResult.AsyncResult<SolidProject, Resource.LoadError<never>>;
const solidResourceRender: string = AsyncResult.builder(solidResult)
  .onInitial(() => "initial")
  .onFailure((cause, failed) =>
    Option.match(failed.previousSuccess, {
      onNone: () => String(Cause.squash(cause)),
      onSome: (stale) => `${stale.value.name} (stale)`,
    }),
  )
  .onSuccess((project, success) => (success.waiting ? `${project.name}…` : project.name))
  .exhaustive();
AsyncResult.builder(solidResult)
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
declare const solidAction: Component.ActionHandle<
  { readonly id: string },
  { readonly ok: boolean },
  never
>;
void Component.action(SolidAction);
const solidActionSubmit: Effect.Effect<
  { readonly ok: boolean },
  Component.ActionError<never> | ActionInterrupted
> = solidAction.submitEffect({ id: "atlas" });
const solidActionStateTag: "Initial" | "Success" | "Failure" = solidAction.result()._tag;
const solidActionInput: Option.Option<{ readonly id: string }> = solidAction.input();
solidAction.submit({ id: "atlas" });
const solidExports: Array<unknown> = [
  RouterContextMissing,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  isPlainLeftClick,
  useRouter,
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
  solidRouteNotRegistered,
  solidRouterOptions,
  solidReadSignalValue,
  solidEffectRuntime,
  solidProgramBinding,
  solidProgramDispatch,
  solidProjectValue,
  solidProjectWaiting,
  solidResourceRender,
  solidActionInput,
  solidSignalValue,
  solidStreamValue,
  solidActionSubmit,
  solidActionStateTag,
  solidProviderProps,
  solidProviderRoutesProps,
];
type SolidRouter = BrowserRouter | RouterOutletProps;
type SolidRouterLinkProps = RouterLinkProps<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateArgs = BrowserNavigateArgs<(typeof solidRoutes)[0]>;
type SolidBrowserNavigateOptions = BrowserNavigateOptions;
type SolidBrowserRouterPath = BrowserRouterPath<typeof solidRoutes>;
type SolidBrowserRouterRouteForPath = BrowserRouterRouteForPath<typeof solidRoutes, "/">;
type SolidBrowserRouterState = BrowserRouterState<typeof solidRoutes>;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
type SolidRouteHrefOptions = Route.HrefOptions<(typeof solidRoutes)[0]>;
// Full Component typing coverage lives in type-tests/component.test-d.ts.
const solidComponent: Component<{}> = Component.make("SolidTypeTest", function* () {
  yield* Effect.void;
  return () => "ok";
});
void Component.embed(solidComponent, solidEffectRuntime);
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidRouterLinkProps = SolidRouterLinkProps;
type _SolidBrowserNavigateArgs = SolidBrowserNavigateArgs;
type _SolidBrowserNavigateOptions = SolidBrowserNavigateOptions;
type _SolidBrowserRouterPath = SolidBrowserRouterPath;
type _SolidBrowserRouterRouteForPath = SolidBrowserRouterRouteForPath;
type _SolidBrowserRouterState = SolidBrowserRouterState;
type _SolidRouterProviderProps = SolidRouterProviderProps;
type _SolidRouteHrefOptions = SolidRouteHrefOptions;
