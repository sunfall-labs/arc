import {
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  makeRuntime,
  route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type BrowserRouterHostController,
  type EffectUiRuntime,
  type MemoryBrowserHistoryAdapter
} from "@effect-ui/core";

const runtime = makeRuntime();
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
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeWindowBrowserHistoryAdapter,
  route,
  memoryHistory,
  windowHistory,
  browserHistory,
  navigateOptions,
  historyWindow,
  runtime
];
type RuntimeShape = EffectUiRuntime;
type RouterHostShape = BrowserRouterHostController;
type BrowserHistoryShape = BrowserHistoryAdapter;
type MemoryHistoryShape = MemoryBrowserHistoryAdapter;
type BrowserHistoryWindowShape = BrowserHistoryWindow;
type BrowserNavigateOptionsShape = BrowserNavigateOptions;
void coreExports;
type _RuntimeShape = RuntimeShape;
type _RouterHostShape = RouterHostShape;
type _BrowserHistoryShape = BrowserHistoryShape;
type _MemoryHistoryShape = MemoryHistoryShape;
type _BrowserHistoryWindowShape = BrowserHistoryWindowShape;
type _BrowserNavigateOptionsShape = BrowserNavigateOptionsShape;
