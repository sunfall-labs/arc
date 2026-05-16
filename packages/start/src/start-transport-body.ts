import {
  Server,
  ServerRpcProtocolError,
  ServerTransportError
} from "@effect-ui/core";
import { Effect } from "effect";

/** Body-like source that can be consumed once as JSON by the Start transport. */
export type StartTransportJsonBodySource = Pick<Body, "json">;

/** Body-like source that can be consumed once as form data by the Start action transport. */
export type StartTransportFormDataBodySource = Pick<Body, "formData">;

/** Response-like source that can be consumed once as text by the Start transport. */
export type StartTransportTextBodySource =
  Pick<Body, "text"> & { readonly status: number };

const protocolBodyReadError = (
  message: string,
  cause: unknown
): ServerRpcProtocolError =>
  new ServerRpcProtocolError({
    message,
    payload: Server.serializeDefect(cause)
  });

const transportBodyReadError = (
  response: StartTransportTextBodySource,
  message: string,
  cause: unknown
): ServerTransportError =>
  new ServerTransportError({
    reason: "InvalidResponse",
    status: response.status,
    message,
    cause
  });

/**
 * Reads a Start RPC/action JSON request body through the Effect boundary.
 *
 * Fetch body readers are host APIs. Keeping them behind this helper makes the
 * one-shot read and protocol-failure mapping shared by every Start JSON
 * request path.
 */
export const readStartTransportJsonBodyEffect = (
  body: StartTransportJsonBodySource,
  message: string
): Effect.Effect<unknown, ServerRpcProtocolError> =>
  Effect.tryPromise({
    try: () => body.json(),
    catch: (cause) => protocolBodyReadError(message, cause)
  });

/**
 * Reads a Start action form request body through the Effect boundary.
 *
 * This is the only Start action path that should call the host `formData()`
 * reader directly; callers receive typed protocol failures instead.
 */
export const readStartTransportFormDataBodyEffect = (
  body: StartTransportFormDataBodySource,
  message: string
): Effect.Effect<FormData, ServerRpcProtocolError> =>
  Effect.tryPromise({
    try: () => body.formData(),
    catch: (cause) => protocolBodyReadError(message, cause)
  });

/**
 * Reads a Start transport response body as text through the Effect boundary.
 *
 * Client response parsers validate content type first, then use this helper so
 * stream/body failures become typed `ServerTransportError` values before JSON
 * decoding begins.
 */
export const readStartTransportResponseTextEffect = (
  response: StartTransportTextBodySource,
  message: string
): Effect.Effect<string, ServerTransportError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => transportBodyReadError(response, message, cause)
  });
