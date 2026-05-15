import {
  Action,
  Capability,
  Resource,
  Route,
  Server,
  Signal,
  makeRuntime,
  route,
  type EffectUiRuntime
} from "@effect-ui/core";

const runtime = makeRuntime();
const coreExports: Array<unknown> = [Action, Capability, Resource, Route, Server, Signal, route, runtime];
type RuntimeShape = EffectUiRuntime;
void coreExports;
type _RuntimeShape = RuntimeShape;
