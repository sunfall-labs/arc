import {
  Server,
  ServerClient,
  ServerTransportError
} from "@effect-ui/core";
import { Effect, Layer } from "effect";
import { serverRpcPath } from "./rpc.js";
import {
  callStartFetchEffect,
  getStartTransportHeadersEffect as getRpcHeadersEffect,
  resolveStartFetchEffect,
  type ServerRpcClientOptions
} from "./start-fetch.js";
import { parseRpcResponse } from "./start-transport-protocol.js";

/**
 * Creates a `ServerClient` that invokes server functions through Start RPC.
 *
 * Calls remain Effects. The HTTP request is performed only when the server
 * function Effect is run.
 */
export const makeRpcClient = <FetchError = never>(
  options: ServerRpcClientOptions<FetchError> = {}
): ServerClient => ({
  call: (fn, input) =>
    Effect.gen(function* () {
      const fetcher = yield* resolveStartFetchEffect(
        options.fetch,
        "No fetch implementation is available for server functions."
      );

      const encodedInput = yield* Server.encodeInput(fn, input);
      const request: Server.RpcRequest = {
        name: fn.name,
        input: encodedInput
      };
      const body = yield* Effect.try({
        try: () => JSON.stringify(request),
        catch: (cause) =>
          new ServerTransportError({
            reason: "InvalidResponse",
            message: "Could not encode the server function request body.",
            cause,
            payload: request
          })
      });
      const headers = yield* getRpcHeadersEffect(options);
      const response = yield* callStartFetchEffect(
        fetcher,
        options.endpoint ?? serverRpcPath,
        {
          method: "POST",
          headers,
          body
        },
        (cause) =>
          new ServerTransportError({
            reason: "Network",
            message: "Server function request failed.",
            cause
          })
      );
      const rpcResponse = yield* parseRpcResponse(response);

      switch (rpcResponse._tag) {
        case "Success":
          if (!response.ok) {
            return yield* new ServerTransportError({
              reason: "BadStatus",
              status: response.status,
              message: `Server function succeeded with unexpected HTTP status ${response.status}.`,
              payload: rpcResponse
            });
          }
          return yield* Server.decodeOutput(fn, rpcResponse.value);
        case "Failure":
          if (!response.ok) {
            return yield* new ServerTransportError({
              reason: "BadStatus",
              status: response.status,
              message: `Server function failed with unexpected HTTP status ${response.status}.`,
              payload: rpcResponse
            });
          }
          return yield* Effect.fail(yield* Server.decodeError(fn, rpcResponse.error));
        case "ServerError":
          return yield* Effect.fail(Server.deserializeServerError(rpcResponse.error));
        case "Defect":
          return yield* new ServerTransportError({
            reason: "Defect",
            status: response.status,
            message: "Server function failed with a defect.",
            payload: rpcResponse.defect
          });
      }
    })
});

/** Layer that provides a Start RPC-backed `ServerClient`. */
export const makeRpcClientLayer = <FetchError = never>(
  options: ServerRpcClientOptions<FetchError> = {}
) =>
  Layer.succeed(ServerClient)(makeRpcClient(options));

/** Default browser RPC layer using `globalThis.fetch` and the Start RPC path. */
export const BrowserRpcLive = makeRpcClientLayer();
