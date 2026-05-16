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
  type BrowserRouterHostController,
  type EffectUiRuntime,
  type MemoryBrowserHistoryAdapter
} from "@effect-ui/core";

const runtime = makeRuntime();
const memoryHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/projects" });
const windowHistory = makeWindowBrowserHistoryAdapter();
const browserHistory: BrowserHistoryAdapter = memoryHistory;
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
  runtime
];
type RuntimeShape = EffectUiRuntime;
type RouterHostShape = BrowserRouterHostController;
type BrowserHistoryShape = BrowserHistoryAdapter;
type MemoryHistoryShape = MemoryBrowserHistoryAdapter;
void coreExports;
type _RuntimeShape = RuntimeShape;
type _RouterHostShape = RouterHostShape;
type _BrowserHistoryShape = BrowserHistoryShape;
type _MemoryHistoryShape = MemoryHistoryShape;
