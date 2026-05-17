import {
  createNodeHandler,
  createNodeHandlerEffect,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  nodeRequestToWebRequestEffect,
  StartNodeAdapterError,
  StartRequestHandlerError,
  writeNodeResponse,
  writeNodeResponseEffect,
  type StartForkRuntime,
  type StartNodeHandler,
  type StartNodeHandlerEffect,
  type StartNodeOriginPolicy,
  type StartNodeRequestOptions,
  type StartNodeServerErrorHandler,
  type StartNodeServerHandler,
  type StartNodeServerHandlerOptions,
  type StartNodeServerHandlerRuntimeOptions,
  type WriteNodeResponseOptions,
} from "@effect-ui/start/node-adapter";
import type { EffectUiRuntime } from "@effect-ui/core";
import type { StartRequestHandlerEffect } from "@effect-ui/start";
import { Effect, Scope } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";

const nodeAdapterExports: Array<unknown> = [
  createNodeHandler,
  createNodeHandlerEffect,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  nodeRequestToWebRequestEffect,
  StartNodeAdapterError,
  StartRequestHandlerError,
  writeNodeResponse,
  writeNodeResponseEffect,
];
type NodeAdapter =
  | StartForkRuntime
  | StartNodeHandler
  | StartNodeHandlerEffect
  | StartNodeOriginPolicy
  | StartNodeRequestOptions
  | StartNodeServerErrorHandler
  | StartNodeServerHandler
  | StartNodeServerHandlerOptions
  | StartNodeServerHandlerRuntimeOptions<Scope.Scope>
  | WriteNodeResponseOptions;
void nodeAdapterExports;
type _NodeAdapter = NodeAdapter;

interface NodeAdapterTestService {
  readonly nodeAdapterTestService: unique symbol;
}

declare const nodeRequest: IncomingMessage;
declare const nodeResponse: ServerResponse;
declare const scopeOnlyHandler: StartRequestHandlerEffect<Scope.Scope>;
declare const servicefulHandler: StartRequestHandlerEffect<Scope.Scope | NodeAdapterTestService>;
declare const serviceRuntime: EffectUiRuntime<NodeAdapterTestService>;

const nodeOriginPolicy: StartNodeOriginPolicy = { trustForwardedHeaders: true };
const nodeRequestOptions: StartNodeRequestOptions = {
  ...nodeOriginPolicy,
  origin: "https://example.com",
};
const writeOptions: WriteNodeResponseOptions = { headOnly: false };
const serverErrorHandler: StartNodeServerErrorHandler = () => Effect.void;
const nodeServerOptions: StartNodeServerHandlerOptions = {
  ...nodeRequestOptions,
  onError: serverErrorHandler,
};
const nodeRuntimeOptions: StartNodeServerHandlerRuntimeOptions<
  Scope.Scope | NodeAdapterTestService
> = {
  ...nodeRequestOptions,
  runtime: serviceRuntime,
};
const nodeHandlerEffect: StartNodeHandlerEffect<Scope.Scope> = createNodeHandlerEffect(
  scopeOnlyHandler,
  nodeRequestOptions,
);
const nodeHandler: StartNodeHandler<Scope.Scope> = createNodeHandler(
  scopeOnlyHandler,
  nodeRequestOptions,
);
const nodeServerHandler: StartNodeServerHandler = createNodeServerHandler(
  scopeOnlyHandler,
  nodeServerOptions,
);
const servicefulNodeServerHandler: StartNodeServerHandler = createNodeServerHandler(
  servicefulHandler,
  nodeRuntimeOptions,
);
// @ts-expect-error serviceful Node callback facades must receive a runtime for non-Scope requirements.
createNodeServerHandler(servicefulHandler, nodeServerOptions);
nodeRequestOrigin(nodeRequest, nodeRequestOptions).toUpperCase();
const webRequest: Request = nodeRequestToWebRequest(nodeRequest, nodeRequestOptions);
nodeRequestToWebRequestEffect(nodeRequest, nodeRequestOptions).pipe(
  Effect.map((request) => request.url),
);
writeNodeResponseEffect(nodeResponse, new Response("ok"), writeOptions).pipe(Effect.asVoid);
writeNodeResponse(nodeResponse, new Response(null, { status: 204 }), writeOptions).pipe(
  Effect.asVoid,
);
void nodeHandlerEffect;
void nodeHandler;
void nodeServerHandler;
void servicefulNodeServerHandler;
void webRequest;
