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

type AnyActionDefinition =
  | ActionDefinition<any, any, never, any>
  | ActionDefinition<any, any, any, any>;
type AnyServerFunction = ServerFunction<any, any, any, any>;

type IsAny<T> = 0 extends (1 & T) ? true : false;

type DefinitionIterableValue<Definitions> =
  Definitions extends ReadonlyMap<any, infer Definition> ? Definition
    : Definitions extends Iterable<infer Definition> ? Definition
      : never;

type RegistryInputActions<Input> = Input extends { readonly actions?: infer Actions }
  ? DefinitionIterableValue<NonNullable<Actions>>
  : never;

type RegistryInputServerFunctions<Input> = Input extends { readonly serverFunctions?: infer ServerFunctions }
  ? DefinitionIterableValue<NonNullable<ServerFunctions>>
  : never;

export type ActionDefinitionRequirements<Definition> =
  Definition extends ActionDefinition<any, any, any, infer Requirements>
    ? IsAny<Requirements> extends true ? never : Requirements
    : never;

export type ServerFunctionRequirements<Definition> =
  Definition extends ServerFunction<any, any, any, infer Requirements>
    ? IsAny<Requirements> extends true ? never : Requirements
    : never;

export type AppDefinitionRegistry<
  Actions extends AnyActionDefinition = AnyActionDefinition,
  ServerFunctions extends AnyServerFunction = AnyServerFunction
> = CoreDefinitionRegistry<Actions, ServerFunctions>;

export type AppDefinitionRegistryInput<
  Actions extends AnyActionDefinition = AnyActionDefinition,
  ServerFunctions extends AnyServerFunction = AnyServerFunction
> = CoreDefinitionRegistryInput<Actions, ServerFunctions>;

export type AppDefinitionRegistryFromInput<Input> = AppDefinitionRegistry<
  RegistryInputActions<Input> extends AnyActionDefinition ? RegistryInputActions<Input> : never,
  RegistryInputServerFunctions<Input> extends AnyServerFunction ? RegistryInputServerFunctions<Input> : never
>;

export type AppDefinitionRegistryActionDefinitions<Registry> =
  Registry extends CoreDefinitionRegistry<infer Actions, any> ? Actions : never;

export type AppDefinitionRegistryServerFunctions<Registry> =
  Registry extends CoreDefinitionRegistry<any, infer ServerFunctions> ? ServerFunctions : never;

export type AppDefinitionRegistryActionRequirements<Registry> =
  ActionDefinitionRequirements<AppDefinitionRegistryActionDefinitions<Registry>>;

export type AppDefinitionRegistryServerFunctionRequirements<Registry> =
  ServerFunctionRequirements<AppDefinitionRegistryServerFunctions<Registry>>;

export type AppDefinitionRegistryRequirements<Registry> =
  | AppDefinitionRegistryActionRequirements<Registry>
  | AppDefinitionRegistryServerFunctionRequirements<Registry>;

/**
 * Complete app description shared by adapters and integrations.
 *
 * Carries route definitions, the client root, the runtime used for full-stack
 * Effect services, and a snapshot of named actions and server functions for
 * integrations that build manifests or diagnostics.
 */
export interface AppDefinition<
  Routes extends readonly RouteDefinition<string, unknown, unknown, any>[],
  Client,
  ServerServices = never,
  ServerError = never,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry
> {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  readonly runtime: EffectUiRuntime<ServerServices, ServerError>;
  readonly registry: Registry;
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
  const Routes extends readonly RouteDefinition<string, unknown, unknown, any>[],
  Client,
  ServerServices = never,
  ServerError = never,
  const RegistryInput extends AppDefinitionRegistryInput = AppDefinitionRegistryInput<never, never>
>(config: {
  readonly routes: Routes;
  readonly client: Client;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  /**
   * Explicit action/server-function registry.
   *
   * Defaults to a snapshot of the process-wide registries populated by
   * `Action.define(...)`, `Server.fn(...)`, `Server.stub(...)`, and
   * `Server.client(...)`.
   */
  readonly registry?: RegistryInput;
}): AppDefinition<
  Routes,
  Client,
  ServerServices,
  ServerError,
  AppDefinitionRegistryFromInput<RegistryInput>
> => {
  const runtime = makeRuntime(config.server);
  const registry = config.registry === undefined
    ? snapshotCoreDefinitionRegistry() as unknown as AppDefinitionRegistryFromInput<RegistryInput>
    : makeCoreDefinitionRegistry(config.registry) as AppDefinitionRegistryFromInput<RegistryInput>;
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
