import { Server } from "@sunfall/arc-core";
import { Effect, Layer, Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RpcClient, RpcGroup, RpcSerialization, type Rpc } from "effect/rpc";
import { serverRpcPath } from "./rpc.js";

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
      const protocol = yield* RpcClient.makeProtocolHttp(httpClient).pipe(
        Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.json),
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
