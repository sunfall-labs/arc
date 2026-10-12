import type {
  EffectInputError,
  EffectInputRequirements,
  EnsureEffectInput,
  ResourceRef,
} from "@sunfall/arc-core";
import type { Schema, Stream } from "effect";
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
  CollectionOrigin,
  CollectionOptions,
  CollectionPersistenceConfig,
  CollectionPersistenceStorage,
  CollectionPersistOptions,
  CollectionPolicy,
  CollectionRequirements,
  CollectionRow,
  CollectionRowSnapshot,
  CollectionRowValue,
  CollectionSnapshot,
  CollectionStorageLike,
  CollectionSync,
  CollectionSyncAdapter,
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
  | CollectionSyncReturn<Sync, "refresh">;

type CollectionSyncStreams<Sync> =
  | CollectionSyncReturn<Sync, "follow">
  | CollectionSyncReturn<Sync, "changes">;

// Distributive so an absent stream (`never`) contributes no error/requirement.
type CollectionStreamError<S> = S extends Stream.Stream<any, infer E, any> ? E : never;
type CollectionStreamRequirements<S> = S extends Stream.Stream<any, any, infer R> ? R : never;

type CollectionSyncError<Sync> = [Sync] extends [never]
  ? never
  : Sync extends ResourceRef<any, any, infer E, any>
    ? E
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
 * `Collection.define(...)` returns a definition with synchronous reactive
 * reads (`rows`, `get`, `index`, `result`, ...) and Effect-returning loads
 * (`preload`, `refresh`, ...), which keep errors and service requirements
 * typed in Effect. Actions change the rows: an Action's `optimistic` patches
 * them through `transaction.insert/update/delete`, its `run` writes the
 * backend, and its `invalidates` reloads the collection's sync source.
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
  /** Collection retry policy. */
  export type Policy<E = never> = CollectionPolicy<E>;
  /** Backing source accepted by `sync`: an inline adapter or a `Resource.Ref`. */
  export type Sync<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSync<A, K, E, R>;
  /** Inline sync adapter for loading and following remote data. */
  export type SyncAdapter<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSyncAdapter<A, K, E, R>;
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

  /**
   * Define a local-first collection.
   *
   * Reads are synchronous from an in-memory store. `sync` backs the
   * collection with an inline adapter (whose operations may be Server
   * functions) or a `Resource.Ref`; loads and persistence
   * run through Effect so failures stay in `E` and services stay in `R`.
   * Redefining a name (HMR, re-evaluated modules) replaces the earlier
   * definition; Start rejects two distinct collections sharing a name.
   *
   * @example
   * const todos = Collection.define({
   *   name: "todos",
   *   output: Todo,
   *   getKey: (todo) => todo.id,
   *   sync: { load: listTodos },
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
   * `applyChanges` fails with `ReadonlyCollectionMutation`, and Actions cannot
   * patch it optimistically; patch the source collections instead.
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
