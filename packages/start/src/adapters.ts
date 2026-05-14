import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defaultRuntime, toEffect, type EffectInput } from "@effect-ui/core";
import { Cause, Data, Effect } from "effect";
import { StartRequestHandlerError } from "./start-request-handler.js";

export { StartRequestHandlerError } from "./start-request-handler.js";

/** Error raised while converting Node requests or writing Node responses. */
export class StartNodeAdapterError extends Data.TaggedError("StartNodeAdapterError")<{
  readonly operation: "create-request" | "write-response";
  readonly error: unknown;
}> {}

/** Proxy trust policy used while resolving a Node request's public origin. */
export interface StartNodeOriginPolicy {
  /**
   * Whether `x-forwarded-proto` and `x-forwarded-host` may define the public
   * request origin. Defaults to `true` for compatibility with existing proxy
   * deployments.
   */
  readonly trustForwardedHeaders?: boolean;
}

/** Options for translating a Node `IncomingMessage` into a web `Request`. */
export interface StartNodeRequestOptions extends StartNodeOriginPolicy {
  /** Public origin used to resolve relative Node request URLs. */
  readonly origin?: string | ((request: IncomingMessage) => string);
}

/** Options for writing a web `Response` to Node's `ServerResponse`. */
export interface WriteNodeResponseOptions {
  /** End after headers for HEAD requests without streaming the body. */
  readonly headOnly?: boolean;
}

/** Effect-first Node HTTP handler returned by `createNodeHandlerEffect`. */
export type StartNodeHandlerEffect = (
  request: IncomingMessage,
  response: ServerResponse
) => Effect.Effect<Response, StartNodeAdapterError | StartRequestHandlerError, unknown>;

/** Node HTTP handler returned by `createNodeHandler`. */
export type StartNodeHandler = StartNodeHandlerEffect;

/** Runtime boundary needed by Promise-shaped host adapter facades. */
export interface StartPromiseRuntime {
  readonly runPromise: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions
  ) => Promise<A>;
}

/** Runtime boundary used by callback-shaped host adapter facades. */
export interface StartForkRuntime {
  readonly runFork: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions
  ) => unknown;
}

/** Options for host-shaped fetch handlers that run Effects to Promises. */
export interface StartFetchPromiseHandlerOptions {
  readonly runtime?: StartPromiseRuntime;
  readonly runOptions?: Effect.RunOptions;
}

/** Promise-returning fetch handler for Fetch-native hosts. */
export type StartFetchPromiseHandler = (request: Request) => Promise<Response>;

/**
 * Error callback used by Node server handler facades.
 *
 * Return a pure value or an Effect. Promise-shaped cleanup should be adapted
 * explicitly with `Effect.tryPromise(...)` before it reaches this seam.
 */
export type StartNodeServerErrorHandler = (
  error: unknown,
  request: IncomingMessage,
  response: ServerResponse
) => EffectInput<void, never, never>;

/** Options for Node `createServer`-style host handlers. */
export interface StartNodeServerHandlerOptions extends StartNodeRequestOptions {
  readonly runtime?: StartForkRuntime;
  readonly runOptions?: Effect.RunOptions;
  readonly onError?: StartNodeServerErrorHandler;
}

/** Node `createServer` callback that runs the adapter Effect internally. */
export type StartNodeServerHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void;

/** Effect-first Fetch handler returned by `toFetchHandlerEffect`. */
export type StartFetchHandlerEffect = (
  request: Request
) => Effect.Effect<Response, StartRequestHandlerError, unknown>;

/** Fetch handler returned by `toFetchHandler`. */
export type StartFetchHandler = StartFetchHandlerEffect;

const forwardedHeader = (
  request: IncomingMessage,
  name: string
): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

type StartRequestHandlerInput<E = never> = (
  request: Request
) => Effect.Effect<Response, E, unknown>;

const startRequestHandlerError = (
  request: Request,
  cause: unknown
): StartRequestHandlerError =>
  cause instanceof StartRequestHandlerError
    ? cause
    : new StartRequestHandlerError({
        operation: "handle-request",
        request: {
          method: request.method,
          url: request.url
        },
        cause
      });

/** Resolves the absolute request origin from explicit options or forwarded headers. */
export const nodeRequestOrigin = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {}
): string => {
  if (typeof options.origin === "function") {
    return options.origin(request);
  }
  if (options.origin) {
    return options.origin;
  }

  const trustForwardedHeaders = options.trustForwardedHeaders ?? true;
  const protocol = trustForwardedHeaders
    ? forwardedHeader(request, "x-forwarded-proto") ?? "http"
    : "http";
  const host = trustForwardedHeaders
    ? forwardedHeader(request, "x-forwarded-host") ?? request.headers.host ?? "localhost"
    : request.headers.host ?? "localhost";
  return `${protocol}://${host}`;
};

/** Converts a Node request into a standards-based web `Request`. */
export const nodeRequestToWebRequest = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {}
): Request => {
  const url = new URL(request.url ?? "/", nodeRequestOrigin(request, options));
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  const method = request.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
};

/** Effect wrapper for `nodeRequestToWebRequest` with adapter errors. */
export const nodeRequestToWebRequestEffect = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {}
): Effect.Effect<Request, StartNodeAdapterError> =>
  Effect.try({
    try: () => nodeRequestToWebRequest(request, options),
    catch: (error) => new StartNodeAdapterError({ operation: "create-request", error })
  });

const endNodeResponseEffect = (
  target: ServerResponse
): Effect.Effect<void, StartNodeAdapterError> =>
  Effect.try({
    try: () => {
      target.end();
    },
    catch: (error) => new StartNodeAdapterError({ operation: "write-response", error })
  });

const cancelResponseBodyEffect = (
  response: Response,
  reason: string
): Effect.Effect<void, StartNodeAdapterError> =>
  response.body
    ? Effect.tryPromise({
        try: () => response.body!.cancel(reason),
        catch: (error) => new StartNodeAdapterError({ operation: "write-response", error })
      })
    : Effect.void;

const writeStreamBodyEffect = (
  target: ServerResponse,
  response: Response,
  headOnly: boolean
): Effect.Effect<void, StartNodeAdapterError> =>
  headOnly
    ? cancelResponseBodyEffect(response, "head-response").pipe(
        Effect.andThen(endNodeResponseEffect(target))
      )
    : !response.body
    ? endNodeResponseEffect(target)
    : Effect.tryPromise({
        try: (signal) =>
          pipeline(
            Readable.fromWeb(response.body as NodeReadableStream),
            target,
            { signal }
          ),
        catch: (error) => new StartNodeAdapterError({ operation: "write-response", error })
      });

const setNodeResponseHeaders = (
  target: ServerResponse,
  headers: Headers
): void => {
  const setCookies = headers.getSetCookie();
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    target.setHeader(key, value);
  });
  if (setCookies.length > 0) {
    target.setHeader("set-cookie", setCookies);
  }
};

/**
 * Writes a web `Response` to Node's `ServerResponse`.
 *
 * Body streaming remains inside the returned Effect so callers can decide how
 * to run or supervise the platform boundary.
 */
export const writeNodeResponseEffect = (
  target: ServerResponse,
  response: Response,
  options: WriteNodeResponseOptions = {}
): Effect.Effect<void, StartNodeAdapterError> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      target.statusCode = response.status;
      target.statusMessage = response.statusText;
      setNodeResponseHeaders(target, response.headers);
    });
    yield* writeStreamBodyEffect(target, response, options.headOnly ?? false);
  });

/** Alias for `writeNodeResponseEffect`. */
export const writeNodeResponse = (
  target: ServerResponse,
  response: Response,
  options: WriteNodeResponseOptions = {}
): Effect.Effect<void, StartNodeAdapterError> =>
  writeNodeResponseEffect(target, response, options);

/** Adapts a Start request handler to the fetch adapter's Effect handler shape. */
export const toFetchHandlerEffect = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>
): StartFetchHandlerEffect =>
  (request) =>
    handler(request).pipe(
      Effect.mapError((cause) => startRequestHandlerError(request, cause))
    );

/** Adapts a public Start request handler to the fetch adapter Effect shape. */
export const toFetchHandler = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>
): StartFetchHandler =>
  toFetchHandlerEffect(handler);

const runPromiseWithRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: StartFetchPromiseHandlerOptions = {}
): Promise<A> =>
  options.runtime === undefined
    ? defaultRuntime.runPromise(effect, options.runOptions)
    : options.runtime.runPromise(effect, options.runOptions);

const runForkWithRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: StartNodeServerHandlerOptions = {}
): unknown =>
  options.runtime === undefined
    ? defaultRuntime.runFork(effect, options.runOptions)
    : options.runtime.runFork(effect, options.runOptions);

/**
 * Creates a Promise-returning fetch handler for Fetch-native hosts.
 *
 * The lower adapter remains Effect-first; this facade owns the runtime-to-
 * Promise host seam for workers, edge runtimes, Bun, and similar platforms.
 */
export const createFetchHandler = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>,
  options: StartFetchPromiseHandlerOptions = {}
): StartFetchPromiseHandler => {
  const effectHandler = toFetchHandlerEffect(handler);
  return (request) => runPromiseWithRuntime(effectHandler(request), options);
};

/**
 * Creates an Effect-first Node HTTP handler from a Start request handler.
 *
 * It converts the Node request to a web `Request`, invokes Start, writes the
 * web `Response` back to Node, and returns that response for diagnostics.
 *
 * @example
 * ```ts
 * const nodeHandler = createNodeHandlerEffect(startHandler);
 * ```
 */
export const createNodeHandlerEffect = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>,
  options: StartNodeRequestOptions = {}
): StartNodeHandlerEffect =>
  (request, response) =>
    Effect.gen(function* () {
      const webRequest = yield* nodeRequestToWebRequestEffect(request, options);
      const webResponse = yield* handler(webRequest).pipe(
        Effect.mapError((cause) => startRequestHandlerError(webRequest, cause))
      );
      yield* writeNodeResponseEffect(response, webResponse, {
        headOnly: request.method === "HEAD"
      });
      return webResponse;
    });

/** Alias for `createNodeHandlerEffect`. */
export const createNodeHandler = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>,
  options: StartNodeRequestOptions = {}
): StartNodeHandler =>
  createNodeHandlerEffect(handler, options);

const defaultNodeServerErrorHandler: StartNodeServerErrorHandler = (
  error,
  _request,
  response
) => {
  if (response.writableEnded) {
    return;
  }
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  response.statusCode = 500;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("Internal Server Error");
};

const reportNodeServerErrorEffect = (
  error: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  onError: StartNodeServerErrorHandler = defaultNodeServerErrorHandler
): Effect.Effect<void, never, never> =>
  Effect.suspend(() => toEffect(onError(error, request, response))).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        defaultNodeServerErrorHandler(Cause.squash(cause), request, response);
      })
    ),
    Effect.catchCause(() => Effect.void)
  );

/**
 * Creates a Node `createServer` callback that runs the adapter Effect.
 *
 * This keeps `createNodeHandlerEffect` available for Effect-first hosts while
 * giving ordinary Node HTTP integrations a host-shaped callback facade.
 */
export const createNodeServerHandler = <HandlerError = never>(
  handler: StartRequestHandlerInput<HandlerError>,
  options: StartNodeServerHandlerOptions = {}
): StartNodeServerHandler => {
  const effectHandler = createNodeHandlerEffect(handler, options);
  return (request, response) => {
    void runForkWithRuntime(
      effectHandler(request, response).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          reportNodeServerErrorEffect(Cause.squash(cause), request, response, options.onError)
        )
      ),
      options
    );
  };
};
