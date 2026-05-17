/** Named definition shape used by registries that key entries by `name`. */
export interface NamedCoreDefinition {
  readonly name: string;
}

/**
 * Registry of named core definitions captured by `defineApp(...)` and consumed
 * by manifest, diagnostics, and adapter integrations.
 *
 * Actions and server functions are keyed by `definition.name`.
 */
export interface CoreDefinitionRegistry<
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
> {
  readonly actions: ReadonlyMap<string, ActionDefinition>;
  readonly serverFunctions: ReadonlyMap<string, ServerFunctionDefinition>;
}

/**
 * Definitions accepted by `defineApp(...)` or `makeCoreDefinitionRegistry(...)`.
 *
 * Iterables and maps are keyed by each definition's `name`; map keys are
 * treated only as caller-owned labels and are not trusted as registry identity.
 */
export interface CoreDefinitionRegistryInput<
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
> {
  readonly actions?: Iterable<ActionDefinition> | ReadonlyMap<string, ActionDefinition>;
  readonly serverFunctions?:
    | Iterable<ServerFunctionDefinition>
    | ReadonlyMap<string, ServerFunctionDefinition>;
}

/** Duplicate-name policy for process-wide Action and Server definition registries. */
export type CoreDefinitionRegistryDuplicatePolicy = "keep-first" | "replace";

/** Options for creating a mutable Core Definition Registry Adapter. */
export interface CoreDefinitionRegistryAdapterOptions {
  /** Duplicate-name handling. Defaults to `replace` to preserve Action/Server redefine semantics. */
  readonly duplicates?: CoreDefinitionRegistryDuplicatePolicy;
}

/** Kind of definition stored in the Core Definition Registry. */
export type CoreDefinitionRegistryKind = "action" | "serverFunction";

/** Result of registering one named Action or Server function definition. */
export interface CoreDefinitionRegistration<
  Definition extends NamedCoreDefinition = NamedCoreDefinition,
> {
  readonly kind: CoreDefinitionRegistryKind;
  readonly name: string;
  readonly definition: Definition;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly retained: Definition;
}

/** Diagnostic entry recorded when duplicate named definitions are encountered. */
export interface CoreDefinitionDuplicateDiagnostics {
  readonly kind: CoreDefinitionRegistryKind;
  readonly name: string;
  readonly policy: CoreDefinitionRegistryDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

/** Snapshot of registered Core definitions and duplicate-name diagnostics. */
export interface CoreDefinitionRegistryDiagnostics {
  readonly actions: readonly string[];
  readonly serverFunctions: readonly string[];
  readonly duplicates: readonly CoreDefinitionDuplicateDiagnostics[];
}

/**
 * Mutable registry Adapter for named core definitions.
 *
 * Build tools, tests, and `defineApp(...)` use this seam to capture Actions and
 * Server functions without reading module-global state directly.
 */
export interface CoreDefinitionRegistryAdapter<
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
> {
  registerAction(definition: ActionDefinition): CoreDefinitionRegistration<ActionDefinition>;
  registerServerFunction(
    definition: ServerFunctionDefinition,
  ): CoreDefinitionRegistration<ServerFunctionDefinition>;
  definitions(): CoreDefinitionRegistry<ActionDefinition, ServerFunctionDefinition>;
  diagnostics(): CoreDefinitionRegistryDiagnostics;
  clearActionsUnsafe(): void;
  clearServerFunctionsUnsafe(): void;
}

interface CoreDefinitionRegistryEntry<Definition extends NamedCoreDefinition> {
  readonly definition: Definition;
  readonly sequence: number;
}

const isDefinitionMap = <Definition extends NamedCoreDefinition>(
  definitions: Iterable<Definition> | ReadonlyMap<string, Definition>,
): definitions is ReadonlyMap<string, Definition> =>
  typeof (definitions as { entries?: unknown }).entries === "function" &&
  typeof (definitions as { get?: unknown }).get === "function";

const definitionMap = <Definition extends NamedCoreDefinition>(
  definitions: Iterable<Definition> | ReadonlyMap<string, Definition> | undefined,
): ReadonlyMap<string, Definition> => {
  const map = new Map<string, Definition>();
  if (definitions === undefined) {
    return map;
  }

  if (isDefinitionMap(definitions)) {
    for (const [, definition] of definitions) {
      if (!map.has(definition.name)) {
        map.set(definition.name, definition);
      }
    }
    return map;
  }

  for (const definition of definitions) {
    if (!map.has(definition.name)) {
      map.set(definition.name, definition);
    }
  }
  return map;
};

/** Builds an immutable registry from explicit action and server definitions. */
export const makeCoreDefinitionRegistry = <
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
>(
  input: CoreDefinitionRegistryInput<ActionDefinition, ServerFunctionDefinition> = {},
): CoreDefinitionRegistry<ActionDefinition, ServerFunctionDefinition> => ({
  actions: definitionMap(input.actions),
  serverFunctions: definitionMap(input.serverFunctions),
});

const sortedNames = (definitions: ReadonlyMap<string, NamedCoreDefinition>): readonly string[] =>
  Array.from(definitions.keys()).sort((left, right) => left.localeCompare(right));

const makeRegistration = <Definition extends NamedCoreDefinition>(
  kind: CoreDefinitionRegistryKind,
  definitions: Map<string, Definition>,
  entries: Map<string, CoreDefinitionRegistryEntry<Definition>>,
  duplicates: Array<CoreDefinitionDuplicateDiagnostics>,
  duplicatePolicy: CoreDefinitionRegistryDuplicatePolicy,
  nextSequence: () => number,
  definition: Definition,
): CoreDefinitionRegistration<Definition> => {
  const existing = entries.get(definition.name);

  if (existing?.definition === definition) {
    return {
      kind,
      name: definition.name,
      definition,
      sequence: existing.sequence,
      duplicate: false,
      retained: definition,
    };
  }

  const sequence = nextSequence();
  if (existing === undefined) {
    definitions.set(definition.name, definition);
    entries.set(definition.name, { definition, sequence });
    return {
      kind,
      name: definition.name,
      definition,
      sequence,
      duplicate: false,
      retained: definition,
    };
  }

  if (duplicatePolicy === "replace") {
    definitions.set(definition.name, definition);
    entries.set(definition.name, { definition, sequence });
    duplicates.push({
      kind,
      name: definition.name,
      policy: duplicatePolicy,
      retained: sequence,
      discarded: existing.sequence,
    });
    return {
      kind,
      name: definition.name,
      definition,
      sequence,
      duplicate: true,
      retained: definition,
    };
  }

  duplicates.push({
    kind,
    name: definition.name,
    policy: duplicatePolicy,
    retained: existing.sequence,
    discarded: sequence,
  });
  return {
    kind,
    name: definition.name,
    definition,
    sequence,
    duplicate: true,
    retained: existing.definition,
  };
};

/** Creates a mutable Core Definition Registry Adapter with duplicate tracking. */
export const makeCoreDefinitionRegistryAdapter = <
  ActionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
  ServerFunctionDefinition extends NamedCoreDefinition = NamedCoreDefinition,
>(
  options: CoreDefinitionRegistryAdapterOptions = {},
): CoreDefinitionRegistryAdapter<ActionDefinition, ServerFunctionDefinition> => {
  const duplicatePolicy = options.duplicates ?? "replace";
  const actions = new Map<string, ActionDefinition>();
  const actionEntries = new Map<string, CoreDefinitionRegistryEntry<ActionDefinition>>();
  const serverFunctions = new Map<string, ServerFunctionDefinition>();
  const serverFunctionEntries = new Map<
    string,
    CoreDefinitionRegistryEntry<ServerFunctionDefinition>
  >();
  const duplicates: Array<CoreDefinitionDuplicateDiagnostics> = [];
  let nextSequenceValue = 1;
  const nextSequence = (): number => nextSequenceValue++;

  return {
    registerAction: (definition) =>
      makeRegistration(
        "action",
        actions,
        actionEntries,
        duplicates,
        duplicatePolicy,
        nextSequence,
        definition,
      ),
    registerServerFunction: (definition) =>
      makeRegistration(
        "serverFunction",
        serverFunctions,
        serverFunctionEntries,
        duplicates,
        duplicatePolicy,
        nextSequence,
        definition,
      ),
    definitions: () => ({
      actions,
      serverFunctions,
    }),
    diagnostics: () => ({
      actions: sortedNames(actions),
      serverFunctions: sortedNames(serverFunctions),
      duplicates: duplicates
        .slice()
        .sort(
          (left, right) =>
            left.kind.localeCompare(right.kind) ||
            left.name.localeCompare(right.name) ||
            left.discarded - right.discarded,
        ),
    }),
    clearActionsUnsafe: () => {
      actions.clear();
      actionEntries.clear();
      for (let index = duplicates.length - 1; index >= 0; index--) {
        if (duplicates[index]?.kind === "action") {
          duplicates.splice(index, 1);
        }
      }
    },
    clearServerFunctionsUnsafe: () => {
      serverFunctions.clear();
      serverFunctionEntries.clear();
      for (let index = duplicates.length - 1; index >= 0; index--) {
        if (duplicates[index]?.kind === "serverFunction") {
          duplicates.splice(index, 1);
        }
      }
    },
  };
};

/** Process-wide Core Definition Registry used by Action and Server factories. */
export const defaultCoreDefinitionRegistry = makeCoreDefinitionRegistryAdapter();

/** Captures the current process-wide action and server function registries. */
export const snapshotCoreDefinitionRegistry = (): CoreDefinitionRegistry =>
  makeCoreDefinitionRegistry(defaultCoreDefinitionRegistry.definitions());

/** Registers an Action definition in the process-wide registry. */
export const registerActionDefinition = <Definition extends NamedCoreDefinition>(
  definition: Definition,
): void => {
  defaultCoreDefinitionRegistry.registerAction(definition);
};

/** Process-wide Action definitions keyed by action name. */
export const actionDefinitionRegistry = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition,
>(): ReadonlyMap<string, Definition> =>
  defaultCoreDefinitionRegistry.definitions().actions as ReadonlyMap<string, Definition>;

/** Looks up a process-wide Action definition by action name. */
export const getActionDefinition = <Definition extends NamedCoreDefinition = NamedCoreDefinition>(
  name: string,
): Definition | undefined =>
  defaultCoreDefinitionRegistry.definitions().actions.get(name) as Definition | undefined;

/**
 * Test-only reset for the process-wide Action registry.
 *
 * Unsafe because it affects later `defineApp(...)` snapshots in the same
 * process.
 */
export const clearActionDefinitionRegistryUnsafe = (): void => {
  defaultCoreDefinitionRegistry.clearActionsUnsafe();
};

/** Registers a Server function definition in the process-wide registry. */
export const registerServerFunctionDefinition = <Definition extends NamedCoreDefinition>(
  definition: Definition,
): void => {
  defaultCoreDefinitionRegistry.registerServerFunction(definition);
};

/** Process-wide Server function definitions keyed by function name. */
export const serverFunctionDefinitionRegistry = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition,
>(): ReadonlyMap<string, Definition> =>
  defaultCoreDefinitionRegistry.definitions().serverFunctions as ReadonlyMap<string, Definition>;

/** Looks up a process-wide Server function definition by function name. */
export const getServerFunctionDefinition = <
  Definition extends NamedCoreDefinition = NamedCoreDefinition,
>(
  name: string,
): Definition | undefined =>
  defaultCoreDefinitionRegistry.definitions().serverFunctions.get(name) as Definition | undefined;

/**
 * Test-only reset for the process-wide Server function registry.
 *
 * Unsafe because it affects later `defineApp(...)` snapshots in the same
 * process.
 */
export const clearServerFunctionDefinitionRegistryUnsafe = (): void => {
  defaultCoreDefinitionRegistry.clearServerFunctionsUnsafe();
};

/** Returns process-wide Action/Server definition diagnostics. */
export const coreDefinitionRegistryDiagnostics = (): CoreDefinitionRegistryDiagnostics =>
  defaultCoreDefinitionRegistry.diagnostics();
