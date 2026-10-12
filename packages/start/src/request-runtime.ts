import {
  makeResourceStore,
  provideRequest,
  provideResponse,
  Server,
  type SunfallArcRuntime,
  type RequestContext,
  type ResourceStore as ResourceStoreState,
  type ResponseContext,
  type Route,
} from "@sunfall/arc-core";
import {
  withResourceStore,
  withRuntimeServices,
  type AppDefinitionRegistry,
} from "@sunfall/arc-core/internal";
import type { StartServerApp } from "./start-server-app.js";
import { Effect, Option, type Scope } from "effect";
import { KeyValueStore } from "effect/persistence";
export {
  completeRequestRuntimeWithResponse,
  type RequestRuntimeFinalizeState,
} from "./request-runtime-response.js";

export const makeRequestRuntime = <
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
>(
  app: StartServerApp<Routes, ServerServices, ServerError>,
): SunfallArcRuntime<ServerServices, ServerError> =>
  withResourceStore(app.runtime, makeResourceStore());

/** Services a Request Runtime provides to render, preload, RPC, and action Effects. */
export type RequestRuntimeProvidedRequirements<RuntimeServices> =
  | RuntimeServices
  | ResourceStoreState
  | RequestContext
  | ResponseContext
  | Server.Client
  | KeyValueStore.KeyValueStore;

/**
 * The server's default `KeyValueStore`: it stores nothing, so Resources with
 * `policy.persist` skip persistence during SSR (one request's values never
 * reach another's). A `KeyValueStore` in the server Layer replaces it.
 */
const serverKeyValueStore: KeyValueStore.KeyValueStore = KeyValueStore.makeStringOnly({
  get: () => Effect.succeed(undefined),
  set: () => Effect.void,
  remove: () => Effect.void,
  clear: Effect.void,
  size: Effect.succeed(0),
});

/** Provides the server's default `KeyValueStore` unless the runtime already has one. */
const provideServerKeyValueStore = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, KeyValueStore.KeyValueStore>> =>
  Effect.flatMap(Effect.serviceOption(KeyValueStore.KeyValueStore), (store) =>
    Option.isSome(store)
      ? effect
      : Effect.provideService(effect, KeyValueStore.KeyValueStore, serverKeyValueStore),
  ) as Effect.Effect<A, E, Exclude<R, KeyValueStore.KeyValueStore>>;

export type RequestRuntimeRemainingRequirements<RIn, RuntimeServices> = Exclude<
  RIn,
  RequestRuntimeProvidedRequirements<RuntimeServices>
>;

export const provideLocalServerClient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  registry?: AppDefinitionRegistry,
): Effect.Effect<A, E, Exclude<R, Server.Client>> =>
  Effect.provideService(
    effect,
    Server.Client,
    Server.localClient(registry === undefined ? {} : { registry }),
  ) as Effect.Effect<A, E, Exclude<R, Server.Client>>;

/**
 * A Request Runtime whose every Effect runs with the request's services: the
 * request, its response context, the server's `KeyValueStore`, and the
 * in-process server-function client. Work the render forks (a Resource read
 * the route did not preload, a callback) then runs exactly like the preload
 * does, instead of failing for want of a server-function client.
 */
export const makeServedRequestRuntime = <
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
>(
  app: StartServerApp<Routes, ServerServices, ServerError>,
  request: Request,
  responseContext: ResponseContext,
  registry?: AppDefinitionRegistry,
): SunfallArcRuntime<ServerServices, ServerError> =>
  withRuntimeServices(
    makeRequestRuntime(app),
    (effect) =>
      provideRequest(request)(
        provideResponse(responseContext)(
          provideServerKeyValueStore(provideLocalServerClient(effect, registry)),
        ),
      ) as never,
  ) as SunfallArcRuntime<ServerServices, ServerError>;

export const provideRequestRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>,
  request: Request,
  effect: Effect.Effect<A, E, R>,
  responseContext: ResponseContext,
  registry?: AppDefinitionRegistry,
): Effect.Effect<
  A,
  E | RuntimeError,
  Scope.Scope | RequestRuntimeRemainingRequirements<R, RuntimeServices>
> =>
  runtime.provide(
    provideRequest(request)(
      provideResponse(responseContext)(
        provideServerKeyValueStore(provideLocalServerClient(effect, registry)),
      ),
    ),
  ) as Effect.Effect<
    A,
    E | RuntimeError,
    Scope.Scope | RequestRuntimeRemainingRequirements<R, RuntimeServices>
  >;
