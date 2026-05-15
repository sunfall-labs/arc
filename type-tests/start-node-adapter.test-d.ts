import {
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  writeNodeResponseEffect,
  type StartNodeHandler,
  type StartNodeServerHandlerOptions
} from "@effect-ui/start/node-adapter";

const nodeAdapterExports: Array<unknown> = [
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  writeNodeResponseEffect
];
type NodeAdapter = StartNodeHandler | StartNodeServerHandlerOptions;
void nodeAdapterExports;
type _NodeAdapter = NodeAdapter;
