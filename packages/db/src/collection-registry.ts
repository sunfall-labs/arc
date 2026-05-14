import { collectionIndexes } from "./collection-state.js";
import type {
  AnyCollection,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics
} from "./collection-contract.js";

const collectionDefinitions = new Map<string, AnyCollection>();

export const registerCollectionDefinition = (
  name: string,
  definition: AnyCollection
): void => {
  collectionDefinitions.set(name, definition);
};

/** Return the process-wide registry of named collection definitions. */
export const collectionDefinitionRegistry = (): ReadonlyMap<string, AnyCollection> =>
  collectionDefinitions;

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

/** Describe registered collections, indexes, handlers, sync, and persistence. */
export const collectionDiagnostics = (): CollectionDiagnostics => ({
  collections: Array.from(collectionDefinitions.values(), collectionDefinitionDiagnostics)
    .sort((left, right) => left.name.localeCompare(right.name))
});
