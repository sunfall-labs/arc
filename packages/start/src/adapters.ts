import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Data, Effect } from "effect";
import type { StartRequestHandler, StartRequestHandlerEffect } from "./start-request-handler.js";

/** Error raised while converting Node requests or writing Node responses. */
export class StartNodeAdapterError extends Data.TaggedError("StartNodeAdapterError")<{
  readonly operation: "create-request" | "write-response";
  readonly error: unknown;
}> {}

/** Options for translating a Node `IncomingMessage` into a web `Request`. */
export interface StartNodeRequestOptions {
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
) => Effect.Effect<Response, unknown, unknown>;

/** Node HTTP handler returned by `createNodeHandler`. */
export type StartNodeHandler = StartNodeHandlerEffect;

/** Effect-first Fetch handler returned by `toFetchHandlerEffect`. */
export type StartFetchHandlerEffect = (
  request: Request
) => Effect.Effect<Response, unknown, unknown>;

/** Fetch handler returned by `toFetchHandler`. */
export type StartFetchHandler = StartFetchHandlerEffect;

const forwardedHeader = (
  request: IncomingMessage,
  name: string
): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

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

  const protocol = forwardedHeader(request, "x-forwarded-proto") ?? "http";
  const host = forwardedHeader(request, "x-forwarded-host") ?? request.headers.host ?? "localhost";
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

const writeStreamBodyEffect = (
  target: ServerResponse,
  response: Response,
  headOnly: boolean
): Effect.Effect<void, StartNodeAdapterError> =>
  headOnly || !response.body
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
export const toFetchHandlerEffect = (
  handler: StartRequestHandlerEffect
): StartFetchHandlerEffect =>
  (request) => handler(request);

/** Adapts a public Start request handler to the fetch adapter Effect shape. */
export const toFetchHandler = (
  handler: StartRequestHandler
): StartFetchHandler =>
  (request) => handler(request);

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
export const createNodeHandlerEffect = (
  handler: StartRequestHandlerEffect,
  options: StartNodeRequestOptions = {}
): StartNodeHandlerEffect =>
  (request, response) =>
    Effect.gen(function* () {
      const webRequest = yield* nodeRequestToWebRequestEffect(request, options);
      const webResponse = yield* handler(webRequest);
      yield* writeNodeResponseEffect(response, webResponse, {
        headOnly: request.method === "HEAD"
      });
      return webResponse;
    });

/** Alias for `createNodeHandlerEffect`. */
export const createNodeHandler = (
  handler: StartRequestHandlerEffect,
  options: StartNodeRequestOptions = {}
): StartNodeHandler =>
  createNodeHandlerEffect(handler, options);
