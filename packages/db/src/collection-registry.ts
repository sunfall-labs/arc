import { collectionIndexes } from "./collection-index-materialization.js";
import type {
  AnyCollection,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics
} from "./collection-contract.js";

/**
 * Duplicate-name handling for a Collection registry.
 *
 * `keep-first` retains the original definition; `replace` stores the latest
 * definition. Duplicate attempts are recorded in diagnostics for both policies.
 */
export type CollectionDefinitionDuplicatePolicy = "keep-first" | "replace";

/** Options for an isolated Collection Definition Registry Adapter. */
export interface CollectionDefinitionRegistryOptions {
  /** Duplicate-name handling. Defaults to `keep-first`. */
  readonly duplicates?: CollectionDefinitionDuplicatePolicy;
}

/** Result of registering a Collection Definition. */
export interface CollectionDefinitionRegistration {
  readonly name: string;
  readonly definition: AnyCollection;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly retained: AnyCollection;
}

/** Diagnostic fact describing one duplicate Collection registration attempt. */
export interface CollectionDefinitionDuplicateDiagnostics {
  readonly name: string;
  readonly policy: CollectionDefinitionDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

/** Collection diagnostics plus duplicate registration facts. */
export interface CollectionDefinitionRegistryDiagnostics extends CollectionDiagnostics {
  readonly duplicates: readonly CollectionDefinitionDuplicateDiagnostics[];
}

/**
 * Registry abstraction used by Collection factories to register named
 * definitions, inspect retained definitions, and report duplicate
 * registrations.
 */
export interface CollectionDefinitionRegistryAdapter {
  register(name: string, definition: AnyCollection): CollectionDefinitionRegistration;
  definitions(): ReadonlyMap<string, AnyCollection>;
  diagnostics(): CollectionDefinitionRegistryDiagnostics;
}

interface CollectionDefinitionRegistryEntry {
  readonly definition: AnyCollection;
  readonly sequence: number;
}

interface CollectionDefinitionDuplicateEntry {
  readonly name: string;
  readonly policy: CollectionDefinitionDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

/** Static diagnostics extracted from a Collection Definition. */
export const collectionDefinitionDiagnostics = (
  definition: AnyCollection
): CollectionDefinitionDiagnostics => {
  const options = definition.options;
  const persistence = options.persistence;

  return {
    name: options.name,
    readOnly: definition.readOnly === true,
    inputSchema: options.input !== undefined,
    outputSchema: options.output !== undefined,
    initialData: options.initialData !== undefined,
    indexes: Array.from(collectionIndexes(options), ([name, index]) => ({
      name,
      unique: index.unique === true
    })).sort((left, right) => left.name.localeCompare(right.name)),
    load: options.load !== undefined,
    handlers: {
      insert: options.onInsert !== undefined,
      update: options.onUpdate !== undefined,
      delete: options.onDelete !== undefined
    },
    policy: {
      retry: options.policy?.retry !== undefined
    },
    ...(options.sync === undefined ? {} : { sync: options.sync }),
    persistence: {
      enabled: persistence !== undefined,
      ...(persistence?.key === undefined ? {} : { key: persistence.key }),
      hydrate: persistence !== undefined && persistence.hydrate !== false,
      restoreOnPreload: persistence !== undefined && persistence.restoreOnPreload !== false,
      loadAfterRestore: persistence?.loadAfterRestore === true,
      persistOnLoad: persistence !== undefined && persistence.persistOnLoad !== false,
      persistOnMutation: persistence !== undefined && persistence.persistOnMutation !== false,
      persistOnWrite: persistence !== undefined && persistence.persistOnWrite !== false
    }
  };
};

/** Creates an isolated Collection Definition Registry Adapter. */
export const makeCollectionDefinitionRegistry = (
  options: CollectionDefinitionRegistryOptions = {}
): CollectionDefinitionRegistryAdapter => {
  const duplicatePolicy = options.duplicates ?? "keep-first";
  const definitions = new Map<string, AnyCollection>();
  const entries = new Map<string, CollectionDefinitionRegistryEntry>();
  const duplicates: Array<CollectionDefinitionDuplicateEntry> = [];
  let nextSequence = 1;

  return {
    register: (_name, definition) => {
      const name = definition.name;
      const existing = entries.get(name);

      if (existing?.definition === definition) {
        return {
          name,
          definition,
          sequence: existing.sequence,
          duplicate: false,
          retained: definition
        };
      }

      const sequence = nextSequence++;

      if (existing === undefined) {
        definitions.set(name, definition);
        entries.set(name, { definition, sequence });
        return {
          name,
          definition,
          sequence,
          duplicate: false,
          retained: definition
        };
      }

      if (duplicatePolicy === "replace") {
        definitions.set(name, definition);
        entries.set(name, { definition, sequence });
        duplicates.push({
          name,
          policy: duplicatePolicy,
          retained: sequence,
          discarded: existing.sequence
        });
        return {
          name,
          definition,
          sequence,
          duplicate: true,
          retained: definition
        };
      }

      duplicates.push({
        name,
        policy: duplicatePolicy,
        retained: existing.sequence,
        discarded: sequence
      });
      return {
        name,
        definition,
        sequence,
        duplicate: true,
        retained: existing.definition
      };
    },
    definitions: () => new Map(definitions),
    diagnostics: () => ({
      collections: Array.from(definitions.values(), collectionDefinitionDiagnostics)
        .sort((left, right) => left.name.localeCompare(right.name)),
      duplicates: duplicates
        .slice()
        .sort((left, right) =>
          left.name.localeCompare(right.name) ||
          left.discarded - right.discarded
        )
    })
  };
};

export const defaultCollectionDefinitionRegistry = makeCollectionDefinitionRegistry();

export const registerCollectionDefinition = (
  name: string,
  definition: AnyCollection
): void => {
  defaultCollectionDefinitionRegistry.register(name, definition);
};

/** Return the process-wide registry of named collection definitions. */
export const collectionDefinitionRegistry = (): ReadonlyMap<string, AnyCollection> =>
  defaultCollectionDefinitionRegistry.definitions();

/** Describe registered collections, indexes, handlers, sync, and persistence. */
export const collectionDiagnostics = (): CollectionDiagnostics => ({
  collections: defaultCollectionDefinitionRegistry.diagnostics().collections
});

/** Describe the default registry, including duplicate registrations. */
export const collectionRegistryDiagnostics = (): CollectionDefinitionRegistryDiagnostics =>
  defaultCollectionDefinitionRegistry.diagnostics();
