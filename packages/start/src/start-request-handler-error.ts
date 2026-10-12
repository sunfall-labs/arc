import { Data } from "effect";

/**
 * A readable one-line account of a failure: its message, or its `_tag` and
 * the cause it wraps, so wrapped tagged errors without messages still say
 * what went wrong in logs and the Vite dev overlay.
 */
export const describeStartFailure = (value: unknown, depth = 0): string => {
  if (depth > 4 || value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== "object") {
    return String(value);
  }
  const record = value as {
    readonly message?: unknown;
    readonly _tag?: unknown;
    readonly cause?: unknown;
    readonly error?: unknown;
  };
  if (typeof record.message === "string" && record.message.length > 0) {
    return record.message;
  }
  const inner = record.cause ?? record.error;
  const tag = typeof record._tag === "string" ? record._tag : undefined;
  if (tag === undefined) {
    return inner === undefined ? String(value) : describeStartFailure(inner, depth + 1);
  }
  return inner === undefined ? tag : `${tag}: ${describeStartFailure(inner, depth + 1)}`;
};

/** Error raised when a Start request handler fails before producing a response. */
export class StartRequestHandlerError extends Data.TaggedError("StartRequestHandlerError")<{
  readonly operation: "handle-request";
  readonly request: {
    readonly method: string;
    readonly url: string;
  };
  readonly cause: unknown;
}> {
  override get message(): string {
    return `${this.request.method} ${this.request.url} failed: ${describeStartFailure(this.cause)}`;
  }
}

/** Guidance attached when a request handler returns a non-Effect value. */
export const invalidStartRequestHandlerReturnMessage =
  "Start request handlers must return an Effect. Wrap host Promise work with Effect.tryPromise(...) at the host Adapter seam.";

/** Cause used when an untyped request handler returns something other than an Effect. */
export class StartRequestHandlerInvalidReturn extends Data.TaggedError(
  "StartRequestHandlerInvalidReturn",
)<{
  readonly message: string;
  readonly received: unknown;
}> {}

export const makeStartRequestHandlerError = (
  request: Request,
  cause: unknown,
): StartRequestHandlerError =>
  new StartRequestHandlerError({
    operation: "handle-request",
    request: {
      method: request.method,
      url: request.url,
    },
    cause,
  });

export const normalizeStartRequestHandlerError = (
  request: Request,
  cause: unknown,
): StartRequestHandlerError =>
  cause instanceof StartRequestHandlerError ? cause : makeStartRequestHandlerError(request, cause);
