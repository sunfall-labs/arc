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
