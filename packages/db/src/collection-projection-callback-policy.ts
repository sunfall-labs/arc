import {
  EffectInputCallbackError,
  type ActionOptimisticRowUpdate,
  type EffectInput,
} from "@sunfall/arc-core";
import { invokeEffectInput } from "@sunfall/arc-core/internal";
import { Effect } from "effect";
import { CollectionRowKeyChanged } from "./collection-errors.js";
import type { AnyCollection, CollectionDefinition, CollectionKey } from "./collection-contract.js";
import type { CollectionState } from "./collection-state.js";
import { applyCollectionUpdateSync } from "./collection-value-detachment.js";
import type { RuntimeCollectionStore } from "./runtime-collection-store.js";

export const collectionCallback = <A, E, R>(
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

export const collectionProjection = <A>(
  definition: AnyCollection,
  operation: string,
  evaluate: () => A,
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => collectionProjectionCallbackError(definition, operation, cause),
  });

export const collectionState = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  store: RuntimeCollectionStore,
): Effect.Effect<CollectionState<A, K, E>, EffectInputCallbackError> =>
  collectionProjection(definition, "state", () => store.state(definition));

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

export const applyCollectionUpdate = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  previous: A,
  update: ActionOptimisticRowUpdate<A>,
): Effect.Effect<ReturnType<typeof applyCollectionUpdateSync<A>>, EffectInputCallbackError> =>
  collectionProjection(definition, "update", () => applyCollectionUpdateSync(previous, update));
