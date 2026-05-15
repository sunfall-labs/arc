import {
  EffectInputCallbackError,
  invokeEffectInput,
  runFork,
  toEffect,
  type EffectInput
} from "@effect-ui/core";
import { Clock, Deferred, Effect, Exit, Option, Scope, type Schedule } from "effect";
import { CollectionRowKeyChanged, CollectionRowNotFound, ReadonlyCollectionMutation } from "./collection-errors.js";
import { CollectionTypeId } from "./collection-ids.js";
import { CollectionPreloadCollector } from "./collection-preload.js";
import {
  applyCollectionBaseRow,
  applyOptimisticTransaction,
  augmentCollectionRow,
  bumpCollectionState,
  cloneStoredRow,
  commitOptimisticTransaction,
  deleteCollectionBaseRow,
  markStoredRowsSynced,
  rebaseCollectionBaseRows,
  restoreStoredRows,
  rollbackOptimisticTransaction,
  type CollectionState,
  type CollectionLoadAttempt,
  type PendingMutationAttempt,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";
import { rowsByCollectionIndex } from "./collection-index-materialization.js";
import {
  applyCollectionUpdate,
  cloneFrozenCollectionTransaction,
  cloneFrozenCollectionValue,
  collectionValueChanges
} from "./collection-value-detachment.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { subscribeCollectionChangeFeedRuntimeEffect } from "./collection-change-feed-runtime.js";
import {
  ingestCollectionMutationRowsEffect,
  ingestCollectionOutputRowsEffect
} from "./collection-row-ingress.js";
import {
  createCollectionTransaction,
  dequeuePendingMutation,
  enqueuePendingMutation,
  pendingMutationSnapshots,
  recordPendingMutationAttempt
} from "./collection-mutation-queue.js";
import {
  collectionPersistenceConfig,
  collectionPersistenceKey,
  dehydrateCollections as dehydrateCollectionsWithStore,
  dehydrateCollectionsEffect as dehydrateCollectionsWithStoreEffect,
  hydrateCollectionEffect as hydrateCollectionWithStoreEffect,
  hydrateCollectionsEffect as hydrateCollectionsWithStoreEffect,
  validateCollectionsHydrationEffect as validateCollectionsHydrationWithStoreEffect,
  persistCollectionEffect as persistCollectionWithStoreEffect,
  persistCollectionForReasonEffect,
  restoreCollectionBeforePreloadEffect as restoreCollectionBeforePreloadWithStoreEffect,
  restoreCollectionEffect as restoreCollectionWithStoreEffect,
  snapshotCollection as snapshotCollectionWithStore,
  snapshotCollectionEffect as snapshotCollectionWithStoreEffect
} from "./collection-persistence.js";
import type {
  CollectionChangeFeedAdapter,
  CollectionChangeFeedSubscribeOptions
} from "./sync-adapter.js";
import {
  commitCollectionWriteEffect,
  restoreCollectionStateSnapshot,
  snapshotCollectionState
} from "./collection-write-commit.js";
import {
  collectionStoreEffect,
  currentCollectionStore,
  defaultRuntimeCollectionStore,
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
  CollectionMutation,
  CollectionMutationContext,
  CollectionOptions,
  CollectionPendingMutation,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionPersistOptions,
  CollectionRow,
  CollectionRuntimeError,
  CollectionSnapshot,
  CollectionStoreEvent,
  CollectionTransaction,
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

export const collectionInputEffect = <A, E, R>(
  input: EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  toEffect(input as never) as Effect.Effect<A, E, R>;

export const collectionInputCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection callback", callback);

export const recordCollectionPreload = (
  definition: AnyCollection
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(CollectionPreloadCollector);
    if (Option.isSome(collector)) {
      collector.value.definitions.set(definition.name, definition);
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

const collectionProjectionCallbackError = (
  definition: AnyCollection,
  operation: string,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.${operation}(${definition.name})`,
    cause,
    guidance: "Collection projection callbacks such as getKey, indexes, and update functions must be synchronous, pure, and total. Move Effectful work into collection loaders or mutation handlers."
  });

const collectionProjectionEffect = <A>(
  definition: AnyCollection,
  operation: string,
  evaluate: () => A
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => collectionProjectionCallbackError(definition, operation, cause)
  });

const collectionStateEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore
): Effect.Effect<CollectionState<A, K, E>, EffectInputCallbackError> =>
  collectionProjectionEffect(definition, "state", () => collectionState(definition, store));

const ensureCollectionRowKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
  nextKey: K
): Effect.Effect<void, CollectionRowKeyChanged> =>
  Object.is(nextKey, key)
    ? Effect.void
    : Effect.fail(new CollectionRowKeyChanged({
        collection: definition.name,
        key,
        nextKey,
        guidance: "Collection updates must preserve the row key. Delete and insert when a domain workflow intentionally changes identity."
      }));

const applyCollectionUpdateEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  previous: A,
  update: CollectionUpdate<A>
): Effect.Effect<ReturnType<typeof applyCollectionUpdate<A>>, EffectInputCallbackError> =>
  collectionProjectionEffect(definition, "update", () => applyCollectionUpdate(previous, update));

const replaceCollectionRows = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  rows: ReadonlyArray<StoredRow<A, K>>
): void => {
  const nextRows = new Map<K, StoredRow<A, K>>();

  for (const row of rows) {
    nextRows.set(row.key, row);
  }

  state.rows.clear();
  const rebaseKeys = new Set<K>();

  for (const [key, row] of nextRows) {
    applyCollectionBaseRow(state, row, rebaseKeys);
  }

  for (const key of state.optimisticRows.keys()) {
    if (!nextRows.has(key)) {
      deleteCollectionBaseRow(state, key, rebaseKeys);
    }
  }

  rebaseCollectionBaseRows(state, rebaseKeys);
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
  store: RuntimeCollectionStore = defaultRuntimeCollectionStore()
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
  store: RuntimeCollectionStore = defaultRuntimeCollectionStore(),
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

const persistenceConfig = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): CollectionPersistenceConfig<E, R> | undefined =>
  collectionPersistenceConfig(definition);

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E | CollectionSnapshotCodecError | EffectInputCallbackError, R> =>
  persistCollectionForReasonEffect(definition, store, collectionStoreEffect, reason);

const restoreBeforePreloadEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore
): Effect.Effect<boolean, CollectionRuntimeError<E>, R> =>
  restoreCollectionBeforePreloadWithStoreEffect(definition, state, store, collectionStoreEffect);

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: RuntimeCollectionStore = defaultRuntimeCollectionStore()
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

const withCollectionRetry = <A, E, R>(
  definition: AnyCollection,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const retry = definition.options.policy?.retry;
  return retry ? Effect.retry(effect, retry as Schedule.Schedule<unknown, E>) : effect;
};

const failCollectionLoadEffect = <A extends object, K extends CollectionKey, E, R, Cause>(
  dbStore: RuntimeCollectionStore,
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  error: Cause
): Effect.Effect<never, Cause> =>
  Effect.gen(function* () {
    state.loadState.set({
      _tag: "Failure",
      waiting: false,
      error: error as CollectionRuntimeError<E>
    });
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionLoadFailure",
      collection: definition.name,
      error
    });
    return yield* Effect.fail(error);
  });

const beginCollectionLoadAttempt = <E>(
  state: CollectionState<any, any, E>,
  force: boolean
): Effect.Effect<
  | { readonly _tag: "Owner"; readonly attempt: CollectionLoadAttempt }
  | { readonly _tag: "Join"; readonly attempt: CollectionLoadAttempt },
  never
> =>
  Effect.gen(function* () {
    if (!force && state.activeLoad) {
      return { _tag: "Join" as const, attempt: state.activeLoad };
    }

    const attempt: CollectionLoadAttempt = {
      generation: ++state.loadGeneration,
      force,
      deferred: yield* Deferred.make<void, CollectionRuntimeError<E>>()
    };
    state.activeLoad = attempt;
    return { _tag: "Owner" as const, attempt };
  });

const isCurrentLoadAttempt = <E>(
  state: CollectionState<any, any, E>,
  attempt: CollectionLoadAttempt
): boolean =>
  state.loadGeneration === attempt.generation && state.activeLoad?.generation === attempt.generation;

const completeCollectionLoadAttempt = <E>(
  state: CollectionState<any, any, E>,
  attempt: CollectionLoadAttempt,
  exit: Exit.Exit<void, CollectionRuntimeError<E>>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (state.activeLoad?.generation === attempt.generation) {
      state.activeLoad = undefined;
    }
    yield* Deferred.done(
      attempt.deferred as Deferred.Deferred<void, CollectionRuntimeError<E>>,
      exit
    ).pipe(Effect.asVoid);
  });

const mutationHandler = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  transaction: CollectionTransaction<A, K>
): Effect.Effect<void, E | EffectInputCallbackError, R> =>
  Effect.gen(function* () {
    const inserts: Array<A> = [];
    const updates: Array<{
      readonly key: K;
      readonly value: A;
      readonly previous: A;
      readonly changes: Partial<A>;
    }> = [];
    const deletes: Array<{ readonly key: K; readonly previous: A }> = [];

    for (const mutation of transaction.mutations) {
      switch (mutation._tag) {
        case "Insert":
          inserts.push(cloneFrozenCollectionValue(mutation.value));
          break;
        case "Update":
          updates.push(cloneFrozenCollectionValue({
            key: mutation.key,
            previous: mutation.previous,
            value: mutation.value,
            changes: mutation.changes
          }));
          break;
        case "Delete":
          deletes.push(cloneFrozenCollectionValue({ key: mutation.key, previous: mutation.previous }));
          break;
      }
    }

    const context: CollectionMutationContext<A, K> = cloneFrozenCollectionValue({
      transaction: cloneFrozenCollectionTransaction(transaction)
    });
    if (inserts.length > 0 && definition.options.onInsert) {
      yield* collectionInputCallbackEffect(() => definition.options.onInsert!(Object.freeze(inserts), context));
    }
    if (updates.length > 0 && definition.options.onUpdate) {
      yield* collectionInputCallbackEffect(() => definition.options.onUpdate!(Object.freeze(updates), context));
    }
    if (deletes.length > 0 && definition.options.onDelete) {
      yield* collectionInputCallbackEffect(() => definition.options.onDelete!(Object.freeze(deletes), context));
    }
  });

const completePendingMutationAttempt = <A extends object, K extends CollectionKey, E>(
  pending: PendingMutationEntry<A, K>,
  attempt: PendingMutationAttempt<A, K>,
  exit: Exit.Exit<CollectionTransaction<A, K>, CollectionRuntimeError<E>>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (pending.activeAttempt?.id === attempt.id) {
      pending.activeAttempt = undefined;
    }
    yield* Deferred.done(
      attempt.deferred as Deferred.Deferred<CollectionTransaction<A, K>, CollectionRuntimeError<E>>,
      exit
    ).pipe(Effect.asVoid);
  });

const runPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  dbStore: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  handler: Effect.Effect<void, E | EffectInputCallbackError, R>
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const active = pending.activeAttempt as PendingMutationAttempt<A, K> | undefined;
    if (active) {
      return yield* Deferred.await(
        active.deferred as Deferred.Deferred<CollectionTransaction<A, K>, CollectionRuntimeError<E>>
      );
    }

    const attempt: PendingMutationAttempt<A, K> = {
      id: ++state.nextMutationAttemptId,
      deferred: yield* Deferred.make<CollectionTransaction<A, K>, CollectionRuntimeError<E>>()
    };
    pending.activeAttempt = attempt;
    const mutation = recordPendingMutationAttempt(pending);
    bumpCollectionState(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionMutateStarted",
      collection: definition.name,
      transaction: mutation.id,
      mutations: mutation.mutations.length
    });

    const exit = yield* Effect.exit(
      withCollectionRetry(definition, handler).pipe(
        Effect.matchEffect({
          onFailure: (error: E | EffectInputCallbackError) =>
            Effect.gen(function* () {
              if (!rollbackOptimisticTransaction(state, mutation)) {
                restoreStoredRows(state, pending.rollbackRows);
              }
              dequeuePendingMutation(state, mutation.id);
              yield* publishStoreEvent(dbStore, {
                _tag: "CollectionMutationDequeued",
                collection: definition.name,
                transaction: mutation.id,
                pending: state.pendingMutations.size
              });
              yield* publishStoreEvent(dbStore, {
                _tag: "CollectionMutateRolledBack",
                collection: definition.name,
                transaction: mutation.id,
                error
              });
              yield* persistForReasonEffect(definition, dbStore, "mutation");
              return yield* Effect.fail(error as CollectionRuntimeError<E>);
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              if (!commitOptimisticTransaction(state, mutation)) {
                markStoredRowsSynced(state, Array.from(pending.rollbackRows.keys()));
              }
              dequeuePendingMutation(state, mutation.id);
              yield* publishStoreEvent(dbStore, {
                _tag: "CollectionMutationDequeued",
                collection: definition.name,
                transaction: mutation.id,
                pending: state.pendingMutations.size
              });
              yield* publishStoreEvent(dbStore, {
                _tag: "CollectionMutateCommitted",
                collection: definition.name,
                transaction: mutation.id,
                mutations: mutation.mutations.length
              });
              yield* persistForReasonEffect(definition, dbStore, "mutation");
              return mutation;
            })
        })
      )
    );
    yield* completePendingMutationAttempt(pending, attempt, exit);
    return yield* exit;
  });

const runMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  mutation: CollectionTransaction<A, K>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  handler: Effect.Effect<void, E | EffectInputCallbackError, R>
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    const previousState = snapshotCollectionState(state);
    const createdAt = yield* Clock.currentTimeMillis;
    applyOptimisticTransaction(state, mutation, snapshots);
    const pending = enqueuePendingMutation(state, mutation, snapshots, createdAt);
    const persistExit = yield* Effect.exit(persistForReasonEffect(definition, dbStore, "mutation"));
    if (Exit.isFailure(persistExit)) {
      restoreCollectionStateSnapshot(state, previousState);
      return yield* Effect.failCause(persistExit.cause);
    }
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionMutationQueued",
      collection: definition.name,
      transaction: mutation.id,
      mutations: mutation.mutations.length,
      pending: state.pendingMutations.size
    });
    return yield* runPendingMutation(definition, state, dbStore, pending, handler);
  });

const flushCollectionPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    const flushed: Array<CollectionTransaction<A, K>> = [];

    for (const entry of Array.from(state.pendingMutations.values())) {
      const pending = state.pendingMutations.get(entry.transaction.id);
      if (!pending) {
        continue;
      }

      const handler = mutationHandler(definition, pending.transaction);
      const transaction = yield* runPendingMutation<A, K, E, R>(definition, state, dbStore, pending, handler);
      flushed.push(transaction);
    }

    return flushed;
  });

const collectionLoadOperation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  force: boolean
): (() => EffectInput<ReadonlyArray<A>, E, R>) | undefined =>
  force
    ? definition.options.refetch ?? definition.options.load
    : definition.options.load ?? definition.options.refetch;

const loadCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: { readonly force: boolean }
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, dbStore);
    const ownership = yield* beginCollectionLoadAttempt(state, options.force);
    if (ownership._tag === "Join") {
      return yield* Deferred.await(
        ownership.attempt.deferred as Deferred.Deferred<void, CollectionRuntimeError<E>>
      );
    }

    const attempt = ownership.attempt;
    const failCurrentLoad = <Cause>(error: Cause): Effect.Effect<never, Cause> =>
      isCurrentLoadAttempt(state, attempt)
        ? failCollectionLoadEffect(dbStore, definition, state, error)
        : Effect.fail(error);

    const exit = yield* Effect.exit(Effect.gen(function* () {
      const restored = yield* restoreBeforePreloadEffect(definition, state, dbStore).pipe(
        Effect.catch((error: CollectionRuntimeError<E>) => failCurrentLoad(error))
      );
      const current = state.loadState.get();
      const shouldLoadAfterRestore =
        restored &&
        persistenceConfig(definition)?.loadAfterRestore === true &&
        collectionLoadOperation(definition, options.force) !== undefined;

      if (!options.force && current._tag === "Ready" && !shouldLoadAfterRestore) {
        return;
      }

      const operation = collectionLoadOperation(definition, options.force);
      if (!operation) {
        if (state.initialDataError !== undefined) {
          return yield* failCurrentLoad(state.initialDataError);
        }
        if (current._tag === "Initial" && isCurrentLoadAttempt(state, attempt)) {
          const updatedAt = yield* Clock.currentTimeMillis;
          state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
        }
        return;
      }

      if (isCurrentLoadAttempt(state, attempt)) {
        state.loadState.set({ _tag: "Pending", waiting: true });
      }
      const load = collectionInputCallbackEffect(operation);
      const values = yield* withCollectionRetry(definition, load).pipe(
        Effect.catch((error: E | EffectInputCallbackError) => failCurrentLoad(error))
      );
      const rows = yield* ingestCollectionOutputRowsEffect(definition, values, {
        operation: "load",
        path: `$.collections[${definition.name}].rows`,
        synced: true,
        origin: "remote"
      }).pipe(
        Effect.catch((error) => failCurrentLoad(error))
      );

      if (!isCurrentLoadAttempt(state, attempt)) {
        return;
      }

      const updatedAt = yield* Clock.currentTimeMillis;
      replaceCollectionRows(definition, state, rows);
      state.initialDataError = undefined;
      state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
      yield* publishStoreEvent(dbStore, {
        _tag: "CollectionLoaded",
        collection: definition.name,
        count: rows.length,
        updatedAt
      });
      yield* persistForReasonEffect(definition, dbStore, "load");
    }));
    yield* completeCollectionLoadAttempt(state, attempt, exit);
    return yield* exit;
  });

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
        yield* loadCollectionEffect(definition, { force: false });
      }),
    refetchEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* loadCollectionEffect(definition, { force: true });
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
      Effect.gen(function* () {
        const dbStore = yield* collectionStoreEffect;
        const state = yield* collectionStateEffect(definition, dbStore);
        const rows = yield* ingestCollectionMutationRowsEffect(definition, toArray(input), {
          operation: "mutation",
          path: `$.collections[${definition.name}].mutations`,
          synced: false,
          origin: "local"
        });
        const snapshots = new Map<K, StoredRow<A, K> | undefined>();
        const mutations: Array<CollectionMutation<A, K>> = [];

        for (const row of rows) {
          const previous = state.rows.get(row.key);
          snapshots.set(row.key, previous ? cloneStoredRow(previous) : undefined);
          mutations.push(
            previous
              ? { _tag: "Insert", key: row.key, value: row.value, previous: previous.value }
              : { _tag: "Insert", key: row.key, value: row.value }
          );
        }

        const tx = createCollectionTransaction(state, definition.name, mutations);
        const handler = mutationHandler(definition, tx);
        return yield* runMutation(definition, tx, snapshots, handler);
      }),
    updateEffect: (key: K, update: CollectionUpdate<A>) =>
      Effect.gen(function* () {
        const dbStore = yield* collectionStoreEffect;
        const state = yield* collectionStateEffect(definition, dbStore);
        const row = state.rows.get(key);
        if (!row) {
          return yield* new CollectionRowNotFound({ collection: definition.name, key });
        }

        const previous = cloneStoredRow(row);
        const updated = yield* applyCollectionUpdateEffect(definition, row.value, update);
        const rows = yield* ingestCollectionMutationRowsEffect(definition, [updated.value], {
          operation: "mutation",
          path: `$.collections[${definition.name}].mutations`,
          synced: false,
          origin: "local"
        });
        const next = rows[0] as StoredRow<A, K>;
        yield* ensureCollectionRowKey(definition, key, next.key);
        const changes = collectionValueChanges(previous.value, next.value);

        const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
        const tx = createCollectionTransaction(state, definition.name, [{
          _tag: "Update",
          key,
          previous: previous.value,
          value: next.value,
          changes
        }]);
        const handler = mutationHandler(definition, tx);
        return yield* runMutation(definition, tx, snapshots, handler);
      }),
    deleteEffect: (key: K) =>
      Effect.gen(function* () {
        const dbStore = yield* collectionStoreEffect;
        const state = yield* collectionStateEffect(definition, dbStore);
        const row = state.rows.get(key);
        if (!row) {
          return yield* new CollectionRowNotFound({ collection: definition.name, key });
        }

        const previous = cloneStoredRow(row);
        const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
        const tx = createCollectionTransaction(state, definition.name, [{
          _tag: "Delete",
          key,
          previous: previous.value
        }]);
        const handler = mutationHandler(definition, tx);
        return yield* runMutation(definition, tx, snapshots, handler);
      }),
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
