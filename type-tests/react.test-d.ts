import {
  Action,
  ActionInterrupted,
  makeMemoryBrowserHistoryAdapter,
  route,
  type EffectInputCallbackError
} from "@effect-ui/core";
import { Effect } from "effect";
import {
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useAction,
  useProgram,
  useResource,
  useResourceSuspense,
  type ActionHandle,
  type BrowserRouter,
  type BrowserRouterOptions,
  type RouterProviderProps,
  type RouterOutletProps
} from "@effect-ui/react";

const reactRoutes = [route("/", {})] as const;
const reactHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const reactBrowserOptions: BrowserRouterOptions<typeof reactRoutes> = {
  history: reactHistory
};
const reactProviderProps: RouterProviderProps<typeof reactRoutes> = {
  routes: reactRoutes,
  history: reactHistory
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
void reactExports;
type _ReactRouter = ReactRouter;
type _ReactBrowserRouterOptions = ReactBrowserRouterOptions;
type _ReactRouterProviderProps = ReactRouterProviderProps;
type _ReactActionHandle = ReactActionHandle;
