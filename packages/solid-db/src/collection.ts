import type { Collection } from "@sunfall/arc-db";
import type { EffectInput } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import type { AsyncResult } from "effect/reactivity";
import type { Accessor } from "solid-js";
import { makeSolidDbReactiveBinding } from "./shared.js";

/** Options for `SolidDb.collection`. */
export interface CollectionBindingOptions<E = never> {
  /** Start loading when the instance mounts. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time preload.
   *
   * The error is `CollectionRuntimeError<E>`, so output-schema and hydration
   * codec failures are reported beside the collection's own `E` channel. If
   * this observer fails, the binding ignores that failure after updating
   * `preloadFailure`. Promise-shaped observers are rejected at the EffectInput
   * seam; adapt host Promise work explicitly with `Effect.tryPromise(...)`.
   */
  readonly onPreloadFailure?: (error: Collection.RuntimeError<E>) => EffectInput<void, unknown>;
}

/**
 * Instance-bound reactive reads of a collection, from `SolidDb.collection`.
 *
 * Accessors read the instance runtime's Collection Store. Writes and loads go
 * through the definition's `*Effect` methods, run with `Component.callback`:
 * `yield* Component.callback((id) => Todos.updateEffect(id, patch))`.
 */
export interface CollectionHandle<A extends object, K extends Collection.Key, E = never> {
  /** Current rows, including optimistic local writes. */
  readonly rows: Accessor<ReadonlyArray<Collection.Row<A, K>>>;
  /**
   * Current load `AsyncResult` with normalized runtime failures: `Success` once
   * rows are loaded, `waiting` while preloading or refetching, `Failure` with
   * the load `Cause`. Rows stay readable through `rows()` in every state.
   */
  readonly result: Accessor<AsyncResult.AsyncResult<void, Collection.RuntimeError<E>>>;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Accessor<Collection.RuntimeError<E> | undefined>;
  /** Queued optimistic mutations in the instance runtime. */
  readonly pendingMutations: Accessor<ReadonlyArray<Collection.PendingMutation<A, K>>>;
  /** Read one row by key from the instance runtime's store. */
  get(key: K): Collection.Row<A, K> | undefined;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: Collection.IndexValue): ReadonlyArray<Collection.Row<A, K>>;
}

/**
 * Binds a collection in a Component setup: reactive rows, keyed and indexed
 * lookups, load state, and pending mutations, read from the instance runtime.
 * It preloads on mount unless `preload` is false. The collection's services
 * join the component's `R`.
 */
export const collection = <A extends object, K extends Collection.Key, E = never, R = never>(
  definition: Collection.Definition<A, K, E, R>,
  options: CollectionBindingOptions<E> = {},
): Effect.Effect<CollectionHandle<A, K, E>, never, R> =>
  Effect.map(Component.instance, (instance) => {
    const preloadEffect = definition.preloadEffect();
    const binding = instance.run(() =>
      makeSolidDbReactiveBinding<Collection.RuntimeError<E>, R, never>({
        runtime: instance.runtime,
        preload: options.preload,
        preloadEffect: () => preloadEffect,
        onPreloadFailure: options.onPreloadFailure,
      }),
    );
    const handle: CollectionHandle<A, K, E> = {
      rows: () => binding.read(() => definition.rows()),
      result: () => binding.read(() => definition.state().get()),
      preloadFailure: binding.preloadFailure,
      pendingMutations: () => binding.read(() => definition.pendingMutations()),
      get: (key) => binding.read(() => definition.get(key)),
      index: (index, value) => binding.read(() => definition.index(index, value)),
    };
    return handle;
  }) as Effect.Effect<CollectionHandle<A, K, E>, never, R>;
