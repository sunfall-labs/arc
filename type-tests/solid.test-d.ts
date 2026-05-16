import {
  makeMemoryBrowserHistoryAdapter,
  route
} from "@effect-ui/core";
import {
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense,
  type BrowserRouter,
  type BrowserRouterOptions,
  type RouterProviderProps,
  type RouterOutletProps
} from "@effect-ui/solid";

const solidRoutes = [route("/", {})] as const;
const solidHistory = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
const solidBrowserOptions: BrowserRouterOptions<typeof solidRoutes> = {
  history: solidHistory
};
const solidProviderProps: RouterProviderProps<typeof solidRoutes> = {
  routes: solidRoutes,
  history: solidHistory
};
const solidExports: Array<unknown> = [
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense,
  solidBrowserOptions,
  solidProviderProps
];
type SolidRouter = BrowserRouter | RouterOutletProps;
type SolidBrowserRouterOptions = BrowserRouterOptions;
type SolidRouterProviderProps = RouterProviderProps<typeof solidRoutes>;
void solidExports;
type _SolidRouter = SolidRouter;
type _SolidBrowserRouterOptions = SolidBrowserRouterOptions;
type _SolidRouterProviderProps = SolidRouterProviderProps;
