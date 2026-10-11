import { collectionIndexes } from "./collection-index-materialization.js";
import { anyCollectionSyncHandlers } from "./sync-adapter.js";
import type {
  AnyCollection,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics,
} from "./collection-contract.js";

/**
 * Registry abstraction used by Collection factories to register named
 * definitions and inspect them.
 *
 * Registering a definition under an existing name replaces it, like Action
 * and Server definitions, so re-evaluated modules (HMR, SSR loaders, build
 * diagnostics) redefine cleanly. Start rejects two distinct collections that
 * share a name within one app (`StartCollectionDuplicateName`).
 */
export interface CollectionDefinitionRegistryAdapter {
  register(definition: AnyCollection): void;
  definitions(): ReadonlyMap<string, AnyCollection>;
  diagnostics(): CollectionDiagnostics;
  /** Forget every registration. Test isolation only. */
  clearUnsafe(): void;
}

/** Static diagnostics extracted from a Collection Definition. */
export const collectionDefinitionDiagnostics = (
  definition: AnyCollection,
): CollectionDefinitionDiagnostics => {
  const options = definition.options;
  const persistence = options.persistence;
  const sync = anyCollectionSyncHandlers(definition);

  return {
    name: options.name,
    readOnly: definition.readOnly === true,
    inputSchema: options.input !== undefined,
    outputSchema: options.output !== undefined,
    initialData: options.initialData !== undefined,
    indexes: Array.from(collectionIndexes(options), ([name, index]) => ({
      name,
      unique: index.unique === true,
    })).sort((left, right) => left.name.localeCompare(right.name)),
    load: sync.load !== undefined,
    handlers: {
      insert: sync.onInsert !== undefined,
      update: sync.onUpdate !== undefined,
      delete: sync.onDelete !== undefined,
    },
    policy: {
      retry: options.policy?.retry !== undefined,
    },
    ...(sync.diagnostics === undefined ? {} : { sync: sync.diagnostics }),
    persistence: {
      enabled: persistence !== undefined,
      ...(persistence?.key === undefined ? {} : { key: persistence.key }),
      hydrate: persistence !== undefined && persistence.hydrate !== false,
      restoreOnPreload: persistence !== undefined && persistence.restoreOnPreload !== false,
      loadAfterRestore: persistence?.loadAfterRestore === true,
      persistOnLoad: persistence !== undefined && persistence.persistOnLoad !== false,
      persistOnMutation: persistence !== undefined && persistence.persistOnMutation !== false,
      persistOnWrite: persistence !== undefined && persistence.persistOnWrite !== false,
    },
  };
};

/** Creates an isolated Collection Definition Registry Adapter. */
export const makeCollectionDefinitionRegistry = (): CollectionDefinitionRegistryAdapter => {
  const definitions = new Map<string, AnyCollection>();

  return {
    register: (definition) => {
      definitions.set(definition.name, definition);
    },
    definitions: () => new Map(definitions),
    diagnostics: () => ({
      collections: Array.from(definitions.values(), collectionDefinitionDiagnostics).sort(
        (left, right) => left.name.localeCompare(right.name),
      ),
    }),
    clearUnsafe: () => {
      definitions.clear();
    },
  };
};

/** Process-wide Collection Definition Registry used by `Collection.define`. */
export const defaultCollectionDefinitionRegistry = makeCollectionDefinitionRegistry();
