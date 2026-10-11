import {
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  StartNodeAdapterError,
  writeNodeResponse,
  type StartForkRuntime,
  type StartNodeHandler,
  type StartNodeOriginPolicy,
  type StartNodeRequestOptions,
  type StartNodeServerErrorHandler,
  type StartNodeServerHandler,
  type StartNodeServerHandlerOptions,
  type StartNodeServerHandlerRuntimeOptions,
  type WriteNodeResponseOptions,
} from "@sunfall/arc-start/node";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import type { StartRequestHandler } from "@sunfall/arc-start";
import { Effect, Scope } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";

const nodeAdapterExports: Array<unknown> = [
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  StartNodeAdapterError,
  writeNodeResponse,
];
type NodeAdapter =
  | StartForkRuntime
  | StartNodeHandler
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
declare const scopeOnlyHandler: StartRequestHandler<Scope.Scope>;
declare const servicefulHandler: StartRequestHandler<Scope.Scope | NodeAdapterTestService>;
declare const serviceRuntime: SunfallArcRuntime<NodeAdapterTestService>;

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
// @ts-expect-error effect-first Node adapters cannot hide requirements through partial generics
const hiddenNodeHandler: StartNodeHandler = createNodeHandler(servicefulHandler);
nodeRequestOrigin(nodeRequest, nodeRequestOptions).toUpperCase();
const webRequest: Request = nodeRequestToWebRequest(nodeRequest, nodeRequestOptions);
writeNodeResponse(nodeResponse, new Response(null, { status: 204 }), writeOptions).pipe(
  Effect.asVoid,
);
void nodeHandler;
void nodeServerHandler;
void servicefulNodeServerHandler;
void hiddenNodeHandler;
void webRequest;
