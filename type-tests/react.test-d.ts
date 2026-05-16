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
const reactExports: Array<unknown> = [
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense,
  reactBrowserOptions,
  reactProviderProps
];
type ReactRouter = BrowserRouter | RouterOutletProps;
type ReactBrowserRouterOptions = BrowserRouterOptions;
type ReactRouterProviderProps = RouterProviderProps<typeof reactRoutes>;
void reactExports;
type _ReactRouter = ReactRouter;
type _ReactBrowserRouterOptions = ReactBrowserRouterOptions;
type _ReactRouterProviderProps = ReactRouterProviderProps;
