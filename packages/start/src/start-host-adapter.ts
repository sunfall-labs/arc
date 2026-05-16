import { Effect } from "effect";
import {
  invalidStartRequestHandlerReturnMessage,
  normalizeStartRequestHandlerError,
  StartRequestHandlerInvalidReturn,
  type StartRequestHandlerError
} from "./start-request-handler-error.js";

export declare const StartRequestHandlerRequirementsTypeId: unique symbol;

export interface StartRequestHandlerRequirementsMarker<Requirements> {
  readonly [StartRequestHandlerRequirementsTypeId]: Requirements;
}

export type StartRequestHandlerInput<E = never, R = never> = (
  request: Request
) => Effect.Effect<Response, E, R>;

export type StartRequestHandlerRequirements<Handler> =
  Handler extends StartRequestHandlerRequirementsMarker<infer R>
    ? R
    : Handler extends StartRequestHandlerInput<any, infer R> ? R : never;

export const startRequestHandlerError = (
  request: Request,
  cause: unknown
): StartRequestHandlerError =>
  normalizeStartRequestHandlerError(request, cause);

export function invokeStartRequestHandlerEffect<Handler extends StartRequestHandlerInput<any, any>>(
  handler: Handler,
  request: Request
): Effect.Effect<Response, StartRequestHandlerError, StartRequestHandlerRequirements<Handler>>;
export function invokeStartRequestHandlerEffect<HandlerError, R>(
  handler: StartRequestHandlerInput<HandlerError, R>,
  request: Request
): Effect.Effect<Response, StartRequestHandlerError, R>;
export function invokeStartRequestHandlerEffect(
  handler: StartRequestHandlerInput<any, any>,
  request: Request
): Effect.Effect<Response, StartRequestHandlerError, any> {
  return Effect.flatMap(
    Effect.try({
      try: () => handler(request) as unknown,
      catch: (cause) => startRequestHandlerError(request, cause)
    }),
    (effect) => {
      if (!Effect.isEffect(effect)) {
        return Effect.fail(
          startRequestHandlerError(
            request,
            new StartRequestHandlerInvalidReturn({
              message: invalidStartRequestHandlerReturnMessage,
              received: effect
            })
          )
        );
      }

      return (effect as Effect.Effect<Response, unknown, any>).pipe(
        Effect.mapError((cause) => startRequestHandlerError(request, cause))
      );
    }
  );
}
