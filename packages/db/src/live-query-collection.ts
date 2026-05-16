import {
  runFork,
  EffectInputCallbackError
} from "@effect-ui/core";
import { Clock, Effect } from "effect";
import { CollectionTypeId } from "./collection-ids.js";
import { ReadonlyCollectionMutation } from "./collection-errors.js";
import { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import {
  markStoreExplicitCollectionSnapshotDefinition,
  type StoreExplicitCollectionSnapshotImplementation
} from "./collection-definition-snapshot.js";
import { persistCollectionSnapshotEffect } from "./collection-persistence.js";
import {
  recordCollectionPreload
} from "./collection-runtime.js";
import { makeLiveQueryCollectionMaterialization } from "./live-query-collection-materialization.js";
import {
  collectionStoreEffect,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";
import { Query, type LiveQuery, type QueryFactory } from "./query-builder.js";
import type { QueryEvaluationError } from "./query-plan.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionIndexRecord,
  CollectionKey,
  CollectionPersistOptions,
  CollectionPersistenceStorage
} from "./collection-contract.js";

/**
 * Options for a read-only collection backed by a live query.
 *
 * Use when derived query results should be addressable as a collection, such as
 * joining or indexing view rows. Mutation effects fail with
 * `ReadonlyCollectionMutation`.
 */
export interface CollectionLiveQueryOptions<A extends object, K extends CollectionKey, E = never, R = never> {
  readonly name: string;
  readonly getKey: (value: A) => K;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly query: LiveQuery<A, E, R> | QueryFactory<A, E, R>;
}

export type LiveQueryCollectionRegister = (
  name: string,
  definition: AnyCollection
) => void;

const readonlyCollectionMutation = (
  collection: string,
  operation: string
): ReadonlyCollectionMutation =>
  new ReadonlyCollectionMutation({ collection, operation });

const liveQueryFromInput = <A extends object, E, R>(
  query: LiveQuery<A, E, R> | QueryFactory<A, E, R>
): LiveQuery<A, E, R> =>
  typeof query === "function"
    ? Query.live<A, E, R>(query)
    : query;

/**
 * Adapter from a live query to a read-only collection definition.
 */
export const makeLiveQueryCollectionDefinition = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: CollectionLiveQueryOptions<A, K, E, R>,
  register: LiveQueryCollectionRegister
): CollectionDefinition<A, K, E | QueryEvaluationError | ReadonlyCollectionMutation, R> => {
  const live = liveQueryFromInput(options.query);
  const readonlyFail = <Out>(operation: string): Effect.Effect<Out, ReadonlyCollectionMutation> =>
    Effect.fail(readonlyCollectionMutation(options.name, operation));
  const readonlySnapshotCodecFailure = (
    operation: "hydrate" | "restore"
  ): CollectionSnapshotCodecError =>
    new CollectionSnapshotCodecError({
      operation,
      path: "$",
      reason: `Live query collection "${options.name}" is derived and read-only; ${operation} source collections instead.`
    });
  const snapshotKeyCallbackError = (cause: unknown): EffectInputCallbackError =>
    new EffectInputCallbackError({
      operation: `Collection.snapshot(${options.name}).getKey`,
      cause,
      guidance: "Collection snapshot key callbacks must be synchronous, pure, and total. Move Effectful work into collection loaders or mutation handlers."
    });

  type LiveQueryCollectionDefinition =
    CollectionDefinition<A, K, E | QueryEvaluationError | ReadonlyCollectionMutation, R> &
    StoreExplicitCollectionSnapshotImplementation<A, K>;
  let definition: LiveQueryCollectionDefinition;
  const materialization = makeLiveQueryCollectionMaterialization<A, K, E, R>({
    name: options.name,
    live,
    definition: () => definition,
    snapshotKeyCallbackError
  });
  definition = {
    [CollectionTypeId]: CollectionTypeId,
    options: {
      name: options.name,
      getKey: options.getKey,
      ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
      load: () => live.preloadEffect().pipe(Effect.map(() => live.evaluate()))
    },
    name: options.name,
    readOnly: true,
    getKey: options.getKey,
    state: () => materialization.state(),
    version: () => materialization.version(),
    get: (key) => materialization.get(key),
    rows: () => materialization.rows(),
    index: (index, value) =>
      materialization.index(index, value),
    firstByIndex: (index, value) =>
      materialization.firstByIndex(index, value),
    preloadEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* live.preloadEffect();
      }),
    refetchEffect: () =>
      Effect.gen(function* () {
        yield* recordCollectionPreload(definition);
        yield* live.refetchEffect();
      }),
    pendingMutationsEffect: () => Effect.succeed([]),
    pendingMutations: () => [],
    flushPendingMutationsEffect: () => Effect.succeed([]),
    snapshotEffect: () =>
      Effect.gen(function* () {
        const store = yield* collectionStoreEffect;
        const updatedAt = yield* Clock.currentTimeMillis;
        return yield* materialization.snapshotWithStoreEffect(store, updatedAt);
      }),
    snapshot: () => materialization.snapshot(Date.now()),
    snapshotWithStore: (store, updatedAt) =>
      materialization.snapshotWithStore(store as RuntimeCollectionStore, updatedAt),
    snapshotWithStoreEffect: (store, updatedAt) =>
      materialization.snapshotWithStoreEffect(store as RuntimeCollectionStore, updatedAt),
    durableSnapshotSources: () => live.sources,
    hydratePreflightEffect: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    hydrateWithStoreEffect: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    hydrateEffect: () => Effect.fail(readonlySnapshotCodecFailure("hydrate")),
    hydrate: (snapshot, hydrateOptions) => {
      void runFork(definition.hydrateEffect(snapshot, hydrateOptions));
    },
    persistEffect: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions
    ) =>
      Effect.gen(function* () {
        const store = yield* collectionStoreEffect;
        const updatedAt = yield* Clock.currentTimeMillis;
        const snapshot = yield* materialization.snapshotWithStoreEffect(store, updatedAt);
        yield* persistCollectionSnapshotEffect(
          definition,
          Effect.succeed(snapshot),
          storage,
          persistOptions,
          store
        );
      }),
    restoreEffect: <PE = never, PR = never>() =>
      Effect.fail(readonlySnapshotCodecFailure("restore")) as Effect.Effect<void, PE | CollectionSnapshotCodecError, PR>,
    insertEffect: () => readonlyFail("insert"),
    updateEffect: () => readonlyFail("update"),
    deleteEffect: () => readonlyFail("delete"),
    writeInsertEffect: () => readonlyFail("writeInsert"),
    writeInsert: (input, writeOptions) => {
      void runFork(definition.writeInsertEffect(input, writeOptions));
    },
    writeUpdateEffect: () => readonlyFail("writeUpdate"),
    writeUpdate: (key, changes, writeOptions) => {
      void runFork(definition.writeUpdateEffect(key, changes, writeOptions));
    },
    writeDeleteEffect: () => readonlyFail("writeDelete"),
    writeDelete: (key) => {
      void runFork(definition.writeDeleteEffect(key));
    }
  };
  markStoreExplicitCollectionSnapshotDefinition(definition);

  register(options.name, definition as AnyCollection);

  return definition;
};
