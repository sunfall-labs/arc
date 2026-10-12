import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/persistence";
import type { AsyncResult } from "effect/reactivity";
import type { AnyResourceRef } from "./resource.js";
import {
  decodeResourceHydrationState,
  resourceHydrationSnapshotFromRef,
  validateResourceHydrationSnapshot,
} from "./resource-snapshot-codec.js";

/**
 * Where a family's settled values persist in the runtime's `KeyValueStore`
 * (`effect/persistence`): `arc/resources/v<version>/<key>/<ref key>`.
 */
export interface ResourcePersistOptions {
  /** Store namespace for the family's entries. */
  readonly key: string;
  /**
   * Format version folded into the prefix; defaults to `1`. Bump it when the
   * output changes shape: values under the old prefix are never read.
   */
  readonly version?: number;
}

const persistKey = (ref: AnyResourceRef, persist: ResourcePersistOptions): string =>
  `arc/resources/v${persist.version ?? 1}/${persist.key}/${ref.key}`;

const persistOptions = (ref: AnyResourceRef): ResourcePersistOptions | undefined =>
  ref.family.options.policy?.persist;

/**
 * Writes a settled value of a persisted family to the runtime's
 * `KeyValueStore`, encoded like a hydration snapshot (through the family's
 * `output` schema). Without a `KeyValueStore` in context it does nothing; a
 * failed write is logged and never fails the load.
 */
export const persistResourceState = (
  ref: AnyResourceRef,
  state: AsyncResult.Success<unknown, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const persist = persistOptions(ref);
    if (persist === undefined) {
      return;
    }
    const store = yield* Effect.serviceOption(KeyValueStore.KeyValueStore);
    if (Option.isNone(store)) {
      return;
    }
    const snapshot = yield* resourceHydrationSnapshotFromRef(ref, state);
    yield* store.value.set(persistKey(ref, persist), JSON.stringify(snapshot));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(
        `Resource "${ref.family.options.name}": could not persist ${ref.key}.`,
        cause,
      ),
    ),
  );

/**
 * Reads the persisted value of `ref`, if its family persists and the
 * runtime's `KeyValueStore` holds one this build can decode. A value that no
 * longer decodes is logged and treated as absent.
 */
export const restoreResourceState = (
  ref: AnyResourceRef,
): Effect.Effect<Option.Option<AsyncResult.Success<unknown, unknown>>> =>
  Effect.gen(function* () {
    const persist = persistOptions(ref);
    if (persist === undefined) {
      return Option.none();
    }
    const store = yield* Effect.serviceOption(KeyValueStore.KeyValueStore);
    if (Option.isNone(store)) {
      return Option.none();
    }
    const stored = yield* store.value.get(persistKey(ref, persist));
    if (stored === undefined || typeof stored !== "string") {
      return Option.none();
    }
    const snapshot = yield* Effect.try({
      try: () => validateResourceHydrationSnapshot(JSON.parse(stored), "hydrate"),
      catch: (cause) => cause,
    });
    if (snapshot.key !== ref.key) {
      return Option.none();
    }
    return Option.some(yield* decodeResourceHydrationState(ref.family, snapshot));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `Resource "${ref.family.options.name}": ignoring an unreadable persisted ${ref.key}.`,
          cause,
        ),
        Option.none(),
      ),
    ),
  );
