import {
  Server,
  ServerClient,
  type AnySunfallArcRuntime,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { Effect, Layer } from "effect";
import { type ServerRpcClientOptions } from "./start-fetch.js";
import { executeStartClientTransportEffect } from "./start-client-transport.js";
import { resolveStartRpcEndpoint } from "./start-transport-endpoints.js";
import { parseRpcResponse } from "./start-transport-protocol.js";

type ServerRpcTransportRuntime<FetchRequirements> =
  | SunfallArcRuntime<FetchRequirements, never>
  | AnySunfallArcRuntime<never>;

type ServerRpcRuntimeFreeOptions<FetchError = never> = ServerRpcClientOptions<
  FetchError,
  never,
  never
> & {
  readonly transportRuntime?: undefined;
};

type ServerRpcRuntimeBackedOptions<FetchError, FetchRequirements> = ServerRpcClientOptions<
  FetchError,
  FetchRequirements,
  never
> & {
  readonly transportRuntime: ServerRpcTransportRuntime<FetchRequirements>;
};

const makeRpcClientFromOptions = <FetchError = never, FetchRequirements = never>(
  options: ServerRpcClientOptions<FetchError, FetchRequirements, never> = {},
): ServerClient => ({
  call: <I, A, E, R>(
    fn: Server.Fn<I, A, E, R>,
    input: I,
  ): Effect.Effect<A, E | Server.ClientError, R> => {
    const workflow = Effect.gen(function* () {
      const encodedInput = yield* Server.encodeInput(fn, input);
      const request: Server.RpcRequest = {
        name: fn.name,
        input: encodedInput,
      };
      const { body: rpcResponse } = yield* executeStartClientTransportEffect({
        kind: "rpc",
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        endpoint: resolveStartRpcEndpoint(options),
        request,
        parseResponse: parseRpcResponse,
      });

      switch (rpcResponse._tag) {
        case "Success":
          return yield* Server.decodeOutput(fn, rpcResponse.value);
        case "Failure":
          return yield* Effect.fail(yield* Server.decodeError(fn, rpcResponse.error));
      }
    });

    return (options.transportRuntime
      ? options.transportRuntime.provide(workflow)
      : workflow) as unknown as Effect.Effect<A, E | Server.ClientError, R>;
  },
});

/**
 * Layer that provides a Start RPC-backed `ServerClient`.
 *
 * Calls remain Effects; the HTTP request is performed only when a server
 * function Effect runs. `makeRpcClientLayer()` uses `globalThis.fetch` and the
 * default Start RPC path.
 */
export function makeRpcClientLayer<FetchError = never>(
  options?: ServerRpcRuntimeFreeOptions<FetchError>,
): Layer.Layer<ServerClient>;
export function makeRpcClientLayer<FetchError = never, FetchRequirements = never>(
  options: ServerRpcRuntimeBackedOptions<FetchError, FetchRequirements>,
): Layer.Layer<ServerClient>;
export function makeRpcClientLayer<FetchError = never, FetchRequirements = never>(
  options: ServerRpcClientOptions<FetchError, FetchRequirements, never> = {},
): Layer.Layer<ServerClient> {
  return Layer.succeed(ServerClient)(makeRpcClientFromOptions(options));
}
