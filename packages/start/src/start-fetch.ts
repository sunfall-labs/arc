import {
  EffectInputPromiseRejected,
  isEffectLike,
  isPromiseLikeValue,
  ServerTransportError,
  type AnyEffectUiRuntime,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Data, Effect } from "effect";
import {
  makeStartRequestIdEffect,
  startJsonMediaType,
  startRequestIdHeader
} from "./rpc.js";
import { mergeStartAbortSignals } from "./start-abort-lifecycle.js";
import type { StartTransportEndpointSource } from "./start-transport-endpoints.js";

const invalidStartFetchReturnMessage =
  "Start fetch hooks must return an Effect. Wrap host Promise work with Effect.tryPromise(...) at the fetch Adapter seam.";

class StartFetchInvalidReturn extends Data.TaggedError("StartFetchInvalidReturn")<{
  readonly message: string;
  readonly received: unknown;
}> {}

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
    const headersInit = yield* Effect.try({
      try: () => typeof options.headers === "function"
        ? options.headers()
        : options.headers,
      catch: (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Could not construct Start transport headers.",
          cause
        })
    });
    if (isPromiseLikeValue(headersInit)) {
      return yield* Effect.fail(new ServerTransportError({
        reason: "Network",
        message: "Could not construct Start transport headers.",
        cause: new EffectInputPromiseRejected({
          guidance: "Start transport headers must be static HeadersInit or a synchronous HeadersInit callback. Move async header work into the StartFetch Adapter and wrap host Promise work with Effect.tryPromise(...)."
        })
      }));
    }

    const headers = yield* Effect.try({
      try: () => new Headers(headersInit),
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
      try: () => fetcher(input, init) as unknown,
      catch: onError
    }),
    (result) =>
      isEffectLike(result)
        ? (result as Effect.Effect<Response, FetchError, FetchRequirements>).pipe(Effect.mapError(onError))
        : Effect.fail(onError(new StartFetchInvalidReturn({
            message: invalidStartFetchReturnMessage,
            received: result
          })))
  );

const withStartFetchAbortSignal = (
  input: StartFetchInput,
  init: StartFetchInit,
  effectSignal: AbortSignal
): { readonly init: StartFetchInit; readonly cleanup: () => void } => {
  const signals = [effectSignal];
  if (init?.signal) {
    signals.push(init.signal);
  }
  if (typeof Request === "function" && input instanceof Request) {
    signals.push(input.signal);
  }
  const merged = mergeStartAbortSignals(signals);
  return {
    init: {
      ...init,
      signal: merged.signal
    },
    cleanup: merged.cleanup
  };
};

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
    Effect.suspend(() => {
      let cleanup = (): void => undefined;
      return Effect.tryPromise({
        try: (signal) => {
          const merged = withStartFetchAbortSignal(input, init, signal);
          cleanup = merged.cleanup;
          return globalThis.fetch(input, merged.init);
        },
        catch: (cause) =>
          new ServerTransportError({
            reason: "Network",
            message: "Global fetch request failed.",
            cause
          })
      }).pipe(
        Effect.ensuring(Effect.sync(() => cleanup()))
      );
    })
  ) as StartFetch<FetchError | ServerTransportError, FetchRequirements>);
};
