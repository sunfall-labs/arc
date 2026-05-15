import {
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  writeNodeResponseEffect,
  type StartNodeHandler,
  type StartNodeServerHandlerOptions
} from "@effect-ui/start-node";

const nodePackageExports: Array<unknown> = [
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  writeNodeResponseEffect
];
type NodePackage = StartNodeHandler | StartNodeServerHandlerOptions;
void nodePackageExports;
type _NodePackage = NodePackage;
