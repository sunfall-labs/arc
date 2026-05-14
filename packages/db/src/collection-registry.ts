import { collectionIndexes } from "./collection-state.js";
import type {
  AnyCollection,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics
} from "./collection-contract.js";

export type CollectionDefinitionDuplicatePolicy = "keep-first" | "replace";

export interface CollectionDefinitionRegistryOptions {
  readonly duplicates?: CollectionDefinitionDuplicatePolicy;
}

export interface CollectionDefinitionRegistration {
  readonly name: string;
  readonly definition: AnyCollection;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly retained: AnyCollection;
}

export interface CollectionDefinitionDuplicateDiagnostics {
  readonly name: string;
  readonly policy: CollectionDefinitionDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

export interface CollectionDefinitionRegistryDiagnostics extends CollectionDiagnostics {
  readonly duplicates: readonly CollectionDefinitionDuplicateDiagnostics[];
}

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

export const collectionDefinitionDiagnostics = (
  definition: AnyCollection
): CollectionDefinitionDiagnostics => {
  const options = definition.options;
  const persistence = options.persistence;

  return {
    name: options.name,
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
      hydrate: persistence?.hydrate !== undefined,
      restoreOnPreload: persistence?.restoreOnPreload === true,
      loadAfterRestore: persistence?.loadAfterRestore === true,
      persistOnLoad: persistence?.persistOnLoad === true,
      persistOnMutation: persistence?.persistOnMutation === true,
      persistOnWrite: persistence?.persistOnWrite === true
    }
  };
};

export const makeCollectionDefinitionRegistry = (
  options: CollectionDefinitionRegistryOptions = {}
): CollectionDefinitionRegistryAdapter => {
  const duplicatePolicy = options.duplicates ?? "keep-first";
  const definitions = new Map<string, AnyCollection>();
  const entries = new Map<string, CollectionDefinitionRegistryEntry>();
  const duplicates: Array<CollectionDefinitionDuplicateEntry> = [];
  let nextSequence = 1;

  return {
    register: (name, definition) => {
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
    definitions: () => definitions,
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
