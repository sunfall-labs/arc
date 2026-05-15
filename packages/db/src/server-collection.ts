import {
  EffectInputCallbackError,
  isServerFunction,
  invokeEffectInput,
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
} from "./collection-contract.js";
import {
  collectionSyncOptions,
  type CollectionSyncAdapter,
  type CollectionSyncDeletePayload,
  type CollectionSyncInsertPayload,
  type CollectionSyncUpdatePayload
} from "./sync-adapter.js";

/**
 * Return type accepted from server collection operations.
 *
 * Use Effect-first callbacks or `ServerFunction`s so transport failures remain
 * typed in the collection error channel.
 */
export type ServerCollectionResult<A, E = never, R = never> =
  EffectInput<A, E, R>;

/**
 * Server-backed operation used by `serverCollectionSyncAdapter`.
 *
 * A `ServerFunction` is invoked through `.effect(input)`; a plain callback is
 * converted with `toEffect`.
 */
export type ServerCollectionOperation<I, A, E = never, R = never> =
  | ServerFunction<I, A, E, R>
  | ((input: I) => ServerCollectionResult<A, E, R>);

/** Insert payload accepted by a server-backed collection operation. */
export type ServerCollectionInsertPayload<A extends object, K extends CollectionKey> =
  CollectionSyncInsertPayload<A, K>;

/** Update payload accepted by a server-backed collection operation. */
export type ServerCollectionUpdatePayload<A extends object, K extends CollectionKey> =
  CollectionSyncUpdatePayload<A, K>;

/** Delete payload accepted by a server-backed collection operation. */
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

/**
 * Options for a collection backed by server functions.
 *
 * Provide a stable `name` or `id`; it is used for collection identity, sync
 * diagnostics, and persistence keys. Server client failures are included in the
 * resulting collection error channel.
 */
export type ServerCollectionOptions<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
> = ServerCollectionIdentity & {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly policy?: CollectionPolicy<E | EffectInputCallbackError | ServerClientError>;
  readonly getKey: (value: A) => K;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly initialData?: ReadonlyArray<A>;
  readonly load?: ServerCollectionOperation<void, ReadonlyArray<A>, E, R>;
  readonly refetch?: ServerCollectionOperation<void, ReadonlyArray<A>, E, R>;
  readonly insert?: ServerCollectionOperation<ServerCollectionInsertPayload<A, K>, void, E, R>;
  readonly update?: ServerCollectionOperation<ServerCollectionUpdatePayload<A, K>, void, E, R>;
  readonly delete?: ServerCollectionOperation<ServerCollectionDeletePayload<A, K>, void, E, R>;
};

/**
 * Error thrown when server collection options omit both `name` and `id`.
 */
export class ServerCollectionMissingIdentity extends Data.TaggedError(
  "ServerCollectionMissingIdentity"
)<{
  readonly guidance: string;
}> {}

const isServerCollectionFunction = <I, A, E, R>(
  operation: ServerCollectionOperation<I, A, E, R>
): operation is ServerFunction<I, A, E, R> =>
  isServerFunction(operation);

const runOperation = <I, A, E, R>(
  operation: () => ServerCollectionOperation<I, A, E, R>,
  callback: () => ServerCollectionResult<A, E, R>,
  input: I
): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R> =>
  Effect.suspend(() => {
    const current = operation();
    if (isServerCollectionFunction(current)) {
      return invokeEffectInput("Collection.server.operation", () => current.effect(input));
    }

    return invokeEffectInput("Collection.server.operation", callback);
  });

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

/**
 * Build a sync adapter from server functions or Effect callbacks.
 *
 * Use this when you want to compose the adapter manually before passing it to
 * `collectionSyncOptions` or `Collection.syncOptions`.
 */
export const serverCollectionSyncAdapter = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: ServerCollectionOptions<A, K, E, R>
): CollectionSyncAdapter<A, K, E | EffectInputCallbackError | ServerClientError, R> => ({
  name: serverCollectionName(options),
  ...(options.load === undefined
    ? {}
    : {
        load: () => runOperation(() => options.load!, () => options.load!(undefined), undefined)
      }),
  ...(options.refetch === undefined
    ? {}
    : {
        refetch: () => runOperation(() => options.refetch!, () => options.refetch!(undefined), undefined)
      }),
  ...(options.insert === undefined
    ? {}
    : {
        insert: (payload) => runOperation(() => options.insert!, () => options.insert!(payload), payload)
      }),
  ...(options.update === undefined
    ? {}
    : {
        update: (payload) => runOperation(() => options.update!, () => options.update!(payload), payload)
      }),
  ...(options.delete === undefined
    ? {}
    : {
        delete: (payload) => runOperation(() => options.delete!, () => options.delete!(payload), payload)
      })
});

/**
 * Build `Collection.define` options for a server-backed collection.
 *
 * Load/refetch and mutation operations are converted to Effect, and
 * `ServerClientError` is added to the collection error channel.
 *
 * @example
 * const todos = Collection.define(serverCollectionOptions({
 *   name: "todos",
 *   getKey: (todo) => todo.id,
 *   load: listTodos,
 *   update: updateTodos
 * }))
 */
export const serverCollectionOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never
>(
  options: ServerCollectionOptions<A, K, E, R>
): CollectionOptions<A, K, E | EffectInputCallbackError | ServerClientError, R> =>
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
