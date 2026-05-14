import {
  Signal,
  stableStringify,
  runFork
} from "@effect-ui/core";
import { Clock, Effect } from "effect";
import { CollectionTypeId } from "./collection-ids.js";
import { ReadonlyCollectionMutation } from "./collection-errors.js";
import { rowsMatchingCollectionIndex } from "./collection-state.js";
import {
  collectionSnapshotFromValues,
  encodeCollectionSnapshotEffect
} from "./collection-snapshot-codec.js";
import {
  collectionInputEffect,
  persistenceKey,
  recordCollectionPreload
} from "./collection-runtime.js";
import { Query, type LiveQuery, type QueryFactory } from "./query-builder.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionIndexRecord,
  CollectionKey,
  CollectionLoadState,
  CollectionPersistOptions,
  CollectionPersistenceStorage,
  CollectionRow,
  CollectionSnapshot
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
  readonly query: LiveQuery<A, E, R> | QueryFactory<A>;
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
      rowsMatchingCollectionIndex(definition, materialized().map(row), index, value),
    firstByIndex: (index, value) =>
      rowsMatchingCollectionIndex(definition, materialized().map(row), index, value)[0],
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
      Effect.map(Clock.currentTimeMillis, (updatedAt): CollectionSnapshot<A, K> =>
        collectionSnapshotFromValues(options.name, materialized(), options.getKey, updatedAt)
      ),
    snapshot: () =>
      collectionSnapshotFromValues(options.name, materialized(), options.getKey, Date.now()),
    hydrateEffect: () => Effect.void,
    hydrate: () => {},
    persistEffect: <PE = never, PR = never>(
      storage: CollectionPersistenceStorage<PE, PR>,
      persistOptions?: CollectionPersistOptions
    ) =>
      Effect.gen(function* () {
        const key = persistenceKey(definition, persistOptions);
        const snapshot = yield* definition.snapshotEffect();
        const encoded = yield* encodeCollectionSnapshotEffect(snapshot);
        yield* collectionInputEffect(storage.setItem(key, encoded));
      }),
    restoreEffect: () => Effect.void,
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

  register(options.name, definition as AnyCollection);

  return definition;
};
