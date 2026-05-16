import { EffectInputCallbackError, invokeEffectInput, type EffectInput } from "@effect-ui/core";
import { Clock, Data, Effect } from "effect";
import {
  bumpCollectionState,
  type CollectionState
} from "./collection-state.js";
import {
  hasStoreExplicitCollectionSnapshotMarker,
  hydrateStoreExplicitCollectionSnapshotEffect,
  hydrateStoreExplicitCollectionSnapshotPreflightEffect,
  snapshotStoreExplicitCollection,
  snapshotStoreExplicitCollectionEffect,
  type CollectionPersistenceStore
} from "./collection-definition-snapshot.js";
export type { CollectionPersistenceStore } from "./collection-definition-snapshot.js";
import {
  advanceCollectionTransactionIdentity
} from "./collection-mutation-queue.js";
import {
  collectionSnapshotFromState,
  CollectionSnapshotCodecError,
  decodeCollectionSnapshotEffect,
  encodeCollectionSnapshotEffect,
  hydrateCollectionSnapshotStateEffect,
  validateCollectionHydrationPayload,
  validateCollectionSnapshotStateHydrationEffect,
  validateCollectionSnapshotDefinitionEffect,
  validateCollectionHydrationPayloadEffect
} from "./collection-snapshot-codec.js";
import { withCollectionDurableCommitPermit } from "./collection-write-commit.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionMemoryStorage,
  CollectionOptions,
  CollectionPersistOptions,
  CollectionPersistedOptions,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionPolicy,
  CollectionSnapshot,
  CollectionStorageLike
} from "./collection-contract.js";

/** Error raised by the sync Web Storage Adapter when a host method throws. */
export class CollectionStorageError extends Data.TaggedError(
  "CollectionStorageError"
)<{
  readonly operation: "getItem" | "setItem" | "removeItem";
  readonly key: string;
  readonly cause: unknown;
}> {}

const storageInputCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection persistence storage callback", callback);

interface CollectionHydrationPlanEntry {
  readonly collection: AnyCollection;
  readonly snapshot: CollectionSnapshot<any, any>;
}

interface CollectionHydrationPlan {
  readonly store: CollectionPersistenceStore;
  readonly entries: ReadonlyArray<CollectionHydrationPlanEntry>;
}

const duplicateCollectionDefinitionError = (
  name: string
): CollectionSnapshotCodecError =>
  new CollectionSnapshotCodecError({
    operation: "hydrate",
    path: "$.collections",
    reason: `Multiple collection definitions were provided for '${name}'. Collection names must identify one hydration definition.`
  });

const collectionDefinitionMapEffect = (
  collections: Iterable<AnyCollection>
): Effect.Effect<ReadonlyMap<string, AnyCollection>, CollectionSnapshotCodecError> =>
  Effect.gen(function* () {
    const definitions = new Map<string, AnyCollection>();
    for (const collection of collections) {
      const existing = definitions.get(collection.name);
      if (existing === collection) {
        continue;
      }
      if (existing !== undefined) {
        return yield* Effect.fail(duplicateCollectionDefinitionError(collection.name));
      }
      definitions.set(collection.name, collection);
    }
    return definitions;
  });

const snapshotCallbackError = (
  definition: AnyCollection,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.snapshot(${definition.name})`,
    cause,
    guidance: "Collection snapshot callbacks and initialData key projection must be synchronous, pure, and total."
  });

const snapshotCollectionForEffectUnsafe = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<any, any>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hasStoreExplicitCollectionSnapshotMarker(definition)
    ? snapshotStoreExplicitCollectionEffect(definition, store, updatedAt)
    : Effect.try({
        try: () => snapshotCollection(definition, store, updatedAt),
        catch: (cause) => snapshotCallbackError(definition, cause)
      });

const snapshotCollectionForEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<any, any>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hasStoreExplicitCollectionSnapshotMarker(definition)
    ? snapshotCollectionForEffectUnsafe(definition, store, updatedAt)
    : withCollectionDurableCommitPermit(
        store.state(definition),
        snapshotCollectionForEffectUnsafe(definition, store, updatedAt)
      );

export function snapshotCollection<A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  updatedAt?: number
): CollectionSnapshot<A, K>;
export function snapshotCollection(
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt?: number
): CollectionSnapshot<any, any>;
export function snapshotCollection(
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt = Date.now()
): CollectionSnapshot<any, any> {
  if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
    return snapshotStoreExplicitCollection(definition, store, updatedAt);
  }
  const state = store.state(definition);
  return collectionSnapshotFromState(definition, state, updatedAt);
}

export const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const store = yield* storeEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    return yield* snapshotCollectionForEffect(definition, store, updatedAt);
  });

const hydrateCollectionEffectUnsafe = (
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      const dbStore = store ?? (yield* storeEffect);
      const validatedSnapshot = yield* validateCollectionSnapshotDefinitionEffect(definition, snapshot);
      yield* hydrateStoreExplicitCollectionSnapshotEffect(definition, dbStore, validatedSnapshot, options);
      return;
    }

    const dbStore = store ?? (yield* storeEffect);
    const state = dbStore.state(definition);
    const validatedSnapshot = yield* validateCollectionSnapshotDefinitionEffect(definition, snapshot);
    yield* validateCollectionSnapshotStateHydrationEffect(state, validatedSnapshot, options);
    const hydrated = yield* hydrateCollectionSnapshotStateEffect(
      state,
      validatedSnapshot,
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

export function hydrateCollectionEffect<A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions | undefined,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
export function hydrateCollectionEffect(
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions | undefined,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
export function hydrateCollectionEffect(
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> {
  return Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      yield* hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore);
      return;
    }

    yield* withCollectionDurableCommitPermit(
      dbStore.state(definition),
      hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore)
    );
  });
}

export const collectionPersistenceKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {}
): string => options.key ?? `effect-ui:collection:${definition.name}`;

const persistCollectionEffectUnsafe = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const updatedAt = yield* Clock.currentTimeMillis;
    yield* persistCollectionSnapshotEffect(
      definition,
      snapshotCollectionForEffectUnsafe(definition, dbStore, updatedAt),
      storage,
      options,
      dbStore
    );
  });

export const persistCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      yield* persistCollectionEffectUnsafe(definition, storage, options, storeEffect, dbStore);
      return;
    }

    yield* withCollectionDurableCommitPermit(
      dbStore.state(definition),
      persistCollectionEffectUnsafe(definition, storage, options, storeEffect, dbStore)
    );
  });

export const persistCollectionSnapshotEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshotEffect: Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  store?: CollectionPersistenceStore
): Effect.Effect<CollectionSnapshot<A, K>, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const key = collectionPersistenceKey(definition, options);
    const snapshot = yield* snapshotEffect;
    const encoded = yield* encodeCollectionSnapshotEffect(snapshot);
    yield* storageInputCallbackEffect(() => storage.setItem(key, encoded));
    if (store) {
      yield* store.publish({
        _tag: "CollectionPersisted",
        collection: definition.name,
        key,
        count: snapshot.rows.length
      });
    }
    return snapshot;
  });

const restoreCollectionSnapshotEffectUnsafe = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<boolean, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const key = collectionPersistenceKey(definition, options);
    const encoded = yield* storageInputCallbackEffect(() => storage.getItem(key));
    if (encoded === null) {
      return false;
    }

    const snapshot = yield* decodeCollectionSnapshotEffect<A, K>(encoded);
    yield* hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore);
    yield* dbStore.publish({
      _tag: "CollectionRestored",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
    return true;
  });

const restoreCollectionSnapshotEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<boolean, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      return yield* restoreCollectionSnapshotEffectUnsafe(definition, storage, options, storeEffect, dbStore);
    }

    return yield* withCollectionDurableCommitPermit(
      dbStore.state(definition),
      restoreCollectionSnapshotEffectUnsafe(definition, storage, options, storeEffect, dbStore)
    );
  });

export const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.asVoid(restoreCollectionSnapshotEffect(definition, storage, options, storeEffect, store));

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

/**
 * Merge collection and persistence error/requirement channels.
 *
 * Use before `Collection.define` when the persistence backend has a different
 * Effect error or requirement type from the collection load/mutation handlers.
 */
export const persistedCollectionOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
  PE = never,
  PR = never
>(
  options: CollectionPersistedOptions<A, K, E, R, PE, PR>
): CollectionOptions<A, K, E | PE, R | PR> => {
  const { policy, persistence, ...rest } = options;
  return {
    ...rest,
    ...(policy === undefined ? {} : { policy: policy as CollectionPolicy<E | PE> }),
    persistence
  };
};

export const persistCollectionForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> => {
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

  return persistCollectionEffectUnsafe(
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
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  shouldRestore: () => boolean = () => true
): Effect.Effect<boolean, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  Effect.gen(function* () {
    const config = collectionPersistenceConfig(definition);
    if (!config || config.restoreOnPreload === false || state.persistenceRestored || !shouldRestore()) {
      return false;
    }

    const restoreOptions = collectionPersistenceRestoreOptions(config);
    const dbStore = store;
    const key = collectionPersistenceKey(definition, restoreOptions);
    const encoded = yield* storageInputCallbackEffect(() => config.storage.getItem(key));
    if (encoded === null || !shouldRestore()) {
      return false;
    }

    const snapshot = yield* decodeCollectionSnapshotEffect<A, K>(encoded);
    const restored = yield* withCollectionDurableCommitPermit(
      state,
      Effect.gen(function* () {
        if (!shouldRestore()) {
          return false;
        }
        yield* hydrateCollectionEffectUnsafe(
          definition,
          snapshot,
          restoreOptions,
          storeEffect,
          dbStore
        );
        yield* dbStore.publish({
          _tag: "CollectionRestored",
          collection: definition.name,
          key,
          count: snapshot.rows.length
        });
        return true;
      })
    );
    if (restored) {
      state.persistenceRestored = true;
    }
    return restored;
  });

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: CollectionPersistenceStore
): CollectionHydrationPayload => {
  const payload = {
    collections: Array.from(collections, (collection) => snapshotCollection(collection, store))
  };
  return validateCollectionHydrationPayload(payload, "snapshot");
};

export const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const store = yield* storeEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    const snapshots: Array<CollectionSnapshot<any, any>> = [];
    let index = 0;
    for (const collection of collections) {
      const snapshot = yield* snapshotCollectionForEffect(collection, store, updatedAt);
      snapshots.push(
        yield* validateCollectionSnapshotDefinitionEffect(
          collection,
          snapshot,
          "snapshot",
          `$.collections[${index}]`
        )
      );
      index++;
    }
    const payload = {
      collections: snapshots
    };
    return yield* validateCollectionHydrationPayloadEffect(payload, "snapshot");
  });

export const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const plan = yield* planCollectionsHydrationEffect(collections, payload, options, storeEffect);
    for (const { collection, snapshot } of plan.entries) {
      yield* hydrateCollectionEffect(collection, snapshot, options, storeEffect, plan.store);
    }
  });

export const validateCollectionsHydrationEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.asVoid(planCollectionsHydrationEffect(collections, payload, options, storeEffect));

const planCollectionsHydrationEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions,
  storeEffect: Effect.Effect<CollectionPersistenceStore>
): Effect.Effect<CollectionHydrationPlan, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const definitions = yield* collectionDefinitionMapEffect(collections);
    const hydrationPayload = yield* validateCollectionHydrationPayloadEffect(payload);
    const entries: Array<CollectionHydrationPlanEntry> = [];
    for (const [index, snapshot] of hydrationPayload.collections.entries()) {
      const collection = definitions.get(snapshot.name);
      if (!collection) {
        return yield* Effect.fail(new CollectionSnapshotCodecError({
          operation: "hydrate",
          path: `$.collections[${index}].name`,
          reason: `No collection definition was provided for '${snapshot.name}'.`
        }));
      }
      const validatedSnapshot = yield* validateCollectionSnapshotDefinitionEffect(collection, snapshot);
      if (hasStoreExplicitCollectionSnapshotMarker(collection)) {
        yield* hydrateStoreExplicitCollectionSnapshotPreflightEffect(collection, validatedSnapshot, options);
      }
      entries.push({ collection, snapshot: validatedSnapshot });
    }

    const store = yield* storeEffect;
    for (const { collection, snapshot } of entries) {
      if (!hasStoreExplicitCollectionSnapshotMarker(collection)) {
        yield* validateCollectionSnapshotStateHydrationEffect(store.state(collection), snapshot, options);
      }
    }
    return { store, entries };
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

export const collectionStorageFromSync = (storage: CollectionStorageLike): CollectionPersistenceStorage<CollectionStorageError, never> => {
  return {
    getItem: (key) =>
      Effect.try({
        try: () => storage.getItem(key),
        catch: (cause) => new CollectionStorageError({ operation: "getItem", key, cause })
      }),
    setItem: (key, value) =>
      Effect.try({
        try: () => storage.setItem(key, value),
        catch: (cause) => new CollectionStorageError({ operation: "setItem", key, cause })
      }),
    ...(storage.removeItem
      ? {
          removeItem: (key: string) =>
            Effect.try({
              try: () => storage.removeItem!(key),
              catch: (cause) => new CollectionStorageError({ operation: "removeItem", key, cause })
            })
        }
      : {})
  };
};
