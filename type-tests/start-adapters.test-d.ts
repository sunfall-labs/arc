import {
  createNodeHandler,
  nodeRequestToWebRequestEffect,
  toFetchHandlerEffect,
  writeNodeResponseEffect,
  type StartFetchHandler,
  type StartNodeHandler
} from "@effect-ui/start/adapters";

const startAdapterExports: Array<unknown> = [
  createNodeHandler,
  nodeRequestToWebRequestEffect,
  toFetchHandlerEffect,
  writeNodeResponseEffect
];
type AdapterHandlers = StartFetchHandler | StartNodeHandler;
void startAdapterExports;
type _AdapterHandlers = AdapterHandlers;
