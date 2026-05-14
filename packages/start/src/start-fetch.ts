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
export type StartFetch<E = never> = (
  input: StartFetchInput,
  init?: StartFetchInit
) => Effect.Effect<Response, E>;

/** Options for clients that call Start server functions over HTTP RPC. */
export interface ServerRpcClientOptions<FetchError = never> {
  /** RPC endpoint. Defaults to the Start server function path. */
  readonly endpoint?: string | URL;
  /** Fetch implementation for browsers, tests, edge runtimes, or Effect handlers. */
  readonly fetch?: StartFetch<FetchError>;
  /** Static or lazily computed headers added to every RPC request. */
  readonly headers?: HeadersInit | (() => HeadersInit);
}

export const getStartTransportHeadersEffect = <FetchError = never>(
  options: ServerRpcClientOptions<FetchError>
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

export const callStartFetchEffect = <FetchError>(
  fetcher: StartFetch<FetchError>,
  input: StartFetchInput,
  init: StartFetchInit,
  onError: (cause: FetchError) => ServerTransportError
): Effect.Effect<Response, ServerTransportError> =>
  fetcher(input, init).pipe(Effect.mapError(onError));

export const resolveStartFetchEffect = <FetchError = never>(
  fetcher: StartFetch<FetchError> | undefined,
  unavailableMessage: string
): Effect.Effect<StartFetch<FetchError | ServerTransportError>, ServerTransportError> => {
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
      catch: (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Global fetch request failed.",
          cause
        })
    })
  );
};
