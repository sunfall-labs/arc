import type {
  EffectInputError,
  EffectInputRequirements,
  EnsureEffectInput,
  ResourceLoadError,
  ResourceRef,
} from "@sunfall/arc-core";
import type { Schema, Stream } from "effect";
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
  type FlushCollectionsPendingMutationsRequirements,
} from "./flush-policy.js";
import {
  collectionStorageFromSync,
  makeCollectionMemoryStorage,
  type CollectionStorageError,
} from "./collection-persistence.js";
import type { QueryEvaluationError } from "./query-plan.js";
import {
  makeLiveQueryCollectionDefinition,
  type CollectionLiveQueryOptions,
} from "./live-query-collection.js";
import type { ReadonlyCollectionMutation } from "./collection-errors.js";
import { defineCollection } from "./collection-runtime.js";
import type {
  AnyCollection,
  CollectionChange,
  CollectionDefinition,
  CollectionError,
  CollectionHydrateOptions,
  CollectionHydrationPayload,
  CollectionIndexDefinition,
  CollectionIndexInput,
  CollectionIndexRecord,
  CollectionIndexResult,
  CollectionIndexValue,
  CollectionKey,
  CollectionMemoryStorage,
  CollectionMutation,
  CollectionMutationContext,
  CollectionOrigin,
  CollectionOptions,
  CollectionPendingMutation,
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
  CollectionSync,
  CollectionSyncAdapter,
  CollectionSyncDeletePayload,
  CollectionSyncInsertPayload,
  CollectionSyncUpdatePayload,
  CollectionTransaction,
  CollectionUpdate,
  CollectionValue,
  CollectionWriteOptions,
} from "./collection-contract.js";

// `Output["Type"]` stays resolvable for generic schemas, unlike the
// `infer`-based `Schema.Schema.Type`.
type CollectionRowFromOutput<Output extends Schema.Top> =
  Output["Type"] extends ReadonlyArray<infer A extends object>
    ? A
    : Output["Type"] extends object
      ? Output["Type"]
      : never;

type CollectionSyncFromDefinition<Definition> = Definition extends {
  readonly sync: infer Sync;
}
  ? Sync
  : never;

type CollectionSyncReturn<Sync, Key extends PropertyKey> = Sync extends {
  readonly [K in Key]: (...args: any) => infer Out;
}
  ? Out
  : never;

type CollectionSyncEffectOutputs<Sync> =
  | CollectionSyncReturn<Sync, "load">
  | CollectionSyncReturn<Sync, "refresh">
  | CollectionSyncReturn<Sync, "insert">
  | CollectionSyncReturn<Sync, "update">
  | CollectionSyncReturn<Sync, "delete">;

type CollectionSyncStreams<Sync> =
  | CollectionSyncReturn<Sync, "follow">
  | CollectionSyncReturn<Sync, "changes">;

// Distributive so an absent stream (`never`) contributes no error/requirement.
type CollectionStreamError<S> = S extends Stream.Stream<any, infer E, any> ? E : never;
type CollectionStreamRequirements<S> = S extends Stream.Stream<any, any, infer R> ? R : never;

type CollectionSyncError<Sync> = [Sync] extends [never]
  ? never
  : Sync extends ResourceRef<any, any, infer E, any>
    ? ResourceLoadError<E>
    :
        | EffectInputError<CollectionSyncEffectOutputs<Sync>>
        | CollectionStreamError<CollectionSyncStreams<Sync>>;

type CollectionSyncRequirements<Sync> = [Sync] extends [never]
  ? never
  : Sync extends ResourceRef<any, any, any, infer R>
    ? R
    :
        | EffectInputRequirements<CollectionSyncEffectOutputs<Sync>>
        | CollectionStreamRequirements<CollectionSyncStreams<Sync>>;

type CollectionPersistenceError<Definition> = Definition extends {
  readonly persistence: { readonly storage: CollectionPersistenceStorage<infer E, any> };
}
  ? E
  : never;

type CollectionPersistenceRequirements<Definition> = Definition extends {
  readonly persistence: { readonly storage: CollectionPersistenceStorage<any, infer R> };
}
  ? R
  : never;

type CollectionErrorFromDefinition<Definition> =
  | CollectionSyncError<CollectionSyncFromDefinition<Definition>>
  | CollectionPersistenceError<Definition>;

type CollectionRequirementsFromDefinition<Definition> =
  | CollectionSyncRequirements<CollectionSyncFromDefinition<Definition>>
  | CollectionPersistenceRequirements<Definition>;

type RejectCollectionPromiseOutput<Out> = [Out] extends [never]
  ? unknown
  : EnsureEffectInput<Out> extends never
    ? never
    : unknown;

type RejectCollectionPromiseOutputs<Definition> = RejectCollectionPromiseOutput<
  CollectionSyncEffectOutputs<CollectionSyncFromDefinition<Definition>>
>;

export {
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  ReadonlyCollectionMutation,
} from "./collection-errors.js";
export { UnknownCollectionIndex } from "./collection-index-materialization.js";
export { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
export { CollectionStorageError } from "./collection-persistence.js";
export { QueryEvaluationError, UnsupportedLiveQuery } from "./query-plan.js";
export { Query } from "./query-builder.js";
export {
  SQLitePersistence,
  SQLitePersistenceInvalidRow,
  SQLitePersistenceInvalidStatementParams,
  SQLitePersistenceInvalidTableName,
  SQLitePersistenceUnsupportedStatement,
} from "./sqlite-persistence.js";

/**
 * Main collection API namespace.
 *
 * `Collection.define(...)` returns a definition whose methods are the single
 * way to read and write it: synchronous reactive reads (`rows`, `get`,
 * `index`, `result`, ...) and Effect-returning methods for loads and writes
 * (`preload`, `refresh`, `insert`, `update`, `delete`, `applyChanges`, ...),
 * which keep errors and service requirements typed in Effect.
 */
export namespace Collection {
  /** Runtime definition returned by `Collection.define(...)`. */
  export type Definition<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionDefinition<A, K, E, R>;
  /**
   * Erased definition used over heterogeneous collection lists while
   * preserving error and requirement channels where possible.
   */
  export type Any<E = unknown, R = unknown> = AnyCollection<E, R>;
  /** Extracts the domain value type from a definition. */
  export type Value<C> = CollectionValue<C>;
  /** Extracts the public row type, including `$key` metadata, from a definition. */
  export type RowValue<C> = CollectionRowValue<C>;
  /** Extracts the declared sync/persistence error channel from a definition. */
  export type Error<C> = CollectionError<C>;
  /** Extracts the declared service requirements from a definition. */
  export type Requirements<C> = CollectionRequirements<C>;
  /** Options accepted by `Collection.define(...)`. */
  export type Options<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionOptions<A, K, E, R>;
  /** Stored row shape with collection key metadata attached. */
  export type Row<A extends object, K extends CollectionKey = CollectionKey> = CollectionRow<A, K>;
  /** Key values accepted by collections and row references. */
  export type Key = CollectionKey;
  /** Origin marker for local or remote collection rows. */
  export type Origin = CollectionOrigin;
  /** Runtime collection error channel including callback and codec failures. */
  export type RuntimeError<E = never> = CollectionRuntimeError<E>;
  /** Optimistic mutation record queued for a collection. */
  export type Mutation<A extends object, K extends CollectionKey> = CollectionMutation<A, K>;
  /** Committed mutation transaction record for diagnostics and rollback. */
  export type Transaction<A extends object, K extends CollectionKey> = CollectionTransaction<A, K>;
  /** Context carried by sync adapter mutation payloads. */
  export type MutationContext<
    A extends object,
    K extends CollectionKey,
  > = CollectionMutationContext<A, K>;
  /** Previous row snapshot retained for rollback. */
  export type RollbackRow<A extends object, K extends CollectionKey> = CollectionRollbackRow<A, K>;
  /** Mutation waiting for its sync adapter to commit. */
  export type PendingMutation<
    A extends object,
    K extends CollectionKey,
  > = CollectionPendingMutation<A, K>;
  /** Collection retry policy. */
  export type Policy<E = never> = CollectionPolicy<E>;
  /** Backing source accepted by `sync`: an inline adapter or a `Resource.Ref`. */
  export type Sync<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSync<A, K, E, R>;
  /** Inline sync adapter for loading, following, and committing remote data. */
  export type SyncAdapter<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSyncAdapter<A, K, E, R>;
  /** Payload passed to `sync.insert`. */
  export type SyncInsertPayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncInsertPayload<A, K>;
  /** Payload passed to `sync.update`. */
  export type SyncUpdatePayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncUpdatePayload<A, K>;
  /** Payload passed to `sync.delete`. */
  export type SyncDeletePayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncDeletePayload<A, K>;
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
  /** Partial row update payload. */
  export type Update<A extends object> = CollectionUpdate<A>;
  /** Remote row change applied by `applyChanges` or streamed by `sync.changes`. */
  export type Change<A extends object, K extends CollectionKey = CollectionKey> = CollectionChange<
    A,
    K
  >;
  /** Origin/synced metadata for `applyChanges`. */
  export type WriteOptions = CollectionWriteOptions;
  /** Durable snapshot for one collection row. */
  export type RowSnapshot<A extends object, K extends CollectionKey> = CollectionRowSnapshot<A, K>;
  /** Durable snapshot for one collection. */
  export type Snapshot<
    A extends object = object,
    K extends CollectionKey = CollectionKey,
  > = CollectionSnapshot<A, K>;
  /** Multi-collection hydration payload used by Start and persistence. */
  export type HydrationPayload = CollectionHydrationPayload;
  /** Options for applying collection hydration snapshots. */
  export type HydrateOptions = CollectionHydrateOptions;
  /** Effect-aware key/value storage contract for collection persistence. */
  export type PersistenceStorage<E = never, R = never> = CollectionPersistenceStorage<E, R>;
  /** Options for writing a collection snapshot to persistence. */
  export type PersistOptions = CollectionPersistOptions;
  /** Persistence policy attached to a collection definition. */
  export type PersistenceConfig<E = never, R = never> = CollectionPersistenceConfig<E, R>;
  /** Options for materializing a read-only collection from a live query. */
  export type LiveQueryOptions<
    A extends object,
    K extends CollectionKey,
    E = never,
    R = never,
  > = CollectionLiveQueryOptions<A, K, E, R>;
  /** Synchronous Web Storage-like shape accepted by `Collection.storage(...)`. */
  export type StorageLike = CollectionStorageLike;
  /** In-memory persistence storage for tests, demos, and ephemeral state. */
  export type MemoryStorage = CollectionMemoryStorage;
  /** Context passed when flushing pending mutations across collections. */
  export type FlushAllPendingMutationsContext = FlushCollectionPendingMutationsContext;
  /** Predicate for skipping a background flush attempt. */
  export type FlushAllPendingMutationsSkip<
    SkipError = never,
    SkipRequirements = never,
  > = FlushCollectionPendingMutationsSkip<SkipError, SkipRequirements>;
  /** Options for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsOptions<
    SkipError = never,
    SkipRequirements = never,
  > = FlushCollectionsPendingMutationsOptions<SkipError, SkipRequirements>;
  /** Error channel for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsError<
    Collections extends Iterable<AnyCollection>,
    SkipError = never,
  > = FlushCollectionsPendingMutationsError<Collections, SkipError>;
  /** Requirement channel for flushing pending mutations across collections. */
  export type FlushAllPendingMutationsRequirements<
    Collections extends Iterable<AnyCollection>,
    SkipRequirements = never,
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
  export type BackgroundSyncAdapter<
    AdapterError = never,
    AdapterRequirements = never,
  > = CollectionBackgroundSyncAdapter<AdapterError, AdapterRequirements>;
  /** Background sync policy and adapter options. */
  export type BackgroundSyncOptions<
    AdapterError = never,
    AdapterRequirements = never,
    SkipError = never,
    SkipRequirements = never,
  > = CollectionBackgroundSyncOptions<
    AdapterError,
    AdapterRequirements,
    SkipError,
    SkipRequirements
  >;
  /** Error channel for background sync pending-mutation evaluation. */
  export type BackgroundSyncError<
    Collections extends Iterable<AnyCollection>,
    AdapterError = never,
    SkipError = never,
  > = CollectionBackgroundSyncError<Collections, AdapterError, SkipError>;
  /** Requirement channel for background sync pending-mutation evaluation. */
  export type BackgroundSyncRequirements<
    Collections extends Iterable<AnyCollection>,
    AdapterRequirements = never,
    SkipRequirements = never,
  > = CollectionBackgroundSyncRequirements<Collections, AdapterRequirements, SkipRequirements>;
  /** Result returned by background sync attempts. */
  export type BackgroundSyncResult = CollectionBackgroundSyncResult;

  /**
   * Define a local-first collection.
   *
   * Reads are synchronous from an in-memory store. `sync` backs the
   * collection with an inline adapter (whose operations may be Server
   * functions) or a `Resource.Ref`; loads, mutation commits, and persistence
   * run through Effect so failures stay in `E` and services stay in `R`.
   * Redefining a name (HMR, re-evaluated modules) replaces the earlier
   * definition; Start rejects two distinct collections sharing a name.
   *
   * @example
   * const todos = Collection.define({
   *   name: "todos",
   *   output: Todo,
   *   getKey: (todo) => todo.id,
   *   sync: { load: listTodos, insert: createTodos },
   * })
   */
  export function define<
    const Output extends Schema.Top,
    K extends CollectionKey,
    const Definition extends Omit<
      CollectionOptions<CollectionRowFromOutput<Output>, K, any, any>,
      "output" | "getKey" | "sync"
    >,
  >(
    options: Definition & {
      readonly output: Output;
      readonly getKey: (value: CollectionRowFromOutput<Output>) => K;
      readonly sync?: CollectionSync<CollectionRowFromOutput<Output>, K, any, any>;
    } & RejectCollectionPromiseOutputs<Definition>,
  ): CollectionDefinition<
    CollectionRowFromOutput<Output>,
    K,
    CollectionErrorFromDefinition<Definition>,
    CollectionRequirementsFromDefinition<Definition>
  >;
  export function define<A extends object, K extends CollectionKey = string, E = never, R = never>(
    options: CollectionOptions<A, K, E, R>,
  ): CollectionDefinition<A, K, E, R>;
  export function define(
    options: CollectionOptions<any, any, any, any>,
  ): CollectionDefinition<any, any, any, any> {
    return defineCollection(options);
  }

  /**
   * Create a read-only collection from a live query.
   *
   * The collection materializes query results for reads, indexes, and joins.
   * Mutation effects fail with `ReadonlyCollectionMutation`; use the source
   * collections for writes.
   */
  export const liveQuery = <
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  >(
    options: CollectionLiveQueryOptions<A, K, E, R>,
  ): CollectionDefinition<A, K, E | QueryEvaluationError | ReadonlyCollectionMutation, R> =>
    makeLiveQueryCollectionDefinition(options);

  /** Flush queued optimistic mutations across many collections. */
  export const flushAllPendingMutations = flushCollectionsPendingMutationsEffect;
  /** Decide whether to flush pending mutations for background sync triggers. */
  export const backgroundSyncPendingMutations = backgroundSyncCollectionsPendingMutationsEffect;

  /** Create in-memory persistence storage for tests, demos, or ephemeral data. */
  export const memoryStorage = (
    initial?: Iterable<readonly [string, string]>,
  ): CollectionMemoryStorage => makeCollectionMemoryStorage(initial);

  /** Adapt synchronous Web Storage style APIs to Effect-aware persistence storage. */
  export const storage = (
    storage: CollectionStorageLike,
  ): CollectionPersistenceStorage<CollectionStorageError, never> =>
    collectionStorageFromSync(storage);
}
