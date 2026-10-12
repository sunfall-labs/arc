export {
  /** Start apps: `App.define` (shared definition) and `App.launch` (browser entry). */
  App,
  /** Raised by `App.launch` when the document has no app root element. */
  StartRootMissing,
  /** Any app definition. */
  type AnyAppDefinition,
  /** Failures `App.launch` can end with besides the client Layer's own. */
  type AppLaunchError,
  /** Services `App.launch` adds to the app's client Layer. */
  type AppLaunchServices,
  /** A Start app definition built by `App.define`. */
  type AppDefinition,
} from "./start-app.js";

export {
  /** Builds the Start request handler for an app: SSR, RPC, and actions. */
  createRequestHandler,
  /** Options for `createRequestHandler`: the server half of a Start app. */
  type CreateRequestHandlerOptions,
} from "./start-app-request-handler.js";

export type {
  /** The head and response headers a Start app sets for a page. */
  StartDocument,
  /** Request facts a `document` function sees. */
  StartDocumentContext,
  /** Attributes of one `<meta>` or `<link>` tag. */
  StartDocumentTagAttributes,
} from "./start-document.js";

export {
  /** Error raised when request preload cannot complete. */
  StartPreloadError,
  /** Error normalized from any Start request handler failure. */
  StartRequestHandlerError,
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
  /** Error raised when an HTML response stream fails. */
  StartStreamError,
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

export type {
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
  /** Progressive (no-JS) HTML form helpers for Start actions. */
  StartAction,
} from "./start-action-client.js";

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
