import { collectionContractDefects } from "./collection-contract-defects.js";
import {
  ActionOptimisticRowsTypeId,
  EffectInputCallbackError,
  type ActionOptimisticRowChange,
  type ActionOptimisticRowsLayer,
} from "@sunfall/arc-core";
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
  applyOptimisticRowMutation,
  augmentCollectionRow,
  commitOptimisticTransaction,
  deleteCollectionBaseRow,
  rebaseCollectionBaseRows,
  rebaseOptimisticRows,
  rollbackOptimisticTransaction,
  type CollectionState,
  type OptimisticRowMutation,
  type StoredRow,
} from "./collection-state.js";
import { rowsByCollectionIndex } from "./collection-index-materialization.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { ingestCollectionOutputRowsEffect } from "./collection-row-ingress.js";
import { collectionValueChanges } from "./collection-value-detachment.js";
import {
  applyCollectionUpdateEffect,
  collectionStateEffect,
  ensureCollectionRowKey,
} from "./collection-projection-callback-policy.js";
import {
  dehydrateCollections as dehydrateCollectionsWithStore,
  dehydrateCollectionsEffect as dehydrateCollectionsWithStoreEffect,
  hydrateCollectionEffect as hydrateCollectionWithStoreEffect,
  hydrateCollectionsEffect as hydrateCollectionsWithStoreEffect,
  validateCollectionsHydrationEffect as validateCollectionsHydrationWithStoreEffect,
  persistCollectionEffect,
  persistCollectionForReasonEffect,
  restoreCollectionEffect,
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
  CollectionPersistOptions,
  CollectionRow,
  CollectionRuntimeError,
  CollectionSnapshot,
  CollectionStoreEvent,
  CollectionWriteOptions,
} from "./collection-contract.js";

export { forgetFailedCollectionLoadsEffect } from "./collection-sync-load-policy.js";
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

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "write",
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

const optimisticRowsError = (
  definition: AnyCollection,
  change: ActionOptimisticRowChange<any, any>,
  cause: unknown,
): EffectInputCallbackError =>
  cause instanceof EffectInputCallbackError
    ? cause
    : new EffectInputCallbackError({
        operation: `Action.optimistic: ${change._tag.toLowerCase()}(${definition.name})`,
        cause,
        guidance:
          "Optimistic rows must decode with the collection's output schema and keep their key. Patch read-only live-query collections through their source collections.",
      });

/** Plans the row mutations one optimistic change makes against the visible rows. */
const optimisticRowMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  change: ActionOptimisticRowChange<A, K>,
): Effect.Effect<ReadonlyArray<OptimisticRowMutation<A, K>>, unknown> =>
  Effect.gen(function* () {
    const ingest = (values: ReadonlyArray<A>) =>
      ingestCollectionOutputRowsEffect(definition, values, {
        operation: "mutation",
        path: `$.collections[${definition.name}].optimistic`,
        synced: false,
        origin: "local",
      });
    switch (change._tag) {
      case "Insert":
        return (yield* ingest(change.values)).map(
          (row): OptimisticRowMutation<A, K> => ({
            _tag: "Insert",
            key: row.key,
            value: row.value,
          }),
        );
      case "Update": {
        const row = state.rows.get(change.key);
        if (!row) {
          return [];
        }
        const updated = yield* applyCollectionUpdateEffect(definition, row.value, change.update);
        const [next] = yield* ingest([updated.value]);
        yield* ensureCollectionRowKey(definition, change.key, next!.key);
        return [
          {
            _tag: "Update",
            key: change.key,
            changes: collectionValueChanges(row.value, next!.value),
          },
        ];
      }
      case "Delete":
        return state.rows.has(change.key) ? [{ _tag: "Delete", key: change.key }] : [];
    }
  });

/**
 * Applies one optimistic Action change as a layer over the synced rows of the
 * current runtime's store, and returns that layer's commit and rollback.
 * Patches only change what renders: they skip persistence and store events.
 */
const applyOptimisticRowsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  transactionId: string,
  change: ActionOptimisticRowChange<A, K>,
): Effect.Effect<ActionOptimisticRowsLayer> =>
  Effect.gen(function* () {
    if (definition.readOnly === true) {
      return yield* Effect.fail(
        new ReadonlyCollectionMutation({ collection: definition.name, operation: "optimistic" }),
      );
    }
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const mutations = yield* optimisticRowMutationsEffect(definition, state, change);
    if (mutations.length > 0) {
      for (const mutation of mutations) {
        applyOptimisticRowMutation(state, transactionId, mutation);
      }
      rebaseOptimisticRows(
        state,
        mutations.map((mutation) => mutation.key),
      );
    }
    return {
      commit: Effect.sync(() => commitOptimisticTransaction(state, transactionId)),
      rollback: Effect.sync(() => rollbackOptimisticTransaction(state, transactionId)),
    };
  }).pipe(
    // A change the collection rejects breaks the optimistic patch contract: a defect.
    Effect.catch((cause) =>
      Effect.die(optimisticRowsError(definition as AnyCollection, change, cause)),
    ),
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
    [ActionOptimisticRowsTypeId]: {
      apply: (transactionId: string, change: ActionOptimisticRowChange<A, K>) =>
        applyOptimisticRowsEffect(definition, transactionId, change),
    },
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
      }).pipe(collectionContractDefects),
    refresh: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* runCollectionSyncLoadPolicyEffect(definition, { force: true });
        yield* followSync;
      }).pipe(collectionContractDefects),
    snapshot: () => snapshotCollectionEffect(definition),
    hydrate: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) =>
      hydrateCollectionEffect(definition, snapshot, hydrateOptions),
    persist: (persistOptions?: CollectionPersistOptions) =>
      persistCollectionEffect(definition, persistOptions, collectionStoreEffect),
    restore: (restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions) =>
      restoreCollectionEffect(definition, restoreOptions, collectionStoreEffect),
    applyChanges: (
      changes: ReadonlyArray<CollectionChange<A, K>>,
      writeOptions?: CollectionWriteOptions,
    ) =>
      applyCollectionChangesEffect(definition, changes, writeOptions).pipe(
        collectionContractDefects,
      ),
  } satisfies CollectionDefinition<A, K, E, R>;

  registry.register(definition as AnyCollection);

  return definition;
};
