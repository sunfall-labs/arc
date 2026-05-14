import { toEffect } from "@effect-ui/core";
import { Clock, Effect } from "effect";
import {
  bumpCollectionState,
  type CollectionState
} from "./collection-state.js";
import {
  advanceCollectionTransactionIdentity
} from "./collection-mutation-queue.js";
import {
  collectionSnapshotFromState,
  type CollectionSnapshotCodecError,
  decodeCollectionSnapshotEffect,
  encodeCollectionSnapshotEffect,
  hydrateCollectionSnapshotState,
  validateCollectionHydrationPayload
} from "./collection-snapshot-codec.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionMemoryStorage,
  CollectionPersistOptions,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionSnapshot,
  CollectionStorageLike,
  CollectionStoreEvent
} from "./collection-contract.js";

export interface CollectionPersistenceStore {
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionState<A, K, E>;
  publish(event: CollectionStoreEvent): Effect.Effect<void>;
}

export const snapshotCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  updatedAt = Date.now()
): CollectionSnapshot<A, K> => {
  const state = store.state(definition);
  return collectionSnapshotFromState(definition, state, updatedAt);
};

export const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<CollectionSnapshot<A, K>> =>
  Effect.gen(function* () {
    const store = yield* storeEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    return snapshotCollection(definition, store, updatedAt);
  });

export const hydrateCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const state = dbStore.state(definition);
    const hydrated = hydrateCollectionSnapshotState(
      state,
      snapshot,
      options,
      (id) => advanceCollectionTransactionIdentity(state, id)
    );
    bumpCollectionState(state);
    yield* dbStore.publish({
      _tag: "CollectionHydrated",
      collection: definition.name,
      count: hydrated.rows.length,
      updatedAt: hydrated.updatedAt
    });
  });

export const collectionPersistenceKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {}
): string => options.key ?? `effect-ui:collection:${definition.name}`;

export const persistCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const key = collectionPersistenceKey(definition, options);
    const updatedAt = yield* Clock.currentTimeMillis;
    const snapshot = snapshotCollection(definition, dbStore, updatedAt);
    const encoded = yield* encodeCollectionSnapshotEffect(snapshot);
    yield* toEffect(storage.setItem(key, encoded));
    yield* dbStore.publish({
      _tag: "CollectionPersisted",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
  });

export const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const key = collectionPersistenceKey(definition, options);
    const encoded = yield* toEffect(storage.getItem(key));
    if (encoded === null) {
      return;
    }

    const snapshot = yield* decodeCollectionSnapshotEffect<A, K>(encoded);
    yield* hydrateCollectionEffect(definition, snapshot, options, storeEffect, dbStore);
    yield* dbStore.publish({
      _tag: "CollectionRestored",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
  });

export const collectionPersistenceConfig = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): CollectionPersistenceConfig<E, R> | undefined =>
  definition.options.persistence;

export const collectionPersistencePersistOptions = <E, R>(
  config: CollectionPersistenceConfig<E, R>
): CollectionPersistOptions => ({
  ...(config.key === undefined ? {} : { key: config.key })
});

export const collectionPersistenceRestoreOptions = <E, R>(
  config: CollectionPersistenceConfig<E, R>
): CollectionPersistOptions & CollectionHydrateOptions => ({
  ...collectionPersistencePersistOptions(config),
  ...(config.hydrate ?? {})
});

export const persistCollectionForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E | CollectionSnapshotCodecError, R> => {
  const config = collectionPersistenceConfig(definition);
  if (!config) {
    return Effect.succeed(undefined);
  }

  const shouldPersist =
    reason === "load"
      ? config.persistOnLoad !== false
      : reason === "mutation"
        ? config.persistOnMutation !== false
        : config.persistOnWrite !== false;

  if (!shouldPersist) {
    return Effect.succeed(undefined);
  }

  return persistCollectionEffect(
    definition,
    config.storage,
    collectionPersistencePersistOptions(config),
    storeEffect,
    store
  );
};

export const restoreCollectionBeforePreloadEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: CollectionPersistenceStore,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<boolean, E | CollectionSnapshotCodecError, R> =>
  Effect.gen(function* () {
    const config = collectionPersistenceConfig(definition);
    if (!config || config.restoreOnPreload === false || state.persistenceRestored) {
      return false;
    }

    const before = state.loadState.get()._tag;
    yield* restoreCollectionEffect(
      definition,
      config.storage,
      collectionPersistenceRestoreOptions(config),
      storeEffect,
      store
    );
    state.persistenceRestored = true;
    return before !== "Ready" && state.loadState.get()._tag === "Ready";
  });

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: CollectionPersistenceStore
): CollectionHydrationPayload => ({
  collections: Array.from(collections, (collection) => snapshotCollection(collection, store))
});

export const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<CollectionHydrationPayload> =>
  Effect.gen(function* () {
    const store = yield* storeEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    return {
      collections: Array.from(collections, (collection) => snapshotCollection(collection, store, updatedAt))
    };
  });

export const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dbStore = yield* storeEffect;
    const definitions = new Map(Array.from(collections, (collection) => [collection.name, collection] as const));
    const hydrationPayload = validateCollectionHydrationPayload(payload);
    for (const snapshot of hydrationPayload.collections) {
      const collection = definitions.get(snapshot.name);
      if (collection) {
        yield* hydrateCollectionEffect(collection, snapshot, options, storeEffect, dbStore);
      }
    }
  });

export const makeCollectionMemoryStorage = (initial?: Iterable<readonly [string, string]>): CollectionMemoryStorage => {
  const values = new Map(initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    }
  };
};

export const collectionStorageFromSync = (storage: CollectionStorageLike): CollectionPersistenceStorage<never, never> => {
  const removeItem = storage.removeItem;
  return {
    getItem: (key) => Effect.sync(() => storage.getItem(key)),
    setItem: (key, value) => Effect.sync(() => storage.setItem(key, value)),
    ...(removeItem
      ? { removeItem: (key: string) => Effect.sync(() => removeItem(key)) }
      : {})
  };
};
