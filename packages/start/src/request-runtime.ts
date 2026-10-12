import {
  makeResourceStore,
  provideRequest,
  provideResponse,
  Server,
  ServerClient,
  type SunfallArcRuntime,
  type RequestContext,
  type ResourceStore as ResourceStoreState,
  type ResponseContext,
  type Route,
  type AppDefinitionRegistry,
} from "@sunfall/arc-core";
import { withResourceStore } from "@sunfall/arc-core/internal";
import type { StartServerApp } from "./start-server-app.js";
import { Effect, type Scope } from "effect";
export {
  completeRequestRuntimeWithResponse,
  type RequestRuntimeFinalizeState,
  type RequestRuntimeStreamFinalizeState,
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
      provideResponse(responseContext)(provideLocalServerClient(effect, registry)),
    ),
  ) as Effect.Effect<
    A,
    E | RuntimeError,
    Scope.Scope | RequestRuntimeRemainingRequirements<R, RuntimeServices>
  >;
