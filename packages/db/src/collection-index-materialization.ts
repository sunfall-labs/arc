import { EffectInputCallbackError, stableStringify } from "@sunfall/arc-core";
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
  CollectionRow,
} from "./collection-contract.js";
import { augmentCollectionRow, type CollectionState, type StoredRow } from "./collection-state.js";
import {
  cloneCollectionValue,
  collectionExecutableValuePath,
} from "./collection-value-detachment.js";

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

const collectionIndexGuidance =
  "Collection secondary index selectors must return scalar plain values: string, number, boolean, valid Date, null, undefined, or arrays of those values.";

const collectionIndexError = (operation: string, cause: unknown): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause,
    guidance: collectionIndexGuidance,
  });

const isCollectionIndexValue = (value: unknown): value is CollectionIndexValue =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  value instanceof Date;

const normalizeCollectionIndexValue = (
  value: unknown,
  operation: string,
  path: string,
): CollectionIndexValue => {
  const executable = collectionExecutableValuePath(value, path);
  if (executable !== undefined) {
    throw collectionIndexError(
      operation,
      new TypeError(
        `Collection secondary index value contains ${executable.reason} at ${executable.path}.`,
      ),
    );
  }
  if (!isCollectionIndexValue(value)) {
    throw collectionIndexError(
      operation,
      new TypeError(`Collection secondary index value at ${path} must be a scalar index value.`),
    );
  }
  if (value instanceof Date && !Number.isFinite(value.getTime())) {
    throw collectionIndexError(
      operation,
      new TypeError(`Collection secondary index Date value at ${path} must be valid.`),
    );
  }
  return value;
};

export const collectionIndexKey = (value: CollectionIndexValue): string => {
  const normalized = normalizeCollectionIndexValue(value, "Collection.index.value", "$.indexValue");
  return normalized instanceof Date
    ? `Date:${normalized.toISOString()}`
    : stableStringify(normalized);
};

const normalizeCollectionIndex = <A extends object>(
  index: CollectionIndexInput<A>,
): CollectionIndexDefinition<A> => (typeof index === "function" ? { key: index } : index);

const isCollectionIndexValueArray = (
  value: CollectionIndexResult,
): value is ReadonlyArray<CollectionIndexValue> => Array.isArray(value);

export const collectionIndexes = <A extends object>(options: {
  readonly indexes?: CollectionIndexRecord<A>;
}): ReadonlyMap<string, CollectionIndexDefinition<A>> =>
  new Map(
    Object.entries(options.indexes ?? {}).map(([name, index]) => [
      name,
      normalizeCollectionIndex(index as CollectionIndexInput<A>),
    ]),
  );

export const collectionIndex = <A extends object>(
  definition: AnyCollection,
  name: string,
): CollectionIndexDefinition<A> => {
  const index = collectionIndexes(definition.options).get(name) as
    | CollectionIndexDefinition<A>
    | undefined;
  if (!index) {
    throw new UnknownCollectionIndex({ collection: definition.name, index: name });
  }
  return index;
};

export const collectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A,
): ReadonlyArray<CollectionIndexValue> => {
  try {
    const result = index.key(value);
    const candidates = isCollectionIndexValueArray(result) ? result : [result];
    return candidates.map((candidate, index) =>
      normalizeCollectionIndexValue(candidate, "Collection.index.selector", `$.index[${index}]`),
    );
  } catch (cause) {
    if (cause instanceof EffectInputCallbackError) {
      throw cause;
    }
    throw collectionIndexError("Collection.index.selector", cause);
  }
};

export const uniqueCollectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A,
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
  value: CollectionIndexValue,
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const key = collectionIndexKey(value);
  return rows.filter((row) =>
    collectionIndexValues(definitionIndex, row).some(
      (candidate) => collectionIndexKey(candidate) === key,
    ),
  );
};

const buildCollectionIndexCache = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  version: number,
  index: CollectionIndexDefinition<A>,
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
    buckets,
  };
};

export const rowsByCollectionIndex = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  index: string,
  value: CollectionIndexValue,
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const version = state.version.get();
  let cache = state.indexCache.get(index);
  if (!cache || cache.version !== version) {
    cache = buildCollectionIndexCache(state, version, definitionIndex);
    state.indexCache.set(index, cache);
  }

  return (cache.buckets.get(collectionIndexKey(value)) ?? []).map((row) =>
    augmentCollectionRow(definition, row),
  );
};

const collectionIndexRowValue = <A extends object>(row: CollectionRow<A, any>): A => {
  const {
    $key: _key,
    $collection: _collection,
    $synced: _synced,
    $origin: _origin,
    ...value
  } = row as CollectionRow<Record<string, unknown>, any>;
  return cloneCollectionValue(value) as A;
};

export const collectionIndexJoinKeys = <A extends object>(
  definition: AnyCollection,
  index: string,
  row: CollectionRow<A, any>,
): ReadonlyArray<CollectionIndexValue> =>
  uniqueCollectionIndexValues(collectionIndex(definition, index), collectionIndexRowValue(row));
