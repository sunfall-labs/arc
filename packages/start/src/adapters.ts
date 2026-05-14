import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { runPromise } from "@effect-ui/core";
import { Data, Effect } from "effect";
import type { StartRequestHandler, StartRequestHandlerEffect } from "./index.js";

export class StartNodeAdapterError extends Data.TaggedError("StartNodeAdapterError")<{
  readonly operation: "create-request" | "write-response";
  readonly error: unknown;
}> {}

export interface StartNodeRequestOptions {
  readonly origin?: string | ((request: IncomingMessage) => string);
}

export interface WriteNodeResponseOptions {
  readonly headOnly?: boolean;
}

export type StartNodeHandlerEffect = (
  request: IncomingMessage,
  response: ServerResponse
) => Effect.Effect<Response, unknown, unknown>;

export type StartNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<Response>;

export type StartFetchHandlerEffect = (
  request: Request
) => Effect.Effect<Response, unknown, unknown>;

export type StartFetchHandler = (request: Request) => Promise<Response>;

const forwardedHeader = (
  request: IncomingMessage,
  name: string
): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

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

export const writeNodeResponse = (
  target: ServerResponse,
  response: Response,
  options: WriteNodeResponseOptions = {}
): Promise<void> =>
  Effect.runPromise(writeNodeResponseEffect(target, response, options));

export const toFetchHandlerEffect = (
  handler: StartRequestHandlerEffect
): StartFetchHandlerEffect =>
  (request) => handler(request);

export const toFetchHandler = (
  handler: StartRequestHandler
): StartFetchHandler =>
  (request) => handler(request);

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

export const createNodeHandler = (
  handler: StartRequestHandlerEffect,
  options: StartNodeRequestOptions = {}
): StartNodeHandler => {
  const effectHandler = createNodeHandlerEffect(handler, options);
  return (request, response) => runPromise(effectHandler(request, response));
};
