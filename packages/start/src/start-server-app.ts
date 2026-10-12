import {
  makeRuntime,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryFromInput,
  type AppDefinitionRegistryInput,
  type Route,
  type RuntimeSource,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import {
  makeCoreDefinitionRegistry,
  snapshotCoreDefinitionRegistry,
} from "@sunfall/arc-core/internal";

/**
 * The server's resolved view of a Start app: its routes, the server runtime
 * built from the server Layer, and the registry of Actions and server
 * functions it serves. Built by `createRequestHandler(app, { server, ... })`;
 * internal to Start.
 */
export interface StartServerApp<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices = never,
  ServerError = never,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry,
> {
  readonly routes: Routes;
  readonly runtime: SunfallArcRuntime<ServerServices, ServerError>;
  readonly registry: Registry;
  readonly fullStack: boolean;
}

/**
 * Builds the server's view of an app from its routes, server Layer, and
 * registry. `createRequestHandler` always passes the registry (the app's
 * Actions plus the handler's server functions); omitting it snapshots the
 * process-wide registries, which only Start's own tests rely on.
 */
export const makeStartServerApp = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices = never,
  ServerError = never,
  const RegistryInput extends AppDefinitionRegistryInput = AppDefinitionRegistryInput<never, never>,
>(config: {
  readonly routes: Routes;
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  readonly registry?: RegistryInput;
}): StartServerApp<
  Routes,
  ServerServices,
  ServerError,
  AppDefinitionRegistryFromInput<RegistryInput>
> => ({
  routes: config.routes,
  runtime: makeRuntime(config.server),
  registry: (config.registry === undefined
    ? snapshotCoreDefinitionRegistry()
    : makeCoreDefinitionRegistry(config.registry)) as AppDefinitionRegistryFromInput<RegistryInput>,
  fullStack: config.server !== undefined,
});
