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

/** The JSON-safe opaque defect sent in place of a server defect. */
export interface StartServerDefectBody {
  readonly _tag: typeof startServerDefectTag;
  readonly message: typeof startServerDefectMessage;
}

export const startServerDefectBody: StartServerDefectBody = {
  _tag: startServerDefectTag,
  message: startServerDefectMessage,
};

/**
 * The value an RPC handler dies with in place of a server defect. `effect/rpc`
 * encodes a defect `Error` as its `name` and `message` only.
 */
export const makeStartServerDefect = (): Error => {
  const error = new Error(startServerDefectMessage);
  error.name = startServerDefectTag;
  return error;
};

/** Logs a server defect, with its full cause, at Error level. */
export const logStartDefect = (
  operation: string,
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(`${operation} failed`, cause);
