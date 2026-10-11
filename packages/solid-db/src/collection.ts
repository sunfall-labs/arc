import type { Collection } from "@sunfall/arc-db";
import type { EffectInput } from "@sunfall/arc-core";
import type { AsyncResult } from "effect/reactivity";
import type { Accessor } from "solid-js";
import { makeSolidDbReactiveBinding } from "./shared.js";

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
  readonly onPreloadFailure?: (
    error: Collection.RuntimeError<E> | ER,
  ) => EffectInput<void, unknown>;
}

/**
 * Solid-facing reactive reads for a collection.
 *
 * Accessors read from the nearest Sunfall Arc runtime. Writes and loads go
 * through the definition's `*Effect` methods run by the runtime runner, e.g.
 * `runEffect(Todos.updateEffect(id, patch))` with `useRuntimeEffect()`.
 */
export interface CollectionHandle<
  A extends object,
  K extends Collection.Key,
  E = never,
  ER = never,
> {
  /** Current rows, including optimistic local writes. */
  readonly rows: Accessor<ReadonlyArray<Collection.Row<A, K>>>;
  /**
   * Current load `AsyncResult` with normalized runtime failures: `Success` once
   * rows are loaded, `waiting` while preloading or refetching, `Failure` with
   * the load `Cause`. Rows stay readable through `rows()` in every state.
   */
  readonly result: Accessor<AsyncResult.AsyncResult<void, Collection.RuntimeError<E>>>;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Accessor<Collection.RuntimeError<E> | ER | undefined>;
  /** Queued optimistic mutations captured from the current Solid runtime. */
  readonly pendingMutations: Accessor<ReadonlyArray<Collection.PendingMutation<A, K>>>;
  /** Read one row by key from the current runtime store. */
  get(key: K): Collection.Row<A, K> | undefined;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: Collection.IndexValue): ReadonlyArray<Collection.Row<A, K>>;
}

/**
 * Subscribes a Solid component to a Sunfall Arc collection.
 *
 * The hook exposes reactive rows, keyed and indexed lookups, load state, and
 * pending mutations. It preloads on mount unless `preload` is false.
 *
 * @example
 * ```tsx
 * const projects = useCollection(Projects);
 * const rows = projects.rows();
 * ```
 */
export const useCollection = <
  A extends object,
  K extends Collection.Key,
  E = never,
  R = never,
  ER = never,
>(
  collection: Collection.Definition<A, K, E, R>,
  options: UseCollectionOptions<E, ER> = {},
): CollectionHandle<A, K, E, ER> => {
  const preloadEffect = collection.preloadEffect();
  const binding = makeSolidDbReactiveBinding<Collection.RuntimeError<E>, R, ER>({
    preload: options.preload,
    preloadEffect: () => preloadEffect,
    onPreloadFailure: options.onPreloadFailure,
  });
  const rows = () => binding.read(() => collection.rows());
  const result = () => binding.read(() => collection.state().get());
  const pendingMutations = () => binding.read(() => collection.pendingMutations());

  return {
    rows,
    result,
    preloadFailure: binding.preloadFailure,
    pendingMutations,
    get: (key) => binding.read(() => collection.get(key)),
    index: (index, value) => binding.read(() => collection.index(index, value)),
  };
};
