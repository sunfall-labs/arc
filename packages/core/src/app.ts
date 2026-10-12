import type { ActionDefinition } from "./action.js";
import type { CoreDefinitionRegistry, CoreDefinitionRegistryInput } from "./definition-registry.js";
import type { ServerFunction } from "./server.js";

type AnyActionDefinition =
  | ActionDefinition<any, any, never, any>
  | ActionDefinition<any, any, any, any>;
type AnyServerFunction = ServerFunction<any, any, any, any>;

type IsAny<T> = 0 extends 1 & T ? true : false;

type DefinitionIterableValue<Definitions> =
  Definitions extends ReadonlyMap<any, infer Definition>
    ? Definition
    : Definitions extends Iterable<infer Definition>
      ? Definition
      : never;

type RegistryInputActions<Input> = Input extends { readonly actions?: infer Actions }
  ? DefinitionIterableValue<NonNullable<Actions>>
  : never;

type RegistryInputServerFunctions<Input> = Input extends {
  readonly serverFunctions?: infer ServerFunctions;
}
  ? DefinitionIterableValue<NonNullable<ServerFunctions>>
  : never;

export type ActionDefinitionRequirements<Definition> =
  Definition extends ActionDefinition<any, any, any, infer Requirements>
    ? IsAny<Requirements> extends true
      ? never
      : Requirements
    : never;

export type ServerFunctionRequirements<Definition> =
  Definition extends ServerFunction<any, any, any, infer Requirements>
    ? IsAny<Requirements> extends true
      ? never
      : Requirements
    : never;

export type AppDefinitionRegistry<
  Actions extends AnyActionDefinition = AnyActionDefinition,
  ServerFunctions extends AnyServerFunction = AnyServerFunction,
> = CoreDefinitionRegistry<Actions, ServerFunctions>;

export type AppDefinitionRegistryInput<
  Actions extends AnyActionDefinition = AnyActionDefinition,
  ServerFunctions extends AnyServerFunction = AnyServerFunction,
> = CoreDefinitionRegistryInput<Actions, ServerFunctions>;

export type AppDefinitionRegistryFromInput<Input> = AppDefinitionRegistry<
  RegistryInputActions<Input> extends AnyActionDefinition ? RegistryInputActions<Input> : never,
  RegistryInputServerFunctions<Input> extends AnyServerFunction
    ? RegistryInputServerFunctions<Input>
    : never
>;

export type AppDefinitionRegistryActionDefinitions<Registry> =
  Registry extends CoreDefinitionRegistry<infer Actions, any> ? Actions : never;

export type AppDefinitionRegistryServerFunctions<Registry> =
  Registry extends CoreDefinitionRegistry<any, infer ServerFunctions> ? ServerFunctions : never;

export type AppDefinitionRegistryActionRequirements<Registry> = ActionDefinitionRequirements<
  AppDefinitionRegistryActionDefinitions<Registry>
>;

export type AppDefinitionRegistryServerFunctionRequirements<Registry> = ServerFunctionRequirements<
  AppDefinitionRegistryServerFunctions<Registry>
>;

export type AppDefinitionRegistryRequirements<Registry> =
  | AppDefinitionRegistryActionRequirements<Registry>
  | AppDefinitionRegistryServerFunctionRequirements<Registry>;
