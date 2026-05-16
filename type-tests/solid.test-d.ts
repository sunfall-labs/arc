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
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useAction,
  useProgram,
  useResource,
  useResourceError,
  useResourceResult,
  useResourceSuspense,
  useResourceValue,
  useRuntime,
  useRuntimeEffect,
  useSignal,
  useStream,
  type ActionHandle,
  type BrowserRouter,
  type BrowserRouterOptions,
  type ProgramHandle,
  type ResourceHandle,
  type ResourceMatch,
  type ResourceSuccessMeta,
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
  history: solidHistory
};
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  history: solidHistory
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
const solidProgramHandle: ProgramHandle<number, "tick", EffectInputCallbackError> = useProgram(SolidProgram);
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
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
  useResourceError,
  useResourceResult,
  useResourceValue,
  useRuntime,
  useRuntimeEffect,
  useSignal,
  useStream,
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
type SolidBrowserRouterOptions = BrowserRouterOptions;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
type SolidActionHandle = ActionHandle<{ readonly id: string }, { readonly ok: boolean }>;
type SolidProgramHandle = ProgramHandle<number, "tick", EffectInputCallbackError>;
type SolidResourceHandle = ResourceHandle<string, SolidProject, never>;
type SolidUseResourceOptions = UseResourceOptions<never>;
type SolidRuntimeEffectRunner = RuntimeEffectRunner;
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidBrowserRouterOptions = SolidBrowserRouterOptions;
type _SolidRouterProviderProps = SolidRouterProviderProps;
type _SolidActionHandle = SolidActionHandle;
type _SolidProgramHandle = SolidProgramHandle;
type _SolidResourceHandle = SolidResourceHandle;
type _SolidUseResourceOptions = SolidUseResourceOptions;
type _SolidRuntimeEffectRunner = SolidRuntimeEffectRunner;
