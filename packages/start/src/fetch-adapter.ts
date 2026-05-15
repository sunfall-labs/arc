import type { EffectUiRuntime } from "@effect-ui/core";
import { Effect, Scope } from "effect";
import { StartRequestHandlerError } from "./start-request-handler-error.js";
import {
  invokeStartRequestHandlerEffect,
  type StartRequestHandlerInput,
  type StartRequestHandlerRequirements
} from "./start-host-adapter.js";
import {
  runStartHostResponsePromise,
  type StartHostPromiseRunnerOptions
} from "./start-host-runtime-runner.js";

export { StartRequestHandlerError } from "./start-request-handler-error.js";

type StartFetchRuntimeRequirements<Requirements> =
  unknown extends Requirements ? never : Exclude<Requirements, Scope.Scope>;

/**
 * Compatibility options for Fetch hosts that require a Promise-shaped entrypoint.
 *
 * Application code should prefer `toFetchHandlerEffect(...)` and stay inside
 * Effect v4. This options type exists only for deployment hosts whose contract
 * is fixed to `(request) => Promise<Response>`.
 */
export interface StartFetchPromiseHandlerOptions<RuntimeError = never>
  extends StartHostPromiseRunnerOptions<RuntimeError> {}

/**
 * Compatibility options required when a Fetch host facade runs a serviceful
 * request handler.
 *
 * The facade provides the per-request Scope itself. Any remaining handler
 * services must come from a typed runtime so the host Adapter cannot silently
 * erase missing app requirements.
 */
export type StartFetchPromiseHandlerRuntimeOptions<
  Requirements,
  RuntimeError = never
> = Omit<StartFetchPromiseHandlerOptions<RuntimeError>, "runtime"> & {
  /** Runtime that supplies the handler's non-Scope requirements. */
  readonly runtime: EffectUiRuntime<StartFetchRuntimeRequirements<Requirements>, RuntimeError>;
};

type StartFetchPromiseHandlerOptionsArgs<
  Requirements,
  RuntimeError = never
> = [StartFetchRuntimeRequirements<Requirements>] extends [never]
  ? [options?: StartFetchPromiseHandlerOptions<RuntimeError>]
  : [options: StartFetchPromiseHandlerRuntimeOptions<Requirements, RuntimeError>];

/**
 * Compatibility handler type for Fetch-native hosts.
 *
 * This is a host adapter contract, not the canonical Effect UI programming
 * model.
 */
export type StartFetchPromiseHandler = (request: Request) => Promise<Response>;

/** Effect-first Fetch handler returned by `toFetchHandlerEffect`. */
export type StartFetchHandlerEffect<Requirements = never> = (
  request: Request
) => Effect.Effect<Response, StartRequestHandlerError, Requirements>;

/** Fetch handler returned by `toFetchHandler`. */
export type StartFetchHandler<Requirements = never> = StartFetchHandlerEffect<Requirements>;

/** Adapts a Start request handler to the fetch adapter's Effect handler shape. */
export function toFetchHandlerEffect<Handler extends StartRequestHandlerInput<any, any>>(
  handler: Handler
): StartFetchHandlerEffect<StartRequestHandlerRequirements<Handler>>;
export function toFetchHandlerEffect<HandlerError, Requirements>(
  handler: StartRequestHandlerInput<HandlerError, Requirements>
): StartFetchHandlerEffect<Requirements>;
export function toFetchHandlerEffect(
  handler: StartRequestHandlerInput<any, any>
): StartFetchHandlerEffect<any> {
  return (request) => invokeStartRequestHandlerEffect(handler, request);
}

/** Adapts a public Start request handler to the fetch adapter Effect shape. */
export function toFetchHandler<Handler extends StartRequestHandlerInput<any, any>>(
  handler: Handler
): StartFetchHandler<StartRequestHandlerRequirements<Handler>>;
export function toFetchHandler<HandlerError, Requirements>(
  handler: StartRequestHandlerInput<HandlerError, Requirements>
): StartFetchHandler<Requirements>;
export function toFetchHandler(
  handler: StartRequestHandlerInput<any, any>
): StartFetchHandler<any> {
  return toFetchHandlerEffect(handler);
}

/**
 * Creates a compatibility Fetch-host handler for platforms that require
 * `(request) => Promise<Response>`.
 *
 * The canonical adapter is `toFetchHandlerEffect(...)`. This facade is kept for
 * deployment compatibility with workers, edge runtimes, Bun, and similar hosts
 * whose public contract is Promise-shaped.
 */
export function createFetchHandler<Handler extends StartRequestHandlerInput<any, any>, RuntimeError = never>(
  handler: Handler,
  ...args: StartFetchPromiseHandlerOptionsArgs<StartRequestHandlerRequirements<Handler>, RuntimeError>
): StartFetchPromiseHandler {
  const options = args[0] ?? {};
  const effectHandler = toFetchHandlerEffect(handler);
  return (request) => runStartHostResponsePromise(effectHandler(request), options);
}
