import { Server } from "@sunfall/arc-core";
import { Effect, Layer, Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RpcClient, RpcClientError, RpcGroup, RpcSerialization, type Rpc } from "effect/rpc";
import { serverRpcPath } from "./rpc.js";

/**
 * Settles every call its HTTP response leaves unanswered. `effect/rpc` routes
 * each response message by request id and ignores ids it does not know, so a
 * response that completes without an `Exit` for the request (a proxy or server
 * answering another id) would leave the call pending forever: the request's
 * send fails with an `RpcClientError` instead.
 */
const settlingUnansweredCalls = (
  protocol: RpcClient.Protocol["Service"],
): RpcClient.Protocol["Service"] => {
  const answered = new Set<string>();
  return {
    ...protocol,
    run: (clientId, write) =>
      protocol.run(clientId, (message) => {
        if (message._tag === "Exit") {
          answered.add(`${clientId}:${message.requestId}`);
        }
        return write(message);
      }),
    send: (clientId, request, transferables) =>
      protocol.send(clientId, request, transferables).pipe(
        Effect.flatMap(() => {
          if (request._tag !== "Request" || answered.delete(`${clientId}:${request.id}`)) {
            return Effect.void;
          }
          return Effect.fail(
            new RpcClientError.RpcClientError({
              reason: new RpcClientError.RpcClientDefect({
                message: "HTTP response ended without an answer for the RPC request",
                cause: { requestId: request.id, tag: request.tag },
              }),
            }),
          );
        }),
      ),
  };
};

type FlatClient = (tag: string, payload: unknown) => Effect.Effect<unknown, unknown, never>;

/**
 * Layer that provides Start's `Server.Client`: an `effect/rpc` `RpcClient`
 * over the runtime's `HttpClient` with JSON serialization, posting to the
 * fixed `/__sunfall-arc/rpc` endpoint. `HttpClient` propagates the caller's
 * span (`traceparent`), so client and server spans share one trace.
 *
 * Server functions are module values that load as routes do, so the group
 * is not known up front: each function gets a one-Rpc client the first time
 * it is called, all sharing one HTTP protocol and the Layer's scope.
 */
export const rpcClientLayer: Layer.Layer<Server.Client, never, HttpClient.HttpClient> =
  Layer.effect(Server.Client)(
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.setUrl(serverRpcPath)),
      );
      const protocol = settlingUnansweredCalls(
        yield* RpcClient.makeProtocolHttp(httpClient).pipe(
          Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.json),
        ),
      );
      const clients = new Map<string, Effect.Effect<FlatClient>>();
      const clientFor = (rpc: Rpc.Any): Effect.Effect<FlatClient> =>
        Effect.suspend(() => {
          let client = clients.get(rpc._tag);
          if (client === undefined) {
            client = Effect.runSync(
              Effect.cached(
                RpcClient.make(RpcGroup.make(rpc), { flatten: true }).pipe(
                  Effect.provideService(RpcClient.Protocol, protocol),
                  Scope.provide(scope),
                ) as unknown as Effect.Effect<FlatClient>,
              ),
            );
            clients.set(rpc._tag, client);
          }
          return client;
        });
      return Server.makeClient(
        <I, A, E, R>(fn: Server.Fn<I, A, E, R>, input: I) =>
          Effect.flatMap(clientFor(fn.rpc as Rpc.Any), (client) =>
            client(fn.name, input),
          ) as Effect.Effect<A, E | Server.ClientError, R>,
      );
    }),
  );
