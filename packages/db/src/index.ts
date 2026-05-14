import {
  currentOrDefaultRuntime,
  ResourceStore,
  Signal,
  stableStringify,
  type ReadableSignal,
  type ResourceStore as ResourceStoreState,
  type WritableSignal,
  runPromise
} from "@effect-ui/core";
import {
  D2,
  MultiSet,
  filter as ivmFilter,
  groupBy as ivmGroupBy,
  innerJoin as ivmInnerJoin,
  map as ivmMap,
  orderByWithFractionalIndex as ivmOrderByWithFractionalIndex,
  output as ivmOutput,
  type IOperator,
  type IStreamBuilder,
  type KeyValue,
  type PipedOperator,
  type RootStreamBuilder
} from "@tanstack/db-ivm";
import { Clock, Context, Data, Effect, Option, PubSub, Scope, type Schedule } from "effect";
import type { EffectInput } from "@effect-ui/core";
import { toEffect } from "@effect-ui/core";
import {
  backgroundSyncCollectionsPendingMutations,
  backgroundSyncCollectionsPendingMutationsEffect,
  flushCollectionsPendingMutations,
  flushCollectionsPendingMutationsEffect,
  type CollectionBackgroundSyncAdapter,
  type CollectionBackgroundSyncAdapterContext,
  type CollectionBackgroundSyncOptions,
  type CollectionBackgroundSyncPending,
  type CollectionBackgroundSyncResult,
  type CollectionBackgroundSyncTrigger,
  type FlushCollectionPendingMutationsContext,
  type FlushCollectionPendingMutationsResult,
  type FlushCollectionPendingMutationsSkip,
  type FlushCollectionsPendingMutationsOptions
} from "./flush-policy.js";
import {
  makeSQLiteMemoryStatementDatabase,
  makeSQLitePreparedStatementDatabase,
  makeSQLitePersistenceStorage,
  makeSQLiteStatementPersistenceDriver,
  type SQLiteMemoryStatement as SQLitePersistenceMemoryStatement,
  type SQLiteMemoryStatementDatabase as SQLitePersistenceMemoryStatementDatabase,
  type SQLitePreparedStatement as SQLitePersistencePreparedStatement,
  type SQLitePreparedStatementDatabase as SQLitePersistencePreparedStatementDatabase,
  type SQLitePreparedStatementDatabaseOptions as SQLitePersistencePreparedStatementDatabaseOptions,
  type SQLitePersistenceDriver,
  type SQLitePersistenceKey,
  type SQLitePersistenceOptions,
  type SQLitePersistenceRow,
  type SQLitePersistenceTable
} from "./sqlite-persistence.js";
import {
  serverCollectionOptions,
  serverCollectionSyncAdapter,
  type ServerCollectionDeletePayload,
  type ServerCollectionInsertPayload,
  type ServerCollectionOperation,
  type ServerCollectionOptions,
  type ServerCollectionResult,
  type ServerCollectionUpdatePayload
} from "./server-collection.js";
import {
  collectionQuerySyncAdapter,
  collectionResourceSyncAdapter,
  collectionSyncOptions,
  type CollectionQuerySyncAdapterOptions,
  type CollectionQuerySyncClient,
  type CollectionQuerySyncFetchOptions,
  type CollectionQuerySyncInvalidateOptions,
  type CollectionQuerySyncKey,
  type CollectionChangeFeedAdapter,
  type CollectionChangeFeedContext,
  type CollectionChangeFeedSubscribeOptions,
  type CollectionChangeFeedSubscription,
  type CollectionChangeFeedUnsubscribe,
  type CollectionSyncAdapter,
  type CollectionSyncDeletePayload,
  type CollectionSyncInsertPayload,
  type CollectionSyncOptions,
  type CollectionResourceSyncAdapterOptions,
  type CollectionSyncUpdatePayload
} from "./sync-adapter.js";

export const CollectionTypeId: unique symbol = Symbol.for("@effect-ui/db/Collection") as typeof CollectionTypeId;
export const CollectionStoreTypeId: unique symbol = Symbol.for("@effect-ui/db/CollectionStore") as typeof CollectionStoreTypeId;

export type CollectionKey = string | number;
export type CollectionOrigin = "local" | "remote";

export type CollectionRow<A extends object, K extends CollectionKey = CollectionKey> = A & {
  readonly $key: K;
  readonly $collection: string;
  readonly $synced: boolean;
  readonly $origin: CollectionOrigin;
};

export type CollectionLoadState<E = unknown> =
  | { readonly _tag: "Initial"; readonly waiting: false }
  | { readonly _tag: "Pending"; readonly waiting: true }
  | { readonly _tag: "Ready"; readonly waiting: false; readonly updatedAt: number }
  | { readonly _tag: "Failure"; readonly waiting: false; readonly error: E };

export type CollectionMutation<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Insert"; readonly key: K; readonly value: A; readonly previous?: A }
  | { readonly _tag: "Update"; readonly key: K; readonly previous: A; readonly value: A; readonly changes: Partial<A> }
  | { readonly _tag: "Delete"; readonly key: K; readonly previous: A };

export interface CollectionTransaction<A extends object, K extends CollectionKey> {
  readonly id: string;
  readonly collection: string;
  readonly mutations: ReadonlyArray<CollectionMutation<A, K>>;
}

export interface CollectionRollbackRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  readonly row?: CollectionRowSnapshot<A, K>;
}

export interface CollectionPendingMutation<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
  readonly rollbackRows: ReadonlyArray<CollectionRollbackRow<A, K>>;
  readonly createdAt: number;
  readonly attempts: number;
}

export interface CollectionMutationContext<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
}

export interface CollectionPolicy<E = unknown> {
  readonly retry?: Schedule.Schedule<unknown, E>;
}

export interface CollectionSyncDiagnostics {
  readonly adapter: string;
}

export type CollectionIndexValue = string | number | boolean | Date | null | undefined;
export type CollectionIndexResult = CollectionIndexValue | ReadonlyArray<CollectionIndexValue>;

export interface CollectionIndexDefinition<A extends object> {
  readonly key: (value: A) => CollectionIndexResult;
  readonly unique?: boolean;
}

export type CollectionIndexInput<A extends object> =
  | ((value: A) => CollectionIndexResult)
  | CollectionIndexDefinition<A>;

export type CollectionIndexRecord<A extends object> = Record<string, CollectionIndexInput<A>>;

export interface CollectionOptions<A extends object, K extends CollectionKey, E = unknown, R = never> {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly policy?: CollectionPolicy<E>;
  readonly persistence?: CollectionPersistenceConfig<E, R>;
  readonly sync?: CollectionSyncDiagnostics;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly getKey: (value: A) => K;
  readonly initialData?: ReadonlyArray<A>;
  readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly onInsert?: (
    input: ReadonlyArray<A>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
  readonly onUpdate?: (
    input: ReadonlyArray<{ readonly key: K; readonly value: A; readonly previous: A; readonly changes: Partial<A> }>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
  readonly onDelete?: (
    input: ReadonlyArray<{ readonly key: K; readonly previous: A }>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
}

export interface CollectionDefinition<A extends object, K extends CollectionKey = string, E = unknown, R = never> {
  readonly [CollectionTypeId]: typeof CollectionTypeId;
  readonly options: CollectionOptions<A, K, E, R>;
  readonly name: string;
  getKey(value: A): K;
  state(): ReadableSignal<CollectionLoadState<E>>;
  version(): ReadableSignal<number>;
  get(key: K): CollectionRow<A, K> | undefined;
  rows(): ReadonlyArray<CollectionRow<A, K>>;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  preloadEffect(): Effect.Effect<void, E, R>;
  preload(): Promise<void>;
  refetchEffect(): Effect.Effect<void, E, R>;
  refetch(): Promise<void>;
  pendingMutationsEffect(): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>>;
  pendingMutations(): ReadonlyArray<CollectionPendingMutation<A, K>>;
  flushPendingMutationsEffect(): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, E, R>;
  flushPendingMutations(): Promise<ReadonlyArray<CollectionTransaction<A, K>>>;
  snapshotEffect(): Effect.Effect<CollectionSnapshot<A, K>>;
  snapshot(): CollectionSnapshot<A, K>;
  hydrateEffect(snapshot: CollectionSnapshot<A, K>, options?: CollectionHydrateOptions): Effect.Effect<void>;
  hydrate(snapshot: CollectionSnapshot<A, K>, options?: CollectionHydrateOptions): void;
  persistEffect<PE = unknown, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions
  ): Effect.Effect<void, PE, PR>;
  persist<PE = unknown, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions
  ): Promise<void>;
  restoreEffect<PE = unknown, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions
  ): Effect.Effect<void, PE, PR>;
  restore<PE = unknown, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions
  ): Promise<void>;
  insertEffect(input: A | ReadonlyArray<A>): Effect.Effect<CollectionTransaction<A, K>, E, R>;
  insert(input: A | ReadonlyArray<A>): Promise<CollectionTransaction<A, K>>;
  updateEffect(key: K, update: CollectionUpdate<A>): Effect.Effect<CollectionTransaction<A, K>, E | CollectionRowNotFound, R>;
  update(key: K, update: CollectionUpdate<A>): Promise<CollectionTransaction<A, K>>;
  deleteEffect(key: K): Effect.Effect<CollectionTransaction<A, K>, E | CollectionRowNotFound, R>;
  delete(key: K): Promise<CollectionTransaction<A, K>>;
  writeInsertEffect(input: A | ReadonlyArray<A>, options?: CollectionWriteOptions): Effect.Effect<void, E, R>;
  writeInsert(input: A | ReadonlyArray<A>, options?: CollectionWriteOptions): void;
  writeUpdateEffect(key: K, changes: Partial<A>, options?: CollectionWriteOptions): Effect.Effect<void, E | CollectionRowNotFound, R>;
  writeUpdate(key: K, changes: Partial<A>, options?: CollectionWriteOptions): void;
  writeDeleteEffect(key: K): Effect.Effect<void, E, R>;
  writeDelete(key: K): void;
}

export type AnyCollection = CollectionDefinition<any, any, any, any>;
export type CollectionValue<C> = C extends CollectionDefinition<infer A, infer _K, infer _E, infer _R> ? A : never;
export type CollectionRowValue<C> = C extends CollectionDefinition<infer A, infer K, infer _E, infer _R> ? CollectionRow<A, K> : never;
export type CollectionError<C> = C extends CollectionDefinition<infer _A, infer _K, infer E, infer _R> ? E : never;
export type CollectionRequirements<C> = C extends CollectionDefinition<infer _A, infer _K, infer _E, infer R> ? R : never;

const collectionDefinitions = new Map<string, AnyCollection>();

export interface CollectionPreloadCollector {
  readonly definitions: Map<string, AnyCollection>;
}

export const CollectionPreloadCollector = Context.Service<CollectionPreloadCollector>(
  "@effect-ui/db/CollectionPreloadCollector"
);

export interface CollectionPreloadCollected<A> {
  readonly value: A;
  readonly definitions: ReadonlyArray<AnyCollection>;
}

export type CollectionUpdate<A extends object> = Partial<A> | ((draft: A) => A | void);

export interface CollectionWriteOptions {
  readonly origin?: CollectionOrigin;
  readonly synced?: boolean;
}

export type CollectionChange<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Upsert"; readonly value: A }
  | { readonly _tag: "Delete"; readonly key: K };

export interface CollectionRowSnapshot<A extends object, K extends CollectionKey> {
  readonly key: K;
  readonly value: A;
  readonly synced: boolean;
  readonly origin: CollectionOrigin;
}

export interface CollectionSnapshot<A extends object = object, K extends CollectionKey = CollectionKey> {
  readonly name: string;
  readonly rows: ReadonlyArray<CollectionRowSnapshot<A, K>>;
  readonly pendingMutations: ReadonlyArray<CollectionPendingMutation<A, K>>;
  readonly updatedAt: number;
}

export interface CollectionHydrationPayload {
  readonly collections: ReadonlyArray<CollectionSnapshot<any, any>>;
}

export interface CollectionHydrateOptions {
  readonly replace?: boolean;
}

export interface CollectionPersistenceStorage<E = unknown, R = never> {
  readonly getItem: (key: string) => EffectInput<string | null, E, R>;
  readonly setItem: (key: string, value: string) => EffectInput<void, E, R>;
  readonly removeItem?: (key: string) => EffectInput<void, E, R>;
}

export interface CollectionPersistOptions {
  readonly key?: string;
}

export interface CollectionPersistenceConfig<E = unknown, R = never> extends CollectionPersistOptions {
  readonly storage: CollectionPersistenceStorage<E, R>;
  readonly hydrate?: CollectionHydrateOptions;
  readonly restoreOnPreload?: boolean;
  readonly loadAfterRestore?: boolean;
  readonly persistOnLoad?: boolean;
  readonly persistOnMutation?: boolean;
  readonly persistOnWrite?: boolean;
}

export type CollectionPersistedOptions<
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never,
  PE = unknown,
  PR = never
> = Omit<CollectionOptions<A, K, E, R>, "persistence"> & {
  readonly persistence: CollectionPersistenceConfig<PE, PR>;
};

export interface CollectionLiveQueryOptions<A extends object, K extends CollectionKey, E = unknown, R = never> {
  readonly name: string;
  readonly getKey: (value: A) => K;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly query: LiveQuery<A, E, R> | QueryFactory<A>;
}

export interface CollectionStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem?: (key: string) => void;
}

export interface CollectionMemoryStorage extends CollectionPersistenceStorage<never, never> {
  readonly values: ReadonlyMap<string, string>;
  clear(): void;
}

export interface CollectionDefinitionDiagnostics {
  readonly name: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly initialData: boolean;
  readonly indexes: readonly {
    readonly name: string;
    readonly unique: boolean;
  }[];
  readonly load: boolean;
  readonly handlers: {
    readonly insert: boolean;
    readonly update: boolean;
    readonly delete: boolean;
  };
  readonly policy: {
    readonly retry: boolean;
  };
  readonly sync?: CollectionSyncDiagnostics;
  readonly persistence: {
    readonly enabled: boolean;
    readonly key?: string;
    readonly hydrate: boolean;
    readonly restoreOnPreload: boolean;
    readonly loadAfterRestore: boolean;
    readonly persistOnLoad: boolean;
    readonly persistOnMutation: boolean;
    readonly persistOnWrite: boolean;
  };
}

export interface CollectionDiagnostics {
  readonly collections: readonly CollectionDefinitionDiagnostics[];
}

export type CollectionStoreEvent =
  | { readonly _tag: "CollectionLoaded"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  | { readonly _tag: "CollectionLoadFailure"; readonly collection: string; readonly error: unknown }
  | { readonly _tag: "CollectionHydrated"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  | { readonly _tag: "CollectionPersisted"; readonly collection: string; readonly key: string; readonly count: number }
  | { readonly _tag: "CollectionRestored"; readonly collection: string; readonly key: string; readonly count: number }
  | { readonly _tag: "CollectionMutationQueued"; readonly collection: string; readonly transaction: string; readonly mutations: number; readonly pending: number }
  | { readonly _tag: "CollectionMutateStarted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  | { readonly _tag: "CollectionMutationDequeued"; readonly collection: string; readonly transaction: string; readonly pending: number }
  | { readonly _tag: "CollectionMutateCommitted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  | { readonly _tag: "CollectionMutateRolledBack"; readonly collection: string; readonly transaction: string; readonly error: unknown }
  | { readonly _tag: "CollectionWritten"; readonly collection: string; readonly mutations: number };

export class CollectionRowNotFound extends Data.TaggedError("CollectionRowNotFound")<{
  readonly collection: string;
  readonly key: CollectionKey;
}> {}

export class ReadonlyCollectionMutation extends Data.TaggedError("ReadonlyCollectionMutation")<{
  readonly collection: string;
  readonly operation: string;
}> {}

export class UnknownCollectionIndex extends Data.TaggedError("UnknownCollectionIndex")<{
  readonly collection: string;
  readonly index: string;
}> {}

export class UnsupportedLiveQuery extends Data.TaggedError("UnsupportedLiveQuery")<{
  readonly reason: string;
}> {}

interface StoredRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  value: A;
  synced: boolean;
  origin: CollectionOrigin;
}

interface PendingMutationEntry<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
  readonly rollbackRows: ReadonlyMap<K, StoredRow<A, K> | undefined>;
  readonly createdAt: number;
  attempts: number;
}

interface CollectionIndexCacheEntry<A extends object, K extends CollectionKey> {
  readonly version: number;
  readonly buckets: ReadonlyMap<string, ReadonlyArray<StoredRow<A, K>>>;
}

interface CollectionState<A extends object, K extends CollectionKey, E> {
  readonly rows: Map<K, StoredRow<A, K>>;
  readonly pendingMutations: Map<string, PendingMutationEntry<A, K>>;
  readonly indexCache: Map<string, CollectionIndexCacheEntry<A, K>>;
  readonly version: WritableSignal<number>;
  readonly loadState: WritableSignal<CollectionLoadState<E>>;
  initialized: boolean;
  persistenceRestored: boolean;
}

export interface CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId;
  readonly disposeEffect: Effect.Effect<void>;
  subscribeEventsEffect(): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope>;
}

let nextTransactionId = 0;

class RuntimeCollectionStore implements CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId = CollectionStoreTypeId;
  readonly #states = new WeakMap<object, CollectionState<any, CollectionKey, any>>();
  readonly #events = Effect.runSync(PubSub.sliding<CollectionStoreEvent>(1024));
  readonly disposeEffect = PubSub.shutdown(this.#events);

  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionState<A, K, E> {
    const existing = this.#states.get(definition);
    if (existing) {
      return existing as CollectionState<A, K, E>;
    }

    const state: CollectionState<A, K, E> = {
      rows: new Map(),
      pendingMutations: new Map(),
      indexCache: new Map(),
      version: Signal.make(0),
      loadState: Signal.make<CollectionLoadState<E>>({ _tag: "Initial", waiting: false }),
      initialized: false,
      persistenceRestored: false
    };
    this.#states.set(definition, state as CollectionState<any, CollectionKey, any>);
    initializeCollection(definition, state);
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

const storeFor = (resourceStore: ResourceStoreState): RuntimeCollectionStore => {
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

const collectionStoreEffect: Effect.Effect<RuntimeCollectionStore> =
  Effect.map(resourceStoreEffect, storeFor);

const collectionInputEffect = <A, E, R>(
  input: EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  toEffect(input);

const recordCollectionPreload = (
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

const bump = (state: CollectionState<any, any, any>): void => {
  state.indexCache.clear();
  state.version.update((value) => value + 1);
};

const toArray = <A>(input: A | ReadonlyArray<A>): ReadonlyArray<A> =>
  Array.isArray(input) ? input as ReadonlyArray<A> : [input as A];

const collectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
): CollectionState<A, K, E> => {
  return store.state(definition);
};

const initializeCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>
): void => {
  if (state.initialized) {
    return;
  }

  state.initialized = true;
  const initialData = definition.options.initialData ?? [];
  if (initialData.length === 0) {
    return;
  }

  for (const value of initialData) {
    const key = definition.getKey(value);
    state.rows.set(key, {
      key,
      value,
      synced: true,
      origin: "remote"
    });
  }
  state.loadState.set({ _tag: "Ready", waiting: false, updatedAt: Date.now() });
  bump(state);
};

const augmentRow = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  row: StoredRow<A, K>
): CollectionRow<A, K> =>
  Object.assign({}, row.value, {
    $key: row.key,
    $collection: definition.name,
    $synced: row.synced,
    $origin: row.origin
  }) as CollectionRow<A, K>;

const collectionIndexKey = (value: CollectionIndexValue): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

const normalizeCollectionIndex = <A extends object>(
  index: CollectionIndexInput<A>
): CollectionIndexDefinition<A> =>
  typeof index === "function" ? { key: index } : index;

const isCollectionIndexValueArray = (
  value: CollectionIndexResult
): value is ReadonlyArray<CollectionIndexValue> =>
  Array.isArray(value);

const collectionIndexes = <A extends object>(
  options: { readonly indexes?: CollectionIndexRecord<A> }
): ReadonlyMap<string, CollectionIndexDefinition<A>> =>
  new Map(
    Object.entries(options.indexes ?? {}).map(([name, index]) => [
      name,
      normalizeCollectionIndex(index as CollectionIndexInput<A>)
    ])
  );

const collectionIndex = <A extends object>(
  definition: CollectionDefinition<A, any, any, any>,
  name: string
): CollectionIndexDefinition<A> => {
  const index = collectionIndexes(definition.options).get(name);
  if (!index) {
    throw new UnknownCollectionIndex({ collection: definition.name, index: name });
  }
  return index;
};

const collectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A
): ReadonlyArray<CollectionIndexValue> => {
  const result = index.key(value);
  return isCollectionIndexValueArray(result) ? result : [result];
};

const uniqueCollectionIndexValues = <A extends object>(
  index: CollectionIndexDefinition<A>,
  value: A
): ReadonlyArray<CollectionIndexValue> => {
  const values: Array<CollectionIndexValue> = [];
  const seen = new Set<string>();
  for (const candidate of collectionIndexValues(index, value)) {
    const key = collectionIndexKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(candidate);
    }
  }
  return values;
};

const rowsMatchingIndex = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  rows: ReadonlyArray<CollectionRow<A, K>>,
  index: string,
  value: CollectionIndexValue
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const key = collectionIndexKey(value);
  return rows.filter((row) =>
    collectionIndexValues(definitionIndex, row).some((candidate) =>
      collectionIndexKey(candidate) === key
    )
  );
};

const buildCollectionIndexCache = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  version: number,
  index: CollectionIndexDefinition<A>
): CollectionIndexCacheEntry<A, K> => {
  const buckets = new Map<string, Array<StoredRow<A, K>>>();
  for (const row of state.rows.values()) {
    for (const value of uniqueCollectionIndexValues(index, row.value)) {
      const key = collectionIndexKey(value);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(key, [row]);
      }
    }
  }

  return {
    version,
    buckets
  };
};

const rowsByIndex = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  index: string,
  value: CollectionIndexValue
): ReadonlyArray<CollectionRow<A, K>> => {
  const definitionIndex = collectionIndex(definition, index);
  const state = collectionState(definition);
  const version = state.version.get();
  let cache = state.indexCache.get(index);
  if (!cache || cache.version !== version) {
    cache = buildCollectionIndexCache(state, version, definitionIndex);
    state.indexCache.set(index, cache);
  }

  return (cache.buckets.get(collectionIndexKey(value)) ?? [])
    .map((row) => augmentRow(definition, row));
};

const indexJoinKeys = <A extends object>(
  definition: CollectionDefinition<A, any, any, any>,
  index: string,
  row: CollectionRow<A, any>
): ReadonlyArray<QueryJoinKey> =>
  uniqueCollectionIndexValues(collectionIndex(definition, index), row) as ReadonlyArray<QueryJoinKey>;

const replaceRows = <A extends object, K extends CollectionKey>(
  definition: CollectionDefinition<A, K, any, any>,
  state: CollectionState<A, K, any>,
  values: ReadonlyArray<A>
): void => {
  const pending = Array.from(state.rows.values()).filter((row) => !row.synced);
  state.rows.clear();

  for (const value of values) {
    const key = definition.getKey(value);
    state.rows.set(key, {
      key,
      value,
      synced: true,
      origin: "remote"
    });
  }

  for (const row of pending) {
    state.rows.set(row.key, row);
  }

  bump(state);
};

const rowSnapshot = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>
): CollectionRowSnapshot<A, K> => ({
  key: row.key,
  value: row.value,
  synced: row.synced,
  origin: row.origin
});

const rowFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionRowSnapshot<A, K>
): StoredRow<A, K> => ({
  key: snapshot.key,
  value: snapshot.value,
  synced: snapshot.synced,
  origin: snapshot.origin
});

const rollbackRowSnapshot = <A extends object, K extends CollectionKey>(
  key: K,
  row: StoredRow<A, K> | undefined
): CollectionRollbackRow<A, K> =>
  row
    ? { key, row: rowSnapshot(row) }
    : { key };

const pendingMutationSnapshot = <A extends object, K extends CollectionKey>(
  entry: PendingMutationEntry<A, K>
): CollectionPendingMutation<A, K> => ({
  transaction: entry.transaction,
  rollbackRows: Array.from(entry.rollbackRows, ([key, row]) => rollbackRowSnapshot(key, row)),
  createdAt: entry.createdAt,
  attempts: entry.attempts
});

const pendingEntryFromSnapshot = <A extends object, K extends CollectionKey>(
  snapshot: CollectionPendingMutation<A, K>
): PendingMutationEntry<A, K> => ({
  transaction: snapshot.transaction,
  rollbackRows: new Map(snapshot.rollbackRows.map((rollback) => [
    rollback.key,
    rollback.row ? rowFromSnapshot(rollback.row) : undefined
  ])),
  createdAt: snapshot.createdAt,
  attempts: snapshot.attempts
});

const collectionPendingMutations = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
): ReadonlyArray<CollectionPendingMutation<A, K>> => {
  const state = collectionState(definition, store);
  state.version.get();
  return Array.from(state.pendingMutations.values(), pendingMutationSnapshot);
};

const collectionPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>> =>
  Effect.map(collectionStoreEffect, (store) => collectionPendingMutations(definition, store));

const snapshotCollection = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore),
  updatedAt = Date.now()
): CollectionSnapshot<A, K> => {
  const state = collectionState(definition, store);
  state.version.get();
  return {
    name: definition.name,
    rows: Array.from(state.rows.values(), rowSnapshot),
    pendingMutations: Array.from(state.pendingMutations.values(), pendingMutationSnapshot),
    updatedAt
  };
};

const snapshotCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): Effect.Effect<CollectionSnapshot<A, K>> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    return snapshotCollection(definition, store, updatedAt);
  });

const hydrateCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  snapshot: CollectionSnapshot<A, K>,
  options: CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* collectionStoreEffect);
    const state = collectionState(definition, dbStore);
    if (options.replace !== false) {
      state.rows.clear();
      state.pendingMutations.clear();
    }

    for (const row of snapshot.rows) {
      state.rows.set(row.key, rowFromSnapshot(row));
    }

    for (const pending of snapshot.pendingMutations ?? []) {
      state.pendingMutations.set(pending.transaction.id, pendingEntryFromSnapshot(pending));
    }

    state.loadState.set({
      _tag: "Ready",
      waiting: false,
      updatedAt: snapshot.updatedAt
    });
    bump(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionHydrated",
      collection: definition.name,
      count: snapshot.rows.length,
      updatedAt: snapshot.updatedAt
    });
  });

const persistenceKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: CollectionPersistOptions = {}
): string => options.key ?? `effect-ui:collection:${definition.name}`;

const persistCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, PE, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* collectionStoreEffect);
    const key = persistenceKey(definition, options);
    const updatedAt = yield* Clock.currentTimeMillis;
    const snapshot = snapshotCollection(definition, dbStore, updatedAt);
    yield* collectionInputEffect(storage.setItem(key, JSON.stringify(snapshot)));
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionPersisted",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
  });

const restoreCollectionEffect = <A extends object, K extends CollectionKey, E, R, PE, PR>(
  definition: CollectionDefinition<A, K, E, R>,
  storage: CollectionPersistenceStorage<PE, PR>,
  options: CollectionPersistOptions & CollectionHydrateOptions = {},
  store?: RuntimeCollectionStore
): Effect.Effect<void, PE, PR> =>
  Effect.gen(function* () {
    const dbStore = store ?? (yield* collectionStoreEffect);
    const key = persistenceKey(definition, options);
    const encoded = yield* collectionInputEffect(storage.getItem(key));
    if (encoded === null) {
      return;
    }

    const snapshot = JSON.parse(encoded) as CollectionSnapshot<A, K>;
    yield* hydrateCollectionEffect(definition, snapshot, options, dbStore);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionRestored",
      collection: definition.name,
      key,
      count: snapshot.rows.length
    });
  });

const persistenceConfig = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>
): CollectionPersistenceConfig<E, R> | undefined =>
  definition.options.persistence;

const persistencePersistOptions = <E, R>(
  config: CollectionPersistenceConfig<E, R>
): CollectionPersistOptions => ({
  ...(config.key === undefined ? {} : { key: config.key })
});

const persistenceRestoreOptions = <E, R>(
  config: CollectionPersistenceConfig<E, R>
): CollectionPersistOptions & CollectionHydrateOptions => ({
  ...persistencePersistOptions(config),
  ...(config.hydrate ?? {})
});

const persistForReasonEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
  reason: "load" | "mutation" | "write"
): Effect.Effect<void, E, R> => {
  const config = persistenceConfig(definition);
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
    persistencePersistOptions(config),
    store
  );
};

const restoreBeforePreloadEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  store: RuntimeCollectionStore
): Effect.Effect<boolean, E, R> =>
  Effect.gen(function* () {
    const config = persistenceConfig(definition);
    if (!config || config.restoreOnPreload === false || state.persistenceRestored) {
      return false;
    }

    const before = state.loadState.get()._tag;
    yield* restoreCollectionEffect(
      definition,
      config.storage,
      persistenceRestoreOptions(config),
      store
    );
    state.persistenceRestored = true;
    return before !== "Ready" && state.loadState.get()._tag === "Ready";
  });

const dehydrateCollections = (
  collections: Iterable<AnyCollection>,
  store: RuntimeCollectionStore = storeFor(currentOrDefaultRuntime().resourceStore)
): CollectionHydrationPayload => ({
  collections: Array.from(collections, (collection) => snapshotCollection(collection, store))
});

const dehydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>
): Effect.Effect<CollectionHydrationPayload> =>
  Effect.gen(function* () {
    const store = yield* collectionStoreEffect;
    const updatedAt = yield* Clock.currentTimeMillis;
    return {
      collections: Array.from(collections, (collection) => snapshotCollection(collection, store, updatedAt))
    };
  });

const hydrateCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  payload: CollectionHydrationPayload,
  options: CollectionHydrateOptions = {}
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const definitions = new Map(Array.from(collections, (collection) => [collection.name, collection] as const));
    for (const snapshot of payload.collections) {
      const collection = definitions.get(snapshot.name);
      if (collection) {
        yield* hydrateCollectionEffect(collection, snapshot, options, dbStore);
      }
    }
  });

const changeFeedUnsubscribe = (
  subscription: CollectionChangeFeedSubscription
): CollectionChangeFeedUnsubscribe | undefined =>
  typeof subscription === "function"
    ? subscription
    : subscription?.unsubscribe;

const subscribeCollectionChangesEffect = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError = never,
  FeedRequirements = never
>(
  definition: CollectionDefinition<A, K, E, R>,
  adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements>,
  options: CollectionChangeFeedSubscribeOptions = {}
): Effect.Effect<void, E | FeedError, R | FeedRequirements | Scope.Scope> =>
  Effect.acquireRelease(
    toEffect(adapter.subscribe({
      collection: definition.name,
      emit: (changes, writeOptions) =>
        applyCollectionChangesEffect(definition, changes, writeOptions ?? options.write)
    })),
    (subscription) => {
      const unsubscribe = changeFeedUnsubscribe(subscription);
      return unsubscribe
        ? toEffect(unsubscribe())
        : Effect.void;
    }
  ).pipe(Effect.asVoid);

const makeMemoryStorage = (initial?: Iterable<readonly [string, string]>): CollectionMemoryStorage => {
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

const fromStorage = (storage: CollectionStorageLike): CollectionPersistenceStorage<never, never> => {
  const removeItem = storage.removeItem;
  return {
    getItem: (key) => Effect.sync(() => storage.getItem(key)),
    setItem: (key, value) => Effect.sync(() => storage.setItem(key, value)),
    ...(removeItem
      ? { removeItem: (key: string) => Effect.sync(() => removeItem(key)) }
      : {})
  };
};

const cloneRow = <A extends object, K extends CollectionKey>(
  row: StoredRow<A, K>
): StoredRow<A, K> => ({
  key: row.key,
  value: row.value,
  synced: row.synced,
  origin: row.origin
});

const restoreRows = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>
): void => {
  for (const [key, row] of snapshots) {
    if (row) {
      state.rows.set(key, cloneRow(row));
    } else {
      state.rows.delete(key);
    }
  }
  bump(state);
};

const enqueuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  mutation: CollectionTransaction<A, K>,
  rollbackRows: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  createdAt: number
): PendingMutationEntry<A, K> => {
  const existing = state.pendingMutations.get(mutation.id);
  if (existing) {
    return existing;
  }

  const entry: PendingMutationEntry<A, K> = {
    transaction: mutation,
    rollbackRows: new Map(rollbackRows),
    createdAt,
    attempts: 0
  };
  state.pendingMutations.set(mutation.id, entry);
  bump(state);
  return entry;
};

const dequeuePendingMutation = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  id: string
): void => {
  if (state.pendingMutations.delete(id)) {
    bump(state);
  }
};

const markSynced = <A extends object, K extends CollectionKey>(
  state: CollectionState<A, K, any>,
  keys: ReadonlyArray<K>
): void => {
  for (const key of keys) {
    const row = state.rows.get(key);
    if (row) {
      row.synced = true;
    }
  }
  bump(state);
};

const diffChanges = <A extends object>(previous: A, value: A): Partial<A> => {
  const changes: Partial<A> = {};
  for (const key of Object.keys(value) as Array<keyof A>) {
    if (!Object.is(previous[key], value[key])) {
      changes[key] = value[key];
    }
  }
  return changes;
};

const applyUpdate = <A extends object>(previous: A, update: CollectionUpdate<A>): {
  readonly value: A;
  readonly changes: Partial<A>;
} => {
  if (typeof update === "function") {
    const draft = { ...previous } as A;
    const result = update(draft);
    const value = result === undefined ? draft : result;
    return {
      value,
      changes: diffChanges(previous, value)
    };
  }

  return {
    value: { ...previous, ...update },
    changes: update
  };
};

const transaction = <A extends object, K extends CollectionKey>(
  collection: string,
  mutations: ReadonlyArray<CollectionMutation<A, K>>
): CollectionTransaction<A, K> => ({
  id: `ctx_${++nextTransactionId}`,
  collection,
  mutations
});

const withCollectionRetry = <A, E, R>(
  definition: CollectionDefinition<any, any, E, R>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const retry = definition.options.policy?.retry;
  return retry ? Effect.retry(effect, retry) : effect;
};

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
      yield* collectionInputEffect(definition.options.onInsert(inserts, context));
    }
    if (updates.length > 0 && definition.options.onUpdate) {
      yield* collectionInputEffect(definition.options.onUpdate(updates, context));
    }
    if (deletes.length > 0 && definition.options.onDelete) {
      yield* collectionInputEffect(definition.options.onDelete(deletes, context));
    }
  });

const runPendingMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
  dbStore: RuntimeCollectionStore,
  pending: PendingMutationEntry<A, K>,
  handler: Effect.Effect<void, E, R>
): Effect.Effect<CollectionTransaction<A, K>, E, R> =>
  Effect.gen(function* () {
    const mutation = pending.transaction;
    pending.attempts += 1;
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionMutateStarted",
      collection: definition.name,
      transaction: mutation.id,
      mutations: mutation.mutations.length
    });

    return yield* withCollectionRetry(definition, handler).pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          markSynced(state, Array.from(pending.rollbackRows.keys()));
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
        })
      ),
      Effect.as(mutation),
      Effect.catch((error: E) =>
        Effect.gen(function* () {
          restoreRows(state, pending.rollbackRows);
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
  });

const runMutation = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  mutation: CollectionTransaction<A, K>,
  snapshots: ReadonlyMap<K, StoredRow<A, K> | undefined>,
  handler: Effect.Effect<void, E, R>
): Effect.Effect<CollectionTransaction<A, K>, E, R> =>
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
): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, E, R> =>
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
      const transaction = yield* runPendingMutation(definition, state, dbStore, pending, handler);
      flushed.push(transaction);
    }

    return flushed;
  });

const loadCollectionEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  options: { readonly force: boolean }
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const restored = yield* restoreBeforePreloadEffect(definition, state, dbStore);
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
    const load = collectionInputEffect(definition.options.load());
    const values = yield* withCollectionRetry(definition, load).pipe(
      Effect.catch((error: E) =>
        Effect.gen(function* () {
          state.loadState.set({ _tag: "Failure", waiting: false, error });
          yield* publishStoreEvent(dbStore, {
            _tag: "CollectionLoadFailure",
            collection: definition.name,
            error
          });
          return yield* Effect.fail(error);
        })
      )
    );
    const updatedAt = yield* Clock.currentTimeMillis;
    replaceRows(definition, state, values);
    state.loadState.set({ _tag: "Ready", waiting: false, updatedAt });
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionLoaded",
      collection: definition.name,
      count: values.length,
      updatedAt
    });
    yield* persistForReasonEffect(definition, dbStore, "load");
  });

const writeRows = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  input: A | ReadonlyArray<A>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const values = toArray(input);
    for (const value of values) {
      const key = definition.getKey(value);
      state.rows.set(key, {
        key,
        value,
        synced: options.synced ?? true,
        origin: options.origin ?? "remote"
      });
    }
    bump(state);
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
): Effect.Effect<void, E | CollectionRowNotFound, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    const row = state.rows.get(key);
    if (!row) {
      return yield* new CollectionRowNotFound({ collection: definition.name, key });
    }

    row.value = { ...row.value, ...changes };
    row.synced = options.synced ?? true;
    row.origin = options.origin ?? "remote";
    bump(state);
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
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const dbStore = yield* collectionStoreEffect;
    const state = collectionState(definition, dbStore);
    state.rows.delete(key);
    bump(state);
    yield* publishStoreEvent(dbStore, {
      _tag: "CollectionWritten",
      collection: definition.name,
      mutations: 1
    });
    yield* persistForReasonEffect(definition, dbStore, "write");
  });

const applyCollectionChangesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  changes: ReadonlyArray<CollectionChange<A, K>>,
  options: CollectionWriteOptions = {}
): Effect.Effect<void, E, R> =>
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

export const persistedCollectionOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never,
  PE = unknown,
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

const readonlyCollectionMutation = (
  collection: string,
  operation: string
): ReadonlyCollectionMutation =>
  new ReadonlyCollectionMutation({ collection, operation });

const collectionHashVersion = (values: unknown): number => {
  const input = stableStringify(values);
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return hash;
};

const liveQueryFromInput = <A extends object, E, R>(
  query: LiveQuery<A, E, R> | QueryFactory<A>
): LiveQuery<A, E, R> =>
  typeof query === "function"
    ? Query.live<A, E, R>(query)
    : query;

export const makeLiveQueryCollection = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: CollectionLiveQueryOptions<A, K, E, R>
): CollectionDefinition<A, K, E | ReadonlyCollectionMutation, R> => {
  const live = liveQueryFromInput(options.query);
  const materialized = (): ReadonlyArray<A> => live.data.get();
  const row = (value: A): CollectionRow<A, K> =>
    Object.assign({}, value, {
      $key: options.getKey(value),
      $collection: options.name,
      $synced: true,
      $origin: "remote"
    }) as CollectionRow<A, K>;
  const readonlyFail = <Out>(operation: string): Effect.Effect<Out, ReadonlyCollectionMutation> =>
    Effect.fail(readonlyCollectionMutation(options.name, operation));

  let definition: CollectionDefinition<A, K, E | ReadonlyCollectionMutation, R>;
  definition = {
    [CollectionTypeId]: CollectionTypeId,
    options: {
      name: options.name,
      getKey: options.getKey,
      ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
      load: () => live.preloadEffect().pipe(Effect.as(live.evaluate()))
    },
    name: options.name,
    getKey: options.getKey,
    state: () =>
      Signal.derive<CollectionLoadState<E | ReadonlyCollectionMutation>>(() => {
        const state = live.state.get();
        switch (state._tag) {
          case "Pending":
            return { _tag: "Pending", waiting: true };
          case "Failure":
            return { _tag: "Failure", waiting: false, error: state.error };
          case "Success":
            return { _tag: "Ready", waiting: false, updatedAt: Date.now() };
        }
      }),
    version: () =>
      Signal.derive(() => collectionHashVersion(materialized())),
    get: (key) => {
      const value = materialized().find((entry) => Object.is(options.getKey(entry), key));
      return value ? row(value) : undefined;
    },
    rows: () => materialized().map(row),
    index: (index, value) =>
      rowsMatchingIndex(definition, materialized().map(row), index, value),
    firstByIndex: (index, value) =>
      rowsMatchingIndex(definition, materialized().map(row), index, value)[0],
    preloadEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* live.preloadEffect();
      }),
    preload: () => runPromise(definition.preloadEffect()),
    refetchEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* live.refetchEffect();
      }),
    refetch: () => runPromise(definition.refetchEffect()),
    pendingMutationsEffect: () => Effect.succeed([]),
    pendingMutations: () => [],
    flushPendingMutationsEffect: () => Effect.succeed([]),
    flushPendingMutations: () => runPromise(definition.flushPendingMutationsEffect()),
    snapshotEffect: () =>
      Effect.map(Clock.currentTimeMillis, (updatedAt): CollectionSnapshot<A, K> => ({
        name: options.name,
        rows: materialized().map((value) => ({
          key: options.getKey(value),
          value,
          synced: true,
          origin: "remote"
        })),
        pendingMutations: [],
        updatedAt
      })),
    snapshot: () => ({
      name: options.name,
      rows: materialized().map((value) => ({
        key: options.getKey(value),
        value,
        synced: true,
        origin: "remote"
      })),
      pendingMutations: [],
      updatedAt: Date.now()
    }),
    hydrateEffect: () => Effect.void,
    hydrate: () => {},
    persistEffect: <PE = unknown, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions
    ) =>
      Effect.gen(function* () {
        const key = persistenceKey(definition, persistOptions);
        const snapshot = yield* definition.snapshotEffect();
        yield* collectionInputEffect(storage.setItem(key, JSON.stringify(snapshot)));
      }),
    persist: <PE = unknown, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions
    ) => runPromise(definition.persistEffect(storage, persistOptions)),
    restoreEffect: () => Effect.void,
    restore: <PE = unknown, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions
    ) => runPromise(definition.restoreEffect(storage, restoreOptions)),
    insertEffect: () => readonlyFail("insert"),
    insert: (input) => runPromise(definition.insertEffect(input)),
    updateEffect: () => readonlyFail("update"),
    update: (key, update) => runPromise(definition.updateEffect(key, update)),
    deleteEffect: () => readonlyFail("delete"),
    delete: (key) => runPromise(definition.deleteEffect(key)),
    writeInsertEffect: () => readonlyFail("writeInsert"),
    writeInsert: (input, writeOptions) => {
      void runPromise(definition.writeInsertEffect(input, writeOptions));
    },
    writeUpdateEffect: () => readonlyFail("writeUpdate"),
    writeUpdate: (key, changes, writeOptions) => {
      void runPromise(definition.writeUpdateEffect(key, changes, writeOptions));
    },
    writeDeleteEffect: () => readonlyFail("writeDelete"),
    writeDelete: (key) => {
      void runPromise(definition.writeDeleteEffect(key));
    }
  };

  collectionDefinitions.set(options.name, definition as AnyCollection);

  return definition;
};

export type QuerySortDirection = "asc" | "desc";
export type QuerySortValue = string | number | boolean | Date | null | undefined;
export type QueryJoinKey = string | number | boolean | Date | null | undefined;
export type QueryJoinStrategy = "collection-scan" | "collection-index";

type SourceRecord = Record<string, AnyCollection>;
type QueryContext<Sources extends SourceRecord> = {
  readonly [Key in keyof Sources]: CollectionRowValue<Sources[Key]>;
};
type QueryJoinedContext<
  TContext extends Record<string, any>,
  Alias extends string,
  C extends AnyCollection
> = TContext & {
  readonly [Key in Alias]: CollectionRowValue<C>;
};
type QueryJoinResult<TContext, TResult, TNextContext> =
  [TResult] extends [TContext]
    ? [TContext] extends [TResult]
      ? TNextContext
      : TResult
    : TResult;

interface QueryOrder<TContext> {
  readonly direction: QuerySortDirection;
  readonly selector: (row: TContext) => QuerySortValue;
}

interface QueryJoin {
  readonly alias: string;
  readonly collection: AnyCollection;
  readonly leftKey: (row: Record<string, any>) => QueryJoinKey;
  readonly rightKeys: (row: CollectionRow<any, any>) => ReadonlyArray<QueryJoinKey>;
  readonly rightIndex?: string;
}

export interface QueryPlanSourceDiagnostics {
  readonly alias: string;
  readonly collection: string;
  readonly rows: number;
}

export interface QueryPlanJoinDiagnostics {
  readonly alias: string;
  readonly collection: string;
  readonly strategy: QueryJoinStrategy;
  readonly index?: string;
  readonly leftRows: number;
  readonly rightRows: number;
  readonly outputRows: number;
  readonly estimatedComparisons: number;
}

export interface QueryPlanDiagnostics {
  readonly sources: ReadonlyArray<QueryPlanSourceDiagnostics>;
  readonly joins: ReadonlyArray<QueryPlanJoinDiagnostics>;
  readonly filters: number;
  readonly orders: number;
  readonly grouped: boolean;
  readonly offset: number;
  readonly limit?: number;
  readonly contextRows: number;
}

interface QueryExecution<TContext> {
  readonly contexts: Array<TContext>;
  readonly diagnostics: QueryPlanDiagnostics;
}

export interface QueryAggregate<TContext, R, V = unknown> {
  readonly preMap: (row: TContext) => V;
  readonly reduce: (values: Array<[V, number]>) => V;
  readonly postMap?: (value: V) => R;
}

export type QueryAggregateRecord<TContext> = Record<string, QueryAggregate<TContext, any, any>>;
export type QueryAggregateResult<
  TKey extends Record<string, unknown>,
  Aggregates extends QueryAggregateRecord<any>
> = TKey & {
  readonly [Key in keyof Aggregates]: Aggregates[Key] extends QueryAggregate<infer _Context, infer R, infer _Value> ? R : never;
};

interface QueryGrouping<TSource extends Record<string, any>, TResult extends Record<string, unknown>> {
  readonly key: (row: TSource) => Record<string, unknown>;
  readonly aggregates: QueryAggregateRecord<TSource>;
  readonly sourceFilters: ReadonlyArray<(row: TSource) => boolean>;
}

interface QueryProjectOptions {
  readonly filter?: boolean;
  readonly order?: boolean;
  readonly window?: boolean;
}

const projectCurrentContext = <TContext, TResult>(row: TContext): TResult => {
  const value: unknown = row;
  return value as TResult;
};

export class QueryBuilder<TContext extends Record<string, any>, TResult> {
  constructor(
    readonly sources: ReadonlyArray<readonly [string, AnyCollection]>,
    readonly filters: ReadonlyArray<(row: TContext) => boolean> = [],
    readonly projector: ((row: TContext) => TResult) | undefined = undefined,
    readonly orders: ReadonlyArray<QueryOrder<TContext>> = [],
    readonly offsetCount = 0,
    readonly limitCount: number | undefined = undefined,
    readonly joins: ReadonlyArray<QueryJoin> = [],
    readonly grouping: QueryGrouping<any, any> | undefined = undefined
  ) {}

  private filtersFor<NextContext extends TContext>(): ReadonlyArray<(row: NextContext) => boolean> {
    return this.filters;
  }

  private projectorFor<NextContext extends Record<string, any>, NextResult>(): ((row: NextContext) => NextResult) | undefined {
    return this.projector as ((row: NextContext) => NextResult) | undefined;
  }

  private ordersFor<NextContext extends TContext>(): ReadonlyArray<QueryOrder<NextContext>> {
    return this.orders;
  }

  where(predicate: (row: TContext) => boolean): QueryBuilder<TContext, TResult> {
    return new QueryBuilder(
      this.sources,
      [...this.filters, predicate],
      this.projector,
      this.orders,
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  select<Next>(projector: (row: TContext) => Next): QueryBuilder<TContext, Next> {
    return new QueryBuilder(
      this.sources,
      this.filters,
      projector,
      this.orders,
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  join<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<NextContext, NextResult>(
      [...this.sources, [alias, collection] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          collection,
          leftKey: leftKey as (row: Record<string, any>) => QueryJoinKey,
          rightKeys: (row: CollectionRow<any, any>) => [
            (rightKey as (row: CollectionRow<any, any>) => QueryJoinKey)(row)
          ]
        }
      ],
      this.grouping
    );
  }

  joinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<NextContext, NextResult>(
      [...this.sources, [alias, collection] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          collection,
          leftKey: leftKey as (row: Record<string, any>) => QueryJoinKey,
          rightKeys: (row: CollectionRow<any, any>) => indexJoinKeys(collection, index, row),
          rightIndex: index
        }
      ],
      this.grouping
    );
  }

  innerJoin<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>
  > {
    return this.join(alias, collection, leftKey, rightKey);
  }

  innerJoinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>
  > {
    return this.joinIndexed(alias, collection, leftKey, index);
  }

  groupBy<
    TKey extends Record<string, unknown>,
    Aggregates extends QueryAggregateRecord<TContext>
  >(
    key: (row: TContext) => TKey,
    aggregates: Aggregates
  ): QueryBuilder<
    QueryAggregateResult<TKey, Aggregates>,
    QueryAggregateResult<TKey, Aggregates>
  > {
    type Grouped = QueryAggregateResult<TKey, Aggregates>;
    return new QueryBuilder<Grouped, Grouped>(
      this.sources,
      [],
      undefined,
      [],
      0,
      undefined,
      this.joins,
      {
        key: key as (row: Record<string, any>) => Record<string, unknown>,
        aggregates: aggregates as QueryAggregateRecord<Record<string, any>>,
        sourceFilters: this.filters
      }
    );
  }

  orderBy(selector: (row: TContext) => QuerySortValue, direction: QuerySortDirection = "asc"): QueryBuilder<TContext, TResult> {
    return new QueryBuilder(
      this.sources,
      this.filters,
      this.projector,
      [...this.orders, { selector, direction }],
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  offset(count: number): QueryBuilder<TContext, TResult> {
    return new QueryBuilder(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      Math.max(0, count),
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  limit(count: number): QueryBuilder<TContext, TResult> {
    return new QueryBuilder(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      this.offsetCount,
      Math.max(0, count),
      this.joins,
      this.grouping
    );
  }

  execute(): ReadonlyArray<TResult> {
    const contexts = buildQueryContexts(this);
    return this.projectContexts(contexts);
  }

  projectContexts(contexts: ReadonlyArray<TContext>, options: QueryProjectOptions = {}): ReadonlyArray<TResult> {
    const shouldFilter = options.filter ?? true;
    const shouldOrder = options.order ?? true;
    const shouldWindow = options.window ?? true;
    let filtered = shouldFilter
      ? contexts.filter((row) => this.filters.every((filter) => filter(row)))
      : [...contexts];

    if (shouldOrder && this.orders.length > 0) {
      filtered = filtered
        .map((row, index) => ({ row, index }))
        .sort((left, right) => compareRows(left.row, right.row, left.index, right.index, this.orders))
        .map(({ row }) => row);
    }

    if (shouldWindow && this.offsetCount > 0) {
      filtered = filtered.slice(this.offsetCount);
    }

    if (shouldWindow && this.limitCount !== undefined) {
      filtered = filtered.slice(0, this.limitCount);
    }

    const projector = this.projector ?? projectCurrentContext<TContext, TResult>;
    return filtered.map(projector);
  }
}

export type QueryFactory<TResult> = (query: QueryRoot) => QueryBuilder<any, TResult>;

export interface QueryRoot {
  from<const Sources extends SourceRecord>(sources: Sources): QueryBuilder<QueryContext<Sources>, QueryContext<Sources>>;
}

export type LiveQueryState<T, E = unknown> =
  | { readonly _tag: "Pending"; readonly waiting: true; readonly data: ReadonlyArray<T> }
  | { readonly _tag: "Success"; readonly waiting: false; readonly data: ReadonlyArray<T> }
  | { readonly _tag: "Failure"; readonly waiting: false; readonly error: E; readonly data: ReadonlyArray<T> };

export interface LiveQuery<T, E = unknown, R = never> {
  readonly builder: QueryBuilder<any, T>;
  readonly data: ReadableSignal<ReadonlyArray<T>>;
  readonly state: ReadableSignal<LiveQueryState<T, E>>;
  readonly sources: ReadonlyArray<AnyCollection>;
  evaluate(): ReadonlyArray<T>;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
  preload(): Promise<void>;
  refetch(): Promise<void>;
}

const queryRoot: QueryRoot = {
  from: <const Sources extends SourceRecord>(
    sources: Sources
  ): QueryBuilder<QueryContext<Sources>, QueryContext<Sources>> => new QueryBuilder<QueryContext<Sources>, QueryContext<Sources>>(
    Object.entries(sources) as ReadonlyArray<readonly [string, AnyCollection]>
  )
};

const buildContexts = <TContext extends Record<string, any>>(
  sources: ReadonlyArray<readonly [string, AnyCollection]>
): Array<TContext> => {
  if (sources.length === 0) {
    throw new UnsupportedLiveQuery({ reason: "Live queries require at least one source collection." });
  }

  const contexts: Array<TContext> = [];
  const visit = (index: number, current: Record<string, unknown>): void => {
    if (index >= sources.length) {
      contexts.push({ ...current } as TContext);
      return;
    }

    const source = sources[index];
    if (!source) {
      return;
    }

    const [alias, collection] = source;
    for (const row of collection.rows()) {
      current[alias] = row;
      visit(index + 1, current);
    }
    delete current[alias];
  };

  visit(0, {});
  return contexts;
};

const buildQueryContexts = <TContext extends Record<string, any>>(
  builder: QueryBuilder<TContext, unknown>
): Array<TContext> =>
  buildQueryExecution(builder).contexts;

const buildQueryExecution = <TContext extends Record<string, any>>(
  builder: QueryBuilder<TContext, unknown>
): QueryExecution<TContext> => {
  const joinAliases = new Set(builder.joins.map((join) => join.alias));
  const baseSources = builder.sources.filter(([alias]) => !joinAliases.has(alias));
  const sourceDiagnostics = builder.sources.map(([alias, collection]): QueryPlanSourceDiagnostics => ({
    alias,
    collection: collection.name,
    rows: collection.rows().length
  }));
  const joins: Array<QueryPlanJoinDiagnostics> = [];
  let contexts = buildContexts<Record<string, any>>(baseSources);

  for (const join of builder.joins) {
    const joined: Array<Record<string, any>> = [];
    const leftRows = contexts.length;
    const rightRows = join.collection.rows().length;
    for (const context of contexts) {
      const leftValue = join.leftKey(context);
      const left = joinKey(leftValue);
      const rows = join.rightIndex
        ? join.collection.index(join.rightIndex, leftValue as CollectionIndexValue)
        : join.collection.rows();
      for (const row of rows) {
        if (join.rightKeys(row).some((rightValue) => left === joinKey(rightValue))) {
          joined.push({
            ...context,
            [join.alias]: row
          });
        }
      }
    }
    joins.push({
      alias: join.alias,
      collection: join.collection.name,
      strategy: join.rightIndex ? "collection-index" : "collection-scan",
      ...(join.rightIndex === undefined ? {} : { index: join.rightIndex }),
      leftRows,
      rightRows,
      outputRows: joined.length,
      estimatedComparisons: join.rightIndex ? leftRows : leftRows * rightRows
    });
    contexts = joined;
  }

  let resultContexts: Array<Record<string, any>>;
  if (builder.grouping) {
    resultContexts = groupContexts(contexts, builder.grouping);
  } else {
    resultContexts = contexts;
  }

  return {
    contexts: resultContexts as Array<TContext>,
    diagnostics: {
      sources: sourceDiagnostics,
      joins,
      filters: builder.filters.length,
      orders: builder.orders.length,
      grouped: builder.grouping !== undefined,
      offset: builder.offsetCount,
      ...(builder.limitCount === undefined ? {} : { limit: builder.limitCount }),
      contextRows: resultContexts.length
    }
  };
};

const groupContexts = (
  contexts: ReadonlyArray<Record<string, any>>,
  grouping: QueryGrouping<Record<string, any>, Record<string, unknown>>
): Array<Record<string, unknown>> => {
  const groups = new Map<string, {
    readonly key: Record<string, unknown>;
    readonly values: Array<Record<string, any>>;
  }>();

  for (const context of contexts) {
    if (!grouping.sourceFilters.every((filter) => filter(context))) {
      continue;
    }

    const key = grouping.key(context);
    const keyString = stableStringify(key);
    const existing = groups.get(keyString);
    if (existing) {
      existing.values.push(context);
    } else {
      groups.set(keyString, { key, values: [context] });
    }
  }

  return Array.from(groups.values(), (group) => {
    const result: Record<string, unknown> = { ...group.key };
    for (const [name, aggregate] of Object.entries(grouping.aggregates)) {
      const values = group.values.map((value) => [aggregate.preMap(value), 1] as [unknown, number]);
      const reduced = aggregate.reduce(values);
      result[name] = aggregate.postMap ? aggregate.postMap(reduced) : reduced;
    }
    return result;
  });
};

const compareValue = (left: QuerySortValue, right: QuerySortValue): number => {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (leftValue === rightValue) return 0;
  if (leftValue === null || leftValue === undefined) return 1;
  if (rightValue === null || rightValue === undefined) return -1;
  return leftValue < rightValue ? -1 : 1;
};

const compareRows = <TContext>(
  left: TContext,
  right: TContext,
  leftIndex: number,
  rightIndex: number,
  orders: ReadonlyArray<QueryOrder<TContext>>
): number => {
  for (const order of orders) {
    const direction = order.direction === "asc" ? 1 : -1;
    const comparison = compareValue(order.selector(left), order.selector(right));
    if (comparison !== 0) {
      return comparison * direction;
    }
  }

  return leftIndex - rightIndex;
};

const compareIvmContexts = <TContext extends Record<string, any>>(
  orders: ReadonlyArray<QueryOrder<TContext>>
) => (left: TContext, right: TContext): number => {
  const comparison = compareRows(left, right, 0, 0, orders);
  if (comparison !== 0) {
    return comparison;
  }

  return compareValue(
    (left as IvmContext)[contextKeySymbol],
    (right as IvmContext)[contextKeySymbol]
  );
};

const querySources = (builder: QueryBuilder<any, any>): ReadonlyArray<AnyCollection> =>
  builder.sources.map(([, collection]) => collection);

const contextKeySymbol: unique symbol = Symbol.for("@effect-ui/db/QueryContextKey") as typeof contextKeySymbol;
const crossJoinKey = "__effect_ui_db_all__";

const joinKey = (value: QueryJoinKey): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

type IvmRuntimeOperator = IOperator<unknown>;

const addIvmRuntimeOperator = (
  graph: IStreamBuilder<unknown>["graph"],
  operator: IvmRuntimeOperator
): void => {
  // @tanstack/db-ivm dispatches through IOperator at runtime, but addOperator is typed to internal classes.
  (graph.addOperator as (operator: IvmRuntimeOperator) => void)(operator);
};

const ivmFlatMap = <T, U>(
  mapInput: (input: T) => ReadonlyArray<U>
): PipedOperator<T, U> =>
  (stream): IStreamBuilder<U> => {
    const reader = stream.connectReader();
    const output = stream.graph.newInput<U>();
    addIvmRuntimeOperator(stream.graph, {
      run: () => {
        for (const message of reader.drain()) {
          const mapped: Array<[U, number]> = [];
          for (const [input, multiplicity] of message.getInner()) {
            for (const outputValue of mapInput(input)) {
              mapped.push([outputValue, multiplicity]);
            }
          }
          if (mapped.length > 0) {
            output.writer.sendData(new MultiSet(mapped));
          }
        }
      },
      hasPendingWork: () => !reader.isEmpty()
    });
    return output;
  };

type IvmContext = Record<string, unknown> & {
  readonly [contextKeySymbol]: string;
};

interface IvmSource {
  readonly alias: string;
  readonly collection: AnyCollection;
  readonly input: RootStreamBuilder<KeyValue<string, IvmContext>>;
  readonly previous: Map<string, { readonly row: CollectionRow<any, any>; readonly hash: string }>;
}

interface IvmOutputRow<TContext> {
  readonly context: TContext;
  readonly order: string | undefined;
}

class IvmLiveQueryEngine<TContext extends Record<string, any>, TResult> {
  readonly #graph = new D2();
  readonly #sources: ReadonlyArray<IvmSource>;
  readonly #rows = new Map<string, { context: TContext; count: number; order: string | undefined }>();

  constructor(readonly builder: QueryBuilder<TContext, TResult>) {
    this.#sources = builder.sources.map(([alias, collection]) => ({
      alias,
      collection,
      input: this.#graph.newInput<KeyValue<string, IvmContext>>(),
      previous: new Map()
    }));

    if (this.#sources.length > 0) {
      this.#compile();
    }

    this.#graph.finalize();
  }

  evaluate(): ReadonlyArray<TResult> {
    for (const source of this.#sources) {
      source.collection.version().get();
      this.#syncSource(source);
    }

    this.#graph.run();
    const rows = Array.from(this.#rows.values());
    if (this.builder.orders.length > 0) {
      rows.sort((left, right) => compareValue(left.order, right.order));
    }

    return this.builder.projectContexts(
      rows.map((row) => row.context),
      {
        filter: false,
        order: this.builder.orders.length === 0,
        window: this.builder.orders.length === 0
      }
    );
  }

  #compile(): void {
    const joinAliases = new Set(this.builder.joins.map((join) => join.alias));
    const sourceByAlias = new Map(this.#sources.map((source) => [source.alias, source]));
    const baseSources = this.builder.joins.length === 0
      ? this.#sources
      : this.#sources.filter((source) => !joinAliases.has(source.alias));
    const first = baseSources[0];
    if (!first) {
      return;
    }

    let stream: IStreamBuilder<KeyValue<string, IvmContext>> = first.input;
    for (const source of baseSources.slice(1)) {
      stream = stream.pipe(
        ivmInnerJoin(source.input),
        ivmMap(([_, pair]) => {
          const [left, right] = pair;
          return [crossJoinKey, mergeContexts(left, right)] satisfies KeyValue<string, IvmContext>;
        })
      ) as IStreamBuilder<KeyValue<string, IvmContext>>;
    }

    for (const join of this.builder.joins) {
      const source = sourceByAlias.get(join.alias);
      if (!source) {
        throw new UnsupportedLiveQuery({ reason: `Join source "${join.alias}" is not registered.` });
      }

      const keyedLeft = stream.pipe(
        ivmMap(([_, context]) =>
          [joinKey(join.leftKey(context)), context] satisfies KeyValue<string, IvmContext>
        )
      );
      const keyedRight = source.input.pipe(
        ivmFlatMap(([_, context]) => {
          const row = context[join.alias] as CollectionRow<any, any>;
          return join.rightKeys(row).map((rightKey) =>
            [joinKey(rightKey), context] satisfies KeyValue<string, IvmContext>
          );
        })
      );

      stream = keyedLeft.pipe(
        ivmInnerJoin(keyedRight),
        ivmMap(([_, pair]) => {
          const [left, right] = pair;
          return [crossJoinKey, mergeContexts(left, right)] satisfies KeyValue<string, IvmContext>;
        })
      ) as IStreamBuilder<KeyValue<string, IvmContext>>;
    }

    let resultStream: IStreamBuilder<KeyValue<string, TContext>>;
    if (this.builder.grouping) {
      const grouping = this.builder.grouping as QueryGrouping<Record<string, any>, Record<string, unknown>>;
      resultStream = stream.pipe(
        ivmFilter(([_, context]) =>
          grouping.sourceFilters.every((filter) => filter(context))
        ),
        ivmMap(([_, context]) => context as Record<string, any>),
        ivmGroupBy(grouping.key, grouping.aggregates),
        ivmFilter(([_, group]) =>
          this.builder.filters.every((filter) => filter(group as TContext))
        ),
        ivmMap(([key, group]) =>
          [key, group as TContext] satisfies KeyValue<string, TContext>
        )
      );
    } else {
      resultStream = stream.pipe(
        ivmFilter(([_, context]) =>
          this.builder.filters.every((filter) => filter(context as TContext))
        ),
        ivmMap(([_, context]) =>
          [context[contextKeySymbol], context as TContext] satisfies KeyValue<string, TContext>
        )
      );
    }

    let outputStream: IStreamBuilder<KeyValue<string, IvmOutputRow<TContext>>>;
    if (this.builder.orders.length > 0) {
      const orderOptions = {
        comparator: compareIvmContexts(this.builder.orders) as (left: unknown, right: unknown) => number,
        offset: this.builder.offsetCount,
        ...(this.builder.limitCount === undefined ? {} : { limit: this.builder.limitCount })
      };
      outputStream = resultStream.pipe(
        ivmOrderByWithFractionalIndex(
          (context) => context,
          orderOptions
        ),
        ivmMap(([key, [context, order]]) =>
          [key, { context, order }] satisfies KeyValue<string, IvmOutputRow<TContext>>
        )
      );
    } else {
      outputStream = resultStream.pipe(
        ivmMap(([key, context]) =>
          [key, { context, order: undefined }] satisfies KeyValue<string, IvmOutputRow<TContext>>
        )
      );
    }

    outputStream.pipe(ivmOutput((data) => this.#applyOutput(data)));
  }

  #applyOutput(data: MultiSet<KeyValue<string, IvmOutputRow<TContext>>>): void {
    const changes = new Map<string, {
      count: number;
      positive: IvmOutputRow<TContext> | undefined;
    }>();

    for (const [[key, row], multiplicity] of data.getInner()) {
      const existing = changes.get(key) ?? { count: 0, positive: undefined };
      changes.set(key, {
        count: existing.count + multiplicity,
        positive: multiplicity > 0 ? row : existing.positive
      });
    }

    for (const [key, change] of changes) {
      const existing = this.#rows.get(key);
      const nextCount = (existing?.count ?? 0) + change.count;
      if (nextCount <= 0) {
        this.#rows.delete(key);
      } else {
        const row = change.positive ?? existing;
        if (row) {
          this.#rows.set(key, {
            context: row.context,
            count: nextCount,
            order: row.order
          });
        }
      }
    }
  }

  #syncSource(source: IvmSource): void {
    const current = new Map<string, { readonly row: CollectionRow<any, any>; readonly hash: string }>();
    const deltas: Array<[KeyValue<string, IvmContext>, number]> = [];

    for (const row of source.collection.rows()) {
      const key = String(row.$key);
      const hash = stableStringify(row);
      const previous = source.previous.get(key);
      current.set(key, { row, hash });

      if (!previous) {
        deltas.push([sourceContext(source.alias, row), 1]);
        continue;
      }

      if (previous.hash !== hash) {
        deltas.push([sourceContext(source.alias, previous.row), -1]);
        deltas.push([sourceContext(source.alias, row), 1]);
      }
    }

    for (const [key, previous] of source.previous) {
      if (!current.has(key)) {
        deltas.push([sourceContext(source.alias, previous.row), -1]);
      }
    }

    source.previous.clear();
    for (const [key, row] of current) {
      source.previous.set(key, row);
    }

    if (deltas.length > 0) {
      source.input.sendData(new MultiSet(deltas));
    }
  }

}

const sourceContext = (
  alias: string,
  row: CollectionRow<any, any>
): KeyValue<string, IvmContext> => [
  crossJoinKey,
  {
    [alias]: row,
    [contextKeySymbol]: `${alias}:${String(row.$key)}`
  }
];

const mergeContexts = (left: IvmContext | null, right: IvmContext | null): IvmContext => {
  const leftKey = left?.[contextKeySymbol] ?? "";
  const rightKey = right?.[contextKeySymbol] ?? "";
  return {
    ...(left ?? {}),
    ...(right ?? {}),
    [contextKeySymbol]: `${leftKey}|${rightKey}`
  };
};

const preloadSourcesEffect = <E, R>(
  sources: ReadonlyArray<AnyCollection>,
  force: boolean
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    for (const source of sources) {
      yield* (force ? source.refetchEffect() : source.preloadEffect());
    }
  });

export const isCollection = (value: unknown): value is AnyCollection =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CollectionTypeId]?: unknown })[CollectionTypeId] === CollectionTypeId;

const collectionDefinitionDiagnostics = (
  definition: AnyCollection
): CollectionDefinitionDiagnostics => {
  const options = definition.options;
  const persistence = options.persistence;

  return {
    name: options.name,
    inputSchema: options.input !== undefined,
    outputSchema: options.output !== undefined,
    initialData: options.initialData !== undefined,
    indexes: Array.from(collectionIndexes(options), ([name, index]) => ({
      name,
      unique: index.unique === true
    })).sort((left, right) => left.name.localeCompare(right.name)),
    load: options.load !== undefined,
    handlers: {
      insert: options.onInsert !== undefined,
      update: options.onUpdate !== undefined,
      delete: options.onDelete !== undefined
    },
    policy: {
      retry: options.policy?.retry !== undefined
    },
    ...(options.sync === undefined ? {} : { sync: options.sync }),
    persistence: {
      enabled: persistence !== undefined,
      ...(persistence?.key === undefined ? {} : { key: persistence.key }),
      hydrate: persistence?.hydrate !== undefined,
      restoreOnPreload: persistence?.restoreOnPreload === true,
      loadAfterRestore: persistence?.loadAfterRestore === true,
      persistOnLoad: persistence?.persistOnLoad === true,
      persistOnMutation: persistence?.persistOnMutation === true,
      persistOnWrite: persistence?.persistOnWrite === true
    }
  };
};

export const eq = <A>(left: A, right: A): boolean => Object.is(left, right);
export const neq = <A>(left: A, right: A): boolean => !Object.is(left, right);
export const gt = <A extends number | string | Date>(left: A, right: A): boolean => left > right;
export const gte = <A extends number | string | Date>(left: A, right: A): boolean => left >= right;
export const lt = <A extends number | string | Date>(left: A, right: A): boolean => left < right;
export const lte = <A extends number | string | Date>(left: A, right: A): boolean => left <= right;
export const and = (...values: ReadonlyArray<boolean>): boolean => values.every(Boolean);
export const or = (...values: ReadonlyArray<boolean>): boolean => values.some(Boolean);
export const not = (value: boolean): boolean => !value;
export const includes = <A>(values: ReadonlyArray<A>, value: A): boolean => values.includes(value);

const aggregateCount = <TContext>(
  value: (row: TContext) => unknown = (row) => row
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) => value(row) == null ? 0 : 1,
  reduce: (values) => {
    let total = 0;
    for (const [present, multiplicity] of values) {
      total += present * multiplicity;
    }
    return total;
  }
});

const aggregateSum = <TContext>(
  value: (row: TContext) => number
): QueryAggregate<TContext, number, number> => ({
  preMap: value,
  reduce: (values) => {
    let total = 0;
    for (const [amount, multiplicity] of values) {
      total += amount * multiplicity;
    }
    return total;
  }
});

const aggregateAvg = <TContext>(
  value: (row: TContext) => number
): QueryAggregate<TContext, number, { readonly sum: number; readonly count: number }> => ({
  preMap: (row) => ({ sum: value(row), count: 1 }),
  reduce: (values) => {
    let sum = 0;
    let count = 0;
    for (const [entry, multiplicity] of values) {
      sum += entry.sum * multiplicity;
      count += entry.count * multiplicity;
    }
    return { sum, count };
  },
  postMap: ({ sum, count }) => count === 0 ? 0 : sum / count
});

const aggregateMin = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: value,
  reduce: (values) => {
    let min: V | undefined;
    for (const [candidate, multiplicity] of values) {
      if (multiplicity <= 0 || candidate === undefined) {
        continue;
      }
      if (min === undefined || candidate < min) {
        min = candidate;
      }
    }
    return min;
  }
});

const aggregateMax = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: value,
  reduce: (values) => {
    let max: V | undefined;
    for (const [candidate, multiplicity] of values) {
      if (multiplicity <= 0 || candidate === undefined) {
        continue;
      }
      if (max === undefined || candidate > max) {
        max = candidate;
      }
    }
    return max;
  }
});

export namespace Collection {
  export type Definition<A extends object, K extends CollectionKey = string, E = unknown, R = never> = CollectionDefinition<A, K, E, R>;
  export type Row<A extends object, K extends CollectionKey = CollectionKey> = CollectionRow<A, K>;
  export type Key = CollectionKey;
  export type Origin = CollectionOrigin;
  export type State<E = unknown> = CollectionLoadState<E>;
  export type Mutation<A extends object, K extends CollectionKey> = CollectionMutation<A, K>;
  export type Transaction<A extends object, K extends CollectionKey> = CollectionTransaction<A, K>;
  export type RollbackRow<A extends object, K extends CollectionKey> = CollectionRollbackRow<A, K>;
  export type PendingMutation<A extends object, K extends CollectionKey> = CollectionPendingMutation<A, K>;
  export type Policy<E = unknown> = CollectionPolicy<E>;
  export type SyncDiagnostics = CollectionSyncDiagnostics;
  export type IndexValue = CollectionIndexValue;
  export type IndexResult = CollectionIndexResult;
  export type IndexDefinition<A extends object> = CollectionIndexDefinition<A>;
  export type IndexInput<A extends object> = CollectionIndexInput<A>;
  export type IndexRecord<A extends object> = CollectionIndexRecord<A>;
  export type Store = CollectionStore;
  export type StoreEvent = CollectionStoreEvent;
  export type Update<A extends object> = CollectionUpdate<A>;
  export type Change<A extends object, K extends CollectionKey = CollectionKey> = CollectionChange<A, K>;
  export type RowSnapshot<A extends object, K extends CollectionKey> = CollectionRowSnapshot<A, K>;
  export type Snapshot<A extends object = object, K extends CollectionKey = CollectionKey> = CollectionSnapshot<A, K>;
  export type HydrationPayload = CollectionHydrationPayload;
  export type HydrateOptions = CollectionHydrateOptions;
  export type PersistenceStorage<E = unknown, R = never> = CollectionPersistenceStorage<E, R>;
  export type PersistOptions = CollectionPersistOptions;
  export type PersistenceConfig<E = unknown, R = never> = CollectionPersistenceConfig<E, R>;
  export type PersistedOptions<
    A extends object,
    K extends CollectionKey = string,
    E = unknown,
    R = never,
    PE = unknown,
    PR = never
  > = CollectionPersistedOptions<A, K, E, R, PE, PR>;
  export type LiveQueryOptions<A extends object, K extends CollectionKey, E = unknown, R = never> =
    CollectionLiveQueryOptions<A, K, E, R>;
  export type StorageLike = CollectionStorageLike;
  export type MemoryStorage = CollectionMemoryStorage;
  export type DefinitionDiagnostics = CollectionDefinitionDiagnostics;
  export type Diagnostics = CollectionDiagnostics;
  export type PreloadCollector = CollectionPreloadCollector;
  export type Collected<A> = CollectionPreloadCollected<A>;
  export type ServerOptions<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    ServerCollectionOptions<A, K, E, R>;
  export type ServerOperation<I, A, E = unknown, R = never> = ServerCollectionOperation<I, A, E, R>;
  export type ServerResult<A, E = unknown, R = never> = ServerCollectionResult<A, E, R>;
  export type ServerInsertPayload<A extends object, K extends CollectionKey> = ServerCollectionInsertPayload<A, K>;
  export type ServerUpdatePayload<A extends object, K extends CollectionKey> = ServerCollectionUpdatePayload<A, K>;
  export type ServerDeletePayload<A extends object, K extends CollectionKey> = ServerCollectionDeletePayload<A, K>;
  export type SyncAdapter<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionSyncAdapter<A, K, E, R>;
  export type SyncOptions<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionSyncOptions<A, K, E, R>;
  export type ResourceSyncAdapterOptions<I, A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionResourceSyncAdapterOptions<I, A, K, E, R>;
  export type QuerySyncKey = CollectionQuerySyncKey;
  export type QuerySyncFetchOptions<A extends object, E = unknown, R = never> =
    CollectionQuerySyncFetchOptions<A, E, R>;
  export type QuerySyncInvalidateOptions = CollectionQuerySyncInvalidateOptions;
  export type QuerySyncClient<A extends object, E = unknown, R = never> =
    CollectionQuerySyncClient<A, E, R>;
  export type QuerySyncAdapterOptions<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionQuerySyncAdapterOptions<A, K, E, R>;
  export type ChangeFeedUnsubscribe = CollectionChangeFeedUnsubscribe;
  export type ChangeFeedSubscription = CollectionChangeFeedSubscription;
  export type ChangeFeedContext<A extends object, K extends CollectionKey = string> =
    CollectionChangeFeedContext<A, K>;
  export type ChangeFeedAdapter<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionChangeFeedAdapter<A, K, E, R>;
  export type ChangeFeedSubscribeOptions = CollectionChangeFeedSubscribeOptions;
  export type SyncInsertPayload<A extends object, K extends CollectionKey> = CollectionSyncInsertPayload<A, K>;
  export type SyncUpdatePayload<A extends object, K extends CollectionKey> = CollectionSyncUpdatePayload<A, K>;
  export type SyncDeletePayload<A extends object, K extends CollectionKey> = CollectionSyncDeletePayload<A, K>;
  export type FlushAllPendingMutationsContext = FlushCollectionPendingMutationsContext;
  export type FlushAllPendingMutationsSkip<SkipError = never, SkipRequirements = never> =
    FlushCollectionPendingMutationsSkip<SkipError, SkipRequirements>;
  export type FlushAllPendingMutationsOptions<SkipError = never, SkipRequirements = never> =
    FlushCollectionsPendingMutationsOptions<SkipError, SkipRequirements>;
  export type FlushAllPendingMutationsResult = FlushCollectionPendingMutationsResult;
  export type BackgroundSyncTrigger = CollectionBackgroundSyncTrigger;
  export type BackgroundSyncPending = CollectionBackgroundSyncPending;
  export type BackgroundSyncAdapterContext = CollectionBackgroundSyncAdapterContext;
  export type BackgroundSyncAdapter<AdapterError = never, AdapterRequirements = never> =
    CollectionBackgroundSyncAdapter<AdapterError, AdapterRequirements>;
  export type BackgroundSyncOptions<
    AdapterError = never,
    AdapterRequirements = never,
    SkipError = never,
    SkipRequirements = never
  > = CollectionBackgroundSyncOptions<AdapterError, AdapterRequirements, SkipError, SkipRequirements>;
  export type BackgroundSyncResult = CollectionBackgroundSyncResult;
  export type SQLiteStorageKey = SQLitePersistenceKey;
  export type SQLiteStorageRow = SQLitePersistenceRow;
  export type SQLiteStorageTable<E = unknown, R = never> = SQLitePersistenceTable<E, R>;
  export type SQLiteStorageDriver<E = unknown, R = never> = SQLitePersistenceDriver<E, R>;
  export type SQLiteStorageOptions = SQLitePersistenceOptions;
  export type SQLiteMemoryStatement = SQLitePersistenceMemoryStatement;
  export type SQLiteMemoryStatementDatabase = SQLitePersistenceMemoryStatementDatabase;
  export type SQLiteStatementValue = string | number | null;
  export type SQLiteStatementParams = ReadonlyArray<SQLiteStatementValue>;
  export interface SQLiteStatementRow {
    readonly namespace?: unknown;
    readonly key?: unknown;
    readonly schema_version?: unknown;
    readonly schemaVersion?: unknown;
    readonly value?: unknown;
    readonly updated_at?: unknown;
    readonly updatedAt?: unknown;
  }
  export interface SQLiteStatementDatabase<E = unknown, R = never> {
    readonly execute: (sql: string, params?: SQLiteStatementParams) => EffectInput<void, E, R>;
    readonly select: (sql: string, params?: SQLiteStatementParams) => EffectInput<ReadonlyArray<SQLiteStatementRow>, E, R>;
  }
  export type SQLitePreparedStatement<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = unknown,
    R = never
  > = SQLitePersistencePreparedStatement<Row, E, R>;
  export type SQLitePreparedStatementDatabase<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = unknown,
    R = never
  > = SQLitePersistencePreparedStatementDatabase<Row, E, R>;
  export type SQLitePreparedStatementDatabaseOptions = SQLitePersistencePreparedStatementDatabaseOptions;

  export const serverOptions = serverCollectionOptions;
  export const serverSyncAdapter = serverCollectionSyncAdapter;
  export const resourceSyncAdapter = collectionResourceSyncAdapter;
  export const querySyncAdapter = collectionQuerySyncAdapter;
  export const syncOptions = collectionSyncOptions;
  export const persistedOptions = persistedCollectionOptions;
  export const liveQuery = makeLiveQueryCollection;
  export const flushAllPendingMutationsEffect = flushCollectionsPendingMutationsEffect;
  export const flushAllPendingMutations = flushCollectionsPendingMutations;
  export const backgroundSyncPendingMutationsEffect = backgroundSyncCollectionsPendingMutationsEffect;
  export const backgroundSyncPendingMutations = backgroundSyncCollectionsPendingMutations;
  export const sqliteStorage = makeSQLitePersistenceStorage;
  export const sqlitePreparedStatementDatabase = makeSQLitePreparedStatementDatabase;
  export const sqliteStatementDriver = makeSQLiteStatementPersistenceDriver;
  export const sqliteMemoryStatementDatabase = makeSQLiteMemoryStatementDatabase;

  export const define = <
    A extends object,
    K extends CollectionKey = string,
    E = unknown,
    R = never
  >(
    options: Omit<CollectionOptions<A, K, E, R>, "load"> & {
      readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
    }
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
        return row ? augmentRow(definition, row) : undefined;
      },
      rows: () => {
        const state = collectionState(definition);
        state.version.get();
        return Array.from(state.rows.values(), (row) => augmentRow(definition, row));
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
      preload: () => runPromise(loadCollectionEffect(definition, { force: false })),
      refetchEffect: () =>
        Effect.gen(function* () {
          yield* recordCollectionPreload(definition);
          yield* loadCollectionEffect(definition, { force: true });
        }),
      refetch: () => runPromise(loadCollectionEffect(definition, { force: true })),
      pendingMutationsEffect: () => collectionPendingMutationsEffect(definition),
      pendingMutations: () => collectionPendingMutations(definition),
      flushPendingMutationsEffect: () => flushCollectionPendingMutationsEffect(definition),
      flushPendingMutations: () => runPromise(flushCollectionPendingMutationsEffect(definition)),
      snapshotEffect: () => snapshotCollectionEffect(definition),
      snapshot: () => snapshotCollection(definition),
      hydrateEffect: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) =>
        hydrateCollectionEffect(definition, snapshot, hydrateOptions),
      hydrate: (snapshot: CollectionSnapshot<A, K>, hydrateOptions?: CollectionHydrateOptions) => {
        void runPromise(hydrateCollectionEffect(definition, snapshot, hydrateOptions));
      },
      persistEffect: <PE = unknown, PR = never>(
        storage: CollectionPersistenceStorage<PE, PR>,
        persistOptions?: CollectionPersistOptions
      ) => persistCollectionEffect(definition, storage, persistOptions),
      persist: <PE = unknown, PR = never>(
        storage: CollectionPersistenceStorage<PE, PR>,
        persistOptions?: CollectionPersistOptions
      ) => runPromise(persistCollectionEffect(definition, storage, persistOptions)),
      restoreEffect: <PE = unknown, PR = never>(
        storage: CollectionPersistenceStorage<PE, PR>,
        restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions
      ) => restoreCollectionEffect(definition, storage, restoreOptions),
      restore: <PE = unknown, PR = never>(
        storage: CollectionPersistenceStorage<PE, PR>,
        restoreOptions?: CollectionPersistOptions & CollectionHydrateOptions
      ) => runPromise(restoreCollectionEffect(definition, storage, restoreOptions)),
      insertEffect: (input: A | ReadonlyArray<A>) =>
        Effect.gen(function* () {
          const dbStore = yield* collectionStoreEffect;
          const state = collectionState(definition, dbStore);
          const values = toArray(input);
          const snapshots = new Map<K, StoredRow<A, K> | undefined>();
          const mutations: Array<CollectionMutation<A, K>> = [];

          for (const value of values) {
            const key = definition.getKey(value);
            const previous = state.rows.get(key);
            snapshots.set(key, previous ? cloneRow(previous) : undefined);
            state.rows.set(key, { key, value, synced: false, origin: "local" });
            mutations.push(previous ? { _tag: "Insert", key, value, previous: previous.value } : { _tag: "Insert", key, value });
          }
          bump(state);

          const tx = transaction(definition.name, mutations);
          const handler = definition.options.onInsert
            ? collectionInputEffect(definition.options.onInsert(values, { transaction: tx }))
            : Effect.succeed(undefined);
          return yield* runMutation(definition, tx, snapshots, handler);
        }),
      insert: (input: A | ReadonlyArray<A>) => runPromise(definition.insertEffect(input)),
      updateEffect: (key: K, update: CollectionUpdate<A>) =>
        Effect.gen(function* () {
          const dbStore = yield* collectionStoreEffect;
          const state = collectionState(definition, dbStore);
          const row = state.rows.get(key);
          if (!row) {
            return yield* new CollectionRowNotFound({ collection: definition.name, key });
          }

          const previous = cloneRow(row);
          const updated = applyUpdate(row.value, update);
          row.value = updated.value;
          row.synced = false;
          row.origin = "local";
          bump(state);

          const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
          const tx = transaction(definition.name, [{
            _tag: "Update",
            key,
            previous: previous.value,
            value: updated.value,
            changes: updated.changes
          }]);
          const handler = definition.options.onUpdate
            ? collectionInputEffect(definition.options.onUpdate([{
                key,
                previous: previous.value,
                value: updated.value,
                changes: updated.changes
              }], { transaction: tx }))
            : Effect.succeed(undefined);
          return yield* runMutation(definition, tx, snapshots, handler);
        }),
      update: (key: K, update: CollectionUpdate<A>) => runPromise(definition.updateEffect(key, update)),
      deleteEffect: (key: K) =>
        Effect.gen(function* () {
          const dbStore = yield* collectionStoreEffect;
          const state = collectionState(definition, dbStore);
          const row = state.rows.get(key);
          if (!row) {
            return yield* new CollectionRowNotFound({ collection: definition.name, key });
          }

          const previous = cloneRow(row);
          state.rows.delete(key);
          bump(state);

          const snapshots = new Map<K, StoredRow<A, K> | undefined>([[key, previous]]);
          const tx = transaction(definition.name, [{
            _tag: "Delete",
            key,
            previous: previous.value
          }]);
          const handler = definition.options.onDelete
            ? collectionInputEffect(definition.options.onDelete([{ key, previous: previous.value }], { transaction: tx }))
            : Effect.succeed(undefined);
          return yield* runMutation(definition, tx, snapshots, handler);
        }),
      delete: (key: K) => runPromise(definition.deleteEffect(key)),
      writeInsertEffect: (input: A | ReadonlyArray<A>, writeOptions?: CollectionWriteOptions) =>
        writeRows(definition, input, writeOptions),
      writeInsert: (input: A | ReadonlyArray<A>, writeOptions?: CollectionWriteOptions) => {
        void runPromise(writeRows(definition, input, writeOptions));
      },
      writeUpdateEffect: (key: K, changes: Partial<A>, writeOptions?: CollectionWriteOptions) =>
        writeUpdateRow(definition, key, changes, writeOptions),
      writeUpdate: (key: K, changes: Partial<A>, writeOptions?: CollectionWriteOptions) => {
        void runPromise(writeUpdateRow(definition, key, changes, writeOptions));
      },
      writeDeleteEffect: (key: K) => writeDeleteRow(definition, key),
      writeDelete: (key: K) => {
        void runPromise(writeDeleteRow(definition, key));
      }
    } satisfies CollectionDefinition<A, K, E, R>;

    collectionDefinitions.set(options.name, definition as AnyCollection);

    return definition;
  };

  export const definitions = (): ReadonlyMap<string, AnyCollection> =>
    collectionDefinitions;

  export const diagnostics = (): CollectionDiagnostics => ({
    collections: Array.from(collectionDefinitions.values(), collectionDefinitionDiagnostics)
      .sort((left, right) => left.name.localeCompare(right.name))
  });

  export const state = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadableSignal<CollectionLoadState<E>> => definition.state();

  export const version = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadableSignal<number> => definition.version();

  export const get = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    key: K
  ): CollectionRow<A, K> | undefined => definition.get(key);

  export const rows = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadonlyArray<CollectionRow<A, K>> => definition.rows();

  export const index = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    index: string,
    value: CollectionIndexValue
  ): ReadonlyArray<CollectionRow<A, K>> => definition.index(index, value);

  export const firstByIndex = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    index: string,
    value: CollectionIndexValue
  ): CollectionRow<A, K> | undefined => definition.firstByIndex(index, value);

  export const preloadEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<void, E, R> => definition.preloadEffect();

  export const refetchEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<void, E, R> => definition.refetchEffect();

  export const collectEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<CollectionPreloadCollected<A>, E, R> =>
    Effect.gen(function* () {
      const collector: CollectionPreloadCollector = { definitions: new Map() };
      const value = yield* Effect.provideService(effect, CollectionPreloadCollector, collector);
      return {
        value,
        definitions: Array.from(collector.definitions.values())
      };
    });

  export const pendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>> => definition.pendingMutationsEffect();

  export const pendingMutations = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadonlyArray<CollectionPendingMutation<A, K>> => definition.pendingMutations();

  export const flushPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, E, R> => definition.flushPendingMutationsEffect();

  export const flushPendingMutations = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Promise<ReadonlyArray<CollectionTransaction<A, K>>> => definition.flushPendingMutations();

  export const snapshotEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<CollectionSnapshot<A, K>> => definition.snapshotEffect();

  export const snapshot = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionSnapshot<A, K> => definition.snapshot();

  export const hydrateEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    value: CollectionSnapshot<A, K>,
    options?: CollectionHydrateOptions
  ): Effect.Effect<void> => definition.hydrateEffect(value, options);

  export const hydrate = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    value: CollectionSnapshot<A, K>,
    options?: CollectionHydrateOptions
  ): void => definition.hydrate(value, options);

  export const dehydrate = (
    collections: Iterable<AnyCollection>
  ): CollectionHydrationPayload => dehydrateCollections(collections);

  export const dehydrateEffect = (
    collections: Iterable<AnyCollection>
  ): Effect.Effect<CollectionHydrationPayload> => dehydrateCollectionsEffect(collections);

  export const hydratePayloadEffect = (
    collections: Iterable<AnyCollection>,
    payload: CollectionHydrationPayload,
    options?: CollectionHydrateOptions
  ): Effect.Effect<void> => hydrateCollectionsEffect(collections, payload, options);

  export const hydratePayload = (
    collections: Iterable<AnyCollection>,
    payload: CollectionHydrationPayload,
    options?: CollectionHydrateOptions
  ): void => {
    void runPromise(hydratePayloadEffect(collections, payload, options));
  };

  export const applyChangesEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): Effect.Effect<void, E, R> => applyCollectionChangesEffect(definition, changes, options);

  export const applyChanges = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): void => {
    void runPromise(applyCollectionChangesEffect(definition, changes, options));
  };

  export const subscribeChangesEffect = <
    A extends object,
    K extends CollectionKey,
    E,
    R,
    FeedError = never,
    FeedRequirements = never
  >(
    definition: CollectionDefinition<A, K, E, R>,
    adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements>,
    options?: CollectionChangeFeedSubscribeOptions
  ): Effect.Effect<void, E | FeedError, R | FeedRequirements | Scope.Scope> =>
    subscribeCollectionChangesEffect(definition, adapter, options);

  export const persistEffect = <A extends object, K extends CollectionKey, E, R, PE = unknown, PR = never>(
    definition: CollectionDefinition<A, K, E, R>,
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions
  ): Effect.Effect<void, PE, PR> => definition.persistEffect(storage, options);

  export const restoreEffect = <A extends object, K extends CollectionKey, E, R, PE = unknown, PR = never>(
    definition: CollectionDefinition<A, K, E, R>,
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions
  ): Effect.Effect<void, PE, PR> => definition.restoreEffect(storage, options);

  export const memoryStorage = (initial?: Iterable<readonly [string, string]>): CollectionMemoryStorage =>
    makeMemoryStorage(initial);

  export const storage = (storage: CollectionStorageLike): CollectionPersistenceStorage<never, never> =>
    fromStorage(storage);

  export const storeEffect = (): Effect.Effect<CollectionStore> =>
    collectionStoreEffect;

  export const currentStore = (): CollectionStore =>
    storeFor(currentOrDefaultRuntime().resourceStore);

  export const subscribeEventsEffect = (): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope> =>
    Effect.flatMap(collectionStoreEffect, (store) => store.subscribeEventsEffect());
}

export namespace Query {
  export type Builder<TContext extends Record<string, any>, TResult> = QueryBuilder<TContext, TResult>;
  export type Factory<TResult> = QueryFactory<TResult>;
  export type Live<T, E = unknown, R = never> = LiveQuery<T, E, R>;
  export type LiveState<T, E = unknown> = LiveQueryState<T, E>;
  export type JoinStrategy = QueryJoinStrategy;
  export type PlanSourceDiagnostics = QueryPlanSourceDiagnostics;
  export type PlanJoinDiagnostics = QueryPlanJoinDiagnostics;
  export type PlanDiagnostics = QueryPlanDiagnostics;
  export type Root = QueryRoot;
  export type Aggregate<TContext, R, V = unknown> = QueryAggregate<TContext, R, V>;
  export type Aggregates<TContext> = QueryAggregateRecord<TContext>;
  export type AggregateResult<
    TKey extends Record<string, unknown>,
    Aggregates extends QueryAggregateRecord<any>
  > = QueryAggregateResult<TKey, Aggregates>;

  export const from = queryRoot.from;
  export const count = aggregateCount;
  export const sum = aggregateSum;
  export const avg = aggregateAvg;
  export const min = aggregateMin;
  export const max = aggregateMax;

  export const build = <T>(factory: QueryFactory<T>): QueryBuilder<any, T> =>
    factory(queryRoot);

  export const diagnostics = <T>(factory: QueryFactory<T>): QueryPlanDiagnostics =>
    buildQueryExecution(build(factory)).diagnostics;

  export const onceEffect = <T, E = unknown, R = never>(
    factory: QueryFactory<T>
  ): Effect.Effect<ReadonlyArray<T>, E, R> =>
    Effect.gen(function* () {
      const builder = build(factory);
      yield* preloadSourcesEffect<E, R>(querySources(builder), false);
      return builder.execute();
    });

  export const once = <T>(factory: QueryFactory<T>): Promise<ReadonlyArray<T>> =>
    runPromise(onceEffect(factory));

  export const live = <T, E = unknown, R = never>(
    factory: QueryFactory<T>
  ): LiveQuery<T, E, R> => {
    const builder = build(factory);
    const sources = querySources(builder);
    const engine = new IvmLiveQueryEngine(builder);
    const data = Signal.derive(() => engine.evaluate());
    const state = Signal.derive<LiveQueryState<T, E>>(() => {
      const currentData = data.get();
      for (const source of sources) {
        const sourceState = source.state().get();
        if (sourceState._tag === "Failure") {
          return {
            _tag: "Failure",
            waiting: false,
            error: sourceState.error as E,
            data: currentData
          };
        }
      }

      const waiting = sources.some((source) => {
        const sourceState = source.state().get();
        return sourceState._tag === "Initial" || sourceState._tag === "Pending";
      });

      return waiting
        ? { _tag: "Pending", waiting: true, data: currentData }
        : { _tag: "Success", waiting: false, data: currentData };
    });

    return {
      builder,
      data,
      state,
      sources,
      evaluate: () => engine.evaluate(),
      preloadEffect: () => preloadSourcesEffect<E, R>(sources, false),
      refetchEffect: () => preloadSourcesEffect<E, R>(sources, true),
      preload: () => runPromise(preloadSourcesEffect<E, R>(sources, false)),
      refetch: () => runPromise(preloadSourcesEffect<E, R>(sources, true))
    };
  };
}

export const createCollection = Collection.define;
export const createLiveQuery = Query.live;
export const createLiveQueryCollection = Collection.liveQuery;
export * from "./flush-policy.js";
export * from "./server-collection.js";
export * from "./sqlite-persistence.js";
