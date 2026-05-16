import {
  EffectInputCallbackError,
  runFork,
  type EffectInput
} from "@effect-ui/core";
import { Effect, Option, Scope } from "effect";
import { CollectionRowKeyChanged, CollectionRowNotFound, ReadonlyCollectionMutation } from "./collection-errors.js";
import { CollectionTypeId } from "./collection-ids.js";
import { CollectionPreloadCollector } from "./collection-preload.js";
import {
  applyCollectionBaseRow,
  augmentCollectionRow,
  deleteCollectionBaseRow,
  rebaseCollectionBaseRows,
  type CollectionState,
  type StoredRow
} from "./collection-state.js";
import { rowsByCollectionIndex } from "./collection-index-materialization.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { subscribeCollectionChangeFeedRuntimeEffect } from "./collection-change-feed-runtime.js";
import {
  ingestCollectionMutationRowsEffect,
  ingestCollectionOutputRowsEffect
} from "./collection-row-ingress.js";
import {
  pendingMutationSnapshots
} from "./collection-mutation-queue.js";
import {
  collectionProjectionEffect,
  collectionStateEffect,
  ensureCollectionRowKey
} from "./collection-projection-callback-policy.js";
import {
  deleteCollectionMutationEffect,
  flushCollectionPendingMutationsEffect,
  insertCollectionMutationEffect,
  updateCollectionMutationEffect
} from "./collection-mutation-workflow.js";
import {
  collectionPersistenceKey,
  dehydrateCollections as dehydrateCollectionsWithStore,
  dehydrateCollectionsEffect as dehydrateCollectionsWithStoreEffect,
  hydrateCollectionEffect as hydrateCollectionWithStoreEffect,
  hydrateCollectionsEffect as hydrateCollectionsWithStoreEffect,
  validateCollectionsHydrationEffect as validateCollectionsHydrationWithStoreEffect,
  persistCollectionEffect as persistCollectionWithStoreEffect,
  persistCollectionForReasonEffect,
  restoreCollectionEffect as restoreCollectionWithStoreEffect,
  snapshotCollection as snapshotCollectionWithStore,
  snapshotCollectionEffect as snapshotCollectionWithStoreEffect
} from "./collection-persistence.js";
import type {
  CollectionChangeFeedAdapter,
  CollectionChangeFeedSubscribeOptions
} from "./sync-adapter.js";
import {
  commitCollectionWriteEffect
} from "./collection-write-commit.js";
import { runCollectionSyncLoadPolicyEffect } from "./collection-sync-load-policy.js";
import {
  collectionStoreEffect,
  currentCollectionStore,
  runWithCollectionStore,
  subscribeCollectionEventsEffect,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";
import type {
  AnyCollection,
  CollectionChange,
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionIndexValue,
  CollectionKey,
  CollectionOptions,
  CollectionPendingMutation,
  CollectionPersistenceStorage,
  CollectionPersistOptions,
  CollectionRow,
  CollectionRuntimeError,
  CollectionSnapshot,
  CollectionStoreEvent,
  CollectionUpdate,
  CollectionWriteOptions
} from "./collection-contract.js";

export {
  collectionStoreEffect,
  currentCollectionStore,
  runWithCollectionStore,
  storeFor,
  subscribeCollectionEventsEffect,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";

export const recordCollectionPreload = (
  definition: AnyCollection
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(CollectionPreloadCollector);
    if (Option.isSome(collector)) {
      collector.value.definitions.push(definition);
    }
  });

const publishStoreEvent = (
  store: RuntimeCollectionStore,
  event: CollectionStoreEvent
): Effect.Effect<void> =>
  store.publish(event);

const toArray = <A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> =>
  Array.isArray(input) ? input as ReadonlyArray<A> : [input as A];

const collectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore
): CollectionState<A, K, E> => {
  return store.state(definition);
};

const rowsByIndex = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  index: string,
  value: CollectionIndexValue
): ReadonlyArray<CollectionRow<A, K>> => {
  const state = collectionState(definition);
  return rowsByCollectionIndex(definition, state, index, value);
};

const collectionPendingMutations = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore
): ReadonlyArray<CollectionPendingMutation<A, K>> => {
  const state = collectionState(definition, store);
  state.version.get();
  return pendingMutationSnapshots(state);
};

const collectionPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>> =>
  Effect.map(collectionStoreEffect, (store) => collectionPendingMutations(definition, store));

const snapshotCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore,
  updatedAt = Date.now()
): CollectionSnapshot<A, K> =>
  snapshotCollectionWithStore(definition, store, updatedAt);

const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  snapshotCollectionWithStoreEffect(definition, collectionStoreEffect);

const hydrateCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hydrateCollectionWithStoreEffect(definition, snapshot, options, collectionStoreEffect, store);

export const persistenceKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {}
): string => collectionPersistenceKey(definition, options);

const persistCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  persistCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  restoreCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  persistCollectionForReasonEffect(definition, store, collectionStoreEffect, reason);

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore
): CollectionHydrationPayload =>
  dehydrateCollectionsWithStore(collections, store);

export const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  dehydrateCollectionsWithStoreEffect(collections, collectionStoreEffect);

export const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {}
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hydrateCollectionsWithStoreEffect(collections, payload, options, collectionStoreEffect);

export const validateCollectionsHydrationEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {}
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  validateCollectionsHydrationWithStoreEffect(collections, payload, options, collectionStoreEffect);

export const subscribeCollectionChangesEffect = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError = never,
  FeedRequirements = never
>(
  definition: CollectionDefinition<A, K, E, R>,
  adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements, E, R>,
  options: CollectionChangeFeedSubscribeOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E> | FeedError, R | FeedRequirements | Scope.Scope> =>
  Effect.gen(function* () {
    if (definition.readOnly === true) {
      return yield* Effect.fail(new ReadonlyCollectionMutation({
        collection: definition.name,
        operation: "subscribeChangesEffect"
      }) as CollectionRuntimeError<E>);
    }

    const dbStore = yield* collectionStoreEffect;
    yield* subscribeCollectionChangeFeedRuntimeEffect({
      collection: definition.name,
      adapter,
      options,
      applyChanges: (changes, writeOptions) =>
        applyCollectionChangesWithStoreEffect(definition, dbStore, changes, writeOptions),
      publishFailure: (error) =>
        publishStoreEvent(dbStore, {
          _tag: "CollectionChangeFeedFailure",
          collection: definition.name,
          error
        })
    });
  }).pipe(Effect.asVoid);

const writeRows = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  input: A | ReadonlyArray<A>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    const rows = yield* ingestCollectionMutationRowsEffect(definition, toArray(input), {
      operation: "write",
      path: `$.collections[${definition.name}].rows`,
      synced: options.synced ?? true,
      origin: options.origin ?? "remote"
    });

    yield* commitCollectionWriteEffect({
      collection: definition.name,
      state,
      mutations: rows.length,
      apply: () => {
        const rebaseKeys = new Set<K>();
        for (const row of rows) {
          applyCollectionBaseRow(state, row, rebaseKeys);
        }
        rebaseCollectionBaseRows(state, rebaseKeys);
      },
      persistEffect: persistForReasonEffect(definition, dbStore, "write"),
      publishEffect: (event) => publishStoreEvent(dbStore, event)
    });
  });

const writeUpdateRow = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
  changes: Partial<A>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    const row = state.optimisticRows.get(key)?.base ?? state.rows.get(key);
    if (!row) {
      return yield* new CollectionRowNotFound({ collection: definition.name, key });
    }

    const rows = yield* ingestCollectionMutationRowsEffect(definition, [{ ...row.value, ...changes }], {
      operation: "write",
      path: `$.collections[${definition.name}].rows`,
      synced: options.synced ?? true,
      origin: options.origin ?? "remote"
    });
    const next = rows[0] as StoredRow<A, K>;
    yield* ensureCollectionRowKey(definition, key, next.key);

    yield* commitCollectionWriteEffect({
      collection: definition.name,
      state,
      mutations: 1,
      apply: () => {
        const rebaseKeys = new Set<K>();
        applyCollectionBaseRow(state, next, rebaseKeys);
        rebaseCollectionBaseRows(state, rebaseKeys);
      },
      persistEffect: persistForReasonEffect(definition, dbStore, "write"),
      publishEffect: (event) => publishStoreEvent(dbStore, event)
    });
  });

const writeDeleteRow = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    yield* commitCollectionWriteEffect({
      collection: definition.name,
      state,
      mutations: 1,
      apply: () => {
        const rebaseKeys = new Set<K>();
        deleteCollectionBaseRow(state, key, rebaseKeys);
        rebaseCollectionBaseRows(state, rebaseKeys);
      },
      persistEffect: persistForReasonEffect(definition, dbStore, "write"),
      publishEffect: (event) => publishStoreEvent(dbStore, event)
    });
  });

const applyCollectionChangesWithStoreEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  dbStore: RuntimeCollectionStore,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    if (definition.readOnly === true) {
      return yield* Effect.fail(new ReadonlyCollectionMutation({
        collection: definition.name,
        operation: "applyChangesEffect"
      }) as CollectionRuntimeError<E>);
    }

    const state = yield* collectionStateEffect(definition, dbStore);
    const upserts: Array<A> = [];
    const deletes: Array<K> = [];

    for (const change of changes) {
      switch (change._tag) {
        case "Upsert":
          upserts.push(change.value);
          break;
        case "Delete":
          deletes.push(change.key);
          break;
      }
    }

    const rows = yield* ingestCollectionOutputRowsEffect(definition, upserts, {
      operation: "write",
      path: `$.collections[${definition.name}].changes`,
      synced: options.synced ?? true,
      origin: options.origin ?? "remote"
    });

    yield* commitCollectionWriteEffect({
      collection: definition.name,
      state,
      mutations: changes.length,
      apply: () => {
        const rebaseKeys = new Set<K>();
        for (const row of rows) {
          applyCollectionBaseRow(state, row, rebaseKeys);
        }

        for (const key of deletes) {
          deleteCollectionBaseRow(state, key, rebaseKeys);
        }

        rebaseCollectionBaseRows(state, rebaseKeys);
      },
      persistEffect: persistForReasonEffect(definition, dbStore, "write"),
      publishEffect: (event) => publishStoreEvent(dbStore, event)
    });
  });

export const applyCollectionChangesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.flatMap(collectionStoreEffect, (dbStore) =>
    applyCollectionChangesWithStoreEffect(definition, dbStore, changes, options)
  );

export const defineCollection = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: Omit<CollectionOptions<A, K, E, R>, "load" | "refetch"> & {
    readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
    readonly refetch?: () => EffectInput<ReadonlyArray<A>, E, R>;
  },
  register: (name: string, definition: AnyCollection) => void
): CollectionDefinition<A, K, E, R> => {
  let definition: CollectionDefinition<A, K, E, R>;
  definition = {
    [CollectionTypeId]: CollectionTypeId,
    options: options as CollectionOptions<A, K, E, R>,
    name: options.name,
    getKey: options.getKey,
    state: () => collectionState(definition).loadState,
    version: () => collectionState(definition).version,
    get: (key: K) => {
      const state = collectionState(definition);
      state.version.get();
      const row = state.rows.get(key);
      return row ? augmentCollectionRow(definition, row) : undefined;
    },
    rows: () => {
      const state = collectionState(definition);
      state.version.get();
      return Array.from(state.rows.values(), (row) => augmentCollectionRow(definition, row));
    },
    index: (index: string, value: CollectionIndexValue) =>
      rowsByIndex(definition, index, value),
    firstByIndex: (index: string, value: CollectionIndexValue) =>
      rowsByIndex(definition, index, value)[0],
    preloadEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* runCollectionSyncLoadPolicyEffect(definition, { force: false });
      }),
    refetchEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* runCollectionSyncLoadPolicyEffect(definition, { force: true });
      }),
    pendingMutationsEffect: () => collectionPendingMutationsEffect(definition),
    pendingMutations: () => collectionPendingMutations(definition),
    flushPendingMutationsEffect: () => flushCollectionPendingMutationsEffect(definition),
    snapshotEffect: () => snapshotCollectionEffect(definition),
    snapshot: () => snapshotCollection(definition),
    hydrateEffect: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) =>
      hydrateCollectionEffect(definition, snapshot, hydrateOptions),
    hydrate: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) => {
      void runFork(hydrateCollectionEffect(definition, snapshot, hydrateOptions));
    },
    persistEffect: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions
    ) => persistCollectionEffect(definition, storage, persistOptions),
    restoreEffect: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions
    ) => restoreCollectionEffect(definition, storage, restoreOptions),
    insertEffect: (input: A | ReadonlyArray<A>) =>
      insertCollectionMutationEffect(definition, input),
    updateEffect: (key: K, update: CollectionUpdate<A>) =>
      updateCollectionMutationEffect(definition, key, update),
    deleteEffect: (key: K) =>
      deleteCollectionMutationEffect(definition, key),
    writeInsertEffect: (input: A | ReadonlyArray<A>, writeOptions?: CollectionWriteOptions) =>
      writeRows(definition, input, writeOptions),
    writeInsert: (input: A | ReadonlyArray<A>, writeOptions?: CollectionWriteOptions) => {
      void runFork(writeRows(definition, input, writeOptions));
    },
    writeUpdateEffect: (key: K, changes: Partial<A>, writeOptions?: CollectionWriteOptions) =>
      writeUpdateRow(definition, key, changes, writeOptions),
    writeUpdate: (key: K, changes: Partial<A>, writeOptions?: CollectionWriteOptions) => {
      void runFork(writeUpdateRow(definition, key, changes, writeOptions));
    },
    writeDeleteEffect: (key: K) => writeDeleteRow(definition, key),
    writeDelete: (key: K) => {
      void runFork(writeDeleteRow(definition, key));
    }
  } satisfies CollectionDefinition<A, K, E, R>;

  register(options.name, definition as AnyCollection);

  return definition;
};
