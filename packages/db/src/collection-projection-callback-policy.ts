import { EffectInputCallbackError, invokeEffectInput, type EffectInput } from "@sunfall/arc-core";
import { Effect } from "effect";
import { CollectionRowKeyChanged } from "./collection-errors.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionKey,
  CollectionUpdate,
} from "./collection-contract.js";
import type { CollectionState } from "./collection-state.js";
import { applyCollectionUpdate } from "./collection-value-detachment.js";
import type { RuntimeCollectionStore } from "./runtime-collection-store.js";

export const collectionCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>,
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection callback", callback);

export const collectionProjectionCallbackError = (
  definition: AnyCollection,
  operation: string,
  cause: unknown,
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.${operation}(${definition.name})`,
    cause,
    guidance:
      "Collection projection callbacks such as getKey, indexes, update functions, and state lookup must be synchronous, pure, and total. Move Effectful work into collection loaders or mutation handlers.",
  });

export const collectionProjectionEffect = <A>(
  definition: AnyCollection,
  operation: string,
  evaluate: () => A,
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => collectionProjectionCallbackError(definition, operation, cause),
  });

export const collectionStateEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
): Effect.Effect<CollectionState<A, K, E>, EffectInputCallbackError> =>
  collectionProjectionEffect(definition, "state", () => store.state(definition));

export const ensureCollectionRowKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  key: K,
  nextKey: K,
): Effect.Effect<void, CollectionRowKeyChanged> =>
  Object.is(nextKey, key)
    ? Effect.void
    : Effect.fail(
        new CollectionRowKeyChanged({
          collection: definition.name,
          key,
          nextKey,
          guidance:
            "Collection updates must preserve the row key. Delete and insert when a domain workflow intentionally changes identity.",
        }),
      );

export const applyCollectionUpdateEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  previous: A,
  update: CollectionUpdate<A>,
): Effect.Effect<ReturnType<typeof applyCollectionUpdate<A>>, EffectInputCallbackError> =>
  collectionProjectionEffect(definition, "update", () => applyCollectionUpdate(previous, update));
