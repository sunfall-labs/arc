import type { Collection } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import { Effect, type Cause } from "effect";
import type { Accessor } from "solid-js";
import { makeSolidDbReactiveBinding, settledFailure, type RenderError } from "./shared.js";

/** Options for `SolidDb.collection`. */
export interface CollectionBindingOptions {
  /** Start loading when the instance mounts. Defaults to true. */
  readonly preload?: boolean;
}

/**
 * Instance-bound reactive reads of a collection, from `SolidDb.collection`.
 *
 * Rows render from `rows()`, `get()`, and `index()`; status chrome reads
 * `waiting()` and `failure()`, the same names a Resource reader uses. Rows
 * stay readable while a load is in flight and after a failed refresh; if the
 * collection has never loaded and its load failed, the reads throw that
 * failure to the nearest `<Errored>` (which is why it joins the Component's
 * `E`). Actions change the rows (`transaction.update(Projects, id, patch)` in
 * an Action's `optimistic`).
 */
export interface CollectionHandle<A extends object, K extends Collection.Key, E = never> {
  /** Current rows, including rows Actions are optimistically patching. */
  readonly rows: Accessor<ReadonlyArray<Collection.Row<A, K>>>;
  /** Read one row by key from the instance runtime's store. */
  get(key: K): Collection.Row<A, K> | undefined;
  /** Read rows from a named secondary index bucket. */
  index(index: string, value: Collection.IndexValue): ReadonlyArray<Collection.Row<A, K>>;
  /** True while a preload or refresh is in flight. */
  readonly waiting: Accessor<boolean>;
  /** The settled failure of the latest load, if it failed. */
  readonly failure: Accessor<Cause.Cause<RenderError<E>> | undefined>;
}

/**
 * Binds a collection in a Component setup: reactive rows, keyed and indexed
 * lookups, and load status, read from the instance runtime. It preloads on
 * mount unless `preload` is false. The collection's declared load error joins
 * the Component's `E` (a never-loaded collection whose load failed throws it
 * to `<Errored>`, where `catchTags` handles it) and its services join `R`.
 */
export const collection = <A extends object, K extends Collection.Key, E = never, R = never>(
  definition: Collection.Definition<A, K, E, R>,
  options: CollectionBindingOptions = {},
): Effect.Effect<CollectionHandle<A, K, E>, RenderError<E>, R> =>
  Effect.map(Component.instance, (instance) => {
    const preloadEffect = definition.preload();
    const binding = instance.run(() =>
      makeSolidDbReactiveBinding({
        instance,
        preload: options.preload,
        load: () => preloadEffect,
        result: () => definition.result().get(),
      }),
    );
    const handle: CollectionHandle<A, K, E> = {
      rows: () => binding.read(() => definition.rows()),
      get: (key) => binding.read(() => definition.get(key)),
      index: (index, value) => binding.read(() => definition.index(index, value)),
      waiting: () => binding.result().waiting,
      failure: () => settledFailure(binding.result()),
    };
    return handle;
  }) as Effect.Effect<CollectionHandle<A, K, E>, RenderError<E>, R>;
