export {
  /** Handler error normalized by Start host adapters. */
  StartRequestHandlerError,
  /** Adapter error for Node request conversion or response writing failures. */
  StartNodeAdapterError,
  /** Effect-shaped Node handler for Start request handlers. */
  createNodeHandler,
  /** Effect-first Node handler for composing inside Effect runtimes. */
  createNodeHandlerEffect,
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
  /** Options for resolving Node request origins. */
  type StartNodeRequestOptions,
  /** Options for writing HEAD responses. */
  type WriteNodeResponseOptions
} from "@effect-ui/start/adapters";
