import type { Collection } from "@sunfall/arc-db";
import { Effect, Layer } from "effect";
import { KeyValueStore } from "effect/persistence";

/** Hooks that run before the backing Map is read or written; failing one fails the call. */
export interface TestKeyValueStoreHooks {
  readonly beforeGet?: (key: string) => Effect.Effect<void, KeyValueStore.KeyValueStoreError>;
  /** Replaces a read: receives the stored value and returns what the store yields. */
  readonly get?: (
    key: string,
    stored: string | undefined,
  ) => Effect.Effect<string | undefined, KeyValueStore.KeyValueStoreError>;
  readonly beforeSet?: (
    key: string,
    value: string,
  ) => Effect.Effect<void, KeyValueStore.KeyValueStoreError>;
}

/** A `KeyValueStore` over a Map the test can inspect, shared across runtimes ("page loads"). */
export interface TestKeyValueStore {
  readonly values: Map<string, string>;
  readonly layer: Layer.Layer<KeyValueStore.KeyValueStore>;
  /** The snapshot persisted under `arc/collections/v<version>/<key>`, decoded as plain JSON. */
  snapshot<A extends object = any, K extends Collection.Key = string>(
    key: string,
    version?: number,
  ): Collection.Snapshot<A, K> | undefined;
}

export const collectionStoreKey = (key: string, version = 1): string =>
  `arc/collections/v${version}/${key}`;

export const makeTestKeyValueStore = (
  hooks: TestKeyValueStoreHooks = {},
  /** The backing Map, used as is (seed it with `collectionStoreKey` keys). */
  values: Map<string, string> = new Map(),
): TestKeyValueStore => {
  const layer = Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) =>
        Effect.flatMap(hooks.beforeGet?.(key) ?? Effect.void, () =>
          hooks.get ? hooks.get(key, values.get(key)) : Effect.succeed(values.get(key)),
        ),
      set: (key, value) =>
        Effect.map(hooks.beforeSet?.(key, value) ?? Effect.void, () => {
          values.set(key, value);
        }),
      remove: (key) => Effect.sync(() => void values.delete(key)),
      clear: Effect.sync(() => values.clear()),
      size: Effect.sync(() => values.size),
    }),
  );
  return {
    values,
    layer,
    snapshot: (key, version) => {
      const raw = values.get(collectionStoreKey(key, version));
      return raw === undefined ? undefined : JSON.parse(raw);
    },
  };
};

/** A `KeyValueStoreError` for a failing test store. */
export const keyValueStoreError = (
  method: "get" | "set",
  key: string,
  message: string,
): KeyValueStore.KeyValueStoreError =>
  new KeyValueStore.KeyValueStoreError({ method, key, message });
