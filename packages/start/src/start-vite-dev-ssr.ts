import { Cause, Data, Effect, Exit, Scope } from "effect";
import { toEffect, type EffectInput } from "@effect-ui/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  nodeRequestLifecycle,
  nodeRequestToWebRequestEffect,
  writeNodeExchangeResponseEffect,
  type StartNodeRequestOptions,
} from "./node-web-exchange.js";
import { acceptsMediaType, startHtmlMediaType } from "./rpc.js";
import type { StartRequestHandlerError } from "./start-request-handler.js";
import { defaultServerEntry } from "./start-manifest-wall.js";
import { responseWithScopeLifetimeEffect } from "./response-lifetime.js";
import { suspendResponseStreamSuccessFinalizerEffect } from "./streaming.js";
import {
  resolveStartTransportEndpoints,
  type StartTransportEndpointSource,
} from "./start-transport-endpoints.js";
import {
  interruptStartHostFiberOnSignal,
  mergeStartAbortSignals,
  runStartAbortFinalizerOnSignalEffect,
} from "./start-abort-lifecycle.js";

/**
 * Handler export shape used by the Vite dev SSR middleware.
 *
 * Dev SSR accepts a plain `Response` or an Effect so server entries can stay
 * Effect-first without adding a Promise wrapper inside application code.
 */
export type StartSsrRequestHandler<
  HandlerError = StartRequestHandlerError,
  Requirements = never,
> = (
  request: Request,
) => Response | Effect.Effect<Response, HandlerError, Scope.Scope | Requirements>;

/** Loaded Vite dev SSR module with a handler that may require Effect services. */
export type StartSsrHandlerModule<
  HandlerError = StartRequestHandlerError,
  Requirements = never,
> = Record<string, unknown> & {
  readonly default?: StartSsrRequestHandler<HandlerError, Requirements>;
  readonly handleRequest?: StartSsrRequestHandler<HandlerError, Requirements>;
};

/** Effect-first dev server operations used by Start SSR middleware. */
export interface StartDevServer<Requirements = never> {
  ssrLoadModule(
    id: string,
  ): Effect.Effect<StartSsrHandlerModule<unknown, Requirements>, StartDevServerError, Requirements>;
  transformIndexHtml(
    url: string,
    html: string,
  ): Effect.Effect<string, StartDevServerError, Requirements>;
  ssrFixStacktrace?(error: Error): Effect.Effect<void, never, Requirements>;
}

/** Promise-shaped Vite dev server host surface adapted at the library boundary. */
export interface StartViteDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  transformIndexHtml(url: string, html: string): Promise<string>;
  ssrFixStacktrace?(error: Error): void;
}

/** Options for resolving the SSR handler export in Vite dev. */
export interface HandleSsrDevRequestOptions extends StartTransportEndpointSource {
  readonly serverEntry?: string;
  readonly handlerExport?: string;
  /**
   * Origin and forwarded-header policy used when translating Vite's Node
   * middleware request into the web `Request` seen by Start handlers.
   */
  readonly nodeRequest?: StartNodeRequestOptions;
}

/** Error raised when a dev SSR module does not export the configured handler. */
export class StartHandlerNotFound extends Data.TaggedError("StartHandlerNotFound")<{
  readonly exportName: string;
}> {}

/** Error raised while loading or running a Vite dev SSR request. */
export class StartDevServerError extends Data.TaggedError("StartDevServerError")<{
  readonly operation: "load-module" | "run-handler" | "read-html" | "transform-html";
  readonly error: unknown;
}> {}

/** Invalid erased handler result reported inside the typed dev-server channel. */
class StartHandlerInvalidResponse extends Data.TaggedError("StartHandlerInvalidResponse")<{
  readonly message: string;
  readonly value: unknown;
}> {}

/** Vite middleware continuation callback. */
export type StartDevMiddlewareNext = (error?: unknown) => void;

/** Options for Vite dev SSR middleware lifecycle and request handling. */
export interface HandleSsrDevMiddlewareOptions extends HandleSsrDevRequestOptions {
  /** Effect runtime options used when request aborts interrupt the middleware fiber. */
  readonly runOptions?: Effect.RunOptions;
}

const fixSsrStacktraceBestEffort = <R>(
  server: StartDevServer<R>,
  error: Error,
): Effect.Effect<void, never, R> =>
  Effect.suspend(() => server.ssrFixStacktrace?.(error) ?? Effect.void).pipe(
    Effect.catchCause(() => Effect.void),
  );

const callMiddlewareNextBestEffort = (
  next: StartDevMiddlewareNext,
  error?: unknown,
): Effect.Effect<void> =>
  Effect.try({
    try: () => {
      next(error);
    },
    catch: () => undefined,
  }).pipe(
    Effect.catchCause(() => Effect.void),
    Effect.asVoid,
  );

const reportSsrDevMiddlewareError = <R>(
  server: StartDevServer<R>,
  next: StartDevMiddlewareNext,
  error: unknown,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    if (error instanceof Error) {
      yield* fixSsrStacktraceBestEffort(server, error);
    }
    yield* callMiddlewareNextBestEffort(next, error);
  });

const tryViteDevPromise = <A>(
  operation: StartDevServerError["operation"],
  f: () => Promise<A>,
): Effect.Effect<A, StartDevServerError> =>
  Effect.tryPromise({
    try: f,
    catch: (error) => new StartDevServerError({ operation, error }),
  });

const devServerError = (
  operation: StartDevServerError["operation"],
  error: unknown,
): StartDevServerError => new StartDevServerError({ operation, error });

const requestAbortError = (signal: AbortSignal): StartDevServerError =>
  devServerError(
    "read-html",
    signal.reason ?? new Error("Request aborted while reading dev SSR HTML."),
  );

const failIfRequestAborted = (signal: AbortSignal): Effect.Effect<void, StartDevServerError> =>
  signal.aborted ? Effect.fail(requestAbortError(signal)) : Effect.void;

const cancelResponseReaderEffect = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => reader.cancel(reason),
    catch: () => undefined,
  }).pipe(
    Effect.catchCause(() => Effect.void),
    Effect.asVoid,
  );

const installRequestAbortReaderCancel = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Effect.Effect<void, never, Scope.Scope> =>
  runStartAbortFinalizerOnSignalEffect(signal, (reason) => {
    void Effect.runFork(cancelResponseReaderEffect(reader, reason ?? "request-aborted"));
  });

const readResponseChunkEffect = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Effect.Effect<ReadableStreamReadResult<Uint8Array>, StartDevServerError> =>
  Effect.tryPromise({
    try: () => reader.read(),
    catch: (error) => devServerError("read-html", error),
  });

const releaseResponseReaderLockEffect = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Effect.Effect<void> =>
  Effect.try({
    try: () => {
      reader.releaseLock();
    },
    catch: () => undefined,
  }).pipe(
    Effect.catchCause(() => Effect.void),
    Effect.asVoid,
  );

const readResponseTextEffect = (
  response: Response,
  signal: AbortSignal,
): Effect.Effect<string, StartDevServerError> =>
  response.body === null
    ? Effect.succeed("")
    : Effect.scoped(
        Effect.gen(function* () {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let html = "";
          yield* installRequestAbortReaderCancel(reader, signal);

          const readLoop = Effect.gen(function* () {
            while (true) {
              yield* failIfRequestAborted(signal);
              const chunk = yield* readResponseChunkEffect(reader);
              yield* failIfRequestAborted(signal);
              if (chunk.done) {
                break;
              }
              html += decoder.decode(chunk.value, { stream: true });
            }
            return html + decoder.decode();
          });

          return yield* readLoop.pipe(
            Effect.onInterrupt(() =>
              cancelResponseReaderEffect(reader, "dev-ssr-read-interrupted"),
            ),
            Effect.ensuring(releaseResponseReaderLockEffect(reader)),
          );
        }),
      );

/** Adapts Vite's Promise-based dev server API to Start's Effect-first seam. */
export const startDevServerFromVite = (server: StartViteDevServer): StartDevServer => ({
  ssrLoadModule: (id) => tryViteDevPromise("load-module", () => server.ssrLoadModule(id)),
  transformIndexHtml: (url, html) =>
    tryViteDevPromise("transform-html", () => server.transformIndexHtml(url, html)),
  ...(server.ssrFixStacktrace === undefined
    ? {}
    : {
        ssrFixStacktrace: (error: Error) =>
          Effect.sync(() => {
            server.ssrFixStacktrace?.(error);
          }),
      }),
});

/**
 * Handles one Vite dev-server middleware request.
 *
 * Non-SSR asset requests call `next`; SSR, RPC, and action requests are
 * converted to web requests, handled, and written back to Node.
 */
export const handleSsrDevMiddlewareEffect = <R = never>(
  server: StartDevServer<R>,
  request: IncomingMessage,
  response: ServerResponse,
  next: StartDevMiddlewareNext,
  options: HandleSsrDevMiddlewareOptions = {},
): Effect.Effect<void, never, R> =>
  Effect.withFiber((fiber) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const nodeLifecycle = nodeRequestLifecycle(request, response);
        const mergedLifecycle = mergeStartAbortSignals([
          nodeLifecycle.signal,
          options.nodeRequest?.signal,
        ]);
        const disposeInterrupt = interruptStartHostFiberOnSignal(
          fiber,
          mergedLifecycle.signal,
          options.runOptions === undefined ? {} : { runOptions: options.runOptions },
        );

        return {
          signal: mergedLifecycle.signal,
          dispose: () => {
            disposeInterrupt();
            mergedLifecycle.cleanup();
            nodeLifecycle.dispose();
          },
        };
      }),
      ({ signal }) =>
        Effect.gen(function* () {
          if (!shouldHandleSsrRequest(request, options)) {
            yield* callMiddlewareNextBestEffort(next);
            return;
          }

          const webRequest = yield* nodeRequestToWebRequestEffect(request, {
            ...options.nodeRequest,
            signal,
          });
          const webResponse = yield* handleSsrDevRequestEffect(server, webRequest, options);
          yield* writeNodeExchangeResponseEffect(request, response, webResponse);
        }),
      ({ dispose }) => Effect.sync(dispose),
    ),
  ).pipe(
    Effect.catch((error) => reportSsrDevMiddlewareError(server, next, error)),
    Effect.catchCause((cause) => reportSsrDevMiddlewareError(server, next, Cause.squash(cause))),
  );

/** Returns true when a response should pass through Vite HTML transforms. */
export const isHtmlResponse = (response: Response): boolean =>
  response.headers.get("content-type")?.includes("text/html") ?? false;

const devSsrHostTransformFailureEvent = {
  stream: {
    name: "response",
    state: "errored",
  },
  status: "failure",
  teardownReason: "dev-ssr-host-transform",
} as const;

const devSsrExitFailure = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason)?.error : undefined;

const devSsrHostReadFailureEvent = (
  request: Request,
  exit: Exit.Exit<unknown, unknown>,
):
  | typeof devSsrHostTransformFailureEvent
  | {
      readonly stream: {
        readonly name: "response";
        readonly state: "cancelled";
      };
      readonly status: "cancelled";
      readonly teardownReason: string;
    } => {
  const failure = devSsrExitFailure(exit);
  return request.signal.aborted &&
    failure instanceof StartDevServerError &&
    failure.operation === "read-html"
    ? {
        stream: {
          name: "response",
          state: "cancelled",
        },
        status: "cancelled",
        teardownReason:
          typeof request.signal.reason === "string" ? request.signal.reason : "request-abort",
      }
    : devSsrHostTransformFailureEvent;
};

const headerAcceptsHtml = (accept: string | readonly string[] | undefined): boolean => {
  const headers = new Headers();
  if (typeof accept === "string") {
    headers.set("accept", accept);
  } else if (Array.isArray(accept)) {
    headers.set("accept", accept.join(","));
  }
  return acceptsMediaType(headers, [startHtmlMediaType]);
};

/** Returns true for requests the dev SSR middleware should handle. */
export const shouldHandleSsrRequest = (
  request: Pick<IncomingMessage, "method" | "url" | "headers">,
  endpoints?: StartTransportEndpointSource,
): boolean => {
  const url = request.url ?? "/";
  const pathname = new URL(url, "http://effect-ui.local").pathname;
  const resolved = resolveStartTransportEndpoints(endpoints);
  if (pathname === resolved.rpcPath || pathname === resolved.actionPath) {
    return true;
  }

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (
    url.startsWith("/@") ||
    url.startsWith("/src/") ||
    url.startsWith("/node_modules/") ||
    url.startsWith("/assets/") ||
    url.startsWith("/favicon.")
  ) {
    return false;
  }

  const acceptsHtml = headerAcceptsHtml(request.headers.accept);
  if (!acceptsHtml) {
    return false;
  }

  return true;
};

/** Resolves the SSR request handler export from a loaded server module. */
export const resolveStartHandler = <HandlerError = StartRequestHandlerError, Requirements = never>(
  module: StartSsrHandlerModule<HandlerError, Requirements>,
  options: { readonly handlerExport?: string } = {},
): StartSsrRequestHandler<HandlerError, Requirements> => {
  const candidate = options.handlerExport
    ? module[options.handlerExport]
    : (module.default ?? module.handleRequest);

  if (typeof candidate !== "function") {
    const exportName = options.handlerExport ?? "default or handleRequest";
    throw new StartHandlerNotFound({ exportName });
  }

  return candidate as StartSsrRequestHandler<HandlerError, Requirements>;
};

/** Effect wrapper for `resolveStartHandler` with a typed not-found error. */
export const resolveStartHandlerEffect = <
  HandlerError = StartRequestHandlerError,
  Requirements = never,
>(
  module: StartSsrHandlerModule<HandlerError, Requirements>,
  options: { readonly handlerExport?: string } = {},
): Effect.Effect<StartSsrRequestHandler<HandlerError, Requirements>, StartHandlerNotFound> =>
  Effect.try({
    try: () => resolveStartHandler(module, options),
    catch: (error) =>
      error instanceof StartHandlerNotFound
        ? error
        : new StartHandlerNotFound({
            exportName: options.handlerExport ?? "default or handleRequest",
          }),
  });

const handlerResultEffect = <HandlerError = StartRequestHandlerError, Requirements = never>(
  handler: StartSsrRequestHandler<HandlerError, Requirements>,
  request: Request,
): Effect.Effect<Response, StartDevServerError, Requirements> =>
  Effect.suspend(() =>
    Effect.try({
      try: () => handler(request),
      catch: (error) => new StartDevServerError({ operation: "run-handler", error }),
    }).pipe(
      Effect.flatMap((result) =>
        responseWithScopeLifetimeEffect<HandlerError, Requirements>(
          toEffect(result as EffectInput<Response, HandlerError, Scope.Scope | Requirements>),
        ),
      ),
      Effect.flatMap((response) =>
        response instanceof Response
          ? Effect.succeed(response)
          : Effect.fail(
              new StartDevServerError({
                operation: "run-handler",
                error: new StartHandlerInvalidResponse({
                  message:
                    "Vite dev SSR handlers must return a Response or an Effect that succeeds with a Response.",
                  value: response,
                }),
              }),
            ),
      ),
      Effect.mapError((error) =>
        error instanceof StartDevServerError
          ? error
          : new StartDevServerError({ operation: "run-handler", error }),
      ),
    ),
  ).pipe(
    Effect.catchCause((cause) => {
      const failure = cause.reasons.find(Cause.isFailReason)?.error;
      return Effect.fail(
        failure instanceof StartDevServerError
          ? failure
          : new StartDevServerError({ operation: "run-handler", error: Cause.squash(cause) }),
      );
    }),
  );

/**
 * Handles one Vite dev SSR web request.
 *
 * Loads the configured server entry, runs its handler, and applies Vite HTML
 * transforms to HTML responses.
 */
export const handleSsrDevRequestEffect = <R = never>(
  server: StartDevServer<R>,
  request: Request,
  options: HandleSsrDevRequestOptions = {},
): Effect.Effect<Response, StartHandlerNotFound | StartDevServerError, R> =>
  Effect.gen(function* () {
    const module = yield* server.ssrLoadModule(options.serverEntry ?? defaultServerEntry);
    const handler = yield* resolveStartHandlerEffect(module, options);
    const response = yield* handlerResultEffect(handler, request);

    if (!isHtmlResponse(response)) {
      return response;
    }

    const transformedResponse = yield* suspendResponseStreamSuccessFinalizerEffect(
      response,
      Effect.gen(function* () {
        const url = new URL(request.url);
        const html = yield* readResponseTextEffect(response, request.signal);
        const transformed = yield* server.transformIndexHtml(`${url.pathname}${url.search}`, html);
        const headers = new Headers(response.headers);
        headers.delete("content-length");

        return new Response(transformed, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }),
      (exit) => devSsrHostReadFailureEvent(request, exit),
    );

    return transformedResponse;
  });

/** Alias for `handleSsrDevRequestEffect` on the current dev SSR surface. */
export const handleSsrDevRequest = <R = never>(
  server: StartDevServer<R>,
  request: Request,
  options: HandleSsrDevRequestOptions = {},
): Effect.Effect<Response, StartHandlerNotFound | StartDevServerError, R> =>
  handleSsrDevRequestEffect(server, request, options);
