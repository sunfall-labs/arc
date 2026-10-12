import {
  type EffectInputCallbackError,
  type EffectInput,
  type ReadableSignal,
  type ResourceRef,
  type RetrySchedule,
} from "@sunfall/arc-core";
import { Effect, type PubSub, type Scope, type Stream } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { CollectionStoreTypeId, CollectionTypeId } from "./collection-ids.js";
import type { CollectionRowKeyChanged, CollectionRowNotFound } from "./collection-errors.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";

/** Stable row identity accepted by Collection definitions and snapshots. */
export type CollectionKey = string | number;
/** Source of the latest row value visible in the in-memory Collection Store. */
export type CollectionOrigin = "local" | "remote";

/**
 * A collection value as exposed to readers.
 *
 * Metadata fields identify the stable key, owning collection, sync status, and
 * whether the latest value came from a local write or a remote source.
 */
export type CollectionRow<A extends object, K extends CollectionKey = CollectionKey> = A & {
  readonly $key: K;
  readonly $collection: string;
  readonly $synced: boolean;
  readonly $origin: CollectionOrigin;
};

/**
 * Failure channel for collection runtime reads and loads.
 *
 * `E` comes from the collection loader or mutation handlers. Snapshot codec
 * errors cover malformed persisted/hydrated rows and output-schema validation
 * failures, while EffectInput callback errors report synchronous throws before a
 * loader, handler, adapter, or persistence callback can return a value or
 * Effect.
 */
export type CollectionRuntimeError<E = never> =
  | E
  | CollectionSnapshotCodecError
  | EffectInputCallbackError;

/** A single optimistic mutation captured inside a transaction. */
export type CollectionMutation<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Insert"; readonly key: K; readonly value: A; readonly previous?: A }
  | {
      readonly _tag: "Update";
      readonly key: K;
      readonly previous: A;
      readonly value: A;
      readonly changes: Partial<A>;
    }
  | { readonly _tag: "Delete"; readonly key: K; readonly previous: A };

/** A batch of local collection mutations sent to mutation handlers as one unit. */
export interface CollectionTransaction<A extends object, K extends CollectionKey> {
  readonly id: string;
  readonly collection: string;
  readonly mutations: ReadonlyArray<CollectionMutation<A, K>>;
}

/** Row snapshot saved before an optimistic mutation so rollback can restore state. */
export interface CollectionRollbackRow<A extends object, K extends CollectionKey> {
  readonly key: K;
  readonly row?: CollectionRowSnapshot<A, K>;
}

/** Queued optimistic transaction waiting for its mutation handler to commit. */
export interface CollectionPendingMutation<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
  readonly rollbackRows: ReadonlyArray<CollectionRollbackRow<A, K>>;
  readonly createdAt: number;
  readonly attempts: number;
}

/** Context passed to collection mutation handlers. */
export interface CollectionMutationContext<A extends object, K extends CollectionKey> {
  readonly transaction: CollectionTransaction<A, K>;
}

/**
 * Collection execution policy.
 *
 * The retry schedule wraps loads and queued mutation handlers, preserving their
 * original Effect error and requirement channels.
 */
export interface CollectionPolicy<E = never> {
  readonly retry?: RetrySchedule<E>;
}

/** Diagnostic label for the sync adapter currently backing a collection. */
export interface CollectionSyncDiagnostics {
  readonly adapter: string;
}

/** Value that can be normalized into a stable secondary-index bucket key; Dates must be valid. */
export type CollectionIndexValue = string | number | boolean | Date | null | undefined;
/** One or more bucket keys emitted for a row by a secondary index. */
export type CollectionIndexResult = CollectionIndexValue | ReadonlyArray<CollectionIndexValue>;

/**
 * Secondary index definition used by `collection.index` and indexed joins.
 *
 * Return one valid scalar value for a one-to-one lookup, or several valid
 * scalar values when a row should appear in multiple buckets. Invalid Dates
 * fail as `EffectInputCallbackError`. `unique` is diagnostic metadata only.
 */
export interface CollectionIndexDefinition<A extends object> {
  readonly key: (value: A) => CollectionIndexResult;
  readonly unique?: boolean;
}

/** Shorthand accepted by Collection options for secondary index declarations. */
export type CollectionIndexInput<A extends object> =
  | ((value: A) => CollectionIndexResult)
  | CollectionIndexDefinition<A>;

/** Named secondary index map attached to a Collection definition. */
export type CollectionIndexRecord<A extends object> = Record<string, CollectionIndexInput<A>>;

/** Insert payload delivered to a collection sync adapter. */
export interface CollectionSyncInsertPayload<A extends object, K extends CollectionKey> {
  readonly values: ReadonlyArray<A>;
  readonly transaction: CollectionTransaction<A, K>;
}

/** Update payload delivered to a collection sync adapter. */
export interface CollectionSyncUpdatePayload<A extends object, K extends CollectionKey> {
  readonly updates: ReadonlyArray<{
    readonly key: K;
    readonly value: A;
    readonly previous: A;
    readonly changes: Partial<A>;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

/** Delete payload delivered to a collection sync adapter. */
export interface CollectionSyncDeletePayload<A extends object, K extends CollectionKey> {
  readonly deletes: ReadonlyArray<{
    readonly key: K;
    readonly previous: A;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

/**
 * Transport adapter that backs a collection.
 *
 * Every operation may return a plain value or an Effect, and may be a Server
 * function directly (`load: listTodos`, `update: updateTodos`). Failures become
 * the collection error channel `E`; required services become `R`.
 *
 * - `load` fills rows on the first preload; `refresh` forces a fresh read and
 *   falls back to `load` (and `load` falls back to `refresh`).
 * - `follow` streams later authoritative row snapshots. The first successful
 *   preload/refresh in a Collection Store starts it on that store's lifetime;
 *   each emission reconciles synced rows like a refresh (pending optimistic
 *   mutations stay applied on top), and store disposal interrupts it.
 * - `changes` streams incremental remote changes (`Upsert`/`Update`/`Delete`).
 *   It starts and stops exactly like `follow`; each batch is applied like
 *   `applyChanges` without queuing mutation handlers.
 * - `insert`, `update`, and `delete` commit optimistic local writes. A failure
 *   rolls back the affected rows.
 */
export interface CollectionSyncAdapter<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> {
  /** Diagnostic label reported as `sync.adapter` by collection diagnostics. */
  readonly name?: string;
  readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly refresh?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly follow?: () => Stream.Stream<ReadonlyArray<A>, E, R>;
  readonly changes?: () => Stream.Stream<ReadonlyArray<CollectionChange<A, K>>, E, R>;
  readonly insert?: (payload: CollectionSyncInsertPayload<A, K>) => EffectInput<void, E, R>;
  readonly update?: (payload: CollectionSyncUpdatePayload<A, K>) => EffectInput<void, E, R>;
  readonly delete?: (payload: CollectionSyncDeletePayload<A, K>) => EffectInput<void, E, R>;
}

/**
 * Backing source for a collection: an inline sync adapter, or a Core
 * `Resource.Ref` whose rows the collection loads, refreshes, and follows
 * through `Resource.changes`.
 */
export type CollectionSync<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> = CollectionSyncAdapter<A, K, E, R> | ResourceRef<any, ReadonlyArray<A>, any, any>;

/**
 * Defines a local-first collection.
 *
 * `sync` backs the collection: an inline `CollectionSyncAdapter` or a
 * `Resource.Ref`. Without `sync` the collection is local-only. Adapter
 * failures use the Effect error channel `E` and roll back affected rows;
 * required services are carried in `R`.
 *
 * @example
 * ```ts
 * const todos = Collection.define({
 *   name: "todos",
 *   output: Todo,
 *   getKey: (todo) => todo.id,
 *   sync: {
 *     load: listTodos,
 *     update: updateTodos,
 *   },
 * });
 * ```
 */
export interface CollectionOptions<
  A extends object,
  K extends CollectionKey,
  E = never,
  R = never,
> {
  /** Stable collection identity used by stores, snapshots, persistence, and devtools. */
  readonly name: string;
  /** Optional schema for mutation input values. */
  readonly input?: unknown;
  /** Optional schema for loaded and written row values. */
  readonly output?: unknown;
  /** Load, mutation, and retry policy for this collection. */
  readonly policy?: CollectionPolicy<E>;
  /** Persistence storage and restore settings for this collection. */
  readonly persistence?: CollectionPersistenceConfig<E, R>;
  /** Backing source: an inline sync adapter or a `Resource.Ref`. */
  readonly sync?: CollectionSync<A, K, E, R>;
  /** Secondary index definitions used by `index`, `firstByIndex`, and indexed joins. */
  readonly indexes?: CollectionIndexRecord<A>;
  /** Stable key extractor for one row. Keys must be deterministic across loads and snapshots. */
  readonly getKey: (value: A) => K;
  /** Rows available before the first load runs. */
  readonly initialData?: ReadonlyArray<A>;
}

/**
 * Runtime handle returned by `Collection.define`.
 *
 * Read methods are synchronous and reactive through `state`/`version` signals.
 * Load and mutation Effects expose the collection error channel `E` and
 * requirements `R`; run them through the runtime at UI boundaries.
 */
export interface CollectionDefinition<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> {
  readonly [CollectionTypeId]: typeof CollectionTypeId;
  readonly options: CollectionOptions<A, K, E, R>;
  readonly name: string;
  /** True for derived definitions that must reject direct writes and remote change application. */
  readonly readOnly?: boolean;
  getKey(value: A): K;
  /**
   * Reactive load `AsyncResult` for the collection's preload/refresh.
   *
   * `Success` (timestamped by the load) means rows are loaded; loads mark the
   * current result `waiting`; `Failure` carries the load `Cause`. Rows stay
   * their own signal, so local writes keep rows available while a later load
   * is waiting or failed.
   */
  result(): ReadableSignal<AsyncResult.AsyncResult<void, CollectionRuntimeError<E>>>;
  /** Reactive version signal that changes when rows or pending mutations change. */
  version(): ReadableSignal<number>;
  /** Read one row by key from the current in-memory state. */
  get(key: K): CollectionRow<A, K> | undefined;
  /** Read all current rows, including local optimistic rows. */
  rows(): ReadonlyArray<CollectionRow<A, K>>;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  /** Read the first row from a named secondary index bucket. */
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  /** Ensure the collection has loaded once. */
  preload(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Force a fresh load even when the collection is already ready. */
  refresh(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Synchronously read queued optimistic mutations from the current runtime store. */
  pendingMutations(): ReadonlyArray<CollectionPendingMutation<A, K>>;
  /** Retry all queued mutation handlers for this collection. */
  flushPendingMutations(): Effect.Effect<
    ReadonlyArray<CollectionTransaction<A, K>>,
    CollectionRuntimeError<E>,
    R
  >;
  /** Capture a durable serializable snapshot with an Effect-provided timestamp. */
  snapshot(): Effect.Effect<
    CollectionSnapshot<A, K>,
    CollectionSnapshotCodecError | EffectInputCallbackError
  >;
  /** Restore rows and pending mutations from a snapshot. */
  hydrate(
    snapshot: CollectionSnapshot<A, K>,
    options?: CollectionHydrateOptions,
  ): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
  /** Persist the current snapshot to an Effect-aware string storage backend. */
  persist<PE = never, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions,
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR>;
  /** Load a persisted snapshot from storage and hydrate it if present. */
  restore<PE = never, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions,
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR>;
  /** Optimistically insert rows and run the insert handler. */
  insert(
    input: A | ReadonlyArray<A>,
  ): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R>;
  /** Optimistically update one row and run the update handler. */
  update(
    key: K,
    update: CollectionUpdate<A>,
  ): Effect.Effect<
    CollectionTransaction<A, K>,
    CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged,
    R
  >;
  /** Optimistically delete one row and run the delete handler. */
  delete(
    key: K,
  ): Effect.Effect<
    CollectionTransaction<A, K>,
    CollectionRuntimeError<E> | CollectionRowNotFound,
    R
  >;
  /**
   * Apply remote changes directly, without queuing mutation handlers.
   *
   * Changes apply in order as one write: `Upsert` stores a full row, `Update`
   * patches an existing row (failing with `CollectionRowNotFound` or
   * `CollectionRowKeyChanged`), and `Delete` removes a row if present.
   * Rows default to `origin: "remote"` and `synced: true`.
   */
  applyChanges(
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions,
  ): Effect.Effect<
    void,
    CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged,
    R
  >;
}

/**
 * Erased Collection definition used by adapters over heterogeneous collection
 * lists while preserving error and requirement channels where possible.
 */
export type AnyCollection<E = unknown, R = unknown> = Omit<
  CollectionDefinition<any, any, E, R>,
  "options"
> & {
  readonly options: Omit<CollectionOptions<any, any, E, R>, "policy" | "persistence"> & {
    readonly policy?: { readonly retry?: unknown };
    readonly persistence?: CollectionPersistenceConfig<E, R>;
  };
};
/** Extracts the domain value type from a Collection definition. */
export type CollectionValue<C> =
  C extends CollectionDefinition<infer A, infer _K, infer _E, infer _R> ? A : never;
/** Extracts the public row type, including `$key` metadata, from a Collection definition. */
export type CollectionRowValue<C> =
  C extends CollectionDefinition<infer A, infer K, infer _E, infer _R>
    ? CollectionRow<A, K>
    : never;
/** Extracts the declared loader/mutation error channel from a Collection definition. */
export type CollectionError<C> =
  C extends AnyCollection<infer E, infer _R>
    ? E
    : C extends CollectionDefinition<infer _A, infer _K, infer E, infer _R>
      ? E
      : never;
/** Extracts the declared service requirements from a Collection definition. */
export type CollectionRequirements<C> =
  C extends AnyCollection<infer _E, infer R>
    ? R
    : C extends CollectionDefinition<infer _A, infer _K, infer _E, infer R>
      ? R
      : never;

/**
 * Update input for `update`.
 *
 * Pass a partial patch or mutate/return a shallow draft copy of the previous
 * value.
 */
export type CollectionUpdate<A extends object> = Partial<A> | ((draft: A) => A | void);

/** Metadata for direct writes that bypass mutation handlers. */
export interface CollectionWriteOptions {
  readonly origin?: CollectionOrigin;
  readonly synced?: boolean;
}

/** Remote change applied through `applyChanges` or streamed by `sync.changes`. */
export type CollectionChange<A extends object, K extends CollectionKey = CollectionKey> =
  | { readonly _tag: "Upsert"; readonly value: A }
  | { readonly _tag: "Update"; readonly key: K; readonly changes: Partial<A> }
  | { readonly _tag: "Delete"; readonly key: K };

/** Serializable row record used by Collection snapshots and hydration payloads. */
export interface CollectionRowSnapshot<A extends object, K extends CollectionKey> {
  readonly key: K;
  readonly value: A;
  readonly synced: boolean;
  readonly origin: CollectionOrigin;
}

/**
 * Serializable collection state including rows and queued local mutations.
 *
 * Use this for SSR hydration, offline restore, or custom persistence. The value
 * is plain JSON-compatible as long as row values and keys are.
 */
export interface CollectionSnapshot<
  A extends object = object,
  K extends CollectionKey = CollectionKey,
> {
  readonly name: string;
  readonly rows: ReadonlyArray<CollectionRowSnapshot<A, K>>;
  readonly pendingMutations: ReadonlyArray<CollectionPendingMutation<A, K>>;
  readonly updatedAt: number;
}

/** Multi-collection snapshot payload for route-level dehydration/hydration. */
export interface CollectionHydrationPayload {
  readonly collections: ReadonlyArray<CollectionSnapshot<any, any>>;
}

/** Hydration behavior for snapshots and persisted payloads. */
export interface CollectionHydrateOptions {
  readonly replace?: boolean;
}

/**
 * Effect-aware string storage used by collection persistence.
 *
 * Implement this over `localStorage`, IndexedDB, SQLite, or any other durable
 * store. Storage failures become the persistence error channel.
 */
export interface CollectionPersistenceStorage<E = never, R = never> {
  readonly getItem: (key: string) => EffectInput<string | null, E, R>;
  readonly setItem: (key: string, value: string) => EffectInput<void, E, R>;
  readonly removeItem?: (key: string) => EffectInput<void, E, R>;
}

/** Shared key options for collection persistence, restore, and hydration. */
export interface CollectionPersistOptions {
  readonly key?: string;
}

/**
 * Persistence policy attached to a collection definition.
 *
 * Restore can run before preload, then optional load can reconcile remote data.
 * Persist hooks default to enabled unless explicitly set to `false`.
 */
export interface CollectionPersistenceConfig<
  E = never,
  R = never,
> extends CollectionPersistOptions {
  readonly storage: CollectionPersistenceStorage<E, R>;
  readonly hydrate?: CollectionHydrateOptions | false;
  readonly restoreOnPreload?: boolean;
  readonly loadAfterRestore?: boolean;
  readonly persistOnLoad?: boolean;
  readonly persistOnMutation?: boolean;
  readonly persistOnWrite?: boolean;
}

/** Synchronous storage shape adapted by `Collection.storage`. */
export interface CollectionStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem?: (key: string) => void;
}

/** In-memory persistence storage for tests, demos, and ephemeral sessions. */
export interface CollectionMemoryStorage extends CollectionPersistenceStorage<never, never> {
  readonly values: ReadonlyMap<string, string>;
  clear(): void;
}

/**
 * Static metadata extracted from a Collection Definition for manifests and
 * diagnostics.
 *
 * Boolean fields report whether schemas, handlers, sync, persistence, or retry
 * policy were declared; they do not represent runtime health.
 */
export interface CollectionDefinitionDiagnostics {
  readonly name: string;
  /**
   * True for derived/live-query collections that reject direct writes and
   * remote change application. Concrete writable definitions report `false`.
   */
  readonly readOnly: boolean;
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

/** Static diagnostic inventory for registered Collection definitions. */
export interface CollectionDiagnostics {
  readonly collections: readonly CollectionDefinitionDiagnostics[];
}

/** Store-level collection lifecycle and mutation events used by devtools and tests. */
export type CollectionStoreEvent =
  /** A load/refresh completed and replaced rows; `count` is the stored row count. */
  | {
      readonly _tag: "CollectionLoaded";
      readonly collection: string;
      readonly count: number;
      readonly updatedAt: number;
    }
  /** A load/refresh failed; `error` is the normalized collection runtime error payload. */
  | { readonly _tag: "CollectionLoadFailure"; readonly collection: string; readonly error: unknown }
  /** A snapshot was applied; `count` is the hydrated row count. */
  | {
      readonly _tag: "CollectionHydrated";
      readonly collection: string;
      readonly count: number;
      readonly updatedAt: number;
    }
  /** A snapshot was persisted under `key`; `count` is the persisted row count. */
  | {
      readonly _tag: "CollectionPersisted";
      readonly collection: string;
      readonly key: string;
      readonly count: number;
    }
  /** A snapshot was restored from `key`; `count` is the restored row count. */
  | {
      readonly _tag: "CollectionRestored";
      readonly collection: string;
      readonly key: string;
      readonly count: number;
    }
  /** An optimistic transaction was queued; `pending` is queue length after enqueue. */
  | {
      readonly _tag: "CollectionMutationQueued";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
      readonly pending: number;
    }
  /** A queued transaction started running its mutation handler. */
  | {
      readonly _tag: "CollectionMutateStarted";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
    }
  /** A transaction left the queue; `pending` is queue length after dequeue. */
  | {
      readonly _tag: "CollectionMutationDequeued";
      readonly collection: string;
      readonly transaction: string;
      readonly pending: number;
    }
  /** A mutation handler committed successfully. */
  | {
      readonly _tag: "CollectionMutateCommitted";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
    }
  /** A mutation handler failed and optimistic changes were rolled back. */
  | {
      readonly _tag: "CollectionMutateRolledBack";
      readonly collection: string;
      readonly transaction: string;
      readonly error: unknown;
    }
  /** A `sync.changes` stream or one of its batches failed. */
  | {
      readonly _tag: "CollectionChangeFeedFailure";
      readonly collection: string;
      readonly error: unknown;
    }
  /** Rows were written directly without queuing mutation handlers. */
  | { readonly _tag: "CollectionWritten"; readonly collection: string; readonly mutations: number };

/** Stable Collection Store count snapshot that does not expose private row maps. */
export interface CollectionStoreDiagnosticsSnapshot {
  readonly collectionCount: number;
  readonly rowCount: number;
  readonly pendingMutationCount: number;
  readonly activeMutationCount: number;
  readonly optimisticRowCount: number;
  readonly loadingCount: number;
  readonly failureCount: number;
}

/** Effect-first diagnostics seam for runtime-local collection store facts. */
export interface CollectionStoreDiagnostics {
  readonly snapshot: Effect.Effect<CollectionStoreDiagnosticsSnapshot>;
}

/**
 * Runtime-local Collection Store contract.
 *
 * Stores own collection rows, pending mutation queues, lifecycle events, and
 * diagnostics for one Sunfall Arc Runtime Spine or request scope. Framework
 * adapters read it through `@sunfall/arc-db/internal`.
 */
export interface CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId;
  readonly diagnostics: CollectionStoreDiagnostics;
  subscribeEvents(): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope>;
}
