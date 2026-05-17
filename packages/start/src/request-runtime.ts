import {
  makeResourceStore,
  provideRequest,
  provideResponse,
  Server,
  ServerClient,
  withResourceStore,
  type AppDefinition,
  type EffectUiRuntime,
  type RequestContext,
  type ResourceStore as ResourceStoreState,
  type ResponseContext,
  type Route,
  type AppDefinitionRegistry,
} from "@effect-ui/core";
import { Effect, type Scope } from "effect";
export {
  completeRequestRuntimeWithResponse,
  type RequestRuntimeFinalizeState,
  type RequestRuntimeStreamFinalizeState,
} from "./request-runtime-response.js";

export const makeRequestRuntime = <
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
): EffectUiRuntime<ServerServices, ServerError> =>
  withResourceStore(app.runtime, makeResourceStore());

type RequestRuntimeProvidedRequirements<RuntimeServices> =
  | RuntimeServices
  | ResourceStoreState
  | RequestContext
  | ResponseContext
  | ServerClient;

export type RequestRuntimeRemainingRequirements<RIn, RuntimeServices> = Exclude<
  RIn,
  RequestRuntimeProvidedRequirements<RuntimeServices>
>;

export const provideLocalServerClient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  registry?: AppDefinitionRegistry,
): Effect.Effect<A, E, Exclude<R, ServerClient>> =>
  Effect.provideService(
    effect,
    ServerClient,
    Server.localClient(registry === undefined ? {} : { registry }),
  ) as Effect.Effect<A, E, Exclude<R, ServerClient>>;

export const provideRequestRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
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
      provideResponse(responseContext)(provideLocalServerClient(effect, registry)),
    ),
  ) as Effect.Effect<
    A,
    E | RuntimeError,
    Scope.Scope | RequestRuntimeRemainingRequirements<R, RuntimeServices>
  >;
