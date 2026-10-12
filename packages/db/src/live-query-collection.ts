import { Clock, Effect } from "effect";
import { CollectionTypeId } from "./collection-ids.js";
import { ReadonlyCollectionMutation } from "./collection-errors.js";
import { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import {
  markStoreExplicitCollectionSnapshotDefinition,
  withCollectionDurableSnapshotPermits,
  type StoreExplicitCollectionSnapshotImplementation,
} from "./collection-definition-snapshot.js";
import { persistCollectionSnapshotEffect } from "./collection-persistence.js";
import { makeLiveQueryCollectionMaterialization } from "./live-query-collection-materialization.js";
import { collectionStoreEffect, type RuntimeCollectionStore } from "./runtime-collection-store.js";
import { Query, type LiveQuery, type QueryFactory } from "./query-builder.js";
import {
  defaultCollectionDefinitionRegistry,
  type CollectionDefinitionRegistryAdapter,
} from "./collection-registry.js";
import type { QueryEvaluationError } from "./query-plan.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionIndexRecord,
  CollectionKey,
  CollectionPersistOptions,
  CollectionPersistenceStorage,
} from "./collection-contract.js";

/**
 * Options for a read-only collection backed by a live query.
 *
 * Use when derived query results should be addressable as a collection, such as
 * joining or indexing view rows. Mutation effects fail with
 * `ReadonlyCollectionMutation`.
 */
export interface CollectionLiveQueryOptions<
  A extends object,
  K extends CollectionKey,
  E = never,
  R = never,
> {
  readonly name: string;
  readonly getKey: (value: A) => K;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly query: LiveQuery<A, E, R> | QueryFactory<A, E, R>;
}

const readonlyCollectionMutation = (
  collection: string,
  operation: string,
): ReadonlyCollectionMutation => new ReadonlyCollectionMutation({ collection, operation });

const liveQueryFromInput = <A extends object, E, R>(
  query: LiveQuery<A, E, R> | QueryFactory<A, E, R>,
): LiveQuery<A, E, R> => (typeof query === "function" ? Query.live<A, E, R>(query) : query);

/**
 * Adapter from a live query to a read-only collection definition.
 */
export const makeLiveQueryCollectionDefinition = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
>(
  options: CollectionLiveQueryOptions<A, K, E, R>,
  registry: CollectionDefinitionRegistryAdapter = defaultCollectionDefinitionRegistry,
): CollectionDefinition<A, K, E | QueryEvaluationError | ReadonlyCollectionMutation, R> => {
  const live = liveQueryFromInput(options.query);
  const readonlyFail = <Out>(operation: string): Effect.Effect<Out, ReadonlyCollectionMutation> =>
    Effect.fail(readonlyCollectionMutation(options.name, operation));
  const readonlySnapshotCodecFailure = (
    operation: "hydrate" | "restore",
  ): CollectionSnapshotCodecError =>
    new CollectionSnapshotCodecError({
      operation,
      path: "$",
      reason: `Live query collection "${options.name}" is derived and read-only; ${operation} source collections instead.`,
    });

  type LiveQueryCollectionDefinition = CollectionDefinition<
    A,
    K,
    E | QueryEvaluationError | ReadonlyCollectionMutation,
    R
  > &
    StoreExplicitCollectionSnapshotImplementation<A, K>;
  let definition: LiveQueryCollectionDefinition;
  const materialization = makeLiveQueryCollectionMaterialization<A, K, E, R>({
    name: options.name,
    live,
    definition: () => definition,
  });
  definition = {
    [CollectionTypeId]: CollectionTypeId,
    options: {
      name: options.name,
      getKey: options.getKey,
      ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
      sync: {
        load: () => live.preload().pipe(Effect.map(() => live.evaluate())),
      },
    },
    name: options.name,
    readOnly: true,
    getKey: options.getKey,
    result: () => materialization.state(),
    version: () => materialization.version(),
    get: (key) => materialization.get(key),
    rows: () => materialization.rows(),
    index: (index, value) => materialization.index(index, value),
    firstByIndex: (index, value) => materialization.firstByIndex(index, value),
    preload: () => live.preload(),
    refresh: () => live.refresh(),
    pendingMutations: () => [],
    flushPendingMutations: () => Effect.succeed([]),
    snapshot: () =>
      Effect.gen(function* () {
        const store = yield* collectionStoreEffect;
        const updatedAt = yield* Clock.currentTimeMillis;
        return yield* withCollectionDurableSnapshotPermits(
          store,
          [definition],
          materialization.snapshotWithStoreEffect(store, updatedAt),
        );
      }),
    snapshotWithStore: (store, updatedAt) =>
      materialization.snapshotWithStore(store as RuntimeCollectionStore, updatedAt),
    snapshotWithStoreEffect: (store, updatedAt) =>
      materialization.snapshotWithStoreEffect(store as RuntimeCollectionStore, updatedAt),
    durableSnapshotSources: () => live.sources,
    hydratePreflightEffect: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    hydrateWithStoreEffect: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    hydrate: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    persist: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions,
    ) =>
      Effect.gen(function* () {
        const store = yield* collectionStoreEffect;
        const updatedAt = yield* Clock.currentTimeMillis;
        const snapshot = yield* withCollectionDurableSnapshotPermits(
          store,
          [definition],
          materialization.snapshotWithStoreEffect(store, updatedAt),
        );
        yield* persistCollectionSnapshotEffect(
          definition,
          Effect.succeed(snapshot),
          storage,
          persistOptions,
          store,
        );
      }),
    restore: <_PE = never, _PR = never>() => Effect.fail(readonlySnapshotCodecFailure("restore")),
    insert: () => readonlyFail("insert"),
    update: () => readonlyFail("update"),
    delete: () => readonlyFail("delete"),
    applyChanges: () => readonlyFail("applyChanges"),
  };
  markStoreExplicitCollectionSnapshotDefinition(definition);

  registry.register(definition as AnyCollection);

  return definition;
};
