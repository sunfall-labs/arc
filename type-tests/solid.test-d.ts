import {
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense,
  type BrowserRouter,
  type RouterOutletProps
} from "@effect-ui/solid";

const solidExports: Array<unknown> = [
  RouterProvider,
  RuntimeProvider,
  createBrowserRouter,
  useProgram,
  useResource,
  useResourceSuspense
];
type SolidRouter = BrowserRouter | RouterOutletProps;
void solidExports;
type _SolidRouter = SolidRouter;
