import { EffectInputCallbackError, type EffectInput } from "@effect-ui/core";
import { Cause, Clock, Deferred, Effect, Exit } from "effect";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionKey,
  CollectionLoadState,
  CollectionSnapshot,
  CollectionRuntimeError
} from "./collection-contract.js";
import {
  collectionPersistenceConfig,
  collectionPersistencePersistOptions,
  persistCollectionSnapshotEffect,
  restoreCollectionBeforePreloadEffect
} from "./collection-persistence.js";
import { ingestCollectionOutputRowsEffect } from "./collection-row-ingress.js";
import {
  applyCollectionBaseRow,
  deleteCollectionBaseRow,
  makeCollectionState,
  rebaseCollectionBaseRows,
  type CollectionLoadAttempt,
  type CollectionState,
  type StoredRow
} from "./collection-state.js";
import {
  collectionStoreEffect,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";
import {
  collectionCallbackEffect,
  collectionStateEffect
} from "./collection-projection-callback-policy.js";
import {
  restoreCollectionStateSnapshot,
  snapshotCollectionState,
  withCollectionDurableCommitPermit
} from "./collection-write-commit.js";
import {
  collectionSnapshotFromState
} from "./collection-snapshot-codec.js";
import { withCollectionPolicyRetry } from "./collection-policy.js";

/** Options for one Collection Sync Load Policy invocation. */
export interface CollectionSyncLoadPolicyOptions {
  /** Forces a fresh `refetch`/`load` attempt even when the collection is already ready. */
  readonly force: boolean;
}

const publishStoreEvent = (
  store: RuntimeCollectionStore,
  event: Parameters<RuntimeCollectionStore["publish"]>[0]
): Effect.Effect<void> =>
  store.publish(event);

const replaceLoadedCollectionRows = <A extends object, K extends CollectionKey, E, R>(
  state: CollectionState<A, K, E>,
  rows: ReadonlyArray<StoredRow<A, K>>
): void => {
  const nextRows = new Map<K, StoredRow<A, K>>();

  for (const row of rows) {
    nextRows.set(row.key, row);
  }
  for (const row of state.rows.values()) {
    if (!row.synced && !nextRows.has(row.key) && !state.optimisticRows.has(row.key)) {
      nextRows.set(row.key, row);
    }
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

const isInterruptedCause = <E>(cause: Cause.Cause<E>): boolean =>
  cause.reasons.some(Cause.isInterruptReason);

const failCollectionLoadEffect = <A extends object, K extends CollectionKey, E, R, Cause>(
  store: RuntimeCollectionStore,
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
    yield* publishStoreEvent(store, {
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

const effectFromLoadAttemptExit = <E>(
  exit: Exit.Exit<void, CollectionRuntimeError<E>>
): Effect.Effect<void, CollectionRuntimeError<E>> =>
  Exit.isSuccess(exit) ? Effect.void : Effect.failCause(exit.cause);

const supersededLoadAttemptWithoutActiveError = (
  definition: AnyCollection,
  state: CollectionState<any, any, any>,
  attempt: CollectionLoadAttempt
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.load(${definition.name}).superseded`,
    cause: {
      attemptGeneration: attempt.generation,
      currentGeneration: state.loadGeneration,
      loadState: state.loadState.get()._tag
    },
    guidance: "A superseded collection load can only complete from a visible Ready or Failure state, or by joining the current active load generation."
  });

const waitForSupersedingLoadAttempt = <E>(
  definition: AnyCollection,
  state: CollectionState<any, any, E>,
  attempt: CollectionLoadAttempt
): Effect.Effect<void, CollectionRuntimeError<E>> =>
  Effect.suspend(() => {
    const current = state.loadState.get();
    switch (current._tag) {
      case "Ready":
        return Effect.void;
      case "Failure":
        return Effect.fail(current.error);
      case "Initial":
      case "Pending": {
        const active = state.activeLoad;
        return active && active.generation !== attempt.generation
          ? Deferred.await(active.deferred as Deferred.Deferred<void, CollectionRuntimeError<E>>)
          : Effect.fail(supersededLoadAttemptWithoutActiveError(definition, state, attempt));
      }
    }
  });

const resolveLoadAttemptCompletion = <E>(
  definition: AnyCollection,
  state: CollectionState<any, any, E>,
  attempt: CollectionLoadAttempt,
  exit: Exit.Exit<void, CollectionRuntimeError<E>>
): Effect.Effect<void, CollectionRuntimeError<E>> =>
  state.loadGeneration === attempt.generation
    ? effectFromLoadAttemptExit(exit)
    : waitForSupersedingLoadAttempt(definition, state, attempt);

const collectionLoadOperation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  force: boolean
): (() => EffectInput<ReadonlyArray<A>, E, R>) | undefined =>
  force
    ? definition.options.refetch ?? definition.options.load
    : definition.options.load ?? definition.options.refetch;

const restoreBeforePreloadEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  attempt: CollectionLoadAttempt
): Effect.Effect<boolean, CollectionRuntimeError<E>, R> =>
  Effect.suspend(() => {
    const restoreVersion = state.version.get();
    return restoreCollectionBeforePreloadEffect(
      definition,
      state,
      store,
      collectionStoreEffect,
      () => isCurrentLoadAttempt(state, attempt) && state.version.get() === restoreVersion
    );
  });

const shouldPersistLoad = (definition: AnyCollection): boolean => {
  const config = collectionPersistenceConfig(definition);
  return config !== undefined && config.persistOnLoad !== false;
};

const stagedLoadedCollectionSnapshotEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  rows: ReadonlyArray<StoredRow<A, K>>,
  updatedAt: number
): Effect.Effect<CollectionSnapshot<A, K>, EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      const stagedState = makeCollectionState<A, K, E>();
      restoreCollectionStateSnapshot(stagedState, snapshotCollectionState(state));
      replaceLoadedCollectionRows(stagedState, rows);
      return collectionSnapshotFromState(definition, stagedState, updatedAt);
    },
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: `Collection.load(${definition.name}).snapshot`,
        cause,
        guidance: "Collection load snapshots must be serializable before rows are committed to live state."
      })
  });

const persistLoadSnapshotEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  snapshot: CollectionSnapshot<A, K>
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.suspend(() => {
    const config = collectionPersistenceConfig(definition);
    if (config === undefined || config.persistOnLoad === false) {
      return Effect.succeed(undefined);
    }

    return persistCollectionSnapshotEffect(
      definition,
      Effect.succeed(snapshot),
      config.storage,
      collectionPersistencePersistOptions(config),
      store
    ).pipe(Effect.asVoid);
  });

const restoreLoadStateIfCurrentEffect = <A extends object, K extends CollectionKey, E>(
  state: CollectionState<A, K, E>,
  attempt: CollectionLoadAttempt,
  loadState: CollectionLoadState<CollectionRuntimeError<E>>
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (isCurrentLoadAttempt(state, attempt)) {
      state.loadState.set(loadState);
    }
  });

const commitLoadedCollectionRowsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore,
  attempt: CollectionLoadAttempt,
  rows: ReadonlyArray<StoredRow<A, K>>,
  previousLoadState: CollectionLoadState<CollectionRuntimeError<E>>,
  updatedAt: number
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  withCollectionDurableCommitPermit(
    state,
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!isCurrentLoadAttempt(state, attempt)) {
          return;
        }

        const snapshot = shouldPersistLoad(definition)
          ? yield* stagedLoadedCollectionSnapshotEffect(definition, state, rows, updatedAt).pipe(
              Effect.catch((error) =>
                isCurrentLoadAttempt(state, attempt)
                  ? failCollectionLoadEffect(store, definition, state, error)
                  : Effect.fail(error)
              )
            )
          : undefined;

        if (!isCurrentLoadAttempt(state, attempt)) {
          return;
        }

        const persistExit = yield* (snapshot === undefined
          ? Effect.succeed(Exit.void)
          : restore(persistLoadSnapshotEffect(definition, store, snapshot)).pipe(Effect.exit));
        if (Exit.isFailure(persistExit)) {
          if (isInterruptedCause(persistExit.cause)) {
            yield* restoreLoadStateIfCurrentEffect(state, attempt, previousLoadState);
          } else if (isCurrentLoadAttempt(state, attempt)) {
            yield* failCollectionLoadEffect(
              store,
              definition,
              state,
              persistExit.cause.reasons.find(Cause.isFailReason)?.error ?? Cause.squash(persistExit.cause)
            ).pipe(Effect.exit);
          }
          return yield* Effect.failCause(persistExit.cause);
        }

        if (!isCurrentLoadAttempt(state, attempt)) {
          return;
        }

        replaceLoadedCollectionRows(state, rows);
        state.initialDataError = undefined;
        state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
        yield* publishStoreEvent(store, {
          _tag: "CollectionLoaded",
          collection: definition.name,
          count: state.rows.size,
          updatedAt
        });
      })
    )
  );

/**
 * Runs the Collection Sync Load Policy for `preloadEffect` and `refetchEffect`.
 *
 * The policy owns in-flight load ownership, joiners, stale generation checks,
 * restore-before-load, retry scheduling, row replacement, lifecycle events, and
 * load persistence. Collection Runtime calls this small Interface so load
 * ordering stays Effect-first and runtime/request-local.
 */
export const runCollectionSyncLoadPolicyEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionSyncLoadPolicyOptions
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const state = yield* collectionStateEffect(definition, store);
    const ownership = yield* beginCollectionLoadAttempt(state, options.force);
    if (ownership._tag === "Join") {
      return yield* Deferred.await(
        ownership.attempt.deferred as Deferred.Deferred<void, CollectionRuntimeError<E>>
      );
    }

    const attempt = ownership.attempt;
    const failCurrentLoad = <Cause>(
      error: Cause
    ): Effect.Effect<never, Cause> =>
      isCurrentLoadAttempt(state, attempt)
        ? failCollectionLoadEffect(store, definition, state, error)
        : Effect.fail(error);

    const runOwnerLoad = Effect.gen(function* () {
      const restored = yield* restoreBeforePreloadEffect(definition, state, store, attempt).pipe(
        Effect.catch((error: CollectionRuntimeError<E>) => failCurrentLoad(error))
      );
      if (!isCurrentLoadAttempt(state, attempt)) {
        return;
      }
      const current = state.loadState.get();
      const operation = collectionLoadOperation(definition, options.force);
      const shouldLoadAfterRestore =
        restored &&
        collectionPersistenceConfig(definition)?.loadAfterRestore === true &&
        operation !== undefined;

      if (!options.force && current._tag === "Ready" && !shouldLoadAfterRestore) {
        return;
      }

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

      const load = collectionCallbackEffect(operation);
      const previousLoadState = state.loadState.get();
      if (isCurrentLoadAttempt(state, attempt)) {
        state.loadState.set({ _tag: "Pending", waiting: true });
      }
      const values = yield* withCollectionPolicyRetry(definition, load).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && isInterruptedCause(exit.cause)
            ? restoreLoadStateIfCurrentEffect(state, attempt, previousLoadState)
            : Effect.void
        ),
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
      yield* commitLoadedCollectionRowsEffect(
        definition,
        state,
        store,
        attempt,
        rows,
        previousLoadState,
        updatedAt
      );
    }).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          const completionExit = yield* Effect.exit(resolveLoadAttemptCompletion(definition, state, attempt, exit));
          yield* completeCollectionLoadAttempt(state, attempt, completionExit);
          return yield* effectFromLoadAttemptExit(completionExit);
        })
      )
    );

    return yield* runOwnerLoad.pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? completeCollectionLoadAttempt(
              state,
              attempt,
              exit as Exit.Exit<void, CollectionRuntimeError<E>>
            )
          : Effect.void
      )
    );
  });
