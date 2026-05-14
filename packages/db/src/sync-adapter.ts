import { Resource, toEffect, type EffectInput } from "@effect-ui/core";
import { Effect } from "effect";
import type {
  CollectionIndexRecord,
  CollectionKey,
  CollectionChange,
  CollectionOptions,
  CollectionPersistenceConfig,
  CollectionPolicy,
  CollectionTransaction,
  CollectionWriteOptions
} from "./index.js";

export interface CollectionSyncInsertPayload<A extends object, K extends CollectionKey> {
  readonly values: ReadonlyArray<A>;
  readonly transaction: CollectionTransaction<A, K>;
}

export interface CollectionSyncUpdatePayload<A extends object, K extends CollectionKey> {
  readonly updates: ReadonlyArray<{
    readonly key: K;
    readonly value: A;
    readonly previous: A;
    readonly changes: Partial<A>;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

export interface CollectionSyncDeletePayload<A extends object, K extends CollectionKey> {
  readonly deletes: ReadonlyArray<{
    readonly key: K;
    readonly previous: A;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

export interface CollectionSyncAdapter<A extends object, K extends CollectionKey = string, E = unknown, R = never> {
  readonly name: string;
  readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly refetch?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly insert?: (payload: CollectionSyncInsertPayload<A, K>) => EffectInput<void, E, R>;
  readonly update?: (payload: CollectionSyncUpdatePayload<A, K>) => EffectInput<void, E, R>;
  readonly delete?: (payload: CollectionSyncDeletePayload<A, K>) => EffectInput<void, E, R>;
}

export interface CollectionSyncOptions<
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
> {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly policy?: CollectionPolicy<E>;
  readonly persistence?: CollectionPersistenceConfig<E, R>;
  readonly indexes?: CollectionIndexRecord<A>;
  readonly getKey: (value: A) => K;
  readonly initialData?: ReadonlyArray<A>;
  readonly sync: CollectionSyncAdapter<A, K, E, R>;
}

export interface CollectionResourceSyncAdapterOptions<
  I,
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
> extends Pick<CollectionSyncAdapter<A, K, E, R>, "insert" | "update" | "delete"> {
  readonly name?: string;
  readonly ref: Resource.Ref<I, ReadonlyArray<A>, E, R>;
}

export type CollectionQuerySyncKey = ReadonlyArray<unknown>;

export interface CollectionQuerySyncFetchOptions<A extends object, E = unknown, R = never> {
  readonly queryKey: CollectionQuerySyncKey;
  readonly queryFn: () => EffectInput<ReadonlyArray<A>, E, R>;
}

export interface CollectionQuerySyncInvalidateOptions {
  readonly queryKey: CollectionQuerySyncKey;
}

export interface CollectionQuerySyncClient<A extends object, E = unknown, R = never> {
  readonly fetchQuery: (options: CollectionQuerySyncFetchOptions<A, E, R>) =>
    EffectInput<ReadonlyArray<A>, E, R>;
  readonly invalidateQueries?: (options: CollectionQuerySyncInvalidateOptions) =>
    EffectInput<unknown, E, R>;
}

export interface CollectionQuerySyncAdapterOptions<
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
> extends Pick<CollectionSyncAdapter<A, K, E, R>, "insert" | "update" | "delete"> {
  readonly name?: string;
  readonly queryKey: CollectionQuerySyncKey;
  readonly queryFn: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly queryClient: CollectionQuerySyncClient<A, E, R>;
  readonly invalidateOnRefetch?: boolean;
  readonly invalidateOnMutation?: boolean;
}

export type CollectionChangeFeedUnsubscribe = () => EffectInput<void, never, never>;

export type CollectionChangeFeedSubscription =
  | CollectionChangeFeedUnsubscribe
  | {
      readonly unsubscribe: CollectionChangeFeedUnsubscribe;
    }
  | void;

export interface CollectionChangeFeedContext<
  A extends object,
  K extends CollectionKey = string
> {
  readonly collection: string;
  readonly emit: (
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ) => EffectInput<void, unknown, unknown>;
}

export interface CollectionChangeFeedAdapter<
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
> {
  readonly name: string;
  readonly subscribe: (
    context: CollectionChangeFeedContext<A, K>
  ) => EffectInput<CollectionChangeFeedSubscription, E, R>;
}

export interface CollectionChangeFeedSubscribeOptions {
  readonly write?: CollectionWriteOptions;
}

const runSyncInput = <A, E, R>(
  input: EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  toEffect(input);

const queryKeyName = (queryKey: CollectionQuerySyncKey): string => {
  const [first] = queryKey;
  return `query:${typeof first === "string" || typeof first === "number" ? String(first) : "collection"}`;
};

const syncLoad = <A extends object, K extends CollectionKey, E, R>(
  adapter: CollectionSyncAdapter<A, K, E, R>
): (() => Effect.Effect<ReadonlyArray<A>, E, R>) | undefined => {
  const initial = adapter.load ?? adapter.refetch;
  if (!initial) {
    return undefined;
  }

  let loaded = false;
  return () =>
    Effect.gen(function* () {
      const operation = loaded && adapter.refetch ? adapter.refetch : initial;
      const rows = yield* runSyncInput(operation());
      loaded = true;
      return rows;
    });
};

export const collectionSyncOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: CollectionSyncOptions<A, K, E, R>
): CollectionOptions<A, K, E, R> => {
  const load = syncLoad(options.sync);

  return {
    name: options.name,
    getKey: options.getKey,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
    sync: {
      adapter: options.sync.name
    },
    ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
    ...(options.initialData === undefined ? {} : { initialData: options.initialData }),
    ...(load === undefined ? {} : { load }),
    ...(options.sync.insert === undefined
      ? {}
      : {
          onInsert: (values, context) =>
            runSyncInput(options.sync.insert!({
              values,
              transaction: context.transaction
            }))
        }),
    ...(options.sync.update === undefined
      ? {}
      : {
          onUpdate: (updates, context) =>
            runSyncInput(options.sync.update!({
              updates,
              transaction: context.transaction
            }))
        }),
    ...(options.sync.delete === undefined
      ? {}
      : {
          onDelete: (deletes, context) =>
            runSyncInput(options.sync.delete!({
              deletes,
              transaction: context.transaction
            }))
        })
  } satisfies CollectionOptions<A, K, E, R>;
};

export const collectionResourceSyncAdapter = <
  I,
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: CollectionResourceSyncAdapterOptions<I, A, K, E, R>
): CollectionSyncAdapter<A, K, E, R> => ({
  name: options.name ?? `resource:${options.ref.family.options.name}`,
  load: () => Resource.prefetchEffect(options.ref),
  refetch: () => Resource.refreshEffect(options.ref),
  ...(options.insert === undefined ? {} : { insert: options.insert }),
  ...(options.update === undefined ? {} : { update: options.update }),
  ...(options.delete === undefined ? {} : { delete: options.delete })
});

export const collectionQuerySyncAdapter = <
  A extends object,
  K extends CollectionKey = string,
  E = unknown,
  R = never
>(
  options: CollectionQuerySyncAdapterOptions<A, K, E, R>
): CollectionSyncAdapter<A, K, E, R> => {
  const fetch = (): Effect.Effect<ReadonlyArray<A>, E, R> =>
    runSyncInput(options.queryClient.fetchQuery({
      queryKey: options.queryKey,
      queryFn: options.queryFn
    }));
  const invalidate = (): Effect.Effect<void, E, R> =>
    options.queryClient.invalidateQueries
      ? Effect.flatMap(
          runSyncInput(options.queryClient.invalidateQueries({ queryKey: options.queryKey })),
          () => Effect.void
        )
      : Effect.succeed(undefined);

  return {
    name: options.name ?? queryKeyName(options.queryKey),
    load: fetch,
    refetch: (): Effect.Effect<ReadonlyArray<A>, E, R> =>
      Effect.gen(function* () {
        if (options.invalidateOnRefetch !== false && options.queryClient.invalidateQueries) {
          yield* invalidate();
        }
        return yield* fetch();
      }),
    ...(options.insert === undefined
      ? {}
      : {
          insert: (payload: CollectionSyncInsertPayload<A, K>): Effect.Effect<void, E, R> =>
            Effect.gen(function* () {
              yield* runSyncInput(options.insert!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidate();
              }
            })
        }),
    ...(options.update === undefined
      ? {}
      : {
          update: (payload: CollectionSyncUpdatePayload<A, K>): Effect.Effect<void, E, R> =>
            Effect.gen(function* () {
              yield* runSyncInput(options.update!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidate();
              }
            })
        }),
    ...(options.delete === undefined
      ? {}
      : {
          delete: (payload: CollectionSyncDeletePayload<A, K>): Effect.Effect<void, E, R> =>
            Effect.gen(function* () {
              yield* runSyncInput(options.delete!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidate();
              }
            })
        })
  };
};

export namespace CollectionSync {
  export type InsertPayload<A extends object, K extends CollectionKey> = CollectionSyncInsertPayload<A, K>;
  export type UpdatePayload<A extends object, K extends CollectionKey> = CollectionSyncUpdatePayload<A, K>;
  export type DeletePayload<A extends object, K extends CollectionKey> = CollectionSyncDeletePayload<A, K>;
  export type Adapter<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionSyncAdapter<A, K, E, R>;
  export type Options<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionSyncOptions<A, K, E, R>;
  export type ResourceAdapterOptions<I, A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionResourceSyncAdapterOptions<I, A, K, E, R>;
  export type QueryKey = CollectionQuerySyncKey;
  export type QueryFetchOptions<A extends object, E = unknown, R = never> =
    CollectionQuerySyncFetchOptions<A, E, R>;
  export type QueryInvalidateOptions = CollectionQuerySyncInvalidateOptions;
  export type QueryClient<A extends object, E = unknown, R = never> =
    CollectionQuerySyncClient<A, E, R>;
  export type QueryAdapterOptions<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionQuerySyncAdapterOptions<A, K, E, R>;
  export type ChangeFeedUnsubscribe = CollectionChangeFeedUnsubscribe;
  export type ChangeFeedSubscription = CollectionChangeFeedSubscription;
  export type ChangeFeedContext<A extends object, K extends CollectionKey = string> =
    CollectionChangeFeedContext<A, K>;
  export type ChangeFeedAdapter<A extends object, K extends CollectionKey = string, E = unknown, R = never> =
    CollectionChangeFeedAdapter<A, K, E, R>;
  export type ChangeFeedSubscribeOptions = CollectionChangeFeedSubscribeOptions;

  export const options = collectionSyncOptions;
  export const resourceAdapter = collectionResourceSyncAdapter;
  export const queryAdapter = collectionQuerySyncAdapter;
}
