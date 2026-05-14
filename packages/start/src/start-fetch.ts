import { ServerTransportError } from "@effect-ui/core";
import { Effect } from "effect";
import {
  makeStartRequestIdEffect,
  startJsonMediaType,
  startRequestIdHeader
} from "./rpc.js";

/** Input accepted by the Start client transport fetch hook. */
export type StartFetchInput = Parameters<typeof globalThis.fetch>[0];

/** Request options accepted by the Start client transport fetch hook. */
export type StartFetchInit = Parameters<typeof globalThis.fetch>[1];

/** Effect hook used by Start clients to perform fetch-shaped transport work. */
export type StartFetch = (
  input: StartFetchInput,
  init?: StartFetchInit
) => Effect.Effect<Response, unknown>;

/** Options for clients that call Start server functions over HTTP RPC. */
export interface ServerRpcClientOptions {
  /** RPC endpoint. Defaults to the Start server function path. */
  readonly endpoint?: string | URL;
  /** Fetch implementation for browsers, tests, edge runtimes, or Effect handlers. */
  readonly fetch?: StartFetch;
  /** Static or lazily computed headers added to every RPC request. */
  readonly headers?: HeadersInit | (() => HeadersInit);
}

export const getStartTransportHeadersEffect = (
  options: ServerRpcClientOptions
): Effect.Effect<Headers> =>
  Effect.gen(function* () {
    const headers = new Headers(
      typeof options.headers === "function" ? options.headers() : options.headers
    );
    if (!headers.has(startRequestIdHeader)) {
      headers.set(startRequestIdHeader, yield* makeStartRequestIdEffect);
    }
    headers.set("accept", startJsonMediaType);
    headers.set("content-type", startJsonMediaType);
    return headers;
  });

export const callStartFetchEffect = (
  fetcher: StartFetch,
  input: StartFetchInput,
  init: StartFetchInit,
  onError: (cause: unknown) => ServerTransportError
): Effect.Effect<Response, ServerTransportError> =>
  fetcher(input, init).pipe(Effect.mapError(onError));

export const resolveStartFetchEffect = (
  fetcher: StartFetch | undefined,
  unavailableMessage: string
): Effect.Effect<StartFetch, ServerTransportError> => {
  if (fetcher) {
    return Effect.succeed(fetcher);
  }

  if (typeof globalThis.fetch !== "function") {
    return Effect.fail(
      new ServerTransportError({
        reason: "Network",
        message: unavailableMessage
      })
    );
  }

  return Effect.succeed((input, init) =>
    Effect.tryPromise({
      try: () => globalThis.fetch(input, init),
      catch: (cause) => cause
    })
  );
};
