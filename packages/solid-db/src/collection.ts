import {
  type CollectionDefinition,
  type CollectionIndexValue,
  type CollectionKey,
  type CollectionLoadState,
  type CollectionPendingMutation,
  type CollectionRow,
  type CollectionRowKeyChanged,
  type CollectionRowNotFound,
  type CollectionRuntimeError,
  type CollectionTransaction,
  type CollectionUpdate,
  type CollectionWriteOptions
} from "@effect-ui/db";
import type { EffectInput } from "@effect-ui/core";
import { Effect } from "effect";
import { createMemo, type Accessor } from "solid-js";
import { collectionStateError, makeSolidDbReactiveBinding } from "./shared.js";

/** Options for binding a Collection to Solid reactivity. */
export interface UseCollectionOptions<E = never, ER = never> {
  /** Start loading on mount. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time preload.
   *
   * The error is `CollectionRuntimeError<E>`, so output-schema and hydration
   * codec failures are reported beside the collection's own `E` channel. If
   * this observer fails, the hook ignores that failure after updating
   * `preloadFailure`. Promise-shaped observers are rejected at the EffectInput
   * seam; adapt host Promise work explicitly with `Effect.tryPromise(...)`.
   */
  readonly onPreloadFailure?: (error: CollectionRuntimeError<E> | ER) => EffectInput<void, unknown>;
}

/**
 * Solid-facing handle for a collection.
 *
 * Accessors read from the nearest Effect UI runtime. Loading and refetching are
 * exposed as Effects so callers can compose or run them at UI boundaries.
 */
export interface CollectionHandle<A extends object, K extends CollectionKey, E = never, ER = never> {
  /** Current rows, including optimistic local writes. */
  readonly rows: Accessor<ReadonlyArray<CollectionRow<A, K>>>;
  /** Current load/refetch state with normalized runtime failures. */
  readonly state: Accessor<CollectionLoadState<CollectionRuntimeError<E>>>;
  /** True while the collection is preloading or refetching. */
  readonly waiting: Accessor<boolean>;
  /** Latest load/refetch failure, when the state is `Failure`. */
  readonly error: Accessor<CollectionRuntimeError<E> | undefined>;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Accessor<CollectionRuntimeError<E> | ER | undefined>;
  /** Queued optimistic mutations captured from the current Solid runtime. */
  readonly pendingMutations: Accessor<ReadonlyArray<CollectionPendingMutation<A, K>>>;
  /** Read one row by key from the current runtime store. */
  get(key: K): CollectionRow<A, K> | undefined;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: CollectionIndexValue): ReadonlyArray<CollectionRow<A, K>>;
  /** Read the first row from a named secondary index bucket. */
  firstByIndex(index: string, value: CollectionIndexValue): CollectionRow<A, K> | undefined;
  /** Ensure the collection has loaded inside the nearest Solid runtime. */
  preloadEffect(): Effect.Effect<void, CollectionRuntimeError<E> | ER>;
  /** Force a fresh collection load inside the nearest Solid runtime. */
  refetchEffect(): Effect.Effect<void, CollectionRuntimeError<E> | ER>;
  /** Optimistically insert rows and run the insert handler inside the Solid runtime. */
  insertEffect(input: A | ReadonlyArray<A>): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E> | ER>;
  /** Optimistically update one row and run the update handler inside the Solid runtime. */
  updateEffect(
    key: K,
    update: CollectionUpdate<A>
  ): Effect.Effect<
    CollectionTransaction<A, K>,
    CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged | ER
  >;
  /** Optimistically delete one row and run the delete handler inside the Solid runtime. */
  deleteEffect(
    key: K
  ): Effect.Effect<CollectionTransaction<A, K>, CollectionRuntimeError<E> | CollectionRowNotFound | ER>;
  /** Write rows directly without queuing mutation handlers inside the Solid runtime. */
  writeInsertEffect(input: A | ReadonlyArray<A>, options?: CollectionWriteOptions): Effect.Effect<void, CollectionRuntimeError<E> | ER>;
  /** Write a partial patch directly without queuing mutation handlers inside the Solid runtime. */
  writeUpdateEffect(
    key: K,
    changes: Partial<A>,
    options?: CollectionWriteOptions
  ): Effect.Effect<void, CollectionRuntimeError<E> | CollectionRowNotFound | CollectionRowKeyChanged | ER>;
  /** Delete a row directly without queuing mutation handlers inside the Solid runtime. */
  writeDeleteEffect(key: K): Effect.Effect<void, CollectionRuntimeError<E> | ER>;
  /** Retry queued mutation handlers for this collection inside the Solid runtime. */
  flushPendingMutationsEffect(): Effect.Effect<ReadonlyArray<CollectionTransaction<A, K>>, CollectionRuntimeError<E> | ER>;
}

/**
 * Subscribes a Solid component to an Effect UI collection.
 *
 * The hook exposes rows, indexed lookups, load state, and Effect-returning
 * preload/refetch methods. It preloads on mount unless `preload` is false.
 *
 * @example
 * ```tsx
 * const projects = useCollection(Projects);
 * const rows = projects.rows();
 * ```
 */
export const useCollection = <A extends object, K extends CollectionKey, E = never, R = never, ER = never>(
  collection: CollectionDefinition<A, K, E, R>,
  options: UseCollectionOptions<E, ER> = {}
): CollectionHandle<A, K, E, ER> => {
  const binding = makeSolidDbReactiveBinding<CollectionRuntimeError<E>, R, ER>({
    sources: [collection],
    preload: options.preload,
    preloadEffect: collection.preloadEffect(),
    onPreloadFailure: options.onPreloadFailure
  });
  const rows = () => binding.read(() => collection.rows());
  const state = () => binding.read(() => collection.state().get());
  const pendingMutations = () => binding.read(() => collection.pendingMutations());

  return {
    rows,
    state,
    waiting: createMemo(() => state().waiting),
    error: createMemo(() => collectionStateError(state())),
    preloadFailure: binding.preloadFailure,
    pendingMutations,
    get: (key) => binding.read(() => collection.get(key)),
    index: (index, value) => binding.read(() => collection.index(index, value)),
    firstByIndex: (index, value) => binding.read(() => collection.firstByIndex(index, value)),
    preloadEffect: () => binding.bindEffect(collection.preloadEffect()),
    refetchEffect: () => binding.bindEffect(collection.refetchEffect()),
    insertEffect: (input) => binding.bindEffect(collection.insertEffect(input)),
    updateEffect: (key, update) => binding.bindEffect(collection.updateEffect(key, update)),
    deleteEffect: (key) => binding.bindEffect(collection.deleteEffect(key)),
    writeInsertEffect: (input, writeOptions) => binding.bindEffect(collection.writeInsertEffect(input, writeOptions)),
    writeUpdateEffect: (key, changes, writeOptions) => binding.bindEffect(collection.writeUpdateEffect(key, changes, writeOptions)),
    writeDeleteEffect: (key) => binding.bindEffect(collection.writeDeleteEffect(key)),
    flushPendingMutationsEffect: () => binding.bindEffect(collection.flushPendingMutationsEffect())
  };
};
