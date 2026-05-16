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
  makeRuntime,
  route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
  type BrowserRouterHostController,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type MemoryBrowserHistoryAdapter
} from "@effect-ui/core";

const runtime = makeRuntime();
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
  runtime
];
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
type _RuntimeShape = RuntimeShape;
type _AnyRuntimeShape = AnyRuntimeShape;
type _RouterKernelShape = RouterKernelShape;
type _RouterKernelOptionsShape = RouterKernelOptionsShape;
type _RouterHostShape = RouterHostShape;
type _BrowserHistoryShape = BrowserHistoryShape;
type _MemoryHistoryShape = MemoryHistoryShape;
type _BrowserHistoryWindowShape = BrowserHistoryWindowShape;
type _BrowserNavigateOptionsShape = BrowserNavigateOptionsShape;
