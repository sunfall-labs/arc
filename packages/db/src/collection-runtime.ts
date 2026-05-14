import {
  currentOrDefaultRuntime,
  ResourceStore,
  runFork,
  toEffect,
  type EffectInput,
  type ResourceStore as ResourceStoreState
} from "@effect-ui/core";
import { Clock, Effect, Option, PubSub, Scope } from "effect";
import { CollectionRowNotFound } from "./collection-errors.js";
import { CollectionStoreTypeId, CollectionTypeId } from "./collection-ids.js";
import { CollectionPreloadCollector } from "./collection-preload.js";
import {
  applyCollectionUpdate,
  augmentCollectionRow,
  bumpCollectionState,
  collectionIndexJoinKeys,
  initializeCollectionState,
  makeCollectionState,
  markStoredRowsSynced,
  replaceCollectionRows,
  rowsByCollectionIndex,
  type CollectionState,
  type PendingMutationEntry,
  type StoredRow
} from "./collection-state.js";
import {
  cloneStoredRow,
  decodeCollectionOutputValuesEffect,
  type CollectionSnapshotCodecError,
  restoreStoredRows
} from "./collection-snapshot-codec.js";
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
  persistCollectionEffect as persistCollectionWithStoreEffect,
  persistCollectionForReasonEffect,
  restoreCollectionBeforePreloadEffect as restoreCollectionBeforePreloadWithStoreEffect,
  restoreCollectionEffect as restoreCollectionWithStoreEffect,
  snapshotCollection as snapshotCollectionWithStore,
  snapshotCollectionEffect as snapshotCollectionWithStoreEffect
} from "./collection-persistence.js";
import type {
  CollectionChangeFeedAdapter,
  CollectionChangeFeedSubscribeOptions,
  CollectionChangeFeedSubscription,
  CollectionChangeFeedUnsubscribe
} from "./sync-adapter.js";
import type { QueryJoinKey } from "./query-plan.js";
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
  CollectionStore,
  CollectionStoreEvent,
  CollectionTransaction,
  CollectionUpdate,
  CollectionWriteOptions
} from "./collection-contract.js";

export class RuntimeCollectionStore implements CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId = CollectionStoreTypeId;
  readonly #states = new WeakMap<object, CollectionState<any, CollectionKey, any>>();
  readonly #events = Effect.runSync(PubSub.sliding<CollectionStoreEvent>(1024));
  readonly disposeEffect = PubSub.shutdown(this.#events);

  state(
    definition: AnyCollection
  ): CollectionState<any, any, any>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionState<A, K, E>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionState<A, K, E> {
    const existing = this.#states.get(definition);
    if (existing) {
      return existing as CollectionState<A, K, E>;
    }

    const state = makeCollectionState<A, K, E>();
    this.#states.set(definition, state as CollectionState<any, CollectionKey, any>);
    initializeCollectionState(definition, state);
    return state;
  }

  publish(event: CollectionStoreEvent): Effect.Effect<void> {
    return PubSub.publish(this.#events, event).pipe(Effect.asVoid);
  }

  subscribeEventsEffect(): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope> {
    return PubSub.subscribe(this.#events);
  }
}

const makeCollectionStore = (): RuntimeCollectionStore => new RuntimeCollectionStore();

const isRuntimeCollectionStore = (value: unknown): value is RuntimeCollectionStore =>
  value instanceof RuntimeCollectionStore;

export const storeFor = (resourceStore: ResourceStoreState): RuntimeCollectionStore => {
  const existing = resourceStore.modules.get(CollectionStoreTypeId);
  if (isRuntimeCollectionStore(existing)) {
    return existing;
  }

  const store = makeCollectionStore();
  resourceStore.modules.set(CollectionStoreTypeId, store);
  return store;
};

const resourceStoreEffect: Effect.Effect<ResourceStoreState> =
  Effect.gen(function* () {
    const store = yield* Effect.serviceOption(ResourceStore);
    return Option.isSome(store) ? store.value : currentOrDefaultRuntime().resourceStore;
  });

export const collectionStoreEffect: Effect.Effect<RuntimeCollectionStore> =
  Effect.map(resourceStoreEffect, storeFor);

export const currentCollectionStore = (): CollectionStore =>
  storeFor(currentOrDefaultRuntime().resourceStore);

export const subscribeCollectionEventsEffect = (): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope> =>
  Effect.flatMap(collectionStoreEffect, (store) => store.subscribeEventsEffect());

export const collectionInputEffect = <A, E, R>(
  input: EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  toEffect(input);

export const collectionInputCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.try({
    try: callback,
    catch: (error) => error as E
  }).pipe(Effect.flatMap(collectionInputEffect));

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

const validateCollectionOutputValuesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> =>
  decodeCollectionOutputValuesEffect(
    definition.options.output,
    values,
    "hydrate",
    `$.collections[${definition.name}].rows`
  );

const collectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
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

export const indexJoinKeys = <A extends object>(
  definition: AnyCollection,
  index: string,
  row: CollectionRow<A, any>
): ReadonlyArray<QueryJoinKey> =>
  collectionIndexJoinKeys(definition, index, row) as ReadonlyArray<QueryJoinKey>;

const collectionPendingMutations = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
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
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore),
  updatedAt = Date.now()
): CollectionSnapshot<A, K> =>
  snapshotCollectionWithStore(definition, store, updatedAt);

const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<CollectionSnapshot<A, K>> =>
  snapshotCollectionWithStoreEffect(definition, collectionStoreEffect);

const hydrateCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, CollectionSnapshotCodecError> =>
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
): Effect.Effect<void, PE | CollectionSnapshotCodecError, PR> =>
  persistCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, PE | CollectionSnapshotCodecError, PR> =>
  restoreCollectionWithStoreEffect(definition, storage, options, collectionStoreEffect, store);

const persistenceConfig = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): CollectionPersistenceConfig<E, R> | undefined =>
  collectionPersistenceConfig(definition);

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E | CollectionSnapshotCodecError, R> =>
  persistCollectionForReasonEffect(definition, store, collectionStoreEffect, reason);

const restoreBeforePreloadEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore
): Effect.Effect<boolean, CollectionRuntimeError<E>, R> =>
  restoreCollectionBeforePreloadWithStoreEffect(definition, state, store, collectionStoreEffect);

export const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
): CollectionHydrationPayload =>
  dehydrateCollectionsWithStore(collections, store);

export const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>
): Effect.Effect<CollectionHydrationPayload> =>
  dehydrateCollectionsWithStoreEffect(collections, collectionStoreEffect);

export const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {}
): Effect.Effect<void, CollectionSnapshotCodecError> =>
  hydrateCollectionsWithStoreEffect(collections, payload, options, collectionStoreEffect);

const changeFeedUnsubscribe = (
  subscription: CollectionChangeFeedSubscription
): CollectionChangeFeedUnsubscribe | undefined =>
  typeof subscription === "function"
    ? subscription
    : subscription?.unsubscribe;

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
  Effect.acquireRelease(
    collectionInputCallbackEffect(() => adapter.subscribe({
      collection: definition.name,
      emit: (changes, writeOptions) =>
        applyCollectionChangesEffect(definition, changes, writeOptions ?? options.write)
    })),
    (subscription) => {
      const unsubscribe = changeFeedUnsubscribe(subscription);
      return unsubscribe
        ? collectionInputCallbackEffect(() => unsubscribe())
        : Effect.void;
    }
  ).pipe(Effect.asVoid);

const withCollectionRetry = <A, E, R>(
  definition: CollectionDefinition<any, any, E, R>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const retry = definition.options.policy?.retry;
  return retry ? Effect.retry(effect, retry) : effect;
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

const mutationHandler = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  transaction: CollectionTransaction<A, K>
): Effect.Effect<void, E, R> =>
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
          inserts.push(mutation.value);
          break;
        case "Update":
          updates.push({
            key: mutation.key,
            previous: mutation.previous,
            value: mutation.value,
            changes: mutation.changes
          });
          break;
        case "Delete":
          deletes.push({ key: mutation.key, previous: mutation.previous });
          break;
      }
    }

    const context: CollectionMutationContext<A, K> = { transaction };
    if (inserts.length > 0 && definition.options.onInsert) {
      yield* collectionInputCallbackEffect(() => definition.options.onInsert!(inserts, context));
    }
    if (updates.length > 0 && definition.options.onUpdate) {
      yield* collectionInputCallbackEffect(() => definition.options.onUpdate!(updates, context));
    }
    if (deletes.length > 0 && definition.options.onDelete) {
      yield* collectionInputCallbackEffect(() => definition.options.onDelete!(deletes, context));
    }
  });

const runPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  dbStore: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  handler: Effect.Effect<void, E, R>
): Effect.Effect<CollectionTransaction<A, K>, E | CollectionSnapshotCodecError, R> =>
  Effect.gen(function* () {
    const mutation = recordPendingMutationAttempt(pending);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionMutateStarted",
      collection: definition.name,
      transaction: mutation.id,
      mutations: mutation.mutations.length
    });

    yield* withCollectionRetry(definition, handler).pipe(
      Effect.catch((error: E) =>
        Effect.gen(function* () {
          restoreStoredRows(state, pending.rollbackRows);
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
          return yield* Effect.fail(error);
        })
      )
    );
    markStoredRowsSynced(state, Array.from(pending.rollbackRows.keys()));
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
  });

const runMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  mutation: CollectionTransaction<A, K>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  handler: Effect.Effect<void, E, R>
): Effect.Effect<CollectionTransaction<A, K>, E | CollectionSnapshotCodecError, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const createdAt = yield* Clock.currentTimeMillis;
    const pending = enqueuePendingMutation(state, mutation, snapshots, createdAt);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionMutationQueued",
      collection: definition.name,
      transaction: mutation.id,
      mutations: mutation.mutations.length,
      pending: state.pendingMutations.size
    });
    yield* persistForReasonEffect(definition, dbStore, "mutation");
    return yield* runPendingMutation(definition, state, dbStore, pending, handler);
  });

const flushCollectionPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, E | CollectionSnapshotCodecError, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
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

const loadCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: { readonly force: boolean }
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const restored = yield* restoreBeforePreloadEffect(definition, state, dbStore).pipe(
      Effect.catch((error: CollectionRuntimeError<E>) => failCollectionLoadEffect(dbStore, definition, state, error))
    );
    const current = state.loadState.get();
    const shouldLoadAfterRestore =
      restored &&
      persistenceConfig(definition)?.loadAfterRestore === true &&
      definition.options.load !== undefined;

    if (!options.force && current._tag === "Ready" && !shouldLoadAfterRestore) {
      return;
    }

    if (!definition.options.load) {
      if (current._tag === "Initial") {
        const updatedAt = yield* Clock.currentTimeMillis;
        state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
      }
      return;
    }

    state.loadState.set({ _tag: "Pending", waiting: true });
    const load = collectionInputCallbackEffect(() => definition.options.load!());
    const values = yield* withCollectionRetry(definition, load).pipe(
      Effect.catch((error: E) => failCollectionLoadEffect(dbStore, definition, state, error))
    );
    const decodedValues = yield* validateCollectionOutputValuesEffect(definition, values).pipe(
      Effect.catch((error) => failCollectionLoadEffect(dbStore, definition, state, error))
    );
    const updatedAt = yield* Clock.currentTimeMillis;
    replaceCollectionRows(definition, state, decodedValues);
    state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionLoaded",
      collection: definition.name,
      count: decodedValues.length,
      updatedAt
    });
    yield* persistForReasonEffect(definition, dbStore, "load");
  });

const writeRows = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  input: A | ReadonlyArray<A>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const values = yield* validateCollectionOutputValuesEffect(definition, toArray(input));
    for (const value of values) {
      const key = definition.getKey(value);
      state.rows.set(key, {
        key,
        value,
        synced: options.synced ?? true,
        origin: options.origin ?? "remote"
      });
    }
    bumpCollectionState(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionWritten",
      collection: definition.name,
      mutations: values.length
    });
    yield* persistForReasonEffect(definition, dbStore, "write");
  });

const writeUpdateRow = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
  changes: Partial<A>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E> | CollectionRowNotFound, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const row = state.rows.get(key);
    if (!row) {
      return yield* new CollectionRowNotFound({ collection: definition.name, key });
    }

    const values = yield* validateCollectionOutputValuesEffect(definition, [{ ...row.value, ...changes }]);
    const value = values[0] as A;
    row.value = value;
    row.synced = options.synced ?? true;
    row.origin = options.origin ?? "remote";
    bumpCollectionState(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionWritten",
      collection: definition.name,
      mutations: 1
    });
    yield* persistForReasonEffect(definition, dbStore, "write");
  });

const writeDeleteRow = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K
): Effect.Effect<void, E | CollectionSnapshotCodecError, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    state.rows.delete(key);
    bumpCollectionState(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionWritten",
      collection: definition.name,
      mutations: 1
    });
    yield* persistForReasonEffect(definition, dbStore, "write");
  });

export const applyCollectionChangesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, CollectionRuntimeError<E>, R> =>
  Effect.gen(function* () {
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

    if (upserts.length > 0) {
      yield* writeRows(definition, upserts, options);
    }

    for (const key of deletes) {
      yield* writeDeleteRow(definition, key);
    }
  });

export const defineCollection = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: Omit<CollectionOptions<A, K, E, R>, "load"> & {
    readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
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
        const state = collectionState(definition, dbStore);
        const values = yield* validateCollectionOutputValuesEffect(definition, toArray(input));
        const snapshots = new Map<K, StoredRow<A, K> | undefined>();
        const mutations: Array<CollectionMutation<A, K>> = [];

        for (const value of values) {
          const key = definition.getKey(value);
          const previous = state.rows.get(key);
          snapshots.set(key, previous ? cloneStoredRow(previous) : undefined);
          state.rows.set(key, { key, value, synced: false, origin: "local" });
          mutations.push(previous ? { _tag: "Insert", key, value, previous: previous.value } : { _tag: "Insert", key, value });
        }
        bumpCollectionState(state);

        const tx = createCollectionTransaction(state, definition.name, mutations);
        const handler = definition.options.onInsert
          ? collectionInputCallbackEffect(() => definition.options.onInsert!(values, { transaction: tx }))
          : Effect.succeed(undefined);
        return yield* runMutation(definition, tx, snapshots, handler);
      }),
    updateEffect: (key: K, update: CollectionUpdate<A>) =>
      Effect.gen(function* () {
        const dbStore = yield* collectionStoreEffect;
        const state = collectionState(definition, dbStore);
        const row = state.rows.get(key);
        if (!row) {
          return yield* new CollectionRowNotFound({ collection: definition.name, key });
        }

        const previous = cloneStoredRow(row);
        const updated = applyCollectionUpdate(row.value, update);
        const decodedValues = yield* validateCollectionOutputValuesEffect(definition, [updated.value]);
        const decodedValue = decodedValues[0] as A;
        row.value = decodedValue;
        row.synced = false;
        row.origin = "local";
        bumpCollectionState(state);

        const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
        const tx = createCollectionTransaction(state, definition.name, [{
          _tag: "Update",
          key,
          previous: previous.value,
          value: decodedValue,
          changes: updated.changes
        }]);
        const handler = definition.options.onUpdate
          ? collectionInputCallbackEffect(() => definition.options.onUpdate!([{
              key,
              previous: previous.value,
              value: decodedValue,
              changes: updated.changes
            }], { transaction: tx }))
          : Effect.succeed(undefined);
        return yield* runMutation(definition, tx, snapshots, handler);
      }),
    deleteEffect: (key: K) =>
      Effect.gen(function* () {
        const dbStore = yield* collectionStoreEffect;
        const state = collectionState(definition, dbStore);
        const row = state.rows.get(key);
        if (!row) {
          return yield* new CollectionRowNotFound({ collection: definition.name, key });
        }

        const previous = cloneStoredRow(row);
        state.rows.delete(key);
        bumpCollectionState(state);

        const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
        const tx = createCollectionTransaction(state, definition.name, [{
          _tag: "Delete",
          key,
          previous: previous.value
        }]);
        const handler = definition.options.onDelete
          ? collectionInputCallbackEffect(() => definition.options.onDelete!([{ key, previous: previous.value }], { transaction: tx }))
          : Effect.succeed(undefined);
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
