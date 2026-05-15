import { stableStringify } from "@effect-ui/core";
import { Data } from "effect";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionIndexDefinition,
  CollectionIndexInput,
  CollectionIndexRecord,
  CollectionIndexResult,
  CollectionIndexValue,
  CollectionKey,
  CollectionRow
} from "./collection-contract.js";
import {
  augmentCollectionRow,
  type CollectionState,
  type StoredRow
} from "./collection-state.js";

/**
 * Error raised when reading an index that was not declared on the collection.
 */
export class UnknownCollectionIndex extends Data.TaggedError("UnknownCollectionIndex")<{
  readonly collection: string;
  readonly index: string;
}> {}

export interface CollectionIndexCacheEntry<A extends object, K extends CollectionKey> {
  readonly version: number;
  readonly buckets: ReadonlyMap<string, ReadonlyArray<StoredRow<A, K>>>;
}

export const collectionIndexKey = (value: CollectionIndexValue): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

const normalizeCollectionIndex = <A extends object>(
  index: CollectionIndexInput<A>
): CollectionIndexDefinition<A> =>
  typeof index === "function" ? { key: index } : index;

const isCollectionIndexValueArray = (
  value: CollectionIndexResult
): value is ReadonlyArray<CollectionIndexValue> =>
  Array.isArray(value);

export const collectionIndexes = <A extends object>(
  options: { readonly indexes?: CollectionIndexRecord<A> }
): ReadonlyMap<string, CollectionIndexDefinition<A>> =>
  new Map(
    Object.entries(options.indexes ?? {}).map(([name, index]) => [
      name,
      normalizeCollectionIndex(index as CollectionIndexInput<A>)
    ])
  );

export const collectionIndex = <A extends object>(
  definition: AnyCollection,
  name: string
): CollectionIndexDefinition<A> => {
  const index = collectionIndexes(definition.options).get(name) as CollectionIndexDefinition<A> | undefined;
  if (!index) {
    throw new UnknownCollectionIndex({ collection: definition.name, index: name });
  }
  return index;
};

export const collectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A
): ReadonlyArray<CollectionIndexValue> => {
  const result = index.key(value);
  return isCollectionIndexValueArray(result) ? result : [result];
};

export const uniqueCollectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A
): ReadonlyArray<CollectionIndexValue> => {
  const values: Array<CollectionIndexValue> = [];
  const seen = new Set<string>();
  for (const candidate of collectionIndexValues(index, value)) {
    const key = collectionIndexKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(candidate);
    }
  }
  return values;
};

export const rowsMatchingCollectionIndex = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  rows: ReadonlyArray<CollectionRow<A, K>>,
  index: string,
  value: CollectionIndexValue
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const key = collectionIndexKey(value);
  return rows.filter((row) =>
    collectionIndexValues(definitionIndex, row).some((candidate) =>
      collectionIndexKey(candidate) === key
    )
  );
};

const buildCollectionIndexCache = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  version: number,
  index: CollectionIndexDefinition<A>
): CollectionIndexCacheEntry<A, K> => {
  const buckets = new Map<string, Array<StoredRow<A, K>>>();
  for (const row of state.rows.values()) {
    for (const value of uniqueCollectionIndexValues(index, row.value)) {
      const key = collectionIndexKey(value);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(key, [row]);
      }
    }
  }

  return {
    version,
    buckets
  };
};

export const rowsByCollectionIndex = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  index: string,
  value: CollectionIndexValue
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const version = state.version.get();
  let cache = state.indexCache.get(index);
  if (!cache || cache.version !== version) {
    cache = buildCollectionIndexCache(state, version, definitionIndex);
    state.indexCache.set(index, cache);
  }

  return (cache.buckets.get(collectionIndexKey(value)) ?? [])
    .map((row) => augmentCollectionRow(definition, row));
};

export const collectionIndexJoinKeys = <A extends object>(
  definition: AnyCollection,
  index: string,
  row: CollectionRow<A, any>
): ReadonlyArray<CollectionIndexValue> =>
  uniqueCollectionIndexValues(collectionIndex(definition, index), row as CollectionRow<any, any>);
