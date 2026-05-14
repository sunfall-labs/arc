export interface NamedCoreDefinition {
  readonly name: string;
}

export interface CoreDefinitionRegistry<
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition
> {
  readonly actions: ReadonlyMap<string, ActionDefinition>;
  readonly serverFunctions: ReadonlyMap<string, ServerFunctionDefinition>;
}

export interface CoreDefinitionRegistryInput<
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition
> {
  readonly actions?: Iterable<ActionDefinition> | ReadonlyMap<string, ActionDefinition>;
  readonly serverFunctions?:
    | Iterable<ServerFunctionDefinition>
    | ReadonlyMap<string, ServerFunctionDefinition>;
}

interface MutableCoreDefinitionRegistry {
  readonly actions: Map<string, NamedCoreDefinition>;
  readonly serverFunctions: Map<string, NamedCoreDefinition>;
}

const globalRegistry: MutableCoreDefinitionRegistry = {
  actions: new Map(),
  serverFunctions: new Map()
};

const isDefinitionMap = <Definition extends NamedCoreDefinition>(
  definitions: Iterable<Definition> | ReadonlyMap<string, Definition>
): definitions is ReadonlyMap<string, Definition> =>
  typeof (definitions as { entries?: unknown }).entries === "function" &&
  typeof (definitions as { get?: unknown }).get === "function";

const definitionMap = <Definition extends NamedCoreDefinition>(
  definitions: Iterable<Definition> | ReadonlyMap<string, Definition> | undefined
): ReadonlyMap<string, Definition> => {
  const map = new Map<string, Definition>();
  if (definitions === undefined) {
    return map;
  }

  if (isDefinitionMap(definitions)) {
    for (const [name, definition] of definitions) {
      map.set(name, definition);
    }
    return map;
  }

  for (const definition of definitions) {
    map.set(definition.name, definition);
  }
  return map;
};

export const makeCoreDefinitionRegistry = <
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition
>(
  input: CoreDefinitionRegistryInput<ActionDefinition, ServerFunctionDefinition> = {}
): CoreDefinitionRegistry<ActionDefinition, ServerFunctionDefinition> => ({
  actions: definitionMap(input.actions),
  serverFunctions: definitionMap(input.serverFunctions)
});

export const snapshotCoreDefinitionRegistry = (): CoreDefinitionRegistry =>
  makeCoreDefinitionRegistry(globalRegistry);

export const registerActionDefinition = <Definition extends NamedCoreDefinition>(
  definition: Definition
): void => {
  globalRegistry.actions.set(definition.name, definition);
};

export const actionDefinitionRegistry = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition
>(): ReadonlyMap<string, Definition> =>
  globalRegistry.actions as unknown as ReadonlyMap<string, Definition>;

export const getActionDefinition = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition
>(
  name: string
): Definition | undefined =>
  globalRegistry.actions.get(name) as Definition | undefined;

export const clearActionDefinitionRegistryUnsafe = (): void => {
  globalRegistry.actions.clear();
};

export const registerServerFunctionDefinition = <Definition extends NamedCoreDefinition>(
  definition: Definition
): void => {
  globalRegistry.serverFunctions.set(definition.name, definition);
};

export const serverFunctionDefinitionRegistry = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition
>(): ReadonlyMap<string, Definition> =>
  globalRegistry.serverFunctions as unknown as ReadonlyMap<string, Definition>;

export const getServerFunctionDefinition = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition
>(
  name: string
): Definition | undefined =>
  globalRegistry.serverFunctions.get(name) as Definition | undefined;

export const clearServerFunctionDefinitionRegistryUnsafe = (): void => {
  globalRegistry.serverFunctions.clear();
};
