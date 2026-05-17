import { EffectInputCallbackError } from "@effect-ui/core";
import { Clock, Deferred, Effect, Exit } from "effect";
import { CollectionRowKeyChanged, CollectionRowNotFound } from "./collection-errors.js";
import {
  dequeuePendingMutation,
  enqueuePendingMutation,
  recordPendingMutationAttempt,
  createCollectionTransaction,
} from "./collection-mutation-queue.js";
import { persistCollectionForReasonEffect } from "./collection-persistence.js";
import { ingestCollectionMutationRowsEffect } from "./collection-row-ingress.js";
import {
  applyOptimisticTransaction,
  bumpCollectionState,
  cloneStoredRow,
  commitOptimisticTransaction,
  markStoredRowsSynced,
  restoreStoredRows,
  rollbackOptimisticTransaction,
  type CollectionState,
  type PendingMutationAttempt,
  type PendingMutationEntry,
  type StoredRow,
} from "./collection-state.js";
import {
  restoreCollectionStateSnapshot,
  snapshotCollectionState,
  withCollectionDurableCommitPermit,
} from "./collection-write-commit.js";
import {
  cloneFrozenCollectionTransaction,
  cloneFrozenCollectionValue,
  collectionValueChanges,
} from "./collection-value-detachment.js";
import {
  applyCollectionUpdateEffect,
  collectionCallbackEffect,
  collectionStateEffect,
  ensureCollectionRowKey,
} from "./collection-projection-callback-policy.js";
import { collectionStoreEffect, type RuntimeCollectionStore } from "./runtime-collection-store.js";
import { withCollectionPolicyRetry } from "./collection-policy.js";
import type {
  CollectionDefinition,
  CollectionKey,
  CollectionMutation,
  CollectionMutationContext,
  CollectionRuntimeError,
  CollectionStoreEvent,
  CollectionTransaction,
  CollectionUpdate,
} from "./collection-contract.js";

const toArray = <A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> =>
  Array.isArray(input) ? (input as ReadonlyArray<A>) : [input as A];

const publishStoreEvent = (
  store: RuntimeCollectionStore,
  event: CollectionStoreEvent,
): Effect.Effect<void> => store.publish(event);

const persistMutationEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  persistCollectionForReasonEffect(definition, store, collectionStoreEffect, "mutation");

const collectionMutationHandlerEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  transaction: CollectionTransaction<A, K>,
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
          updates.push(
            cloneFrozenCollectionValue({
              key: mutation.key,
              previous: mutation.previous,
              value: mutation.value,
              changes: mutation.changes,
            }),
          );
          break;
        case "Delete":
          deletes.push(
            cloneFrozenCollectionValue({ key: mutation.key, previous: mutation.previous }),
          );
          break;
      }
    }

    const context: CollectionMutationContext<A, K> = cloneFrozenCollectionValue({
      transaction: cloneFrozenCollectionTransaction(transaction),
    });
    if (inserts.length > 0 && definition.options.onInsert) {
      yield* collectionCallbackEffect(() =>
        definition.options.onInsert!(Object.freeze(inserts), context),
      );
    }
    if (updates.length > 0 && definition.options.onUpdate) {
      yield* collectionCallbackEffect(() =>
        definition.options.onUpdate!(Object.freeze(updates), context),
      );
    }
    if (deletes.length > 0 && definition.options.onDelete) {
      yield* collectionCallbackEffect(() =>
        definition.options.onDelete!(Object.freeze(deletes), context),
      );
    }
  });

const completePendingMutationAttempt = <A extends object, K extends CollectionKey, E>(
  pending: PendingMutationEntry<A, K>,
  attempt: PendingMutationAttempt<A, K>,
  exit: Exit.Exit<CollectionTransaction<A, K>, CollectionRuntimeError<E>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (pending.activeAttempt?.id === attempt.id) {
      pending.activeAttempt = undefined;
    }
    yield* Deferred.done(
      attempt.deferred as Deferred.Deferred<CollectionTransaction<A, K>, CollectionRuntimeError<E>>,
      exit,
    ).pipe(Effect.asVoid);
  });

const publishMutationDequeued = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  transaction: CollectionTransaction<A, K>,
): Effect.Effect<void> =>
  publishStoreEvent(store, {
    _tag: "CollectionMutationDequeued",
    collection: definition.name,
    transaction: transaction.id,
    pending: state.pendingMutations.size,
  });

const rollbackPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  mutation: CollectionTransaction<A, K>,
  error: E | EffectInputCallbackError,
): Effect.Effect<never, CollectionRuntimeError<E>, R> =>
  withCollectionDurableCommitPermit(
    state,
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!rollbackOptimisticTransaction(state, mutation)) {
          restoreStoredRows(state, pending.rollbackRows);
        }
        dequeuePendingMutation(state, mutation.id);
        const persistExit = yield* restore(persistMutationEffect(definition, store)).pipe(
          Effect.exit,
        );
        if (Exit.isFailure(persistExit)) {
          return yield* Effect.failCause(persistExit.cause);
        }
        yield* publishMutationDequeued(definition, state, store, mutation);
        yield* publishStoreEvent(store, {
          _tag: "CollectionMutateRolledBack",
          collection: definition.name,
          transaction: mutation.id,
          error,
        });
      }),
    ),
  ).pipe(Effect.flatMap(() => Effect.fail(error as CollectionRuntimeError<E>)));

const commitPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  mutation: CollectionTransaction<A, K>,
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  withCollectionDurableCommitPermit(
    state,
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!commitOptimisticTransaction(state, mutation)) {
          markStoredRowsSynced(state, Array.from(pending.rollbackRows.keys()));
        }
        dequeuePendingMutation(state, mutation.id);
        const persistExit = yield* restore(persistMutationEffect(definition, store)).pipe(
          Effect.exit,
        );
        if (Exit.isFailure(persistExit)) {
          return yield* Effect.failCause(persistExit.cause);
        }
        yield* publishMutationDequeued(definition, state, store, mutation);
        yield* publishStoreEvent(store, {
          _tag: "CollectionMutateCommitted",
          collection: definition.name,
          transaction: mutation.id,
          mutations: mutation.mutations.length,
        });
        return mutation;
      }),
    ),
  );

const runPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  handler: Effect.Effect<void, E | EffectInputCallbackError, R>,
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const active = pending.activeAttempt as PendingMutationAttempt<A, K> | undefined;
    if (active) {
      return yield* Deferred.await(
        active.deferred as Deferred.Deferred<
          CollectionTransaction<A, K>,
          CollectionRuntimeError<E>
        >,
      );
    }

    const attempt: PendingMutationAttempt<A, K> = {
      id: ++state.nextMutationAttemptId,
      deferred: yield* Deferred.make<CollectionTransaction<A, K>, CollectionRuntimeError<E>>(),
    };
    pending.activeAttempt = attempt;
    const runOwnerMutation = Effect.gen(function* () {
      const mutation = recordPendingMutationAttempt(pending);
      bumpCollectionState(state);
      yield* publishStoreEvent(store, {
        _tag: "CollectionMutateStarted",
        collection: definition.name,
        transaction: mutation.id,
        mutations: mutation.mutations.length,
      });

      const exit = yield* Effect.exit(
        withCollectionPolicyRetry(definition, handler).pipe(
          Effect.matchEffect({
            onFailure: (error: E | EffectInputCallbackError) =>
              rollbackPendingMutation(definition, state, store, pending, mutation, error),
            onSuccess: () => commitPendingMutation(definition, state, store, pending, mutation),
          }),
        ),
      );
      yield* completePendingMutationAttempt(pending, attempt, exit);
      return yield* exit;
    });

    return yield* runOwnerMutation.pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? completePendingMutationAttempt(
              pending,
              attempt,
              exit as Exit.Exit<CollectionTransaction<A, K>, CollectionRuntimeError<E>>,
            )
          : Effect.void,
      ),
    );
  });

const runCollectionMutationTransactionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  mutation: CollectionTransaction<A, K>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  handler: Effect.Effect<void, E | EffectInputCallbackError, R>,
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const pending = yield* withCollectionDurableCommitPermit(
      state,
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previousState = snapshotCollectionState(state);
          const createdAt = yield* Clock.currentTimeMillis;
          applyOptimisticTransaction(state, mutation, snapshots);
          const pending = enqueuePendingMutation(state, mutation, snapshots, createdAt);
          const persistExit = yield* restore(persistMutationEffect(definition, store)).pipe(
            Effect.exit,
          );
          if (Exit.isFailure(persistExit)) {
            restoreCollectionStateSnapshot(state, previousState);
            return yield* Effect.failCause(persistExit.cause);
          }
          yield* publishStoreEvent(store, {
            _tag: "CollectionMutationQueued",
            collection: definition.name,
            transaction: mutation.id,
            mutations: mutation.mutations.length,
            pending: state.pendingMutations.size,
          });
          return pending;
        }),
      ),
    );
    return yield* runPendingMutation(definition, state, store, pending, handler);
  });

/**
 * Flush restored or otherwise queued optimistic collection mutations.
 *
 * The workflow owns restored-pending replay, active attempt joiners, mutation
 * retry policy, optimistic commit/rollback, lifecycle events, and mutation
 * persistence so `Collection.define` can stay a small public facade.
 */
export const flushCollectionPendingMutationsEffect = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
>(
  definition: CollectionDefinition<A, K, E, R>,
): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const flushed: Array<CollectionTransaction<A, K>> = [];

    for (const entry of Array.from(state.pendingMutations.values())) {
      const pending = state.pendingMutations.get(entry.transaction.id);
      if (!pending) {
        continue;
      }

      const handler = collectionMutationHandlerEffect(definition, pending.transaction);
      const transaction = yield* runPendingMutation<A, K, E, R>(
        definition,
        state,
        store,
        pending,
        handler,
      );
      flushed.push(transaction);
    }

    return flushed;
  });

/** Optimistically insert rows and run the insert mutation workflow. */
export const insertCollectionMutationEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  input: A | ReadonlyArray<A>,
): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const rows = yield* ingestCollectionMutationRowsEffect(definition, toArray(input), {
      operation: "mutation",
      path: `$.collections[${definition.name}].mutations`,
      synced: false,
      origin: "local",
    });
    if (rows.length === 0) {
      return createCollectionTransaction(state, definition.name, []);
    }

    const snapshots = new Map<K, StoredRow<A, K> | undefined>();
    const mutations: Array<CollectionMutation<A, K>> = [];

    for (const row of rows) {
      const previous = state.rows.get(row.key);
      snapshots.set(row.key, previous ? cloneStoredRow(previous) : undefined);
      mutations.push(
        previous
          ? { _tag: "Insert", key: row.key, value: row.value, previous: previous.value }
          : { _tag: "Insert", key: row.key, value: row.value },
      );
    }

    const transaction = createCollectionTransaction(state, definition.name, mutations);
    const handler = collectionMutationHandlerEffect(definition, transaction);
    return yield* runCollectionMutationTransactionEffect(
      definition,
      transaction,
      snapshots,
      handler,
    );
  });

/** Optimistically update one row and run the update mutation workflow. */
export const updateCollectionMutationEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
  update: CollectionUpdate<A>,
): Effect.Effect<
  CollectionTransaction<A, K>,
  CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged,
  R
> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
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
      origin: "local",
    });
    const next = rows[0] as StoredRow<A, K>;
    yield* ensureCollectionRowKey(definition, key, next.key);
    const changes = collectionValueChanges(previous.value, next.value);

    const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
    const transaction = createCollectionTransaction(state, definition.name, [
      {
        _tag: "Update",
        key,
        previous: previous.value,
        value: next.value,
        changes,
      },
    ]);
    const handler = collectionMutationHandlerEffect(definition, transaction);
    return yield* runCollectionMutationTransactionEffect(
      definition,
      transaction,
      snapshots,
      handler,
    );
  });

/** Optimistically delete one row and run the delete mutation workflow. */
export const deleteCollectionMutationEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
): Effect.Effect<
  CollectionTransaction<A, K>,
  CollectionRuntimeError<E> | CollectionRowNotFound,
  R
> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const row = state.rows.get(key);
    if (!row) {
      return yield* new CollectionRowNotFound({ collection: definition.name, key });
    }

    const previous = cloneStoredRow(row);
    const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
    const transaction = createCollectionTransaction(state, definition.name, [
      {
        _tag: "Delete",
        key,
        previous: previous.value,
      },
    ]);
    const handler = collectionMutationHandlerEffect(definition, transaction);
    return yield* runCollectionMutationTransactionEffect(
      definition,
      transaction,
      snapshots,
      handler,
    );
  });
