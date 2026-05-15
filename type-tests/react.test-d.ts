import {
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense,
  type BrowserRouter,
  type RouterOutletProps
} from "@effect-ui/react";

const reactExports: Array<unknown> = [
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense
];
type ReactRouter = BrowserRouter | RouterOutletProps;
void reactExports;
type _ReactRouter = ReactRouter;
