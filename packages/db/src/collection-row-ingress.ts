import { EffectInputCallbackError } from "@effect-ui/core";
import { Effect } from "effect";
import type {
  CollectionDefinition,
  CollectionKey,
  CollectionOrigin
} from "./collection-contract.js";
import type { StoredRow } from "./collection-state.js";
import { cloneCollectionValue } from "./collection-value-detachment.js";
import {
  CollectionSnapshotCodecError,
  decodeCollectionOutputValuesEffect,
  decodeCollectionOutputValuesSync,
  validateCollectionKey,
  type CollectionSnapshotCodecOperation
} from "./collection-snapshot-codec.js";

interface CollectionRowIngressOptions {
  readonly operation: CollectionSnapshotCodecOperation;
  readonly path: string;
  readonly synced: boolean;
  readonly origin: CollectionOrigin;
}

const collectionIngressCallbackError = (
  definition: { readonly name: string },
  operation: CollectionSnapshotCodecOperation,
  path: string,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: `Collection.getKey(${definition.name})`,
    cause,
    guidance: `Collection row ingress getKey callbacks must be synchronous, pure, and total. The failing ${operation} value was at ${path}.`
  });

const collectionIngressKey = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  path: string
): K => {
  try {
    return validateCollectionKey(definition.getKey(value), operation, path);
  } catch (cause) {
    if (cause instanceof CollectionSnapshotCodecError) {
      throw cause;
    }
    throw collectionIngressCallbackError(definition, operation, path, cause);
  }
};

const collectionIngressKeyEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  value: A,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<K, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.try({
    try: () => collectionIngressKey(definition, value, operation, path),
    catch: (cause) =>
      cause instanceof CollectionSnapshotCodecError || cause instanceof EffectInputCallbackError
        ? cause
        : collectionIngressCallbackError(definition, operation, path, cause)
  });

const storedRowsFromDecodedValuesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  options: CollectionRowIngressOptions
): Effect.Effect<ReadonlyArray<StoredRow<A, K>>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const rows: Array<StoredRow<A, K>> = [];
    for (const [index, decoded] of values.entries()) {
      const value = cloneCollectionValue(decoded);
      const key = yield* collectionIngressKeyEffect(
        definition,
        value,
        options.operation,
        `${options.path}[${index}].key`
      );
      rows.push({
        key,
        value,
        synced: options.synced,
        origin: options.origin
      });
    }
    return rows;
  });

const storedRowsFromDecodedValuesSync = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  options: CollectionRowIngressOptions
): ReadonlyArray<StoredRow<A, K>> => {
  const rows: Array<StoredRow<A, K>> = [];
  for (const [index, decoded] of values.entries()) {
    const value = cloneCollectionValue(decoded);
    const key = collectionIngressKey(
      definition,
      value,
      options.operation,
      `${options.path}[${index}].key`
    );
    rows.push({
      key,
      value,
      synced: options.synced,
      origin: options.origin
    });
  }
  return rows;
};

const decodeCollectionInputValuesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> =>
  decodeCollectionOutputValuesEffect(
    definition.options.input,
    values,
    operation,
    path
  );

const decodeCollectionMutationValuesEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  operation: CollectionSnapshotCodecOperation,
  path: string
): Effect.Effect<ReadonlyArray<A>, CollectionSnapshotCodecError> =>
  Effect.flatMap(
    decodeCollectionInputValuesEffect(definition, values, operation, `${path}.input`),
    (decodedInput) =>
      decodeCollectionOutputValuesEffect(
        definition.options.output,
        decodedInput,
        operation,
        path
      )
  );

export const ingestCollectionOutputRowsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  options: CollectionRowIngressOptions
): Effect.Effect<ReadonlyArray<StoredRow<A, K>>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.flatMap(
    decodeCollectionOutputValuesEffect(definition.options.output, values, options.operation, options.path),
    (decoded) => storedRowsFromDecodedValuesEffect(definition, decoded, options)
  );

export const ingestCollectionMutationRowsEffect = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  options: CollectionRowIngressOptions
): Effect.Effect<ReadonlyArray<StoredRow<A, K>>, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.flatMap(
    decodeCollectionMutationValuesEffect(definition, values, options.operation, options.path),
    (decoded) => storedRowsFromDecodedValuesEffect(definition, decoded, options)
  );

export const ingestCollectionOutputRowsSync = <A extends object, K extends CollectionKey, E, R>(
  definition: CollectionDefinition<A, K, E, R>,
  values: ReadonlyArray<A>,
  options: CollectionRowIngressOptions
): ReadonlyArray<StoredRow<A, K>> =>
  storedRowsFromDecodedValuesSync(
    definition,
    decodeCollectionOutputValuesSync(definition.options.output, values, options.operation, options.path),
    options
  );
