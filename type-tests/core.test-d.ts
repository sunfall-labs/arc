import {
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  makeResourceStore,
  makeRuntime,
  resourceUiMatchState,
  route,
  withResourceStore,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
  type BrowserRouterHostController,
  type ActionSubmissionState,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type MemoryBrowserHistoryAdapter,
  type ResourceUiMatch
} from "@effect-ui/core";

const runtime = makeRuntime();
const requestRuntime = withResourceStore(runtime, makeResourceStore());
const coreRoutes = [route("/projects/:id", {})] as const;
declare const browserRouterKernelRuntime: AnyEffectUiRuntime<never>;
const browserRouterKernelOptions: BrowserRouterKernelOptions<typeof coreRoutes, never> = {
  runtime: browserRouterKernelRuntime,
  initialHref: "/projects/atlas"
};
const browserRouterKernel = createBrowserRouterKernel(coreRoutes, browserRouterKernelOptions);
const memoryHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/projects" });
const windowHistory = makeWindowBrowserHistoryAdapter();
const browserHistory: BrowserHistoryAdapter = memoryHistory;
const navigateOptions: BrowserNavigateOptions = { replace: true };
const historyWindow: BrowserHistoryWindow = {
  location: {
    pathname: "/projects",
    search: "?active=true"
  },
  history: {
    pushState: () => undefined,
    replaceState: () => undefined
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};
const coreExports: Array<unknown> = [
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  createBrowserRouterKernel,
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  route,
  coreRoutes,
  browserRouterKernelRuntime,
  browserRouterKernel,
  browserRouterKernelOptions,
  memoryHistory,
  windowHistory,
  browserHistory,
  navigateOptions,
  historyWindow,
  runtime,
  requestRuntime,
  resourceUiMatchState
];
const actionPendingWithUndefinedPrevious: ActionSubmissionState<string, void, string> = {
  _tag: "Pending",
  input: "publish",
  previous: undefined,
  hasPrevious: true
};
const actionFailureWithUndefinedPrevious: ActionSubmissionState<string, void, string> = {
  _tag: "Failure",
  input: "publish",
  error: "failed",
  previous: undefined,
  hasPrevious: true
};
const resourceUiMatchCases: ResourceUiMatch<void, string, string> = {
  initial: () => "initial",
  pending: (previous, meta) => `${String(previous)}:${String(meta.hasPrevious)}`,
  success: (value, meta) => `${String(value)}:${meta.state._tag}`,
  failure: (error, previous, meta) => `${error}:${String(previous)}:${String(meta.hasPrevious)}`
};
const matchedResourceState = resourceUiMatchState<void, string, string>({
  _tag: "Pending",
  waiting: true,
  previous: undefined
}, resourceUiMatchCases);
type RuntimeShape = EffectUiRuntime;
type AnyRuntimeShape = AnyEffectUiRuntime;
type RouterKernelShape = BrowserRouterKernel<typeof coreRoutes>;
type RouterKernelOptionsShape = BrowserRouterKernelOptions<typeof coreRoutes, never>;
type RouterHostShape = BrowserRouterHostController;
type BrowserHistoryShape = BrowserHistoryAdapter;
type MemoryHistoryShape = MemoryBrowserHistoryAdapter;
type BrowserHistoryWindowShape = BrowserHistoryWindow;
type BrowserNavigateOptionsShape = BrowserNavigateOptions;
void coreExports;
void actionPendingWithUndefinedPrevious;
void actionFailureWithUndefinedPrevious;
void matchedResourceState;
type _RuntimeShape = RuntimeShape;
type _AnyRuntimeShape = AnyRuntimeShape;
type _RouterKernelShape = RouterKernelShape;
type _RouterKernelOptionsShape = RouterKernelOptionsShape;
type _RouterHostShape = RouterHostShape;
type _BrowserHistoryShape = BrowserHistoryShape;
type _MemoryHistoryShape = MemoryHistoryShape;
type _BrowserHistoryWindowShape = BrowserHistoryWindowShape;
type _BrowserNavigateOptionsShape = BrowserNavigateOptionsShape;
