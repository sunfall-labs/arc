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
} from "@effect-ui/react";

interface ReactProject {
  readonly id: string;
  readonly name: string;
}

const reactRoutes = [route("/", {})] as const;
const reactHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const reactBrowserOptions: BrowserRouterOptions<typeof reactRoutes> = {
  history: reactHistory
};
const reactProviderProps: RouterProviderProps<typeof reactRoutes> = {
  routes: reactRoutes,
  history: reactHistory
};
const reactCountSignal = Signal.make(0);
const reactSignalValue: number = useSignal(reactCountSignal);
const reactStreamValue: string = useStream(Stream.succeed("ready"), "idle");
const reactRuntime = useRuntime();
const reactRuntimeRunner: RuntimeEffectRunner = useRuntimeEffect();
const reactRuntimeFiber = reactRuntimeRunner(Effect.succeed("ready"));
const ReactProgram = Program.define<number, "tick">({
  initial: 0,
  update: (model) => Program.next(model + 1)
});
const reactProgramHandle: ProgramHandle<number, "tick", EffectInputCallbackError> = useProgram(ReactProgram);
const ReactProjectById = Resource.family<string, ReactProject>({
  name: "React.type-test.project",
  load: (id) => Effect.succeed({ id, name: "Atlas" })
});
const reactProjectRef = ReactProjectById("atlas");
const reactResourceOptions: UseResourceOptions<never> = { preload: false };
const reactResourceHandle: ResourceHandle<string, ReactProject, never> = useResource(
  reactProjectRef,
  reactResourceOptions
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
    updatedAt: 0
  }
};
const reactResourceMatch: ResourceMatch<ReactProject, Resource.LoadError<never>, string> = {
  initial: () => "initial",
  pending: () => "pending",
  success: (project) => project.name,
  failure: () => "failure"
};
const ReactAction = Action.define<{ readonly id: string }, { readonly ok: boolean }>({
  name: "React.type-test.action",
  run: ({ id }) => Effect.succeed({ ok: id.length > 0 })
});
const reactAction = useAction(ReactAction);
const reactActionHandle: ActionHandle<
  { readonly id: string },
  { readonly ok: boolean }
> = reactAction;
const reactActionSubmit: Effect.Effect<
  { readonly ok: boolean },
  EffectInputCallbackError | ActionInterrupted
> = reactAction.submitEffect({ id: "atlas" });
const reactActionStateTag:
  | "Idle"
  | "Pending"
  | "Success"
  | "Failure" = reactAction.state._tag;
reactAction.instance.state.get()._tag;
reactAction.invalidationPlan?.entries.map((entry) => entry.ref.key);
const reactExports: Array<unknown> = [
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
  reactProviderProps
];
type ReactRouter = BrowserRouter | RouterOutletProps;
type ReactBrowserRouterOptions = BrowserRouterOptions;
type ReactRouterProviderProps = RouterProviderProps<typeof reactRoutes>;
type ReactActionHandle = ActionHandle<{ readonly id: string }, { readonly ok: boolean }>;
type ReactProgramHandle = ProgramHandle<number, "tick", EffectInputCallbackError>;
type ReactResourceHandle = ResourceHandle<string, ReactProject, never>;
type ReactUseResourceOptions = UseResourceOptions<never>;
type ReactRuntimeEffectRunner = RuntimeEffectRunner;
void reactExports;
type _ReactRouter = ReactRouter;
type _ReactBrowserRouterOptions = ReactBrowserRouterOptions;
type _ReactRouterProviderProps = ReactRouterProviderProps;
type _ReactActionHandle = ReactActionHandle;
type _ReactProgramHandle = ReactProgramHandle;
type _ReactResourceHandle = ReactResourceHandle;
type _ReactUseResourceOptions = ReactUseResourceOptions;
type _ReactRuntimeEffectRunner = ReactRuntimeEffectRunner;
