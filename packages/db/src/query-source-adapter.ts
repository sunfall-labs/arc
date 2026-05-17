import type { ReadableSignal } from "@effect-ui/core";
import type { Effect } from "effect";
import { collectionIndexJoinKeys, collectionIndexes } from "./collection-index-materialization.js";
import type {
  AnyCollection,
  CollectionIndexValue,
  CollectionLoadState,
  CollectionRow,
} from "./collection-contract.js";

export type QuerySourceRow = CollectionRow<any, any>;

/**
 * Internal Adapter from Collection Definitions to query-readable sources.
 *
 * Query Builder and Live Query Runtime should depend on this Interface instead
 * of knowing which Collection methods expose rows, indexes, load state,
 * versions, and preload/refetch behavior.
 */
export interface QueryCollectionSourceAdapter {
  readonly collection: AnyCollection;
  readonly name: string;
  rows(): ReadonlyArray<QuerySourceRow>;
  rowCount(): number;
  hasIndex(index: string): boolean;
  indexRows(index: string, value: CollectionIndexValue): ReadonlyArray<QuerySourceRow>;
  indexJoinKeys(index: string, row: QuerySourceRow): ReadonlyArray<CollectionIndexValue>;
  version(): ReadableSignal<number>;
  state(): ReadableSignal<CollectionLoadState<any>>;
  preloadEffect(force: boolean): Effect.Effect<void, any, any>;
}

export const makeQuerySourceAdapter = (
  collection: AnyCollection,
): QueryCollectionSourceAdapter => ({
  collection,
  name: collection.name,
  rows: () => collection.rows(),
  rowCount: () => collection.rows().length,
  hasIndex: (index) => collectionIndexes(collection.options).has(index),
  indexRows: (index, value) => collection.index(index, value),
  indexJoinKeys: (index, row) => collectionIndexJoinKeys(collection, index, row),
  version: () => collection.version(),
  state: () => collection.state(),
  preloadEffect: (force) => (force ? collection.refetchEffect() : collection.preloadEffect()),
});
