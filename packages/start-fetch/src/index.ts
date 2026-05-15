export {
  /** Compatibility Fetch-host handler for platforms that require Promise-shaped entrypoints. */
  createFetchHandler,
  /** Handler error normalized by Start fetch adapters. */
  StartRequestHandlerError,
  /** Effect-shaped fetch adapter for Start request handlers. */
  toFetchHandler,
  /** Effect-first fetch adapter for composing Start handlers. */
  toFetchHandlerEffect,
  /** Effect-shaped fetch handler type. */
  type StartFetchHandler,
  /** Effect-first fetch handler type. */
  type StartFetchHandlerEffect,
  /** Compatibility options for Fetch hosts that require Promise-shaped entrypoints. */
  type StartFetchPromiseHandlerOptions,
  /** Runtime-required compatibility options for serviceful Fetch host entrypoints. */
  type StartFetchPromiseHandlerRuntimeOptions,
  /** Compatibility handler type for Fetch hosts that require Promise-shaped entrypoints. */
  type StartFetchPromiseHandler
} from "@effect-ui/start/fetch-adapter";
