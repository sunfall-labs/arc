export {
  /** Builds the main Start request handler for SSR, RPC, and actions. */
  createRequestHandler,
  /** Error raised when request preload cannot complete. */
  StartPreloadError,
  /** Error normalized from any Start request handler failure. */
  StartRequestHandlerError,
  /** Options for the main Start request handler. */
  type CreateRequestHandlerOptions,
  /** Per-request context passed to a Start SSR render function. */
  type StartRenderContext,
  /** Effect-returning request handler consumed by host adapters. */
  type StartRequestHandler,
} from "./start-request-handler.js";

export type {
  /** Best-effort request diagnostics delivered after runtime teardown. */
  StartRequestTrace,
  /** Callback receiving request diagnostics after runtime teardown. */
  StartRequestTraceHandler,
} from "./request-trace.js";

export {
  /** Builds a buffered HTML response inside Effect. */
  createHtmlResponse,
  /** Builds a streamed HTML response with ordered hydration chunks. */
  createStartStreamedHtmlResponse,
  /** Wraps a string as an HTML stream chunk. */
  htmlChunk,
  /** Error raised when an HTML response stream fails. */
  StartStreamError,
  /** Options for buffered HTML responses. */
  type HtmlResponseOptions,
  /** One HTML stream chunk. */
  type HtmlStreamChunk,
  /** Options for streamed HTML responses. */
  type StartStreamedHtmlResponseOptions,
} from "./streaming.js";

export {
  /** Reads and hydrates Start payloads from a document as an Effect. */
  hydrateFromDocument,
  /** Error raised when a streamed hydration chunk cannot be parsed. */
  StartHydrationChunkParseError,
  /** Error raised when the root hydration payload cannot be parsed. */
  StartHydrationPayloadParseError,
  /** Error raised when a Start hydration payload cannot be serialized for HTML. */
  StartHydrationPayloadSerializeError,
  /** Options for `hydrateFromDocument`. */
  type HydrateFromDocumentOptions,
  /** Shared options for request preload and client hydration collections. */
  type StartCollectionHydrationOptions,
  /** Minimal document shape required for root and streamed hydration. */
  type StartHydrationDocument,
  /** Errors produced while reading or applying hydration payloads. */
  type StartHydrationError,
  /** Start SSR hydration payload for resources and collections. */
  type StartHydrationPayload,
} from "./hydration.js";

export {
  /** Error raised when request preload finds duplicate collection names. */
  StartCollectionDuplicateName,
} from "./start-collection-resolution.js";

export {
  /** Builds the browser RPC `ServerClient` layer; call with no options for defaults. */
  makeRpcClientLayer,
} from "./start-rpc-client.js";

export type {
  /** Options for Start RPC clients. */
  ServerRpcClientOptions,
  /** Effect-returning fetch used by Start transports. */
  StartFetch,
  /** Request init accepted by `StartFetch`. */
  StartFetchInit,
  /** Request input accepted by `StartFetch`. */
  StartFetchInput,
} from "./start-fetch.js";

export {
  /** Error raised when a configured transport endpoint path is invalid. */
  StartTransportEndpointPathError,
  /** Error raised when RPC and action transport endpoints collide. */
  StartTransportEndpointConflictError,
  /** Transport endpoint path overrides for request handlers and clients. */
  type StartTransportEndpointOverrides,
} from "./start-transport-endpoints.js";

export {
  /** File-backed route definitions: `FileRoute.define(path)(options)`. */
  FileRoute,
} from "./file-route.js";

export {
  /** Progressive (no-JS) HTML form helpers for Start actions. */
  StartAction,
} from "./start-action-client.js";

export {
  /** Builds the `ActionTransport` layer that submits served Actions to the Start server. */
  makeActionTransportLayer,
  /** Options for `makeActionTransportLayer(...)`. */
  type ActionTransportLayerOptions,
} from "./start-action-transport.js";

export {
  /** Error raised when action form input cannot be encoded. */
  StartActionFormEncodeError,
  /** Options for `StartAction.form(...)`. */
  type StartActionFormOptions,
} from "./start-action-request-codec.js";

export {
  /** Error raised when two served actions share a name. */
  StartActionDuplicateName,
  /** Resource invalidation plan returned by an action response. */
  type StartActionInvalidationPlan,
} from "./start-transport-protocol.js";

export {
  /** Error raised when a static base path is invalid. */
  StartStaticBasePathError,
  /** Error raised when static client navigation cannot hydrate a target document. */
  StartStaticNavigationHydrationError,
  /** Reads the current static-site href relative to the base path. */
  currentStartStaticHref,
  /** Builds the history adapter used by static client navigation. */
  makeStartStaticHistoryAdapter,
  /** Normalizes a static deployment base path. */
  normalizeStartStaticBasePath,
  /** Removes a static deployment base path from an href. */
  stripStartStaticBasePath,
  /** Adds a static deployment base path to an href. */
  withStartStaticBasePath,
  /** Options for `makeStartStaticHistoryAdapter`. */
  type StartStaticHistoryAdapterOptions,
  /** Minimal window shape used by static client navigation. */
  type StartStaticHistoryWindow,
} from "./static-client-navigation.js";

export type {
  /** Hand-authored server-function source passed to the Start Vite plugin. */
  ServerFunctionManifestSource,
} from "./server-function-manifest.js";

export type {
  /** Hand-authored action source passed to the Start Vite plugin. */
  ActionManifestSource,
} from "./action-manifest.js";
