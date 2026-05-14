import { Signal, stableStringify, type WritableSignal } from "@effect-ui/core";
import { Data } from "effect";
import type {
  CollectionDefinition,
  AnyCollection,
  CollectionIndexDefinition,
  CollectionIndexInput,
  CollectionIndexRecord,
  CollectionIndexResult,
  CollectionIndexValue,
  CollectionKey,
  CollectionLoadState,
  CollectionRuntimeError,
  CollectionOrigin,
  CollectionRow,
  CollectionTransaction,
  CollectionUpdate
} from "./collection-contract.js";

/**
 * Error raised when reading an index that was not declared on the collection.
 */
export class UnknownCollectionIndex extends Data.TaggedError("UnknownCollectionIndex")<{
  readonly collection: string;
  readonly index: string;
}> {}

export interface StoredRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  value: A;
  synced: boolean;
  origin: CollectionOrigin;
}

export interface PendingMutationEntry<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
  readonly rollbackRows: ReadonlyMap<K, StoredRow<A, K> | undefined>;
  readonly createdAt: number;
  attempts: number;
}

interface CollectionIndexCacheEntry<A extends object, K extends CollectionKey> {
  readonly version: number;
  readonly buckets: ReadonlyMap<string, ReadonlyArray<StoredRow<A, K>>>;
}

export interface CollectionState<A extends object, K extends CollectionKey, E> {
  readonly rows: Map<K, StoredRow<A, K>>;
  readonly pendingMutations: Map<string, PendingMutationEntry<A, K>>;
  readonly indexCache: Map<string, CollectionIndexCacheEntry<A, K>>;
  readonly version: WritableSignal<number>;
  readonly loadState: WritableSignal<CollectionLoadState<CollectionRuntimeError<E>>>;
  nextTransactionId: number;
  initialized: boolean;
  persistenceRestored: boolean;
}

export const makeCollectionState = <A extends object, K extends CollectionKey, E>(): CollectionState<A, K, E> => ({
  rows: new Map(),
  pendingMutations: new Map(),
  indexCache: new Map(),
  version: Signal.make(0),
  loadState: Signal.make<CollectionLoadState<CollectionRuntimeError<E>>>({ _tag: "Initial", waiting: false }),
  nextTransactionId: 0,
  initialized: false,
  persistenceRestored: false
});

export const bumpCollectionState = (state: CollectionState<any, any, any>): void => {
  state.indexCache.clear();
  state.version.update((value) => value + 1);
};

export const initializeCollectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>
): void => {
  if (state.initialized) {
    return;
  }

  state.initialized = true;
  const initialData = definition.options.initialData ?? [];
  if (initialData.length === 0) {
    return;
  }

  for (const value of initialData) {
    const key = definition.getKey(value);
    state.rows.set(key, {
      key,
      value,
      synced: true,
      origin: "remote"
    });
  }
  state.loadState.set({ _tag: "Ready", waiting: false, updatedAt: Date.now() });
  bumpCollectionState(state);
};

export const augmentCollectionRow = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  row: StoredRow<A, K>
): CollectionRow<A, K> =>
  Object.assign({}, row.value, {
    $key: row.key,
    $collection: definition.name,
    $synced: row.synced,
    $origin: row.origin
  }) as CollectionRow<A, K>;

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

export const replaceCollectionRows = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  state: CollectionState<A, K, any>,
  values: ReadonlyArray<A>
): void => {
  const pending = Array.from(state.rows.values()).filter((row) => !row.synced);
  state.rows.clear();

  for (const value of values) {
    const key = definition.getKey(value);
    state.rows.set(key, {
      key,
      value,
      synced: true,
      origin: "remote"
    });
  }

  for (const row of pending) {
    state.rows.set(row.key, row);
  }

  bumpCollectionState(state);
};

export const markStoredRowsSynced = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  keys: ReadonlyArray<K>
): void => {
  for (const key of keys) {
    const row = state.rows.get(key);
    if (row) {
      row.synced = true;
    }
  }
  bumpCollectionState(state);
};

const diffChanges = <A extends object>(previous: A, value: A): Partial<A> => {
  const changes: Partial<A> = {};
  for (const key of Object.keys(value) as Array<keyof A>) {
    if (!Object.is(previous[key], value[key])) {
      changes[key] = value[key];
    }
  }
  return changes;
};

export const applyCollectionUpdate = <A extends object>(previous: A, update: CollectionUpdate<A>): {
  readonly value: A;
  readonly changes: Partial<A>;
} => {
  if (typeof update === "function") {
    const draft = { ...previous } as A;
    const result = update(draft);
    const value = result === undefined ? draft : result;
    return {
      value,
      changes: diffChanges(previous, value)
    };
  }

  return {
    value: { ...previous, ...update },
    changes: update
  };
};
