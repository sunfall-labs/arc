import {
  isEffectLike,
  ServerTransportError,
  type AnyEffectUiRuntime,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Effect } from "effect";
import {
  makeStartRequestIdEffect,
  startJsonMediaType,
  startRequestIdHeader
} from "./rpc.js";
import type { StartTransportEndpointSource } from "./start-transport-endpoints.js";

/** Input accepted by the Start client transport fetch hook. */
export type StartFetchInput = Parameters<typeof globalThis.fetch>[0];

/** Request options accepted by the Start client transport fetch hook. */
export type StartFetchInit = Parameters<typeof globalThis.fetch>[1];

/**
 * Effect hook used by Start clients to perform fetch-shaped transport work.
 *
 * Use the `R` parameter when the transport depends on services such as auth,
 * tracing, or test fixtures. Pass `runtime`/`transportRuntime` in client
 * options to provide those services at the transport boundary. Return an Effect.
 * Host fetch implementations that are Promise-shaped must be adapted with
 * `Effect.tryPromise` before they reach this Interface.
 */
export type StartFetch<E = never, R = never> = (
  input: StartFetchInput,
  init?: StartFetchInit
) => Effect.Effect<Response, E, R>;

/** Options for clients that call Start server functions over HTTP RPC. */
export interface ServerRpcClientOptions<
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
> extends Pick<
    StartTransportEndpointSource,
    "rpcPath" | "endpoints" | "serverFunctionManifest" | "appGraph"
  > {
  /** RPC endpoint. Defaults to the Start server function path. */
  readonly endpoint?: string | URL;
  /** Fetch implementation for browsers, tests, edge runtimes, or Effect handlers. */
  readonly fetch?: StartFetch<FetchError, FetchRequirements>;
  /** Runtime used to provide services required by the fetch Effect. */
  readonly transportRuntime?: EffectUiRuntime<FetchRequirements, RuntimeError> | AnyEffectUiRuntime<RuntimeError>;
  /** Static or lazily computed headers added to every RPC request. */
  readonly headers?: HeadersInit | (() => HeadersInit);
}

export const getStartTransportHeadersEffect = (
  options: Pick<ServerRpcClientOptions, "headers">
): Effect.Effect<Headers, ServerTransportError> =>
  Effect.gen(function* () {
    const headers = yield* Effect.try({
      try: () =>
        new Headers(
          typeof options.headers === "function" ? options.headers() : options.headers
        ),
      catch: (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Could not construct Start transport headers.",
          cause
        })
    });
    if (!headers.has(startRequestIdHeader)) {
      headers.set(startRequestIdHeader, yield* makeStartRequestIdEffect);
    }
    headers.set("accept", startJsonMediaType);
    headers.set("content-type", startJsonMediaType);
    return headers;
  });

export const callStartFetchEffect = <FetchError, FetchRequirements>(
  fetcher: StartFetch<FetchError, FetchRequirements>,
  input: StartFetchInput,
  init: StartFetchInit,
  onError: (cause: FetchError | unknown) => ServerTransportError
): Effect.Effect<Response, ServerTransportError, FetchRequirements> =>
  Effect.flatMap(
    Effect.try({
      try: () => {
        const result = fetcher(input, init) as unknown;
        if (!isEffectLike(result)) {
          throw new TypeError(
            "Start fetch hooks must return an Effect. Wrap host Promise work with Effect.tryPromise(...) at the fetch Adapter seam."
          );
        }
        return result as Effect.Effect<Response, FetchError, FetchRequirements>;
      },
      catch: onError
    }),
    (effect) => effect.pipe(Effect.mapError(onError))
  );

export const resolveStartFetchEffect = <FetchError = never, FetchRequirements = never>(
  fetcher: StartFetch<FetchError, FetchRequirements> | undefined,
  unavailableMessage: string
): Effect.Effect<StartFetch<FetchError | ServerTransportError, FetchRequirements>, ServerTransportError> => {
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

  return Effect.succeed(((input, init) =>
    Effect.tryPromise({
      try: () => globalThis.fetch(input, init),
      catch: (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Global fetch request failed.",
          cause
        })
    })
  ) as StartFetch<FetchError | ServerTransportError, FetchRequirements>);
};
