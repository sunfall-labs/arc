import {
  type EffectInputError,
  type EffectInputRequirements,
  type EffectInputCallbackError,
  type EffectInput,
  type EnsureEffectInput,
  type ReadableSignal,
  runFork
} from "@effect-ui/core";
import { Effect, Option, PubSub, Schema, Scope } from "effect";
import {
  backgroundSyncCollectionsPendingMutationsEffect,
  flushCollectionsPendingMutationsEffect,
  type CollectionBackgroundSyncAdapter,
  type CollectionBackgroundSyncAdapterContext,
  type CollectionBackgroundSyncOptions,
  type CollectionBackgroundSyncPending,
  type CollectionBackgroundSyncError,
  type CollectionBackgroundSyncRequirements,
  type CollectionBackgroundSyncResult,
  type CollectionBackgroundSyncTrigger,
  type FlushCollectionPendingMutationsContext,
  type FlushCollectionPendingMutationsResult,
  type FlushCollectionPendingMutationsSkip,
  type FlushCollectionsPendingMutationsError,
  type FlushCollectionsPendingMutationsOptions,
  type FlushCollectionsPendingMutationsRequirements
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
  type SQLitePersistenceTable,
  type SQLiteStatementDatabase as SQLitePersistenceStatementDatabase,
  type SQLiteStatementParams as SQLitePersistenceStatementParams,
  type SQLiteStatementRow as SQLitePersistenceStatementRow,
  type SQLiteStatementValue as SQLitePersistenceStatementValue
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
  type CollectionQuerySyncKeyPart,
  type CollectionQuerySyncMutationInvalidationPolicy,
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
import { UnknownCollectionIndex } from "./collection-index-materialization.js";
import {
  collectionStorageFromSync,
  makeCollectionMemoryStorage,
  CollectionStorageError,
  persistedCollectionOptions
} from "./collection-persistence.js";
import { Query } from "./query-builder.js";
import type { QueryEvaluationError } from "./query-plan.js";
import {
  makeLiveQueryCollectionDefinition,
  type CollectionLiveQueryOptions
} from "./live-query-collection.js";
import { CollectionTypeId } from "./collection-ids.js";
import { ReadonlyCollectionMutation } from "./collection-errors.js";
import {
  CollectionPreloadCollector,
  type CollectionPreloadCollected,
  type CollectionPreloadCollector as CollectionPreloadCollectorState
} from "./collection-preload.js";
import {
  applyCollectionChangesEffect,
  collectionStoreEffect,
  currentCollectionStore,
  defineCollection,
  dehydrateCollections,
  dehydrateCollectionsEffect,
  hydrateCollectionsEffect,
  validateCollectionsHydrationEffect,
  subscribeCollectionChangesEffect,
  subscribeCollectionEventsEffect
} from "./collection-runtime.js";
import {
  collectionRegistryDiagnostics,
  collectionDefinitionRegistry,
  collectionDiagnostics,
  defaultCollectionDefinitionRegistry,
  makeCollectionDefinitionRegistry
} from "./collection-registry.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import type {
  CollectionChangeFeedDispatchPolicy,
  CollectionChangeFeedLateEmitPolicy
} from "./change-feed-dispatcher.js";
import type {
  AnyCollection,
  CollectionChange,
  CollectionDefinition,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics,
  CollectionError,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionIndexDefinition,
  CollectionIndexInput,
  CollectionIndexRecord,
  CollectionIndexResult,
  CollectionIndexValue,
  CollectionKey,
  CollectionLoadState,
  CollectionMemoryStorage,
  CollectionMutation,
  CollectionMutationContext,
  CollectionOrigin,
  CollectionOptions,
  CollectionPendingMutation,
  CollectionPersistedOptions,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionPersistOptions,
  CollectionPolicy,
  CollectionRequirements,
  CollectionRollbackRow,
  CollectionRow,
  CollectionRowSnapshot,
  CollectionRowValue,
  CollectionRuntimeError,
  CollectionSnapshot,
  CollectionStorageLike,
  CollectionStore,
  CollectionStoreDiagnostics,
  CollectionStoreDiagnosticsSnapshot,
  CollectionStoreEvent,
  CollectionSyncDiagnostics,
  CollectionTransaction,
  CollectionUpdate,
  CollectionValue,
  CollectionWriteOptions
} from "./collection-contract.js";
import type {
  CollectionDefinitionDuplicatePolicy,
  CollectionDefinitionDuplicateDiagnostics,
  CollectionDefinitionRegistration,
  CollectionDefinitionRegistryAdapter,
  CollectionDefinitionRegistryDiagnostics,
  CollectionDefinitionRegistryOptions
} from "./collection-registry.js";

type CollectionRowFromOutput<Output extends Schema.Top> =
  Schema.Schema.Type<Output> extends ReadonlyArray<infer A extends object>
    ? A
    : Schema.Schema.Type<Output> extends object
      ? Schema.Schema.Type<Output>
      : never;

type CollectionKeyFromDefinition<Definition> =
  Definition extends { readonly getKey: (value: any) => infer K extends CollectionKey }
    ? K
    : CollectionKey;

type CollectionOptionalReturn<Definition, Key extends PropertyKey> =
  Definition extends { readonly [K in Key]?: (...args: any) => infer Out }
    ? Out
    : never;

type CollectionPersistenceError<Definition> =
  Definition extends {
    readonly persistence: { readonly storage: CollectionPersistenceStorage<infer E, any> };
  }
    ? E
    : never;

type CollectionPersistenceRequirements<Definition> =
  Definition extends {
    readonly persistence: { readonly storage: CollectionPersistenceStorage<any, infer R> };
  }
    ? R
    : never;

type CollectionEffectOutputs<Definition> =
  | CollectionOptionalReturn<Definition, "load">
  | CollectionOptionalReturn<Definition, "refetch">
  | CollectionOptionalReturn<Definition, "onInsert">
  | CollectionOptionalReturn<Definition, "onUpdate">
  | CollectionOptionalReturn<Definition, "onDelete">;

type CollectionErrorFromDefinition<Definition> =
  | EffectInputError<CollectionEffectOutputs<Definition>>
  | CollectionPersistenceError<Definition>;

type CollectionRequirementsFromDefinition<Definition> =
  | EffectInputRequirements<CollectionEffectOutputs<Definition>>
  | CollectionPersistenceRequirements<Definition>;

type RejectCollectionPromiseOutput<Out> =
  [Out] extends [never]
    ? unknown
    : EnsureEffectInput<Out> extends never
      ? never
      : unknown;

type RejectCollectionPromiseOutputs<Definition> =
  RejectCollectionPromiseOutput<CollectionOptionalReturn<Definition, "load">> &
  RejectCollectionPromiseOutput<CollectionOptionalReturn<Definition, "refetch">> &
  RejectCollectionPromiseOutput<CollectionOptionalReturn<Definition, "onInsert">> &
  RejectCollectionPromiseOutput<CollectionOptionalReturn<Definition, "onUpdate">> &
  RejectCollectionPromiseOutput<CollectionOptionalReturn<Definition, "onDelete">>;

export { UnknownCollectionIndex } from "./collection-index-materialization.js";
export { CollectionStoreTypeId, CollectionTypeId } from "./collection-ids.js";
export { CollectionRowKeyChanged, CollectionRowNotFound, ReadonlyCollectionMutation } from "./collection-errors.js";
export { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
export { CollectionPreloadCollector } from "./collection-preload.js";
export type {
  CollectionChangeFeedDispatchPolicy,
  CollectionChangeFeedLateEmitPolicy
} from "./change-feed-dispatcher.js";
export {
  defaultCollectionDefinitionRegistry,
  makeCollectionDefinitionRegistry
} from "./collection-registry.js";
export type {
  AnyCollection,
  CollectionChange,
  CollectionDefinition,
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics,
  CollectionError,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionIndexDefinition,
  CollectionIndexInput,
  CollectionIndexRecord,
  CollectionIndexResult,
  CollectionIndexValue,
  CollectionKey,
  CollectionLoadState,
  CollectionMemoryStorage,
  CollectionMutation,
  CollectionMutationContext,
  CollectionOrigin,
  CollectionOptions,
  CollectionPendingMutation,
  CollectionPersistedOptions,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionPersistOptions,
  CollectionPolicy,
  CollectionRequirements,
  CollectionRollbackRow,
  CollectionRow,
  CollectionRowSnapshot,
  CollectionRowValue,
  CollectionRuntimeError,
  CollectionSnapshot,
  CollectionStorageLike,
  CollectionStore,
  CollectionStoreEvent,
  CollectionSyncDiagnostics,
  CollectionTransaction,
  CollectionUpdate,
  CollectionValue,
  CollectionWriteOptions
} from "./collection-contract.js";
export type {
  CollectionDefinitionDuplicatePolicy,
  CollectionDefinitionDuplicateDiagnostics,
  CollectionDefinitionRegistration,
  CollectionDefinitionRegistryAdapter,
  CollectionDefinitionRegistryDiagnostics,
  CollectionDefinitionRegistryOptions
} from "./collection-registry.js";
export {
  Query,
  and,
  eq,
  gt,
  gte,
  includes,
  lt,
  lte,
  neq,
  not,
  or
} from "./query-builder.js";
export type {
  LiveQuery,
  LiveQueryState,
  QueryFactory,
  QueryRoot
} from "./query-builder.js";
export type { CollectionLiveQueryOptions } from "./live-query-collection.js";
export type {
  CollectionPreloadCollected,
  CollectionPreloadCollector as CollectionPreloadCollectorState
} from "./collection-preload.js";
export { QueryEvaluationError, UnsupportedLiveQuery } from "./query-plan.js";
export type {
  QueryAggregate,
  QueryAggregateRecord,
  QueryAggregateResult,
  QueryEvaluationOperation,
  QueryGroupKey,
  QueryJoinKey,
  QueryJoinStrategy,
  QueryPlanDiagnostics,
  QueryPlanJoinDiagnostics,
  QueryPlanSourceDiagnostics,
  QuerySortDirection,
  QuerySortValue
} from "./query-plan.js";

export { persistedCollectionOptions } from "./collection-persistence.js";

/**
 * Create a read-only collection from a live query.
 *
 * The collection materializes query results for reads, indexes, and joins.
 * Mutation effects fail with `ReadonlyCollectionMutation`; use the source
 * collections for writes.
 */
export const makeLiveQueryCollection = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: CollectionLiveQueryOptions<A, K, E, R>,
  registry: CollectionDefinitionRegistryAdapter = defaultCollectionDefinitionRegistry
): CollectionDefinition<A, K, E | QueryEvaluationError | ReadonlyCollectionMutation, R> =>
  makeLiveQueryCollectionDefinition(options, (name, definition) => {
    registry.register(name, definition);
  });

/**
 * Type guard for runtime collection definitions.
 */
const isCollectionDefinition = (value: unknown): value is AnyCollection =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CollectionTypeId]?: unknown })[CollectionTypeId] === CollectionTypeId;

/** Type guard for runtime collection definitions. */
export const isCollection = isCollectionDefinition;

/**
 * Main collection API namespace.
 *
 * Prefer the `*Effect` entrypoints in application code so errors and service
 * requirements stay typed in Effect. Non-Effect helpers either read synchronously
 * from the current runtime store or fork work onto the current runtime.
 */
export namespace Collection {
  /** Runtime definition returned by `Collection.define(...)`. */
  export type Definition<A extends object, K extends CollectionKey = string, E = never, R = never> = CollectionDefinition<A, K, E, R>;
  /** Stored row shape with collection key metadata attached. */
  export type Row<A extends object, K extends CollectionKey = CollectionKey> = CollectionRow<A, K>;
  /** Key values accepted by collections and row references. */
  export type Key = CollectionKey;
  /** Origin marker for local, remote, or hydrated collection rows. */
  export type Origin = CollectionOrigin;
  /** Reactive load state for one collection. */
  export type State<E = never> = CollectionLoadState<E>;
  /** Runtime collection error channel including callback and storage failures. */
  export type RuntimeError<E = never> = CollectionRuntimeError<E>;
  /** Optimistic mutation record queued for a collection. */
  export type Mutation<A extends object, K extends CollectionKey> = CollectionMutation<A, K>;
  /** Committed mutation transaction record for diagnostics and rollback. */
  export type Transaction<A extends object, K extends CollectionKey> = CollectionTransaction<A, K>;
  /** Context passed to collection mutation handlers. */
  export type MutationContext<A extends object, K extends CollectionKey> = CollectionMutationContext<A, K>;
  /** Previous row snapshot retained for rollback. */
  export type RollbackRow<A extends object, K extends CollectionKey> = CollectionRollbackRow<A, K>;
  /** Mutation waiting for its handler to flush. */
  export type PendingMutation<A extends object, K extends CollectionKey> = CollectionPendingMutation<A, K>;
  /** Collection reload, garbage collection, and retry policy. */
  export type Policy<E = never> = CollectionPolicy<E>;
  /** Sync adapter diagnostic facts for a collection. */
  export type SyncDiagnostics = CollectionSyncDiagnostics;
  /** Scalar value accepted by collection secondary indexes; Dates must be valid. */
  export type IndexValue = CollectionIndexValue;
  /** Result row stored under one secondary index key. */
  export type IndexResult = CollectionIndexResult;
  /** Secondary index definition for collection rows. */
  export type IndexDefinition<A extends object> = CollectionIndexDefinition<A>;
  /** User-facing secondary index configuration. */
  export type IndexInput<A extends object> = CollectionIndexInput<A>;
  /** Map of named secondary indexes for a collection. */
  export type IndexRecord<A extends object> = CollectionIndexRecord<A>;
  /** Runtime in-memory store shared by collection definitions. */
  export type Store = CollectionStore;
  /** Diagnostics facade for the current collection store. */
  export type StoreDiagnostics = CollectionStoreDiagnostics;
  /** Serializable snapshot of collection store diagnostics. */
  export type StoreDiagnosticsSnapshot = CollectionStoreDiagnosticsSnapshot;
  /** Lifecycle event emitted by the collection store. */
  export type StoreEvent = CollectionStoreEvent;
  /** Partial row update payload. */
  export type Update<A extends object> = CollectionUpdate<A>;
  /** Remote or local row change event. */
  export type Change<A extends object, K extends CollectionKey = CollectionKey> = CollectionChange<A, K>;
  /** Durable snapshot for one collection row. */
  export type RowSnapshot<A extends object, K extends CollectionKey> = CollectionRowSnapshot<A, K>;
  /** Durable snapshot for one collection. */
  export type Snapshot<A extends object = object, K extends CollectionKey = CollectionKey> = CollectionSnapshot<A, K>;
  /** Multi-collection hydration payload used by Start and persistence. */
  export type HydrationPayload = CollectionHydrationPayload;
  /** Options for applying collection hydration payloads. */
  export type HydrateOptions = CollectionHydrateOptions;
  /** Error raised when collection snapshots fail validation or serialization. */
  export type SnapshotCodecError = CollectionSnapshotCodecError;
  /** Effect-aware key/value storage contract for collection persistence. */
  export type PersistenceStorage<E = never, R = never> = CollectionPersistenceStorage<E, R>;
  /** Options for writing a collection snapshot to persistence. */
  export type PersistOptions = CollectionPersistOptions;
  /** Persistence policy attached to a collection definition. */
  export type PersistenceConfig<E = never, R = never> = CollectionPersistenceConfig<E, R>;
  /** Collection options with persistence error and requirement channels preserved. */
  export type PersistedOptions<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
    PE = never,
    PR = never
  > = CollectionPersistedOptions<A, K, E, R, PE, PR>;
  /** Options for materializing a read-only collection from a live query. */
  export type LiveQueryOptions<A extends object, K extends CollectionKey, E = never, R = never> =
    CollectionLiveQueryOptions<A, K, E, R>;
  /** Synchronous Web Storage-like shape accepted by `Collection.storage(...)`. */
  export type StorageLike = CollectionStorageLike;
  /** In-memory persistence storage for tests, demos, and ephemeral state. */
  export type MemoryStorage = CollectionMemoryStorage;
  /** Diagnostics for one registered collection definition. */
  export type DefinitionDiagnostics = CollectionDefinitionDiagnostics;
  /** Registry-level diagnostics for collection definitions. */
  export type Diagnostics = CollectionDiagnostics;
  /** Adapter that owns collection definition registration policy. */
  export type DefinitionRegistryAdapter = CollectionDefinitionRegistryAdapter;
  /** Options for an isolated collection definition registry. */
  export type DefinitionRegistryOptions = CollectionDefinitionRegistryOptions;
  /** Registration result for one collection definition. */
  export type DefinitionRegistration = CollectionDefinitionRegistration;
  /** Duplicate-name policy for collection definition registration. */
  export type DefinitionDuplicatePolicy = CollectionDefinitionDuplicatePolicy;
  /** Diagnostics for duplicate collection definition registrations. */
  export type DefinitionDuplicateDiagnostics = CollectionDefinitionDuplicateDiagnostics;
  /** Snapshot of collection definition registry diagnostics. */
  export type DefinitionRegistryDiagnostics = CollectionDefinitionRegistryDiagnostics;
  /** Scoped collector state used during SSR/data preload. */
  export type PreloadCollector = CollectionPreloadCollectorState;
  /** Value plus ordered collection definitions collected during preload. */
  export type Collected<A> = CollectionPreloadCollected<A>;
  /** Options for creating collection definitions from server operations. */
  export type ServerOptions<A extends object, K extends CollectionKey = string, E = never, R = never> =
    ServerCollectionOptions<A, K, E, R>;
  /** Server operation callback accepted by server-backed collections. */
  export type ServerOperation<I, A, E = never, R = never> = ServerCollectionOperation<I, A, E, R>;
  /** Result returned by server-backed collection operations. */
  export type ServerResult<A, E = never, R = never> = ServerCollectionResult<A, E, R>;
  /** Insert payload sent through collection server operations. */
  export type ServerInsertPayload<A extends object, K extends CollectionKey> = ServerCollectionInsertPayload<A, K>;
  /** Update payload sent through collection server operations. */
  export type ServerUpdatePayload<A extends object, K extends CollectionKey> = ServerCollectionUpdatePayload<A, K>;
  /** Delete payload sent through collection server operations. */
  export type ServerDeletePayload<A extends object, K extends CollectionKey> = ServerCollectionDeletePayload<A, K>;
  /** Sync adapter contract for loading and mutating remote collection data. */
  export type SyncAdapter<A extends object, K extends CollectionKey = string, E = never, R = never> =
    CollectionSyncAdapter<A, K, E, R>;
  /** Collection options produced from a sync adapter. */
  export type SyncOptions<A extends object, K extends CollectionKey = string, E = never, R = never> =
    CollectionSyncOptions<A, K, E, R>;
  /** Options for adapting a Core Resource into a collection sync adapter. */
  export type ResourceSyncAdapterOptions<I, A extends object, K extends CollectionKey = string, E = never, R = never> =
    CollectionResourceSyncAdapterOptions<I, A, K, E, R>;
  /** Stable cache key used by query-sync adapters. */
  export type QuerySyncKey = CollectionQuerySyncKey;
  /** One structured segment inside a query-sync cache key. */
  export type QuerySyncKeyPart = CollectionQuerySyncKeyPart;
  /** Options passed when a query-sync adapter fetches rows. */
  export type QuerySyncFetchOptions<A extends object, E = never, R = never> =
    CollectionQuerySyncFetchOptions<A, E, R>;
  /** Options for invalidating query-sync client cache entries. */
  export type QuerySyncInvalidateOptions = CollectionQuerySyncInvalidateOptions;
  /** Query-client bridge used by query-sync adapters. */
  export type QuerySyncClient<A extends object, E = never, R = never> =
    CollectionQuerySyncClient<A, E, R>;
  /** Options for adapting a query client into a collection sync adapter. */
  export type QuerySyncAdapterOptions<A extends object, K extends CollectionKey = string, E = never, R = never> =
    CollectionQuerySyncAdapterOptions<A, K, E, R>;
  /** Policy for invalidating query-sync caches after mutations. */
  export type QuerySyncMutationInvalidationPolicy = CollectionQuerySyncMutationInvalidationPolicy;
  /** Cleanup callback returned by collection change feeds. */
  export type ChangeFeedUnsubscribe<E = never, R = never> = CollectionChangeFeedUnsubscribe<E, R>;
  /** Active remote change-feed subscription. */
  export type ChangeFeedSubscription<E = never, R = never> = CollectionChangeFeedSubscription<E, R>;
  /** Context passed to change-feed adapters. */
  export type ChangeFeedContext<A extends object, K extends CollectionKey = string, E = never, R = never> =
    CollectionChangeFeedContext<A, K, E, R>;
  /** Remote change-feed adapter that emits collection changes. */
  export type ChangeFeedAdapter<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
    CollectionError = never,
    CollectionRequirements = never
  > =
    CollectionChangeFeedAdapter<A, K, E, R, CollectionError, CollectionRequirements>;
  /** Options for subscribing a collection to a change feed. */
  export type ChangeFeedSubscribeOptions = CollectionChangeFeedSubscribeOptions;
  /** Dispatch behavior for incoming change-feed events. */
  export type ChangeFeedDispatchPolicy = CollectionChangeFeedDispatchPolicy;
  /** Policy for handling change-feed emissions after unsubscribe. */
  export type ChangeFeedLateEmitPolicy = CollectionChangeFeedLateEmitPolicy;
  /** Insert change emitted by sync/change-feed protocols. */
  export type SyncInsertPayload<A extends object, K extends CollectionKey> = CollectionSyncInsertPayload<A, K>;
  /** Update change emitted by sync/change-feed protocols. */
  export type SyncUpdatePayload<A extends object, K extends CollectionKey> = CollectionSyncUpdatePayload<A, K>;
  /** Delete change emitted by sync/change-feed protocols. */
  export type SyncDeletePayload<A extends object, K extends CollectionKey> = CollectionSyncDeletePayload<A, K>;
  /** Context passed when flushing pending mutations across collections. */
  export type FlushAllPendingMutationsContext = FlushCollectionPendingMutationsContext;
  /** Predicate for skipping a background flush attempt. */
  export type FlushAllPendingMutationsSkip<SkipError = never, SkipRequirements = never> =
    FlushCollectionPendingMutationsSkip<SkipError, SkipRequirements>;
  /** Options for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsOptions<SkipError = never, SkipRequirements = never> =
    FlushCollectionsPendingMutationsOptions<SkipError, SkipRequirements>;
  /** Error channel for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsError<
    Collections extends Iterable<AnyCollection>,
    SkipError = never
  > = FlushCollectionsPendingMutationsError<Collections, SkipError>;
  /** Requirement channel for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsRequirements<
    Collections extends Iterable<AnyCollection>,
    SkipRequirements = never
  > = FlushCollectionsPendingMutationsRequirements<Collections, SkipRequirements>;
  /** Result of flushing pending mutations across collections. */
  export type FlushAllPendingMutationsResult = FlushCollectionPendingMutationsResult;
  /** Event that triggered a collection background sync attempt. */
  export type BackgroundSyncTrigger = CollectionBackgroundSyncTrigger;
  /** Pending-mutation facts passed to background sync logic. */
  export type BackgroundSyncPending = CollectionBackgroundSyncPending;
  /** Context passed to background sync adapters. */
  export type BackgroundSyncAdapterContext = CollectionBackgroundSyncAdapterContext;
  /** Adapter that performs background sync for pending mutations. */
  export type BackgroundSyncAdapter<AdapterError = never, AdapterRequirements = never> =
    CollectionBackgroundSyncAdapter<AdapterError, AdapterRequirements>;
  /** Background sync policy and adapter options. */
  export type BackgroundSyncOptions<
    AdapterError = never,
    AdapterRequirements = never,
    SkipError = never,
    SkipRequirements = never
  > = CollectionBackgroundSyncOptions<AdapterError, AdapterRequirements, SkipError, SkipRequirements>;
  /** Error channel for background sync pending-mutation evaluation. */
  export type BackgroundSyncError<
    Collections extends Iterable<AnyCollection>,
    AdapterError = never,
    SkipError = never
  > = CollectionBackgroundSyncError<Collections, AdapterError, SkipError>;
  /** Requirement channel for background sync pending-mutation evaluation. */
  export type BackgroundSyncRequirements<
    Collections extends Iterable<AnyCollection>,
    AdapterRequirements = never,
    SkipRequirements = never
  > = CollectionBackgroundSyncRequirements<Collections, AdapterRequirements, SkipRequirements>;
  /** Result returned by background sync attempts. */
  export type BackgroundSyncResult = CollectionBackgroundSyncResult;
  /** SQLite persistence storage key shape. */
  export type SQLiteStorageKey = SQLitePersistenceKey;
  /** SQLite persistence storage row shape. */
  export type SQLiteStorageRow = SQLitePersistenceRow;
  /** SQL table adapter used by SQLite persistence. */
  export type SQLiteStorageTable<E = never, R = never> = SQLitePersistenceTable<E, R>;
  /** Driver abstraction used by SQLite persistence storage. */
  export type SQLiteStorageDriver<E = never, R = never> = SQLitePersistenceDriver<E, R>;
  /** Options for SQLite persistence storage. */
  export type SQLiteStorageOptions = SQLitePersistenceOptions;
  /** In-memory SQL statement handle. */
  export type SQLiteMemoryStatement = SQLitePersistenceMemoryStatement;
  /** In-memory SQL statement database. */
  export type SQLiteMemoryStatementDatabase = SQLitePersistenceMemoryStatementDatabase;
  /** Scalar value accepted by SQLite statement parameters and rows. */
  export type SQLiteStatementValue = SQLitePersistenceStatementValue;
  /** Positional SQLite statement parameters. */
  export type SQLiteStatementParams = SQLitePersistenceStatementParams;
  /** Row returned by a SQLite statement. */
  export type SQLiteStatementRow = SQLitePersistenceStatementRow;
  /** Minimal SQL statement database accepted by the persistence adapter. */
  export type SQLiteStatementDatabase<E = never, R = never> = SQLitePersistenceStatementDatabase<E, R>;
  /** Prepared SQLite statement returned by adapted databases. */
  export type SQLitePreparedStatement<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = never,
    R = never
  > = SQLitePersistencePreparedStatement<Row, E, R>;
  /** Prepared-statement database adapter for SQLite persistence. */
  export type SQLitePreparedStatementDatabase<
    Row extends SQLiteStatementRow = SQLiteStatementRow,
    E = never,
    R = never
  > = SQLitePersistencePreparedStatementDatabase<Row, E, R>;
  /** Options for adapting prepare/run/all style SQLite clients. */
  export type SQLitePreparedStatementDatabaseOptions = SQLitePersistencePreparedStatementDatabaseOptions;

  /** Build `Collection.define` options from server functions or Effect callbacks. */
  export const serverOptions = serverCollectionOptions;
  /** Build a sync adapter from server functions or Effect callbacks. */
  export const serverSyncAdapter = serverCollectionSyncAdapter;
  /** Adapt an `@effect-ui/core` Resource ref into a collection sync adapter. */
  export const resourceSyncAdapter = collectionResourceSyncAdapter;
  /** Adapt a query client style cache into a collection sync adapter. */
  export const querySyncAdapter = collectionQuerySyncAdapter;
  /** Convert a sync adapter into `Collection.define` options. */
  export const syncOptions = collectionSyncOptions;
  /** Attach persistence while preserving storage error and requirement types. */
  export const persistedOptions = persistedCollectionOptions;
  /** Create a read-only collection from a live query result. */
  export const liveQuery = makeLiveQueryCollection;
  /** Build an isolated collection definition registry adapter. */
  export const makeRegistry = makeCollectionDefinitionRegistry;
  /** Process-wide collection definition registry adapter used by default. */
  export const defaultRegistry = defaultCollectionDefinitionRegistry;
  /** Flush queued optimistic mutations across many collections. */
  export const flushAllPendingMutationsEffect = flushCollectionsPendingMutationsEffect;
  /** Decide whether to flush pending mutations for background sync triggers. */
  export const backgroundSyncPendingMutationsEffect = backgroundSyncCollectionsPendingMutationsEffect;
  /** Build collection persistence storage from a SQLite persistence driver. */
  export const sqliteStorage = makeSQLitePersistenceStorage;
  /** Adapt prepare/run/all style SQLite clients to statement database storage. */
  export const sqlitePreparedStatementDatabase = makeSQLitePreparedStatementDatabase;
  /** Build a persistence driver from a simple SQL statement database. */
  export const sqliteStatementDriver = makeSQLiteStatementPersistenceDriver;
  /** In-memory SQL statement database for tests and demos. */
  export const sqliteMemoryStatementDatabase = makeSQLiteMemoryStatementDatabase;

  /**
   * Define a local-first collection.
   *
   * Reads are synchronous from an in-memory store. Loads, mutation handlers, and
   * persistence run through Effect so failures stay in `E` and services stay in
   * `R`.
   *
   * @example
   * const todos = Collection.define({
   *   name: "todos",
   *   getKey: (todo) => todo.id,
   *   load: () => TodoApi.list,
   *   onInsert: (values) => TodoApi.createMany(values)
   * })
   */
  export function define<
    const Output extends Schema.Top,
    const Definition extends Omit<
      CollectionOptions<CollectionRowFromOutput<Output>, CollectionKey, any, any>,
      "output"
    > & {
      readonly output: Output;
    }
  >(
    options: Definition & RejectCollectionPromiseOutputs<Definition>,
    registry?: CollectionDefinitionRegistryAdapter
  ): CollectionDefinition<
    CollectionRowFromOutput<Output>,
    CollectionKeyFromDefinition<Definition>,
    CollectionErrorFromDefinition<Definition>,
    CollectionRequirementsFromDefinition<Definition>
  >;
  export function define<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never
  >(
    options: Omit<CollectionOptions<A, K, E, R>, "load"> & {
      readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
    },
    registry?: CollectionDefinitionRegistryAdapter
  ): CollectionDefinition<A, K, E, R>;
  export function define(
    options: CollectionOptions<any, any, any, any>,
    registry: CollectionDefinitionRegistryAdapter = defaultCollectionDefinitionRegistry
  ): CollectionDefinition<any, any, any, any> {
    return defineCollection(options, (name, definition) => {
      registry.register(name, definition);
    });
  }

  /** Return the process-wide registry of named collection definitions. */
  export const definitions = (): ReadonlyMap<string, AnyCollection> =>
    collectionDefinitionRegistry();

  /** Type guard for values that are full Collection definitions. */
  export const isCollection = isCollectionDefinition;

  /** Describe registered collections, indexes, handlers, sync, and persistence. */
  export const diagnostics = (): CollectionDiagnostics =>
    collectionDiagnostics();

  /** Describe the process-wide registry, including duplicate registrations. */
  export const registryDiagnostics = (): CollectionDefinitionRegistryDiagnostics =>
    collectionRegistryDiagnostics();

  /** Reactive load state signal for a collection. */
  export const state = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadableSignal<CollectionLoadState<CollectionRuntimeError<E>>> => definition.state();

  /** Reactive version signal that changes when rows or pending mutations change. */
  export const version = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadableSignal<number> => definition.version();

  /** Read one row by key from current in-memory state. */
  export const get = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    key: K
  ): CollectionRow<A, K> | undefined => definition.get(key);

  /** Read all current rows, including local optimistic rows. */
  export const rows = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadonlyArray<CollectionRow<A, K>> => definition.rows();

  /** Read rows from a named secondary index bucket. */
  export const index = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    index: string,
    value: CollectionIndexValue
  ): ReadonlyArray<CollectionRow<A, K>> => definition.index(index, value);

  /** Read the first row from a named secondary index bucket. */
  export const firstByIndex = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    index: string,
    value: CollectionIndexValue
  ): CollectionRow<A, K> | undefined => definition.firstByIndex(index, value);

  /**
   * Ensure a collection has loaded once.
   *
   * Restores configured persistence first, then skips `load` when data is
   * already ready. Errors and requirements come from the collection definition.
   */
  export const preloadEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<void, CollectionRuntimeError<E>, R> => definition.preloadEffect();

  /**
   * Force a fresh load for a collection.
   */
  export const refetchEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<void, CollectionRuntimeError<E>, R> => definition.refetchEffect();

  /**
   * Run an Effect and collect any collections it preloads.
   *
   * Useful for SSR or route loaders that need data plus a hydration payload.
   * The returned definitions are ordered preload facts. Nested collection
   * collectors propagate their facts to the parent collector; dehydration
   * dedupes identical definitions and rejects distinct same-name definitions.
   */
  export const collectEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<CollectionPreloadCollected<A>, E, R> =>
    Effect.gen(function* () {
      const parentCollector = yield* Effect.serviceOption(CollectionPreloadCollector);
      const collector: CollectionPreloadCollectorState = { definitions: [] };
      const value = yield* Effect.provideService(effect, CollectionPreloadCollector, collector);
      if (Option.isSome(parentCollector)) {
        parentCollector.value.definitions.push(...collector.definitions);
      }
      return {
        value,
        definitions: collector.definitions.slice()
      };
    });

  /** Return queued optimistic mutations waiting for handlers to commit. */
  export const pendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>> => definition.pendingMutationsEffect();

  /** Synchronously read queued optimistic mutations from the current runtime store. */
  export const pendingMutations = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): ReadonlyArray<CollectionPendingMutation<A, K>> => definition.pendingMutations();

  /** Retry all queued mutation handlers for one collection. */
  export const flushPendingMutationsEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, CollectionRuntimeError<E>, R> => definition.flushPendingMutationsEffect();

  /** Capture a durable serializable snapshot with an Effect-provided timestamp. */
  export const snapshotEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError> => definition.snapshotEffect();

  /** Synchronous inspection snapshot; durable workflows should use `snapshotEffect`. */
  export const snapshot = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>
  ): CollectionSnapshot<A, K> => definition.snapshot();

  /**
   * Restore one collection from a snapshot.
   *
   * By default hydration replaces existing rows and pending mutations. Pass
   * `{ replace: false }` to merge into current state.
   */
  export const hydrateEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    value: CollectionSnapshot<A, K>,
    options?: CollectionHydrateOptions
  ): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> => definition.hydrateEffect(value, options);

  /** Fork `hydrateEffect` on the current runtime. */
  export const hydrate = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    value: CollectionSnapshot<A, K>,
    options?: CollectionHydrateOptions
  ): void => definition.hydrate(value, options);

  /** Snapshot several collections synchronously for UI inspection. */
  export const dehydrate = (
    collections: Iterable<AnyCollection>
  ): CollectionHydrationPayload => dehydrateCollections(collections);

  /** Snapshot several collections durably with an Effect-provided timestamp. */
  export const dehydrateEffect = (
    collections: Iterable<AnyCollection>
  ): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError | EffectInputCallbackError> => dehydrateCollectionsEffect(collections);

  /** Hydrate matching collections from a multi-collection payload. */
  export const hydratePayloadEffect = (
    collections: Iterable<AnyCollection>,
    payload: CollectionHydrationPayload,
    options?: CollectionHydrateOptions
  ): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> => hydrateCollectionsEffect(collections, payload, options);

  /** Validate a multi-collection hydration payload without applying it. */
  export const validateHydrationPayloadEffect = (
    collections: Iterable<AnyCollection>,
    payload: CollectionHydrationPayload,
    options?: CollectionHydrateOptions
  ): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> => validateCollectionsHydrationEffect(collections, payload, options);

  /** Fork `hydratePayloadEffect` on the current runtime. */
  export const hydratePayload = (
    collections: Iterable<AnyCollection>,
    payload: CollectionHydrationPayload,
    options?: CollectionHydrateOptions
  ): void => {
    void runFork(hydratePayloadEffect(collections, payload, options));
  };

  /**
   * Apply remote change-feed events without queuing local mutation handlers.
   */
  export const applyChangesEffect = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): Effect.Effect<void, CollectionRuntimeError<E>, R> => applyCollectionChangesEffect(definition, changes, options);

  /** Fork `applyChangesEffect` on the current runtime. */
  export const applyChanges = <A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): void => {
    void runFork(applyCollectionChangesEffect(definition, changes, options));
  };

  /**
   * Subscribe a collection to a scoped remote change feed.
   *
   * Requires `Scope.Scope`; feed errors/requirements are unioned with the
   * collection channels.
   */
  export const subscribeChangesEffect = <
    A extends object,
    K extends CollectionKey,
    E,
    R,
    FeedError = never,
    FeedRequirements = never
  >(
    definition: CollectionDefinition<A, K, E, R>,
    adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements, E, R>,
    options?: CollectionChangeFeedSubscribeOptions
  ): Effect.Effect<void, CollectionRuntimeError<E> | FeedError, R | FeedRequirements | Scope.Scope> =>
    subscribeCollectionChangesEffect(definition, adapter, options);

  /**
   * Persist one collection snapshot to storage.
   *
   * The storage backend controls the Effect error and requirement channels.
   */
  export const persistEffect = <A extends object, K extends CollectionKey, E, R, PE = never, PR = never>(
    definition: CollectionDefinition<A, K, E, R>,
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> => definition.persistEffect(storage, options);

  /**
   * Restore one collection snapshot from storage if present.
   */
  export const restoreEffect = <A extends object, K extends CollectionKey, E, R, PE = never, PR = never>(
    definition: CollectionDefinition<A, K, E, R>,
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR> => definition.restoreEffect(storage, options);

  /** Create in-memory persistence storage for tests, demos, or ephemeral data. */
  export const memoryStorage = (initial?: Iterable<readonly [string, string]>): CollectionMemoryStorage =>
    makeCollectionMemoryStorage(initial);

  /** Adapt synchronous Web Storage style APIs to Effect-aware persistence storage. */
  export const storage = (storage: CollectionStorageLike): CollectionPersistenceStorage<CollectionStorageError, never> =>
    collectionStorageFromSync(storage);

  /** Access the current runtime collection store as an Effect. */
  export const storeEffect = (): Effect.Effect<CollectionStore> =>
    collectionStoreEffect;

  /** Access the current runtime collection store synchronously. */
  export const currentStore = (): CollectionStore =>
    currentCollectionStore();

  /** Subscribe to collection lifecycle events inside a Scope. */
  export const subscribeEventsEffect = (): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope> =>
    subscribeCollectionEventsEffect();
}

/**
 * Compatibility alias for `Collection.define(...)`.
 *
 * Prefer `Collection.define(...)` in new code so DB APIs stay grouped under
 * their owning namespace in LSP hovers and generated docs.
 *
 * @deprecated Use `Collection.define(...)`.
 */
export const createCollection = Collection.define;
/**
 * Compatibility alias for `Query.live(...)`.
 *
 * Prefer `Query.live(...)` in new code so query APIs stay grouped under their
 * owning namespace in LSP hovers and generated docs.
 *
 * @deprecated Use `Query.live(...)`.
 */
export const createLiveQuery = Query.live;
/**
 * Compatibility alias for `Collection.liveQuery(...)`.
 *
 * Prefer `Collection.liveQuery(...)` in new code so live-query collection APIs
 * stay grouped under their owning namespace in LSP hovers and generated docs.
 *
 * @deprecated Use `Collection.liveQuery(...)`.
 */
export const createLiveQueryCollection = Collection.liveQuery;
export * from "./flush-policy.js";
export * from "./server-collection.js";
export * from "./collection-reactive-binding.js";
export { CollectionStorageError } from "./collection-persistence.js";
export * from "./sqlite-persistence.js";
