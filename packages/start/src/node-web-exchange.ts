import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Data, Effect } from "effect";

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
  /** Abort signal attached to the created Web Request. */
  readonly signal?: AbortSignal;
}

/** Options for writing a web `Response` to Node's `ServerResponse`. */
export interface WriteNodeResponseOptions {
  /** End after headers for HEAD requests without streaming the body. */
  readonly headOnly?: boolean;
}

const forwardedHeader = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Resolves the absolute request origin from explicit options or forwarded headers. */
export const nodeRequestOrigin = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {},
): string => {
  if (typeof options.origin === "function") {
    return options.origin(request);
  }
  if (options.origin) {
    return options.origin;
  }

  const trustForwardedHeaders = options.trustForwardedHeaders ?? true;
  const protocol = trustForwardedHeaders
    ? (forwardedHeader(request, "x-forwarded-proto") ?? "http")
    : "http";
  const host = trustForwardedHeaders
    ? (forwardedHeader(request, "x-forwarded-host") ?? request.headers.host ?? "localhost")
    : (request.headers.host ?? "localhost");
  return `${protocol}://${host}`;
};

/** Converts a Node request into a standards-based web `Request`. */
export const nodeRequestToWebRequest = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {},
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
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
};

export interface StartNodeRequestLifecycle {
  readonly signal: AbortSignal;
  dispose(): void;
}

type NodeLifecycleEventTarget = {
  readonly once?: (event: string, listener: () => void) => unknown;
  readonly off?: (event: string, listener: () => void) => unknown;
};

const addNodeLifecycleListener = (
  target: NodeLifecycleEventTarget | undefined,
  event: string,
  listener: () => void,
): void => {
  if (typeof target?.once === "function") {
    target.once(event, listener);
  }
};

const removeNodeLifecycleListener = (
  target: NodeLifecycleEventTarget | undefined,
  event: string,
  listener: () => void,
): void => {
  if (typeof target?.off === "function") {
    target.off(event, listener);
  }
};

/** Creates a per-request AbortSignal from Node request/response disconnects. */
export const nodeRequestLifecycle = (
  request: IncomingMessage,
  response?: ServerResponse,
): StartNodeRequestLifecycle => {
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortOnResponseClose = (): void => {
    if (response !== undefined && !response.writableEnded) {
      abort();
    }
  };
  const dispose = (): void => {
    removeNodeLifecycleListener(request, "aborted", abort);
    removeNodeLifecycleListener(response, "close", abortOnResponseClose);
    removeNodeLifecycleListener(response, "finish", dispose);
  };

  addNodeLifecycleListener(request, "aborted", abort);
  addNodeLifecycleListener(response, "close", abortOnResponseClose);
  addNodeLifecycleListener(response, "finish", dispose);

  return {
    signal: controller.signal,
    dispose,
  };
};

/** Effect wrapper for `nodeRequestToWebRequest` with adapter errors. */
export const nodeRequestToWebRequestEffect = (
  request: IncomingMessage,
  options: StartNodeRequestOptions = {},
): Effect.Effect<Request, StartNodeAdapterError> =>
  Effect.try({
    try: () => nodeRequestToWebRequest(request, options),
    catch: (error) => new StartNodeAdapterError({ operation: "create-request", error }),
  });

const endNodeResponseEffect = (
  target: ServerResponse,
): Effect.Effect<void, StartNodeAdapterError> =>
  Effect.try({
    try: () => {
      target.end();
    },
    catch: (error) => new StartNodeAdapterError({ operation: "write-response", error }),
  });

const cancelResponseBodyEffect = (
  response: Response,
  reason: string,
): Effect.Effect<void, StartNodeAdapterError> =>
  response.body
    ? Effect.tryPromise({
        try: () => response.body!.cancel(reason),
        catch: (error) => new StartNodeAdapterError({ operation: "write-response", error }),
      })
    : Effect.void;

const writeStreamBodyEffect = (
  target: ServerResponse,
  response: Response,
  headOnly: boolean,
): Effect.Effect<void, StartNodeAdapterError> =>
  headOnly
    ? cancelResponseBodyEffect(response, "head-response").pipe(
        Effect.andThen(endNodeResponseEffect(target)),
      )
    : !response.body
      ? endNodeResponseEffect(target)
      : Effect.tryPromise({
          try: (signal) =>
            pipeline(Readable.fromWeb(response.body as NodeReadableStream), target, { signal }),
          catch: (error) => new StartNodeAdapterError({ operation: "write-response", error }),
        });

const setNodeResponseHeaders = (target: ServerResponse, headers: Headers): void => {
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
 * to run or supervise the platform seam.
 */
export const writeNodeResponseEffect = (
  target: ServerResponse,
  response: Response,
  options: WriteNodeResponseOptions = {},
): Effect.Effect<void, StartNodeAdapterError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        target.statusCode = response.status;
        target.statusMessage = response.statusText;
        setNodeResponseHeaders(target, response.headers);
      },
      catch: (error) => new StartNodeAdapterError({ operation: "write-response", error }),
    });
    yield* writeStreamBodyEffect(target, response, options.headOnly ?? false);
  });

/** Alias for `writeNodeResponseEffect`. */
export const writeNodeResponse = (
  target: ServerResponse,
  response: Response,
  options: WriteNodeResponseOptions = {},
): Effect.Effect<void, StartNodeAdapterError> => writeNodeResponseEffect(target, response, options);

/** Writes a Web response back to the Node exchange that produced it. */
export const writeNodeExchangeResponseEffect = (
  request: IncomingMessage,
  target: ServerResponse,
  response: Response,
): Effect.Effect<void, StartNodeAdapterError> =>
  writeNodeResponseEffect(target, response, {
    headOnly: request.method === "HEAD",
  });
