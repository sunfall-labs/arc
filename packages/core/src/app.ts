import type { RouteDefinition } from "./route.js";
import { makeRuntime, type EffectUiRuntime, type RuntimeSource } from "./runtime.js";

export interface AppDefinition<
  Routes extends readonly RouteDefinition<string, any, any>[],
  Client,
  ServerServices = never,
  ServerError = never
> {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  readonly runtime: EffectUiRuntime<ServerServices, ServerError>;
  readonly fullStack: boolean;
}

export const defineApp = <
  const Routes extends readonly RouteDefinition<string, any, any>[],
  Client,
  ServerServices = never,
  ServerError = never
>(config: {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
}): AppDefinition<Routes, Client, ServerServices, ServerError> => {
  const runtime = makeRuntime(config.server);
  const base = {
    routes: config.routes,
    client: config.client,
    runtime,
    fullStack: config.server !== undefined
  };

  return config.server === undefined
    ? base
    : {
        ...base,
        server: config.server
      };
};
