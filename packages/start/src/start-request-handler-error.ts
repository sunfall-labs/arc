import { Data } from "effect";

/** Error raised when a Start request handler fails before producing a response. */
export class StartRequestHandlerError extends Data.TaggedError("StartRequestHandlerError")<{
  readonly operation: "handle-request";
  readonly request: {
    readonly method: string;
    readonly url: string;
  };
  readonly cause: unknown;
}> {}

/** Guidance attached when a request handler returns a non-Effect value. */
export const invalidStartRequestHandlerReturnMessage =
  "Start request handlers must return an Effect. Wrap host Promise work with Effect.tryPromise(...) at the host Adapter seam.";

/** Cause used when an untyped request handler returns something other than an Effect. */
export class StartRequestHandlerInvalidReturn extends Data.TaggedError(
  "StartRequestHandlerInvalidReturn"
)<{
  readonly message: string;
  readonly received: unknown;
}> {}

export const makeStartRequestHandlerError = (
  request: Request,
  cause: unknown
): StartRequestHandlerError =>
  new StartRequestHandlerError({
    operation: "handle-request",
    request: {
      method: request.method,
      url: request.url
    },
    cause
  });

export const normalizeStartRequestHandlerError = (
  request: Request,
  cause: unknown
): StartRequestHandlerError =>
  cause instanceof StartRequestHandlerError
    ? cause
    : makeStartRequestHandlerError(request, cause);
