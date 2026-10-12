import { ResourceStore, type ResourceStore as ResourceStoreState } from "@sunfall/arc-core";
import { currentOrDefaultRuntime } from "@sunfall/arc-core/internal";
import { Effect, Exit, Option, PubSub, Scope } from "effect";
import { AsyncResult } from "effect/reactivity";
import { CollectionStoreTypeId } from "./collection-ids.js";
import {
  bumpCollectionState,
  commitCollectionLoadState,
  makeCollectionState,
  pendingOptimisticTransactionCount,
  type CollectionState,
} from "./collection-state.js";
import { ingestCollectionOutputRowsSync } from "./collection-row-ingress.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionKey,
  CollectionRuntimeError,
  CollectionStore,
  CollectionStoreDiagnosticsSnapshot,
  CollectionStoreEvent,
} from "./collection-contract.js";

const initialDataPath = (definition: AnyCollection): string =>
  `$.collections[${definition.name}].initialData`;

type AnyCollectionState = CollectionState<any, any, any>;

const stateForDefinition = <A extends object, K extends CollectionKey, E>(
  state: AnyCollectionState,
): CollectionState<A, K, E> => state as CollectionState<A, K, E>;

const initializeCollectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  state: CollectionState<A, K, E>,
): void => {
  if (state.initialized) {
    return;
  }

  state.initialized = true;
  const initialData = definition.options.initialData ?? [];
  if (initialData.length === 0) {
    return;
  }

  try {
    const rows = ingestCollectionOutputRowsSync(definition, initialData, {
      operation: "load",
      path: initialDataPath(definition),
      synced: true,
      origin: "remote",
    });
    for (const row of rows) {
      state.rows.set(row.key, row);
    }
    state.initialDataError = undefined;
    // Initial data materializes synchronously outside any Effect, so there is no Clock here.
    commitCollectionLoadState(state, AsyncResult.success(undefined, { timestamp: Date.now() }));
    bumpCollectionState(state);
  } catch (error) {
    state.rows.clear();
    state.initialDataError = error as CollectionRuntimeError<E>;
    commitCollectionLoadState(state, AsyncResult.fail(state.initialDataError));
  }
};

/**
 * Runtime/request-local owner of collection state, diagnostics, and lifecycle
 * events.
 *
 * The store is keyed through the active Resource Store's module registry, so
 * SSR requests, client runtimes, and tests get isolated collection rows,
 * optimistic Action patches, and event streams.
 */
export class RuntimeCollectionStore implements CollectionStore {
  readonly [CollectionStoreTypeId]: typeof CollectionStoreTypeId = CollectionStoreTypeId;
  readonly #states = new WeakMap<object, AnyCollectionState>();
  readonly #definitions = new Set<AnyCollection>();
  readonly #events = Effect.runSync(PubSub.sliding<CollectionStoreEvent>(1024));
  /** Lifetime of store-owned background work such as `follow` streams. */
  readonly scope: Scope.Closeable = Effect.runSync(Scope.make());
  readonly dispose = Scope.close(this.scope, Exit.void).pipe(
    Effect.ensuring(PubSub.shutdown(this.#events)),
  );
  readonly diagnostics = {
    snapshot: Effect.sync(() => this.diagnosticsSnapshot()),
  };

  state(definition: AnyCollection): CollectionState<any, any, any>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
  ): CollectionState<A, K, E>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
  ): CollectionState<A, K, E> {
    const existing = this.#states.get(definition);
    if (existing) {
      return stateForDefinition<A, K, E>(existing);
    }

    const state = makeCollectionState<A, K, E>(definition.name);
    this.#definitions.add(definition);
    this.#states.set(definition, state);
    initializeCollectionState(definition, state);
    return state;
  }

  diagnosticsSnapshot(): CollectionStoreDiagnosticsSnapshot {
    let rowCount = 0;
    let pendingMutationCount = 0;
    let optimisticRowCount = 0;
    let loadingCount = 0;
    let failureCount = 0;

    for (const definition of this.#definitions) {
      const state = this.#states.get(definition);
      if (!state) {
        continue;
      }
      rowCount += state.rows.size;
      pendingMutationCount += pendingOptimisticTransactionCount(state);
      optimisticRowCount += state.optimisticRows.size;
      const loadState = state.loadState.get();
      if (loadState.waiting) {
        loadingCount += 1;
      }
      if (loadState._tag === "Failure") {
        failureCount += 1;
      }
    }

    return {
      collectionCount: this.#definitions.size,
      rowCount,
      pendingMutationCount,
      optimisticRowCount,
      loadingCount,
      failureCount,
    };
  }

  publish(event: CollectionStoreEvent): Effect.Effect<void> {
    return PubSub.publish(this.#events, event).pipe(Effect.asVoid);
  }

  subscribeEvents(): Effect.Effect<PubSub.Subscription<CollectionStoreEvent>, never, Scope.Scope> {
    return PubSub.subscribe(this.#events);
  }
}

const makeCollectionStore = (): RuntimeCollectionStore => new RuntimeCollectionStore();

const isRuntimeCollectionStore = (value: unknown): value is RuntimeCollectionStore =>
  value instanceof RuntimeCollectionStore;

/** Resolve the Runtime Collection Store attached to a Resource Store. */
export const storeFor = (resourceStore: ResourceStoreState): RuntimeCollectionStore => {
  const existing = resourceStore.moduleRegistry.get(CollectionStoreTypeId);
  if (isRuntimeCollectionStore(existing)) {
    return existing;
  }

  const store = makeCollectionStore();
  resourceStore.moduleRegistry.register(CollectionStoreTypeId, store);
  return store;
};

export const defaultRuntimeCollectionStore = (): RuntimeCollectionStore =>
  storeFor(currentOrDefaultRuntime().resourceStore);

const resourceStoreEffect: Effect.Effect<ResourceStoreState> = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(ResourceStore);
  return Option.isSome(store) ? store.value : currentOrDefaultRuntime().resourceStore;
});

/** Access the active Runtime Collection Store from inside Effect. */
export const collectionStoreEffect: Effect.Effect<RuntimeCollectionStore> = Effect.map(
  resourceStoreEffect,
  storeFor,
);

let currentCollectionStoreOverride: RuntimeCollectionStore | undefined;

/** Access the active Runtime Collection Store from synchronous render/read seams. */
export const currentCollectionStore = (): CollectionStore =>
  currentCollectionStoreOverride ?? defaultRuntimeCollectionStore();

export const runWithCollectionStore = <A>(store: RuntimeCollectionStore, evaluate: () => A): A => {
  const previous = currentCollectionStoreOverride;
  currentCollectionStoreOverride = store;
  try {
    return evaluate();
  } finally {
    currentCollectionStoreOverride = previous;
  }
};

/** Subscribe to active Runtime Collection Store events inside a Scope. */
export const subscribeCollectionEventsEffect = (): Effect.Effect<
  PubSub.Subscription<CollectionStoreEvent>,
  never,
  Scope.Scope
> => Effect.flatMap(collectionStoreEffect, (store) => store.subscribeEvents());
