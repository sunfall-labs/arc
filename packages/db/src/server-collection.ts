import {
  isServerFunction,
  toEffect,
  type EffectInput,
  type ServerClientError,
  type ServerFunction
} from "@effect-ui/core";
import { Data, Effect } from "effect";
import type {
  CollectionIndexRecord,
  CollectionKey,
  CollectionOptions,
  CollectionPolicy
} from "./index.js";
import {
  collectionSyncOptions,
  type CollectionSyncAdapter,
  type CollectionSyncDeletePayload,
  type CollectionSyncInsertPayload,
  type CollectionSyncUpdatePayload
} from "./sync-adapter.js";

export type ServerCollectionResult<A, E = unknown, R = never> =
  | EffectInput<A, E, R>
  | PromiseLike<A>;

export type ServerCollectionOperation<I, A, E = unknown, R = never> =
  | ServerFunction<I, A, E, R>
  | ((input: I) => ServerCollectionResult<A, E, R>);

export type ServerCollectionInsertPayload<A extends object, K extends CollectionKey> =
  CollectionSyncInsertPayload<A, K>;

export type ServerCollectionUpdatePayload<A extends object, K extends CollectionKey> =
  CollectionSyncUpdatePayload<A, K>;

export type ServerCollectionDeletePayload<A extends object, K extends CollectionKey> =
  CollectionSyncDeletePayload<A, K>;

type ServerCollectionIdentity =
  | {
      readonly name: string;
      readonly id?: string;
    }
  | {
      readonly id: string;
      readonly name?: string;
    };

export type ServerCollectionOptions<
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
> = ServerCollectionIdentity & {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly policy?: CollectionPolicy<E | ServerClientError>;
  readonly getKey: (value: A) => K;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly initialData?: ReadonlyArray<A>;
  readonly load?: ServerCollectionOperation<void, ReadonlyArray<A>, E, R>;
  readonly refetch?: ServerCollectionOperation<void, ReadonlyArray<A>, E, R>;
  readonly insert?: ServerCollectionOperation<ServerCollectionInsertPayload<A, K>, void, E, R>;
  readonly update?: ServerCollectionOperation<ServerCollectionUpdatePayload<A, K>, void, E, R>;
  readonly delete?: ServerCollectionOperation<ServerCollectionDeletePayload<A, K>, void, E, R>;
};

export class ServerCollectionMissingIdentity extends Data.TaggedError(
  "ServerCollectionMissingIdentity"
)<{
  readonly guidance: string;
}> {}

const runOperation = <I, A, E, R>(
  operation: ServerCollectionOperation<I, A, E, R>,
  input: I
): Effect.Effect<A, E | ServerClientError, R> =>
  Effect.suspend(() => {
    if (isServerFunction(operation)) {
      return operation.effect(input) as Effect.Effect<A, E | ServerClientError, R>;
    }

    return toEffect(operation(input) as EffectInput<A, E, R>) as Effect.Effect<A, E, R>;
  }) as Effect.Effect<A, E | ServerClientError, R>;

const serverCollectionName = <
  A extends object,
  K extends CollectionKey,
  E,
  R
>(
  options: ServerCollectionOptions<A, K, E, R>
): string => {
  const name = options.name ?? options.id;
  if (name === undefined) {
    throw new ServerCollectionMissingIdentity({
      guidance: "Pass a stable name or id so the collection can be keyed, synced, and traced."
    });
  }
  return name;
};

export const serverCollectionSyncAdapter = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: ServerCollectionOptions<A, K, E, R>
): CollectionSyncAdapter<A, K, E | ServerClientError, R> => ({
  name: serverCollectionName(options),
  ...(options.load === undefined
    ? {}
    : {
        load: () => runOperation(options.load!, undefined)
      }),
  ...(options.refetch === undefined
    ? {}
    : {
        refetch: () => runOperation(options.refetch!, undefined)
      }),
  ...(options.insert === undefined
    ? {}
    : {
        insert: (payload) => runOperation(options.insert!, payload)
      }),
  ...(options.update === undefined
    ? {}
    : {
        update: (payload) => runOperation(options.update!, payload)
      }),
  ...(options.delete === undefined
    ? {}
    : {
        delete: (payload) => runOperation(options.delete!, payload)
      })
});

export const serverCollectionOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: ServerCollectionOptions<A, K, E, R>
): CollectionOptions<A, K, E | ServerClientError, R> =>
  collectionSyncOptions({
    name: serverCollectionName(options),
    getKey: options.getKey,
    sync: serverCollectionSyncAdapter(options),
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
    ...(options.initialData === undefined ? {} : { initialData: options.initialData })
  });
