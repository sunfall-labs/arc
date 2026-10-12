import { EffectInputCallbackError } from "@sunfall/arc-core";
import { Clock, Effect, Option } from "effect";
import { KeyValueStore } from "effect/persistence";
import { type CollectionState } from "./collection-state.js";
import {
  hasStoreExplicitCollectionSnapshotMarker,
  hydrateStoreExplicitCollectionSnapshot,
  hydrateStoreExplicitCollectionSnapshotPreflight,
  snapshotStoreExplicitCollectionSync,
  snapshotStoreExplicitCollection,
  withCollectionDurableSnapshotPermits,
  type CollectionPersistenceStore,
} from "./collection-definition-snapshot.js";
export type { CollectionPersistenceStore } from "./collection-definition-snapshot.js";
import {
  collectionSnapshotFromState,
  CollectionSnapshotCodecError,
  collectionRowValueSchema,
  collectionSnapshotCodecErrorFromSchema,
  collectionSnapshotSchema,
  hydrateCollectionSnapshotState,
  validateCollectionHydrationPayloadSync,
  validateCollectionSnapshotDefinition,
  validateCollectionHydrationPayload,
  type CollectionSnapshotCodecOperation,
} from "./collection-snapshot-codec.js";
import { withCollectionDurableCommitPermit } from "./collection-write-commit.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionKey,
  CollectionPersistOptions,
  CollectionPersistenceConfig,
  CollectionSnapshot,
} from "./collection-contract.js";

interface CollectionHydrationPlanEntry {
  readonly collection: AnyCollection;
  readonly snapshot: CollectionSnapshot<any, any>;
}

interface CollectionHydrationPlan {
  readonly store: CollectionPersistenceStore;
  readonly entries: ReadonlyArray<CollectionHydrationPlanEntry>;
}

const duplicateCollectionDefinitionError = (
  name: string,
  operation: CollectionSnapshotCodecOperation = "hydrate",
): CollectionSnapshotCodecError =>
  new CollectionSnapshotCodecError({
    operation,
    path: "$.collections",
    reason: `Multiple collection definitions were provided for '${name}'. Collection names must identify one hydration definition.`,
  });

const uniqueCollectionDefinitionsUnsafe = (
  collections: Iterable<AnyCollection>,
  operation: CollectionSnapshotCodecOperation,
): ReadonlyArray<AnyCollection> => {
  const definitions = new Map<string, AnyCollection>();
  const unique: AnyCollection[] = [];
  for (const collection of collections) {
    const existing = definitions.get(collection.name);
    if (existing === collection) {
      continue;
    }
    if (existing !== undefined) {
      throw duplicateCollectionDefinitionError(collection.name, operation);
    }
    definitions.set(collection.name, collection);
    unique.push(collection);
  }
  return unique;
};

const uniqueCollectionDefinitionsEffect = (
  collections: Iterable<AnyCollection>,
  operation: CollectionSnapshotCodecOperation,
): Effect.Effect<ReadonlyArray<AnyCollection>, CollectionSnapshotCodecError> =>
  Effect.try({
    try: () => uniqueCollectionDefinitionsUnsafe(collections, operation),
    catch: (cause) =>
      cause instanceof CollectionSnapshotCodecError
        ? cause
        : duplicateCollectionDefinitionError("unknown", operation),
  });

const collectionDefinitionMapEffect = (
  collections: Iterable<AnyCollection>,
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
  cause: unknown,
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.snapshot(${definition.name})`,
    cause,
    guidance:
      "Collection snapshot callbacks and initialData key projection must be synchronous, pure, and total.",
  });

const snapshotCollectionForEffectUnsafe = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number,
): Effect.Effect<
  CollectionSnapshot<any, any>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  hasStoreExplicitCollectionSnapshotMarker(definition)
    ? snapshotStoreExplicitCollection(definition, store, updatedAt)
    : Effect.try({
        try: () => snapshotCollectionSync(definition, store, updatedAt),
        catch: (cause) => snapshotCallbackError(definition, cause),
      });

const snapshotCollectionForEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number,
): Effect.Effect<
  CollectionSnapshot<any, any>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  withCollectionDurableSnapshotPermits(
    store,
    [definition],
    snapshotCollectionForEffectUnsafe(definition, store, updatedAt),
  );

export function snapshotCollectionSync<A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  updatedAt?: number,
): CollectionSnapshot<A, K>;
export function snapshotCollectionSync(
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt?: number,
): CollectionSnapshot<any, any>;
export function snapshotCollectionSync(
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt = Date.now(),
): CollectionSnapshot<any, any> {
  if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
    return snapshotStoreExplicitCollectionSync(definition, store, updatedAt);
  }
  const state = store.state(definition);
  return collectionSnapshotFromState(definition, state, updatedAt);
}

export const snapshotCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
): Effect.Effect<
  CollectionSnapshot<A, K>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
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
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      const dbStore = store ?? (yield* storeEffect);
      const validatedSnapshot = yield* validateCollectionSnapshotDefinition(definition, snapshot);
      yield* hydrateStoreExplicitCollectionSnapshot(
        definition,
        dbStore,
        validatedSnapshot,
        options,
      );
      return;
    }

    const dbStore = store ?? (yield* storeEffect);
    const state = dbStore.state(definition);
    const validatedSnapshot = yield* validateCollectionSnapshotDefinition(definition, snapshot);
    const hydrated = yield* hydrateCollectionSnapshotState(state, validatedSnapshot, options);
    yield* dbStore.publish({
      _tag: "CollectionHydrated",
      collection: definition.name,
      count: hydrated.rows.length,
      updatedAt: hydrated.updatedAt,
    });
  });

export function hydrateCollection<A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions | undefined,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
export function hydrateCollection(
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions | undefined,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
export function hydrateCollection(
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> {
  return Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    if (hasStoreExplicitCollectionSnapshotMarker(definition)) {
      yield* hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore);
      return;
    }

    yield* withCollectionDurableCommitPermit(
      dbStore.state(definition),
      hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore),
    );
  });
}

/** Persistence failures: the store's own, plus snapshots it cannot encode or decode. */
type CollectionPersistError =
  | KeyValueStore.KeyValueStoreError
  | CollectionSnapshotCodecError
  | EffectInputCallbackError;

interface CollectionPersistTarget {
  /** Namespace in the runtime's `KeyValueStore`, e.g. `arc/collections/v1/`. */
  readonly prefix: string;
  /** Key under the prefix; defaults to the collection name. */
  readonly key: string;
}

/**
 * Explicit options win, then the definition's `persistence` config, then the
 * defaults (`version: 1`, the collection name as key).
 */
const collectionPersistTarget = (
  definition: AnyCollection,
  options: CollectionPersistOptions,
): CollectionPersistTarget => {
  const config = definition.options.persistence;
  const version = options.version ?? config?.version ?? 1;
  return {
    prefix: `arc/collections/v${version}/`,
    key: options.key ?? config?.key ?? definition.name,
  };
};

/** The full `KeyValueStore` key a collection snapshot is persisted under. */
export const collectionPersistenceKey = (
  definition: AnyCollection,
  options: CollectionPersistOptions = {},
): string => {
  const target = collectionPersistTarget(definition, options);
  return `${target.prefix}${target.key}`;
};

/** The definition's snapshots in the runtime's `KeyValueStore`, rows through their JSON codec. */
const collectionSnapshotStore = (definition: AnyCollection, target: CollectionPersistTarget) =>
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    return KeyValueStore.toSchemaStore(
      KeyValueStore.prefix(store, target.prefix),
      collectionSnapshotSchema(collectionRowValueSchema(definition.options.output)),
    );
  });

const readPersistedSnapshotEffect = <A extends object, K extends CollectionKey>(
  definition: AnyCollection,
  target: CollectionPersistTarget,
): Effect.Effect<
  Option.Option<CollectionSnapshot<A, K>>,
  KeyValueStore.KeyValueStoreError | CollectionSnapshotCodecError,
  KeyValueStore.KeyValueStore
> =>
  Effect.flatMap(collectionSnapshotStore(definition, target), (store) =>
    store.get(target.key).pipe(
      Effect.map((snapshot) => snapshot as Option.Option<CollectionSnapshot<A, K>>),
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(collectionSnapshotCodecErrorFromSchema(error, "decode")),
      ),
    ),
  );

/**
 * `Collection.define` adds `KeyValueStore` to `R` and `KeyValueStoreError` to
 * `E` whenever `persistence` is configured, so a definition's own channels
 * already cover its configured persistence.
 */
const withinCollectionChannels = <A, X, E, R>(
  effect: Effect.Effect<A, X | KeyValueStore.KeyValueStoreError, KeyValueStore.KeyValueStore>,
): Effect.Effect<A, X | E, R> => effect as Effect.Effect<A, X | E, R>;

const persistCollectionEffectUnsafe = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionPersistError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const updatedAt = yield* Clock.currentTimeMillis;
    yield* persistCollectionSnapshot(
      definition,
      snapshotCollectionForEffectUnsafe(definition, dbStore, updatedAt),
      options,
      dbStore,
    );
  });

export const persistCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionPersistError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    yield* withCollectionDurableSnapshotPermits(
      dbStore,
      [definition],
      persistCollectionEffectUnsafe(definition, options, storeEffect, dbStore),
    );
  });

export const persistCollectionSnapshot = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshotEffect: Effect.Effect<
    CollectionSnapshot<A, K>,
    CollectionSnapshotCodecError | EffectInputCallbackError
  >,
  options: CollectionPersistOptions = {},
  store?: CollectionPersistenceStore,
): Effect.Effect<CollectionSnapshot<A, K>, CollectionPersistError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const target = collectionPersistTarget(definition, options);
    const snapshot = yield* snapshotEffect;
    const snapshots = yield* collectionSnapshotStore(definition, target);
    yield* snapshots
      .set(target.key, snapshot)
      .pipe(
        Effect.catchTag("SchemaError", (error) =>
          Effect.fail(collectionSnapshotCodecErrorFromSchema(error, "encode")),
        ),
      );
    if (store) {
      yield* store.publish({
        _tag: "CollectionPersisted",
        collection: definition.name,
        key: `${target.prefix}${target.key}`,
        count: snapshot.rows.length,
      });
    }
    return snapshot;
  });

const restoreCollectionSnapshotEffectUnsafe = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<boolean, CollectionPersistError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const target = collectionPersistTarget(definition, options);
    const persisted = yield* readPersistedSnapshotEffect<A, K>(definition, target);
    if (Option.isNone(persisted)) {
      return false;
    }

    const snapshot = persisted.value;
    yield* hydrateCollectionEffectUnsafe(definition, snapshot, options, storeEffect, dbStore);
    yield* dbStore.publish({
      _tag: "CollectionRestored",
      collection: definition.name,
      key: `${target.prefix}${target.key}`,
      count: snapshot.rows.length,
    });
    return true;
  });

export const restoreCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  store?: CollectionPersistenceStore,
): Effect.Effect<void, CollectionPersistError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* storeEffect);
    const restore = restoreCollectionSnapshotEffectUnsafe(
      definition,
      options,
      storeEffect,
      dbStore,
    );
    yield* hasStoreExplicitCollectionSnapshotMarker(definition)
      ? restore
      : withCollectionDurableCommitPermit(dbStore.state(definition), restore);
  });

export const collectionPersistenceConfig = (
  definition: AnyCollection,
): CollectionPersistenceConfig | undefined => definition.options.persistence;

const collectionPersistenceRestoreOptions = (
  config: CollectionPersistenceConfig,
): CollectionPersistOptions & CollectionHydrateOptions => ({
  ...config,
  ...(config.hydrate === false ? {} : (config.hydrate ?? {})),
});

export const persistCollectionForReason = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  reason: "load" | "write",
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> => {
  const config = collectionPersistenceConfig(definition);
  if (!config) {
    return Effect.succeed(undefined);
  }

  const shouldPersist =
    reason === "load" ? config.persistOnLoad !== false : config.persistOnWrite !== false;

  if (!shouldPersist) {
    return Effect.succeed(undefined);
  }

  return withinCollectionChannels(
    persistCollectionEffectUnsafe(definition, {}, storeEffect, store),
  );
};

/** Persists an already-staged load snapshot under the definition's configured key. */
export const persistCollectionLoadSnapshot = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: CollectionPersistenceStore,
  snapshot: CollectionSnapshot<A, K>,
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> => {
  const config = collectionPersistenceConfig(definition);
  if (config === undefined || config.persistOnLoad === false) {
    return Effect.void;
  }
  return withinCollectionChannels(
    Effect.asVoid(persistCollectionSnapshot(definition, Effect.succeed(snapshot), {}, store)),
  );
};

export const restoreCollectionBeforePreload = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: CollectionPersistenceStore,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
  shouldRestore: () => boolean = () => true,
): Effect.Effect<boolean, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  Effect.gen(function* () {
    const config = collectionPersistenceConfig(definition);
    if (
      !config ||
      config.hydrate === false ||
      config.restoreOnPreload === false ||
      state.persistenceRestored ||
      !shouldRestore()
    ) {
      return false;
    }

    const restoreOptions = collectionPersistenceRestoreOptions(config);
    const target = collectionPersistTarget(definition, restoreOptions);
    const persisted = yield* withinCollectionChannels<
      Option.Option<CollectionSnapshot<A, K>>,
      CollectionSnapshotCodecError,
      E,
      R
    >(readPersistedSnapshotEffect<A, K>(definition, target));
    if (Option.isNone(persisted) || !shouldRestore()) {
      return false;
    }

    const snapshot = persisted.value;
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
          store,
        );
        yield* store.publish({
          _tag: "CollectionRestored",
          collection: definition.name,
          key: `${target.prefix}${target.key}`,
          count: snapshot.rows.length,
        });
        return true;
      }),
    );
    if (restored) {
      state.persistenceRestored = true;
    }
    return restored;
  });

export const dehydrateCollectionsSync = (
  collections: Iterable<AnyCollection>,
  store: CollectionPersistenceStore,
): CollectionHydrationPayload => {
  const definitions = uniqueCollectionDefinitionsUnsafe(collections, "snapshot");
  const payload = {
    collections: definitions.map((collection) => snapshotCollectionSync(collection, store)),
  };
  return validateCollectionHydrationPayloadSync(payload, "snapshot");
};

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
): Effect.Effect<
  CollectionHydrationPayload,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  Effect.gen(function* () {
    const store = yield* storeEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    const definitions = yield* uniqueCollectionDefinitionsEffect(collections, "snapshot");
    return yield* withCollectionDurableSnapshotPermits(
      store,
      definitions,
      Effect.gen(function* () {
        const snapshots: Array<CollectionSnapshot<any, any>> = [];
        let index = 0;
        for (const collection of definitions) {
          const snapshot = yield* snapshotCollectionForEffectUnsafe(collection, store, updatedAt);
          snapshots.push(
            yield* validateCollectionSnapshotDefinition(
              collection,
              snapshot,
              "snapshot",
              `$.collections[${index}]`,
            ),
          );
          index++;
        }
        const payload = {
          collections: snapshots,
        };
        return yield* validateCollectionHydrationPayload(payload, "snapshot");
      }),
    );
  });

export const hydrateCollections = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const plan = yield* planCollectionsHydrationEffect(collections, payload, options, storeEffect);
    yield* withCollectionDurableSnapshotPermits(
      plan.store,
      plan.entries.map((entry) => entry.collection),
      Effect.forEach(
        plan.entries,
        ({ collection, snapshot }) =>
          hydrateCollectionEffectUnsafe(collection, snapshot, options, storeEffect, plan.store),
        { discard: true },
      ),
    );
  });

export const validateCollectionsHydration = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.asVoid(planCollectionsHydrationEffect(collections, payload, options, storeEffect));

const planCollectionsHydrationEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions,
  storeEffect: Effect.Effect<CollectionPersistenceStore>,
): Effect.Effect<
  CollectionHydrationPlan,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  Effect.gen(function* () {
    const definitions = yield* collectionDefinitionMapEffect(collections);
    const hydrationPayload = yield* validateCollectionHydrationPayload(payload);
    const entries: Array<CollectionHydrationPlanEntry> = [];
    for (const [index, snapshot] of hydrationPayload.collections.entries()) {
      const collection = definitions.get(snapshot.name);
      if (!collection) {
        return yield* Effect.fail(
          new CollectionSnapshotCodecError({
            operation: "hydrate",
            path: `$.collections[${index}].name`,
            reason: `No collection definition was provided for '${snapshot.name}'.`,
          }),
        );
      }
      const validatedSnapshot = yield* validateCollectionSnapshotDefinition(collection, snapshot);
      if (hasStoreExplicitCollectionSnapshotMarker(collection)) {
        yield* hydrateStoreExplicitCollectionSnapshotPreflight(
          collection,
          validatedSnapshot,
          options,
        );
      }
      entries.push({ collection, snapshot: validatedSnapshot });
    }

    const store = yield* storeEffect;
    return { store, entries };
  });
