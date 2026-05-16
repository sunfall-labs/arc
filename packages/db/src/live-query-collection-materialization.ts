import {
  EffectInputCallbackError,
  Signal,
  stableStringify,
  type ReadableSignal
} from "@effect-ui/core";
import { Effect } from "effect";
import type { ReadonlyCollectionMutation } from "./collection-errors.js";
import {
  collectionIndex,
  collectionIndexKey,
  uniqueCollectionIndexValues
} from "./collection-index-materialization.js";
import {
  cloneCollectionValue,
  detachCollectionRow
} from "./collection-value-detachment.js";
import { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { ingestCollectionOutputRowsSync } from "./collection-row-ingress.js";
import {
  currentCollectionStore,
  runWithCollectionStore,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";
import type {
  CollectionDefinition,
  CollectionIndexValue,
  CollectionKey,
  CollectionLoadState,
  CollectionRow,
  CollectionSnapshot
} from "./collection-contract.js";
import type { LiveQuery } from "./query-builder.js";
import type { QueryEvaluationError } from "./query-plan.js";

export type LiveQueryCollectionMaterializationError =
  | CollectionSnapshotCodecError
  | EffectInputCallbackError;

type LiveQueryCollectionMaterializationOperation = "load" | "snapshot";

type LiveQueryCollectionError<E> =
  | E
  | QueryEvaluationError
  | ReadonlyCollectionMutation;

type LiveQueryCollectionLoadStateError<E> =
  | LiveQueryCollectionError<E>
  | LiveQueryCollectionMaterializationError;

type LiveQueryCollectionDefinitionForMaterialization<
  A extends object,
  K extends CollectionKey,
  E,
  R
> = CollectionDefinition<A, K, LiveQueryCollectionError<E>, R>;

interface MaterializedEntry<A extends object, K extends CollectionKey> {
  readonly key: K;
  readonly value: A;
}

interface MaterializedProjection<A extends object, K extends CollectionKey> {
  readonly entries: ReadonlyArray<MaterializedEntry<A, K>>;
  readonly byKey: ReadonlyMap<K, MaterializedEntry<A, K>>;
  readonly serialized: string;
  readonly revision: number;
  readonly updatedAt: number;
}

interface ProjectionIndexCacheEntry<A extends object, K extends CollectionKey> {
  readonly revision: number;
  readonly buckets: ReadonlyMap<string, ReadonlyArray<MaterializedEntry<A, K>>>;
}

interface LiveQueryCollectionStoreMaterialization<A extends object, K extends CollectionKey, E> {
  readonly stateSignal: ReadableSignal<CollectionLoadState<LiveQueryCollectionLoadStateError<E>>>;
  readonly versionSignal: ReadableSignal<number>;
  get(key: K): CollectionRow<A, K> | undefined;
  rows(): ReadonlyArray<CollectionRow<A, K>>;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  snapshot(updatedAt: number): CollectionSnapshot<A, K>;
}

/**
 * Per-store projection cache for a Live Query Collection.
 *
 * The materialization Module owns the one keyed projection shared by `rows`,
 * `get`, secondary indexes, `version`, load state, and snapshots. Keeping that
 * cache behind this interface prevents the read-only Collection Definition
 * adapter from also owning projection invalidation and snapshot encoding rules.
 */
export interface LiveQueryCollectionMaterialization<A extends object, K extends CollectionKey, E = never> {
  state(): ReadableSignal<CollectionLoadState<LiveQueryCollectionLoadStateError<E>>>;
  version(): ReadableSignal<number>;
  get(key: K): CollectionRow<A, K> | undefined;
  rows(): ReadonlyArray<CollectionRow<A, K>>;
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  snapshot(updatedAt: number): CollectionSnapshot<A, K>;
  snapshotWithStore(
    store: RuntimeCollectionStore,
    updatedAt: number
  ): CollectionSnapshot<A, K>;
  snapshotWithStoreEffect(
    store: RuntimeCollectionStore,
    updatedAt: number
  ): Effect.Effect<CollectionSnapshot<A, K>, LiveQueryCollectionMaterializationError>;
}

export interface LiveQueryCollectionMaterializationOptions<
  A extends object,
  K extends CollectionKey,
  E = never,
  R = never
> {
  readonly name: string;
  readonly live: LiveQuery<A, E, R>;
  readonly definition: () => LiveQueryCollectionDefinitionForMaterialization<A, K, E, R>;
  readonly snapshotKeyCallbackError: (cause: unknown) => EffectInputCallbackError;
}

const materializationCallbackError = (
  collection: string,
  operation: LiveQueryCollectionMaterializationOperation,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.materialize(${collection}).${operation}`,
    cause,
    guidance: "Live query collection materialization must produce collection rows with stable keys and stable-stringifiable values."
  });

const normalizeMaterializationError = (
  collection: string,
  operation: LiveQueryCollectionMaterializationOperation,
  cause: unknown
): LiveQueryCollectionMaterializationError =>
  cause instanceof CollectionSnapshotCodecError || cause instanceof EffectInputCallbackError
    ? cause
    : materializationCallbackError(collection, operation, cause);

/**
 * Builds the private Live Query Collection Materialization Module.
 *
 * A live query can be observed from several Runtime Collection Stores during
 * SSR, client runtime work, and tests. This factory gives each store an
 * isolated projection while exposing a single collection-shaped interface to
 * the definition adapter.
 */
export const makeLiveQueryCollectionMaterialization = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: LiveQueryCollectionMaterializationOptions<A, K, E, R>
): LiveQueryCollectionMaterialization<A, K, E> => {
  const storeAdapters = new WeakMap<RuntimeCollectionStore, LiveQueryCollectionStoreMaterialization<A, K, E>>();
  const currentRuntimeCollectionStore = (): RuntimeCollectionStore =>
    currentCollectionStore() as RuntimeCollectionStore;
  const withStore = <Out>(store: RuntimeCollectionStore, evaluate: () => Out): Out =>
    runWithCollectionStore(store, evaluate);
  const storeAdapter = (
    store: RuntimeCollectionStore
  ): LiveQueryCollectionStoreMaterialization<A, K, E> => {
    const existing = storeAdapters.get(store);
    if (existing) {
      return existing;
    }

    let revision = 0;
    let projection: MaterializedProjection<A, K> | undefined;
    let materializationError: LiveQueryCollectionMaterializationError | undefined;
    let materializedUpdatedAt = 0;
    const indexCache = new Map<string, ProjectionIndexCacheEntry<A, K>>();
    const nextUpdatedAt = (): number => {
      const now = Date.now();
      materializedUpdatedAt = now > materializedUpdatedAt ? now : materializedUpdatedAt + 1;
      return materializedUpdatedAt;
    };
    const materialize = (
      values: ReadonlyArray<A>,
      operation: "load" | "snapshot"
    ): Omit<MaterializedProjection<A, K>, "revision" | "updatedAt"> => {
      const definition = options.definition();
      const rows = ingestCollectionOutputRowsSync(definition, values, {
        operation,
        path: `$.collections[${options.name}].rows`,
        synced: true,
        origin: "remote"
      });
      const byKey = new Map<K, MaterializedEntry<A, K>>();
      for (const row of rows) {
        byKey.set(row.key, {
          key: row.key,
          value: cloneCollectionValue(row.value)
        });
      }
      const entries = Array.from(byKey.values());
      return {
        entries,
        byKey,
        serialized: stableStringify(entries.map((entry) => [typeof entry.key, entry.key, entry.value]))
      };
    };
    const emptyProjection = (): Omit<MaterializedProjection<A, K>, "revision" | "updatedAt"> => ({
      entries: [],
      byKey: new Map(),
      serialized: "[]"
    });
    const replaceObservedProjection = (
      next: Omit<MaterializedProjection<A, K>, "revision" | "updatedAt">
    ): MaterializedProjection<A, K> => {
      if (projection === undefined || projection.serialized !== next.serialized) {
        revision++;
        indexCache.clear();
        projection = {
          ...next,
          revision,
          updatedAt: nextUpdatedAt()
        };
      }
      return projection;
    };
    const observeMaterialized = (values: ReadonlyArray<A>): MaterializedProjection<A, K> => {
      try {
        const next = materialize(values, "load");
        materializationError = undefined;
        return replaceObservedProjection(next);
      } catch (error) {
        materializationError = normalizeMaterializationError(options.name, "load", error);
        return projection ?? replaceObservedProjection(emptyProjection());
      }
    };
    const currentProjection = (): MaterializedProjection<A, K> =>
      projectionSignal.get();
    const currentProjectionDirect = (): MaterializedProjection<A, K> =>
      withStore(store, () => observeMaterialized(options.live.state.get().data));
    const projectionSignal = Signal.derive(() =>
      currentProjectionDirect()
    );
    const row = (entry: MaterializedEntry<A, K>): CollectionRow<A, K> =>
      detachCollectionRow({
        collection: options.name,
        key: entry.key,
        value: entry.value,
        synced: true,
        origin: "remote"
      });
    const rows = (): ReadonlyArray<CollectionRow<A, K>> =>
      currentProjection().entries.map(row);
    const indexEntries = (
      name: string,
      value: CollectionIndexValue
    ): ReadonlyArray<MaterializedEntry<A, K>> => {
      const definition = options.definition();
      const definitionIndex = collectionIndex<A>(definition, name);
      const materialized = currentProjection();
      let cache = indexCache.get(name);
      if (!cache || cache.revision !== materialized.revision) {
        const buckets = new Map<string, Array<MaterializedEntry<A, K>>>();
        for (const entry of materialized.entries) {
          for (const candidate of uniqueCollectionIndexValues(definitionIndex, entry.value)) {
            const key = collectionIndexKey(candidate);
            const bucket = buckets.get(key);
            if (bucket) {
              bucket.push(entry);
            } else {
              buckets.set(key, [entry]);
            }
          }
        }
        cache = { revision: materialized.revision, buckets };
        indexCache.set(name, cache);
      }

      return cache.buckets.get(collectionIndexKey(value)) ?? [];
    };
    const snapshot = (
      materialized: MaterializedProjection<A, K>,
      updatedAt: number
    ): CollectionSnapshot<A, K> => ({
      name: options.name,
      rows: materialized.entries.map((entry) => ({
        key: entry.key,
        value: cloneCollectionValue(entry.value),
        synced: true,
        origin: "remote"
      })),
      pendingMutations: [],
      updatedAt
    });
    let readyState: CollectionLoadState<LiveQueryCollectionLoadStateError<E>> | undefined;
    const pendingState: CollectionLoadState<LiveQueryCollectionLoadStateError<E>> = {
      _tag: "Pending",
      waiting: true
    };
    const ready = (updatedAt: number): CollectionLoadState<LiveQueryCollectionLoadStateError<E>> => {
      if (readyState?._tag === "Ready" && readyState.updatedAt === updatedAt) {
        return readyState;
      }
      readyState = { _tag: "Ready", waiting: false, updatedAt };
      return readyState;
    };
    const readState = (): CollectionLoadState<LiveQueryCollectionLoadStateError<E>> =>
      withStore(store, () => {
        const state = options.live.state.get();
        switch (state._tag) {
          case "Pending":
            return pendingState;
          case "Failure":
            return { _tag: "Failure", waiting: false, error: state.error };
          case "Success": {
            const current = currentProjection();
            if (materializationError) {
              return { _tag: "Failure", waiting: false, error: materializationError };
            }
            return ready(current.updatedAt);
          }
        }
      });
    const stateSignal = Signal.derive(readState);
    const versionSignal = Signal.derive(() =>
      currentProjection().revision
    );
    const adapter: LiveQueryCollectionStoreMaterialization<A, K, E> = {
      stateSignal,
      versionSignal,
      get: (key) => {
        const entry = currentProjection().byKey.get(key);
        return entry ? row(entry) : undefined;
      },
      rows,
      index: (index, value) =>
        indexEntries(index, value).map(row),
      firstByIndex: (index, value) => {
        const entry = indexEntries(index, value)[0];
        return entry === undefined ? undefined : row(entry);
      },
      snapshot: (updatedAt) => {
        try {
          const next = materialize(options.live.state.get().data, "snapshot");
          return snapshot({
            ...next,
            revision: revision + 1,
            updatedAt
          }, updatedAt);
        } catch (error) {
          throw normalizeMaterializationError(options.name, "snapshot", error);
        }
      }
    };
    storeAdapters.set(store, adapter);
    return adapter;
  };
  const currentAdapter = (): LiveQueryCollectionStoreMaterialization<A, K, E> =>
    storeAdapter(currentRuntimeCollectionStore());
  const snapshotWithStoreEffect = (
    store: RuntimeCollectionStore,
    updatedAt: number
  ) =>
    Effect.try({
      try: () => runWithCollectionStore(store, () => {
        const adapter = storeAdapter(store);
        return adapter.snapshot(updatedAt);
      }),
      catch: (cause) =>
        normalizeMaterializationError(options.name, "snapshot", cause)
    });
  const snapshotWithStore = (
    store: RuntimeCollectionStore,
    updatedAt: number
  ) =>
    runWithCollectionStore(store, () => {
      const adapter = storeAdapter(store);
      return adapter.snapshot(updatedAt);
    });

  return {
    state: () => currentAdapter().stateSignal,
    version: () => currentAdapter().versionSignal,
    get: (key) => currentAdapter().get(key),
    rows: () => currentAdapter().rows(),
    index: (index, value) =>
      currentAdapter().index(index, value),
    firstByIndex: (index, value) =>
      currentAdapter().firstByIndex(index, value),
    snapshot: (updatedAt) => currentAdapter().snapshot(updatedAt),
    snapshotWithStore,
    snapshotWithStoreEffect
  };
};
