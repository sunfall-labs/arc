import {
  type EffectInputCallbackError,
  type EffectInput,
  type ReadableSignal
} from "@effect-ui/core";
import { Effect, type PubSub, type Scope, type Schedule } from "effect";
import { CollectionStoreTypeId, CollectionTypeId } from "./collection-ids.js";
import type { CollectionRowKeyChanged, CollectionRowNotFound } from "./collection-errors.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";

export type CollectionKey = string | number;
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
 * Reactive load state for a collection preload/refetch.
 *
 * Failure carries the collection error type `E`; local writes can still keep
 * rows available while a later load is pending or failed.
 */
export type CollectionLoadState<E = never> =
  | { readonly _tag: "Initial"; readonly waiting: false }
  | { readonly _tag: "Pending"; readonly waiting: true }
  | { readonly _tag: "Ready"; readonly waiting: false; readonly updatedAt: number }
  | { readonly _tag: "Failure"; readonly waiting: false; readonly error: E };

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
  E | CollectionSnapshotCodecError | EffectInputCallbackError;

/** A single optimistic mutation captured inside a transaction. */
export type CollectionMutation<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Insert"; readonly key: K; readonly value: A; readonly previous?: A }
  | { readonly _tag: "Update"; readonly key: K; readonly previous: A; readonly value: A; readonly changes: Partial<A> }
  | { readonly _tag: "Delete"; readonly key: K; readonly previous: A };

/** A batch of local collection mutations sent to mutation handlers as one unit. */
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

/**
 * Collection execution policy.
 *
 * The retry schedule wraps loads and queued mutation handlers, preserving their
 * original Effect error and requirement channels.
 */
export interface CollectionPolicy<E = never> {
  readonly retry?: Schedule.Schedule<unknown, E>;
}

export interface CollectionSyncDiagnostics {
  readonly adapter: string;
}

export type CollectionIndexValue = string | number | boolean | Date | null | undefined;
export type CollectionIndexResult = CollectionIndexValue | ReadonlyArray<CollectionIndexValue>;

/**
 * Secondary index definition used by `collection.index` and indexed joins.
 *
 * Return one value for a one-to-one lookup, or several values when a row should
 * appear in multiple buckets. `unique` is diagnostic metadata only.
 */
export interface CollectionIndexDefinition<A extends object> {
  readonly key: (value: A) => CollectionIndexResult;
  readonly unique?: boolean;
}

export type CollectionIndexInput<A extends object> =
  | ((value: A) => CollectionIndexResult)
  | CollectionIndexDefinition<A>;

export type CollectionIndexRecord<A extends object> = Record<string, CollectionIndexInput<A>>;

/**
 * Defines a local-first collection.
 *
 * `load` fills rows on first preload. `refetch` forces a fresh remote read
 * when available; otherwise refetch falls back to `load`. `onInsert`,
 * `onUpdate`, and `onDelete` run after optimistic local changes. Handler
 * failures use the Effect error channel `E` and roll back affected rows;
 * required services are carried in `R`.
 *
 * @example
 * ```ts
 * const todos = Collection.define({
 *   name: "todos",
 *   getKey: (todo) => todo.id,
 *   load: () => TodoApi.list,
 *   onUpdate: (updates) => TodoApi.patchMany(updates)
 * });
 * ```
 */
export interface CollectionOptions<A extends object, K extends CollectionKey, E = never, R = never> {
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
  /** Background sync diagnostics metadata exposed to tooling. */
  readonly sync?: CollectionSyncDiagnostics;
  /** Secondary index definitions used by `index`, `firstByIndex`, and indexed joins. */
  readonly indexes?: CollectionIndexRecord<A>;
  /** Stable key extractor for one row. Keys must be deterministic across loads and snapshots. */
  readonly getKey: (value: A) => K;
  /** Rows available before the first load runs. */
  readonly initialData?: ReadonlyArray<A>;
  /** Initial loader. Runs once for `preloadEffect` unless a refetch is forced. */
  readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
  /** Fresh loader used by `refetchEffect`; falls back to `load` when omitted. */
  readonly refetch?: () => EffectInput<ReadonlyArray<A>, E, R>;
  /** Commits optimistic inserts to the backing service. */
  readonly onInsert?: (
    input: ReadonlyArray<A>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
  /** Commits optimistic updates to the backing service. */
  readonly onUpdate?: (
    input: ReadonlyArray<{ readonly key: K; readonly value: A; readonly previous: A; readonly changes: Partial<A> }>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
  /** Commits optimistic deletes to the backing service. */
  readonly onDelete?: (
    input: ReadonlyArray<{ readonly key: K; readonly previous: A }>,
    context: CollectionMutationContext<A, K>
  ) => EffectInput<void, E, R>;
}

/**
 * Runtime handle returned by `Collection.define`.
 *
 * Read methods are synchronous and reactive through `state`/`version` signals.
 * Load and mutation Effects expose the collection error channel `E` and
 * requirements `R`; fire-and-forget write helpers fork the corresponding Effect
 * on the current runtime.
 */
export interface CollectionDefinition<A extends object, K extends CollectionKey = string, E = never, R = never> {
  readonly [CollectionTypeId]: typeof CollectionTypeId;
  readonly options: CollectionOptions<A, K, E, R>;
  readonly name: string;
  /** True for derived definitions that must reject direct writes and change-feed application. */
  readonly readOnly?: boolean;
  getKey(value: A): K;
  /** Reactive load state signal for the collection. */
  state(): ReadableSignal<CollectionLoadState<CollectionRuntimeError<E>>>;
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
  preloadEffect(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Force a fresh load even when the collection is already ready. */
  refetchEffect(): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Return queued optimistic mutations waiting for their handlers to commit. */
  pendingMutationsEffect(): Effect.Effect<ReadonlyArray<CollectionPendingMutation<A, K>>>;
  /** Synchronously read queued optimistic mutations from the current runtime store. */
  pendingMutations(): ReadonlyArray<CollectionPendingMutation<A, K>>;
  /** Retry all queued mutation handlers for this collection. */
  flushPendingMutationsEffect(): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, CollectionRuntimeError<E>, R>;
  /** Capture a durable serializable snapshot with an Effect-provided timestamp. */
  snapshotEffect(): Effect.Effect<CollectionSnapshot<A, K>, CollectionSnapshotCodecError | EffectInputCallbackError>;
  /** Synchronous inspection snapshot; durable workflows should use `snapshotEffect`. */
  snapshot(): CollectionSnapshot<A, K>;
  /** Restore rows and pending mutations from a snapshot. */
  hydrateEffect(snapshot: CollectionSnapshot<A, K>, options?: CollectionHydrateOptions): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
  /** Fork `hydrateEffect` on the current runtime. */
  hydrate(snapshot: CollectionSnapshot<A, K>, options?: CollectionHydrateOptions): void;
  /** Persist the current snapshot to an Effect-aware string storage backend. */
  persistEffect<PE = never, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR>;
  /** Load a persisted snapshot from storage and hydrate it if present. */
  restoreEffect<PE = never, PR = never>(
    storage: CollectionPersistenceStorage<PE, PR>,
    options?: CollectionPersistOptions & CollectionHydrateOptions
  ): Effect.Effect<void, PE | CollectionSnapshotCodecError | EffectInputCallbackError, PR>;
  /** Optimistically insert rows and run the insert handler. */
  insertEffect(input: A | ReadonlyArray<A>): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E>, R>;
  /** Optimistically update one row and run the update handler. */
  updateEffect(key: K, update: CollectionUpdate<A>): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged, R>;
  /** Optimistically delete one row and run the delete handler. */
  deleteEffect(key: K): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E> | CollectionRowNotFound, R>;
  /** Write rows directly without queuing mutation handlers. */
  writeInsertEffect(input: A | ReadonlyArray<A>, options?: CollectionWriteOptions): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Fork `writeInsertEffect` on the current runtime. */
  writeInsert(input: A | ReadonlyArray<A>, options?: CollectionWriteOptions): void;
  /** Write a partial patch directly without queuing mutation handlers. */
  writeUpdateEffect(key: K, changes: Partial<A>, options?: CollectionWriteOptions): Effect.Effect<void, CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged, R>;
  /** Fork `writeUpdateEffect` on the current runtime. */
  writeUpdate(key: K, changes: Partial<A>, options?: CollectionWriteOptions): void;
  /** Delete a row directly without queuing mutation handlers. */
  writeDeleteEffect(key: K): Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Fork `writeDeleteEffect` on the current runtime. */
  writeDelete(key: K): void;
}

export type AnyCollection<E = any, R = any> =
  Omit<CollectionDefinition<any, any, E, R>, "options"> & {
    readonly options: any;
  };
export type CollectionValue<C> = C extends CollectionDefinition<infer A, infer _K, infer _E, infer _R> ? A : never;
export type CollectionRowValue<C> = C extends CollectionDefinition<infer A, infer K, infer _E, infer _R> ? CollectionRow<A, K> : never;
export type CollectionError<C> = C extends CollectionDefinition<infer _A, infer _K, infer E, infer _R> ? E : never;
export type CollectionRequirements<C> = C extends CollectionDefinition<infer _A, infer _K, infer _E, infer R> ? R : never;

/**
 * Update input for `updateEffect`.
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

/** Remote change-feed event applied through `Collection.applyChangesEffect`. */
export type CollectionChange<A extends object, K extends CollectionKey> =
  | { readonly _tag: "Upsert"; readonly value: A }
  | { readonly _tag: "Delete"; readonly key: K };

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
export interface CollectionSnapshot<A extends object = object, K extends CollectionKey = CollectionKey> {
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

export interface CollectionPersistOptions {
  readonly key?: string;
}

/**
 * Persistence policy attached to a collection definition.
 *
 * Restore can run before preload, then optional load can reconcile remote data.
 * Persist hooks default to enabled unless explicitly set to `false`.
 */
export interface CollectionPersistenceConfig<E = never, R = never> extends CollectionPersistOptions {
  readonly storage: CollectionPersistenceStorage<E, R>;
  readonly hydrate?: CollectionHydrateOptions;
  readonly restoreOnPreload?: boolean;
  readonly loadAfterRestore?: boolean;
  readonly persistOnLoad?: boolean;
  readonly persistOnMutation?: boolean;
  readonly persistOnWrite?: boolean;
}

/**
 * `Collection.define` options with an attached persistence backend.
 *
 * `persistedCollectionOptions(...)` converts this shape into normal
 * `CollectionOptions` while unioning collection handler `E`/`R` with
 * persistence storage `PE`/`PR`.
 */
export type CollectionPersistedOptions<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
  PE = never,
  PR = never
> = Omit<CollectionOptions<A, K, E, R>, "persistence"> & {
  readonly persistence: CollectionPersistenceConfig<PE, PR>;
};

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

/** Store-level collection lifecycle and mutation events used by devtools and tests. */
export type CollectionStoreEvent =
  /** A load/refetch completed and replaced rows; `count` is the stored row count. */
  | { readonly _tag: "CollectionLoaded"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  /** A load/refetch failed; `error` is the normalized collection runtime error payload. */
  | { readonly _tag: "CollectionLoadFailure"; readonly collection: string; readonly error: unknown }
  /** A snapshot was applied; `count` is the hydrated row count. */
  | { readonly _tag: "CollectionHydrated"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  /** A snapshot was persisted under `key`; `count` is the persisted row count. */
  | { readonly _tag: "CollectionPersisted"; readonly collection: string; readonly key: string; readonly count: number }
  /** A snapshot was restored from `key`; `count` is the restored row count. */
  | { readonly _tag: "CollectionRestored"; readonly collection: string; readonly key: string; readonly count: number }
  /** An optimistic transaction was queued; `pending` is queue length after enqueue. */
  | { readonly _tag: "CollectionMutationQueued"; readonly collection: string; readonly transaction: string; readonly mutations: number; readonly pending: number }
  /** A queued transaction started running its mutation handler. */
  | { readonly _tag: "CollectionMutateStarted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  /** A transaction left the queue; `pending` is queue length after dequeue. */
  | { readonly _tag: "CollectionMutationDequeued"; readonly collection: string; readonly transaction: string; readonly pending: number }
  /** A mutation handler committed successfully. */
  | { readonly _tag: "CollectionMutateCommitted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  /** A mutation handler failed and optimistic changes were rolled back. */
  | { readonly _tag: "CollectionMutateRolledBack"; readonly collection: string; readonly transaction: string; readonly error: unknown }
  /** An async change-feed emission failed after subscription setup. */
  | { readonly _tag: "CollectionChangeFeedFailure"; readonly collection: string; readonly error: unknown }
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
  snapshot(): CollectionStoreDiagnosticsSnapshot;
  readonly snapshotEffect: Effect.Effect<CollectionStoreDiagnosticsSnapshot>;
}

export interface CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId;
  readonly disposeEffect: Effect.Effect<void>;
  readonly diagnostics: CollectionStoreDiagnostics;
  subscribeEventsEffect(): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope>;
}
