import {
  describeDevtoolsPanels,
  describeDevtoolsSummary,
  devtoolsPanelIds,
  installDevtoolsBridgeEffect,
  type DevtoolsRequestTrace
} from "@effect-ui/devtools";

const devtoolsExports: Array<unknown> = [
  describeDevtoolsPanels,
  describeDevtoolsSummary,
  devtoolsPanelIds,
  installDevtoolsBridgeEffect
];
type Trace = DevtoolsRequestTrace;
void devtoolsExports;
type _Trace = Trace;
