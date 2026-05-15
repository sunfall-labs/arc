import {
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  createBrowserRouterHostController,
  makeRuntime,
  route,
  type BrowserRouterHostController,
  type EffectUiRuntime
} from "@effect-ui/core";

const runtime = makeRuntime();
const coreExports: Array<unknown> = [
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  createBrowserRouterHostController,
  route,
  runtime
];
type RuntimeShape = EffectUiRuntime;
type RouterHostShape = BrowserRouterHostController;
void coreExports;
type _RuntimeShape = RuntimeShape;
type _RouterHostShape = RouterHostShape;
