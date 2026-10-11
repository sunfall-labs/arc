import type { IncomingMessage, ServerResponse } from "node:http";
import { type EffectInput, type SunfallArcRuntime } from "@sunfall/arc-core";
import { defaultRuntime, toEffect } from "@sunfall/arc-core/internal";
import { Cause, Effect, Scope } from "effect";
import type { StartRequestHandlerError } from "./start-request-handler-error.js";
import {
  invokeStartRequestHandlerEffect,
  type StartRequestHandlerInput,
  type StartRequestHandlerRequirements,
} from "./start-host-adapter.js";
import {
  nodeRequestLifecycle,
  nodeRequestToWebRequestEffect,
  writeNodeExchangeResponseEffect,
  type StartNodeAdapterError,
  type StartNodeRequestOptions,
} from "./node-web-exchange.js";
import {
  forkStartHostEffect,
  interruptStartHostFiberOnSignal,
  type StartHostForkRunnerOptions,
} from "./start-host-runtime-runner.js";

export {
  StartNodeAdapterError,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  writeNodeResponse,
} from "./node-web-exchange.js";
export type {
  StartNodeOriginPolicy,
  StartNodeRequestOptions,
  WriteNodeResponseOptions,
} from "./node-web-exchange.js";

/** Effect-first Node HTTP handler returned by `createNodeHandler`. */
export type StartNodeHandler<Requirements = never> = (
  request: IncomingMessage,
  response: ServerResponse,
) => Effect.Effect<Response, StartNodeAdapterError | StartRequestHandlerError, Requirements>;

export type { StartForkRuntime } from "./start-host-runtime-runner.js";

/**
 * Error callback used by Node server handler facades.
 *
 * Return a pure value or an Effect. Promise-shaped cleanup should be adapted
 * explicitly with `Effect.tryPromise(...)` before it reaches this seam.
 */
export type StartNodeServerErrorHandler = (
  error: unknown,
  request: IncomingMessage,
  response: ServerResponse,
) => EffectInput<void, never, never>;

/** Options for Node `createServer`-style host handlers. */
export interface StartNodeServerHandlerOptions<RuntimeError = never>
  extends StartNodeRequestOptions, StartHostForkRunnerOptions<RuntimeError> {
  readonly onError?: StartNodeServerErrorHandler;
}

type StartNodeRuntimeRequirements<Requirements> = unknown extends Requirements
  ? never
  : Exclude<Requirements, Scope.Scope>;

/**
 * Options required when a Node callback facade runs a serviceful request handler.
 *
 * The callback facade owns the per-request Scope. Any remaining handler
 * services must be supplied by a typed runtime so missing requirements remain
 * visible at the host Adapter Interface.
 */
export type StartNodeServerHandlerRuntimeOptions<Requirements, RuntimeError = never> = Omit<
  StartNodeServerHandlerOptions<RuntimeError>,
  "runtime"
> & {
  readonly runtime: SunfallArcRuntime<StartNodeRuntimeRequirements<Requirements>, RuntimeError>;
};

type StartNodeServerHandlerOptionsArgs<Requirements, RuntimeError = never> = [
  StartNodeRuntimeRequirements<Requirements>,
] extends [never]
  ? [options?: StartNodeServerHandlerOptions<RuntimeError>]
  : [options: StartNodeServerHandlerRuntimeOptions<Requirements, RuntimeError>];

/** Node `createServer` callback that runs the adapter Effect internally. */
export type StartNodeServerHandler = (request: IncomingMessage, response: ServerResponse) => void;

/**
 * Creates an Effect-first Node HTTP handler from a Start request handler.
 *
 * It converts the Node request to a web `Request`, invokes Start, writes the
 * web `Response` back to Node, and returns that response for diagnostics.
 *
 * @example
 * ```ts
 * const nodeHandler = createNodeHandler(startHandler);
 * ```
 */
export function createNodeHandler<Handler extends StartRequestHandlerInput<any, any>>(
  handler: Handler,
  options?: StartNodeRequestOptions,
): StartNodeHandler<StartRequestHandlerRequirements<Handler>>;
/**
 * Creates an Effect-first Node HTTP handler while preserving explicit handler
 * service requirements for the caller's runtime.
 */
export function createNodeHandler<HandlerError, Requirements>(
  handler: StartRequestHandlerInput<HandlerError, Requirements>,
  options?: StartNodeRequestOptions,
): StartNodeHandler<Requirements>;
/**
 * Implementation for the Effect-first Node Adapter. It owns Node/Web request
 * conversion and response writing, but leaves execution to the returned Effect.
 */
export function createNodeHandler(
  handler: StartRequestHandlerInput<any, any>,
  options: StartNodeRequestOptions = {},
): StartNodeHandler<any> {
  return (request, response) =>
    Effect.gen(function* () {
      const webRequest = yield* nodeRequestToWebRequestEffect(request, options);
      const webResponse = yield* invokeStartRequestHandlerEffect(handler, webRequest);
      yield* writeNodeExchangeResponseEffect(request, response, webResponse);
      return webResponse;
    });
}

const defaultNodeServerErrorHandler: StartNodeServerErrorHandler = (error, _request, response) => {
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
  onError: StartNodeServerErrorHandler = defaultNodeServerErrorHandler,
): Effect.Effect<void, never, never> =>
  Effect.suspend(() => toEffect(onError(error, request, response))).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        defaultNodeServerErrorHandler(Cause.squash(cause), request, response);
      }),
    ),
    Effect.catchCause(() => Effect.void),
  );

/**
 * Creates a Node `createServer` callback that runs the adapter Effect.
 *
 * This keeps `createNodeHandler` available for Effect-first hosts while
 * giving ordinary Node HTTP integrations a host-shaped callback facade.
 */
export function createNodeServerHandler<
  Handler extends StartRequestHandlerInput<any, any>,
  RuntimeError = never,
>(
  handler: Handler,
  ...args: StartNodeServerHandlerOptionsArgs<StartRequestHandlerRequirements<Handler>, RuntimeError>
): StartNodeServerHandler {
  const options = args[0] ?? {};
  return (request, response) => {
    const lifecycle = nodeRequestLifecycle(request, response);
    const effectHandler = createNodeHandler(handler, {
      ...options,
      signal: lifecycle.signal,
    });
    const reportError = (error: unknown): void => {
      try {
        void defaultRuntime.runFork(
          reportNodeServerErrorEffect(error, request, response, options.onError),
          options.runOptions,
        );
      } catch (reportFailure) {
        try {
          defaultNodeServerErrorHandler(reportFailure, request, response);
        } catch {
          // Nothing useful remains to report after both the runtime and fallback handler fail.
        }
      }
    };

    try {
      const fiber = forkStartHostEffect(
        effectHandler(request, response).pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            reportNodeServerErrorEffect(Cause.squash(cause), request, response, options.onError),
          ),
        ),
        options,
      );
      const disposeInterrupt = interruptStartHostFiberOnSignal(fiber, lifecycle.signal, options);
      fiber.addObserver(() => {
        disposeInterrupt();
        lifecycle.dispose();
      });
    } catch (error) {
      lifecycle.dispose();
      reportError(error);
    }
  };
}
