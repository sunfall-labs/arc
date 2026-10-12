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
import { withResourceStore, type AppDefinitionRegistry } from "@sunfall/arc-core/internal";
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
  | Server.Client;

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
