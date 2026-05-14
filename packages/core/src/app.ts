import type { ActionDefinition } from "./action.js";
import {
  makeCoreDefinitionRegistry,
  snapshotCoreDefinitionRegistry,
  type CoreDefinitionRegistry,
  type CoreDefinitionRegistryInput
} from "./definition-registry.js";
import type { RouteDefinition } from "./route.js";
import { makeRuntime, type EffectUiRuntime, type RuntimeSource } from "./runtime.js";
import type { ServerFunction } from "./server.js";

type AnyActionDefinition = ActionDefinition<any, any, any, any>;
type AnyServerFunction = ServerFunction<any, any, any, any>;

export type AppDefinitionRegistry = CoreDefinitionRegistry<
  AnyActionDefinition,
  AnyServerFunction
>;

export type AppDefinitionRegistryInput = CoreDefinitionRegistryInput<
  AnyActionDefinition,
  AnyServerFunction
>;

/**
 * Complete app description shared by adapters and integrations.
 *
 * Carries route definitions, the client root, and the runtime used to provide
 * server-side Effect services when the app is running full stack.
 */
export interface AppDefinition<
  Routes extends readonly RouteDefinition<string, unknown, unknown>[],
  Client,
  ServerServices = never,
  ServerError = never
> {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  readonly runtime: EffectUiRuntime<ServerServices, ServerError>;
  readonly registry: AppDefinitionRegistry;
  readonly fullStack: boolean;
}

/**
 * Defines an Effect UI app from routes, a client entry, and an optional server runtime.
 *
 * Pass a Layer, ManagedRuntime, or EffectUiRuntime as `server` when server functions,
 * route preloads, or resources need Effect services.
 *
 * @example
 * ```ts
 * const app = defineApp({
 *   routes: [homeRoute],
 *   client: App,
 *   server: AppLive
 * });
 * ```
 */
export const defineApp = <
  const Routes extends readonly RouteDefinition<string, unknown, unknown>[],
  Client,
  ServerServices = never,
  ServerError = never
>(config: {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  readonly registry?: AppDefinitionRegistryInput;
}): AppDefinition<Routes, Client, ServerServices, ServerError> => {
  const runtime = makeRuntime(config.server);
  const registry = config.registry === undefined
    ? snapshotCoreDefinitionRegistry() as AppDefinitionRegistry
    : makeCoreDefinitionRegistry(config.registry);
  const base = {
    routes: config.routes,
    client: config.client,
    runtime,
    registry,
    fullStack: config.server !== undefined
  };

  return config.server === undefined
    ? base
    : {
        ...base,
        server: config.server
      };
};
