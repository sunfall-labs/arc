export {
  /** Handler error normalized by Start host adapters. */
  StartRequestHandlerError,
  /** Adapter error for Node request conversion or response writing failures. */
  StartNodeAdapterError,
  /** Effect-shaped Node handler for Start request handlers. */
  createNodeHandler,
  /** Effect-first Node handler for composing inside Effect runtimes. */
  createNodeHandlerEffect,
  /** Node `createServer` callback facade that runs the adapter Effect. */
  createNodeServerHandler,
  /** Resolves request origin from options or forwarded Node headers. */
  nodeRequestOrigin,
  /** Converts Node `IncomingMessage` to a web `Request`. */
  nodeRequestToWebRequest,
  /** Effect wrapper for Node-to-web request conversion. */
  nodeRequestToWebRequestEffect,
  /** Writes a web `Response` to Node's `ServerResponse`. */
  writeNodeResponse,
  /** Effect-first response writer for Node hosts. */
  writeNodeResponseEffect,
  /** Effect-shaped Node handler type returned by `createNodeHandler`. */
  type StartNodeHandler,
  /** Effect-first Node handler type. */
  type StartNodeHandlerEffect,
  /** Node `createServer` callback facade type. */
  type StartNodeServerHandler,
  /** EffectInput error callback used by the Node server handler facade. */
  type StartNodeServerErrorHandler,
  /** Options for Node `createServer` callback facades. */
  type StartNodeServerHandlerOptions,
  /** Runtime-required options for serviceful Node callback facades. */
  type StartNodeServerHandlerRuntimeOptions,
  /** Erased Runtime Runner seam used by callback-shaped host facades. */
  type StartForkRuntime,
  /** Proxy trust policy for resolving Node request origins. */
  type StartNodeOriginPolicy,
  /** Options for resolving Node request origins. */
  type StartNodeRequestOptions,
  /** Options for writing HEAD responses. */
  type WriteNodeResponseOptions,
} from "@effect-ui/start/node-adapter";
