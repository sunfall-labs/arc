import type { EffectInputCallbackError } from "@sunfall/arc-core";
import { Effect, Option } from "effect";
import {
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  ReadonlyCollectionMutation,
} from "./collection-errors.js";
import { CollectionTypeId } from "./collection-ids.js";
import { CollectionPreloadCollector } from "./collection-preload.js";
import {
  applyCollectionBaseRow,
  augmentCollectionRow,
  deleteCollectionBaseRow,
  rebaseCollectionBaseRows,
  type CollectionState,
  type StoredRow,
} from "./collection-state.js";
import { rowsByCollectionIndex } from "./collection-index-materialization.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { ingestCollectionOutputRowsEffect } from "./collection-row-ingress.js";
import { pendingMutationSnapshots } from "./collection-mutation-queue.js";
import {
  applyCollectionUpdateEffect,
  collectionStateEffect,
  ensureCollectionRowKey,
} from "./collection-projection-callback-policy.js";
import {
  deleteCollectionMutationEffect,
  flushCollectionPendingMutationsEffect,
  insertCollectionMutationEffect,
  updateCollectionMutationEffect,
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
  snapshotCollectionEffect as snapshotCollectionWithStoreEffect,
} from "./collection-persistence.js";
import { commitCollectionWriteEffect } from "./collection-write-commit.js";
import {
  defaultCollectionDefinitionRegistry,
  type CollectionDefinitionRegistryAdapter,
} from "./collection-registry.js";
import {
  followCollectionSyncEffect,
  runCollectionSyncLoadPolicyEffect,
} from "./collection-sync-load-policy.js";
import {
  collectionStoreEffect,
  currentCollectionStore,
  type RuntimeCollectionStore,
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
  CollectionWriteOptions,
} from "./collection-contract.js";

export {
  collectionStoreEffect,
  currentCollectionStore,
  runWithCollectionStore,
  storeFor,
  subscribeCollectionEventsEffect,
  type RuntimeCollectionStore,
} from "./runtime-collection-store.js";

export const recordCollectionPreload = (definition: AnyCollection): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(CollectionPreloadCollector);
    if (Option.isSome(collector)) {
      collector.value.definitions.push(definition);
    }
  });

const publishStoreEvent = (
  store: RuntimeCollectionStore,
  event: CollectionStoreEvent,
): Effect.Effect<void> => store.publish(event);

const collectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore,
): CollectionState<A, K, E> => {
  return store.state(definition);
};

const rowsByIndex = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  index: string,
  value: CollectionIndexValue,
): ReadonlyArray<CollectionRow<A, K>> => {
  const state = collectionState(definition);
  return rowsByCollectionIndex(definition, state, index, value);
};

const collectionPendingMutations = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore,
): ReadonlyArray<CollectionPendingMutation<A, K>> => {
  const state = collectionState(definition, store);
  state.version.get();
  return pendingMutationSnapshots(state);
};

const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
): Effect.Effect<
  CollectionSnapshot<A, K>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> => snapshotCollectionWithStoreEffect(definition, collectionStoreEffect);

const hydrateCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hydrateCollectionWithStoreEffect(definition, snapshot, options, collectionStoreEffect, store);

export const persistenceKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {},
): string => collectionPersistenceKey(definition, options);

const persistCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  store?: RuntimeCollectionStore,
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  persistCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore,
): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> =>
  restoreCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "mutation" | "write",
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  persistCollectionForReasonEffect(definition, store, collectionStoreEffect, reason);

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: RuntimeCollectionStore = currentCollectionStore() as RuntimeCollectionStore,
): CollectionHydrationPayload => dehydrateCollectionsWithStore(collections, store);

export const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
): Effect.Effect<
  CollectionHydrationPayload,
  CollectionSnapshotCodecError | EffectInputCallbackError
> => dehydrateCollectionsWithStoreEffect(collections, collectionStoreEffect);

export const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  hydrateCollectionsWithStoreEffect(collections, payload, options, collectionStoreEffect);

export const validateCollectionsHydrationEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {},
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  validateCollectionsHydrationWithStoreEffect(collections, payload, options, collectionStoreEffect);

type CollectionChangeOperation<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Put"; readonly row: StoredRow<A, K> }
  | { readonly _tag: "Delete"; readonly key: K };

const applyCollectionChangesWithStoreEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  dbStore: RuntimeCollectionStore,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {},
): Effect.Effect<
  void,
  CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged,
  R
> =>
  Effect.gen(function* () {
    if (definition.readOnly === true) {
      return yield* Effect.fail(
        new ReadonlyCollectionMutation({
          collection: definition.name,
          operation: "applyChanges",
        }) as CollectionRuntimeError<E>,
      );
    }

    if (changes.length === 0) {
      return;
    }

    const state = yield* collectionStateEffect(definition, dbStore);
    const ingestOptions = (path: string) => ({
      operation: "write" as const,
      path,
      synced: options.synced ?? true,
      origin: options.origin ?? "remote",
    });
    const upsertRows = yield* ingestCollectionOutputRowsEffect(
      definition,
      changes.flatMap((change) => (change._tag === "Upsert" ? [change.value] : [])),
      ingestOptions(`$.collections[${definition.name}].changes`),
    );

    // Rows written earlier in this batch; `undefined` marks a batch delete.
    const batchRows = new Map<K, StoredRow<A, K> | undefined>();
    const baseRow = (key: K): StoredRow<A, K> | undefined => {
      if (batchRows.has(key)) {
        return batchRows.get(key);
      }
      const optimistic = state.optimisticRows.get(key);
      return optimistic ? (optimistic.base ?? state.rows.get(key)) : state.rows.get(key);
    };
    const hasBaseRow = (key: K): boolean => {
      if (batchRows.has(key)) {
        return batchRows.get(key) !== undefined;
      }
      const optimistic = state.optimisticRows.get(key);
      return optimistic ? optimistic.base !== undefined : state.rows.has(key);
    };

    const operations: Array<CollectionChangeOperation<A, K>> = [];
    let upsertIndex = 0;
    for (const [index, change] of changes.entries()) {
      switch (change._tag) {
        case "Upsert": {
          const row = upsertRows[upsertIndex++] as StoredRow<A, K>;
          batchRows.set(row.key, row);
          operations.push({ _tag: "Put", row });
          break;
        }
        case "Update": {
          const row = baseRow(change.key);
          if (!row) {
            return yield* new CollectionRowNotFound({
              collection: definition.name,
              key: change.key,
            });
          }
          const updated = yield* applyCollectionUpdateEffect(definition, row.value, change.changes);
          const [next] = yield* ingestCollectionOutputRowsEffect(
            definition,
            [updated.value],
            ingestOptions(`$.collections[${definition.name}].changes[${index}]`),
          );
          yield* ensureCollectionRowKey(definition, change.key, next!.key);
          batchRows.set(change.key, next!);
          operations.push({ _tag: "Put", row: next! });
          break;
        }
        case "Delete": {
          if (!hasBaseRow(change.key)) {
            break;
          }
          batchRows.set(change.key, undefined);
          operations.push({ _tag: "Delete", key: change.key });
          break;
        }
      }
    }

    if (operations.length === 0) {
      return;
    }

    yield* commitCollectionWriteEffect({
      collection: definition.name,
      state,
      mutations: operations.length,
      apply: () => {
        const rebaseKeys = new Set<K>();
        for (const operation of operations) {
          if (operation._tag === "Put") {
            applyCollectionBaseRow(state, operation.row, rebaseKeys);
          } else {
            deleteCollectionBaseRow(state, operation.key, rebaseKeys);
          }
        }
        rebaseCollectionBaseRows(state, rebaseKeys);
      },
      persist: persistForReasonEffect(definition, dbStore, "write"),
      publish: (event) => publishStoreEvent(dbStore, event),
    });
  });

const applyCollectionChangesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {},
): Effect.Effect<
  void,
  CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged,
  R
> =>
  Effect.flatMap(collectionStoreEffect, (dbStore) =>
    applyCollectionChangesWithStoreEffect(definition, dbStore, changes, options),
  );

export const defineCollection = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
>(
  options: CollectionOptions<A, K, E, R>,
  registry: CollectionDefinitionRegistryAdapter = defaultCollectionDefinitionRegistry,
): CollectionDefinition<A, K, E, R> => {
  let definition: CollectionDefinition<A, K, E, R>;
  const followSync = Effect.suspend(() =>
    followCollectionSyncEffect(definition, (store, changes) =>
      applyCollectionChangesWithStoreEffect(definition, store, changes),
    ),
  );
  definition = {
    [CollectionTypeId]: CollectionTypeId,
    options,
    name: options.name,
    getKey: options.getKey,
    result: () => collectionState(definition).loadState,
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
    index: (index: string, value: CollectionIndexValue) => rowsByIndex(definition, index, value),
    firstByIndex: (index: string, value: CollectionIndexValue) =>
      rowsByIndex(definition, index, value)[0],
    preload: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* runCollectionSyncLoadPolicyEffect(definition, { force: false });
        yield* followSync;
      }),
    refresh: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* runCollectionSyncLoadPolicyEffect(definition, { force: true });
        yield* followSync;
      }),
    pendingMutations: () => collectionPendingMutations(definition),
    flushPendingMutations: () => flushCollectionPendingMutationsEffect(definition),
    snapshot: () => snapshotCollectionEffect(definition),
    hydrate: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) =>
      hydrateCollectionEffect(definition, snapshot, hydrateOptions),
    persist: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions,
    ) => persistCollectionEffect(definition, storage, persistOptions),
    restore: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions,
    ) => restoreCollectionEffect(definition, storage, restoreOptions),
    insert: (input: A | ReadonlyArray<A>) => insertCollectionMutationEffect(definition, input),
    update: (key: K, update: CollectionUpdate<A>) =>
      updateCollectionMutationEffect(definition, key, update),
    delete: (key: K) => deleteCollectionMutationEffect(definition, key),
    applyChanges: (
      changes: ReadonlyArray<CollectionChange<A, K>>,
      writeOptions?: CollectionWriteOptions,
    ) => applyCollectionChangesEffect(definition, changes, writeOptions),
  } satisfies CollectionDefinition<A, K, E, R>;

  registry.register(definition as AnyCollection);

  return definition;
};
