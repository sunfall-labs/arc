import { EffectInputCallbackError, invokeEffectInput, type EffectInput } from "@effect-ui/core";
import { Clock, Data, Effect } from "effect";
import {
  bumpCollectionState,
  type CollectionState
} from "./collection-state.js";
import { CollectionDefinitionSnapshotTypeId } from "./collection-ids.js";
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
  CollectionStorageLike,
  CollectionStoreEvent
} from "./collection-contract.js";

export interface CollectionPersistenceStore {
  state(
    definition: AnyCollection
  ): CollectionState<any, any, any>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionState<A, K, E>;
  publish(event: CollectionStoreEvent): Effect.Effect<void>;
}

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

const usesDefinitionSnapshot = (
  definition: AnyCollection
): boolean =>
  (definition as { readonly [CollectionDefinitionSnapshotTypeId]?: unknown })[CollectionDefinitionSnapshotTypeId] === CollectionDefinitionSnapshotTypeId;

type DefinitionSnapshotWithStore = {
  readonly snapshotWithStore?: (
    store: CollectionPersistenceStore,
    updatedAt: number
  ) => CollectionSnapshot<any, any>;
  readonly snapshotWithStoreEffect?: (
    store: CollectionPersistenceStore,
    updatedAt: number
  ) => Effect.Effect<CollectionSnapshot<any, any>, CollectionSnapshotCodecError | EffectInputCallbackError>;
  readonly hydratePreflightEffect?: (
    snapshot: CollectionSnapshot<any, any>,
    options: CollectionHydrateOptions
  ) => Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
};

const snapshotWithExplicitStore = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number
): CollectionSnapshot<any, any> =>
  (definition as DefinitionSnapshotWithStore).snapshotWithStore?.(store, updatedAt) ?? definition.snapshot();

const snapshotWithExplicitStoreEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<any, any>, CollectionSnapshotCodecError | EffectInputCallbackError> => {
  const snapshotEffect = (definition as DefinitionSnapshotWithStore).snapshotWithStoreEffect;
  return snapshotEffect === undefined
    ? definition.snapshotEffect()
    : snapshotEffect(store, updatedAt);
};

const hydrateDefinitionPreflightEffect = (
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  (definition as DefinitionSnapshotWithStore).hydratePreflightEffect?.(snapshot, options) ?? Effect.void;

interface CollectionHydrationPlanEntry {
  readonly collection: AnyCollection;
  readonly snapshot: CollectionSnapshot<any, any>;
}

interface CollectionHydrationPlan {
  readonly store: CollectionPersistenceStore;
  readonly entries: ReadonlyArray<CollectionHydrationPlanEntry>;
}

const snapshotCallbackError = (
  definition: AnyCollection,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.snapshot(${definition.name})`,
    cause,
    guidance: "Collection snapshot callbacks and initialData key projection must be synchronous, pure, and total."
  });

const snapshotCollectionForEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<any, any>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  usesDefinitionSnapshot(definition)
    ? snapshotWithExplicitStoreEffect(definition, store, updatedAt)
    : Effect.try({
        try: () => snapshotCollection(definition, store, updatedAt),
        catch: (cause) => snapshotCallbackError(definition, cause)
      });

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
  if (usesDefinitionSnapshot(definition)) {
    return snapshotWithExplicitStore(definition, store, updatedAt);
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
    if (usesDefinitionSnapshot(definition)) {
      const validatedSnapshot = yield* validateCollectionSnapshotDefinitionEffect(definition, snapshot);
      yield* hydrateDefinitionPreflightEffect(definition, validatedSnapshot, options);
      yield* definition.hydrateEffect(validatedSnapshot, options);
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
}

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
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const updatedAt = yield* Clock.currentTimeMillis;
    yield* persistCollectionSnapshotEffect(
      definition,
      snapshotCollectionForEffect(definition, dbStore, updatedAt),
      storage,
      options,
      dbStore
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

const restoreCollectionSnapshotEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
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
    yield* hydrateCollectionEffect(definition, snapshot, options, storeEffect, dbStore);
    yield* dbStore.publish({
      _tag: "CollectionRestored",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
    return true;
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
): Effect.Effect<boolean, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  Effect.gen(function* () {
    const config = collectionPersistenceConfig(definition);
    if (!config || config.restoreOnPreload === false || state.persistenceRestored) {
      return false;
    }

    const restored = yield* restoreCollectionSnapshotEffect(
      definition,
      config.storage,
      collectionPersistenceRestoreOptions(config),
      storeEffect,
      store
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
    const definitions = new Map(Array.from(collections, (collection) => [collection.name, collection] as const));
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
      if (usesDefinitionSnapshot(collection)) {
        yield* hydrateDefinitionPreflightEffect(collection, validatedSnapshot, options);
      }
      entries.push({ collection, snapshot: validatedSnapshot });
    }

    const store = yield* storeEffect;
    for (const { collection, snapshot } of entries) {
      if (!usesDefinitionSnapshot(collection)) {
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
