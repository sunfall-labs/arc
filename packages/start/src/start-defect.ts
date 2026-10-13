// Internal: the one path for server defects that end a transport request.
//
// A defect (a throw, `Effect.die`, a failure outside the declared `error`
// schema, an output that does not encode) is a bug on the server. Its detail
// (message, stack, SQL, file paths) belongs in the server's logs and spans,
// never on the wire: the browser gets an opaque defect, and the request id on
// the response (`x-sunfall-arc-request-id`), which the server log carries as
// the `sunfall-arc.request.id` annotation, correlates the two.
import { Cause, Effect } from "effect";

/** The message every opaque server defect carries to the browser. */
export const startServerDefectMessage = "The server failed to handle the request.";

/** Tag of the opaque defect the browser receives for a server defect. */
export const startServerDefectTag = "StartServerDefect";

/**
 * The JSON-safe opaque defect sent in place of a server defect, shaped as RFC
 * 9457 Problem Details (`type`, `title`, `status`, `detail`). The request id
 * travels in the `x-sunfall-arc-request-id` response header.
 */
export interface StartServerDefectBody {
  readonly _tag: typeof startServerDefectTag;
  readonly type: "about:blank";
  readonly title: "Internal Server Error";
  readonly status: 500;
  readonly detail: typeof startServerDefectMessage;
}

export const startServerDefectBody: StartServerDefectBody = {
  _tag: startServerDefectTag,
  type: "about:blank",
  title: "Internal Server Error",
  status: 500,
  detail: startServerDefectMessage,
};

/**
 * The value an RPC handler dies with in place of a server defect. `effect/rpc`
 * encodes a defect `Error` as its `name` and `message` only, so the request id
 * rides in the message as `(reference <id>)`.
 */
export const makeStartServerDefect = (requestId?: string): Error => {
  const error = new Error(
    requestId === undefined
      ? startServerDefectMessage
      : `${startServerDefectMessage} (reference ${requestId})`,
  );
  error.name = startServerDefectTag;
  return error;
};

/** Logs a server defect, with its full cause, at Error level. */
export const logStartDefect = (
  operation: string,
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(`${operation} failed`, cause);
