import {
  EffectInputCallbackError,
  Resource,
  invokeEffectInput,
  type EffectInput,
} from "@effect-ui/core";
import { Effect } from "effect";
import type {
  CollectionIndexRecord,
  CollectionKey,
  CollectionChange,
  CollectionOptions,
  CollectionPersistenceConfig,
  CollectionPolicy,
  CollectionRuntimeError,
  CollectionTransaction,
  CollectionWriteOptions,
} from "./collection-contract.js";
import type { CollectionChangeFeedDispatchPolicy } from "./change-feed-dispatcher.js";
import {
  cloneCollectionValue,
  collectionExecutableValuePath,
} from "./collection-value-detachment.js";

/**
 * Insert payload delivered to a collection sync adapter.
 */
export interface CollectionSyncInsertPayload<A extends object, K extends CollectionKey> {
  readonly values: ReadonlyArray<A>;
  readonly transaction: CollectionTransaction<A, K>;
}

/**
 * Update payload delivered to a collection sync adapter.
 */
export interface CollectionSyncUpdatePayload<A extends object, K extends CollectionKey> {
  readonly updates: ReadonlyArray<{
    readonly key: K;
    readonly value: A;
    readonly previous: A;
    readonly changes: Partial<A>;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

/**
 * Delete payload delivered to a collection sync adapter.
 */
export interface CollectionSyncDeletePayload<A extends object, K extends CollectionKey> {
  readonly deletes: ReadonlyArray<{
    readonly key: K;
    readonly previous: A;
  }>;
  readonly transaction: CollectionTransaction<A, K>;
}

/**
 * Transport adapter for collection load/refetch and mutation handlers.
 *
 * Each callback may return a plain value or Effect. Errors become the
 * collection error channel `E`, and any required services become `R`.
 */
export interface CollectionSyncAdapter<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> {
  readonly name: string;
  readonly load?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly refetch?: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly insert?: (payload: CollectionSyncInsertPayload<A, K>) => EffectInput<void, E, R>;
  readonly update?: (payload: CollectionSyncUpdatePayload<A, K>) => EffectInput<void, E, R>;
  readonly delete?: (payload: CollectionSyncDeletePayload<A, K>) => EffectInput<void, E, R>;
}

/**
 * Options for defining a collection from a sync adapter.
 */
export interface CollectionSyncOptions<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
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

/**
 * Options for adapting an `@effect-ui/core` Resource ref into collection sync.
 */
export interface CollectionResourceSyncAdapterOptions<
  I,
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> extends Pick<CollectionSyncAdapter<A, K, E, R>, "insert" | "update" | "delete"> {
  readonly name?: string;
  readonly ref: Resource.Ref<I, ReadonlyArray<A>, E, R>;
}

/**
 * Plain recursive value accepted inside a query-client cache key.
 */
export type CollectionQuerySyncKeyPart =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | symbol
  | Date
  | ReadonlyArray<CollectionQuerySyncKeyPart>
  | { readonly [key: string]: CollectionQuerySyncKeyPart };

/**
 * Stable query cache key used by query-client-backed sync adapters.
 */
export type CollectionQuerySyncKey = ReadonlyArray<CollectionQuerySyncKeyPart>;

/**
 * Fetch request issued to a query-client-backed sync adapter.
 */
export interface CollectionQuerySyncFetchOptions<A extends object, E = never, R = never> {
  readonly queryKey: CollectionQuerySyncKey;
  readonly queryFn: () => EffectInput<ReadonlyArray<A>, E, R>;
}

/**
 * Invalidation request issued after refetches or mutations.
 */
export interface CollectionQuerySyncInvalidateOptions {
  readonly queryKey: CollectionQuerySyncKey;
}

/**
 * Minimal query client interface used by `collectionQuerySyncAdapter`.
 */
export interface CollectionQuerySyncClient<A extends object, E = never, R = never> {
  readonly fetchQuery: (
    options: CollectionQuerySyncFetchOptions<A, E, R>,
  ) => EffectInput<ReadonlyArray<A>, E, R>;
  readonly invalidateQueries?: (
    options: CollectionQuerySyncInvalidateOptions,
  ) => EffectInput<void, E, R>;
}

/**
 * Policy for post-mutation query cache invalidation failures.
 *
 * `best-effort` preserves the historical behavior: once the mutation callback
 * succeeds, invalidation failures are ignored so the optimistic commit remains
 * synced. `rollback-on-failure` treats invalidation as part of the mutation
 * handler, so invalidation failures roll back the optimistic transaction and
 * fail the mutation Effect.
 */
export type CollectionQuerySyncMutationInvalidationPolicy = "best-effort" | "rollback-on-failure";

/**
 * Options for adapting query-client cache reads and invalidation to sync.
 */
export interface CollectionQuerySyncAdapterOptions<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> extends Pick<CollectionSyncAdapter<A, K, E, R>, "insert" | "update" | "delete"> {
  readonly name?: string;
  readonly queryKey: CollectionQuerySyncKey;
  readonly queryFn: () => EffectInput<ReadonlyArray<A>, E, R>;
  readonly queryClient: CollectionQuerySyncClient<A, E, R>;
  readonly invalidateOnRefetch?: boolean;
  readonly invalidateOnMutation?: boolean;
  readonly mutationInvalidation?: CollectionQuerySyncMutationInvalidationPolicy;
}

/**
 * Effect-aware unsubscribe callback for change-feed subscriptions.
 *
 * Scope release runs this callback as Effect work. If it fails or defects, the
 * Collection Runtime publishes the failure as `CollectionChangeFeedFailure`
 * and then swallows it so subscription scope cleanup does not fail after
 * release.
 */
export type CollectionChangeFeedUnsubscribe<E = never, R = never> = () => EffectInput<void, E, R>;

/**
 * Value returned by a change-feed subscribe call.
 *
 * Use an Effect-aware unsubscribe when cleanup needs services or can fail. The
 * runtime reports cleanup failures and defects through change-feed failure
 * publication rather than by rethrowing from the released scope.
 */
export type CollectionChangeFeedSubscription<E = never, R = never> =
  | CollectionChangeFeedUnsubscribe<E, R>
  | {
      readonly unsubscribe: CollectionChangeFeedUnsubscribe<E, R>;
    }
  | void;

/**
 * Context passed to change-feed adapters.
 *
 * `emit` returns the Effect for composed Effect adapters. `emitChanges` is the
 * host-callback helper for websocket, worker, and observer feeds; it queues
 * changes into the Collection Runtime consumer owned by
 * `Collection.subscribeChangesEffect(...)`.
 */
export interface CollectionChangeFeedContext<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
> {
  readonly collection: string;
  readonly emit: (
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions,
  ) => EffectInput<void, CollectionRuntimeError<E>, R>;
  readonly emitChanges: (
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions,
  ) => void;
}

/**
 * Scoped adapter for remote change feeds.
 *
 * Use with `Collection.subscribeChangesEffect`; the subscription is released
 * when the provided Scope closes. Subscribe setup failures use the adapter's
 * typed error channel. Unsubscribe failures and defects are published as
 * asynchronous change-feed failures and swallowed during scope release.
 *
 * `E` and `R` describe the feed subscription itself. `CollectionError` and
 * `CollectionRequirements` describe the `context.emit(...)` write seam.
 */
export interface CollectionChangeFeedAdapter<
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
  CollectionError = never,
  CollectionRequirements = never,
> {
  readonly name: string;
  readonly subscribe: (
    context: CollectionChangeFeedContext<A, K, CollectionError, CollectionRequirements>,
  ) => EffectInput<CollectionChangeFeedSubscription<E, R>, E, R>;
}

/**
 * Options applied to writes emitted by a change-feed subscription.
 */
export interface CollectionChangeFeedSubscribeOptions {
  readonly write?: CollectionWriteOptions;
  readonly dispatch?: CollectionChangeFeedDispatchPolicy;
}

const runSyncCallback = <A, E, R>(
  callback: () => EffectInput<A, E, R>,
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection sync adapter callback", callback);

const queryKeyName = (queryKey: CollectionQuerySyncKey): string => {
  const [first] = queryKey;
  return `query:${typeof first === "string" || typeof first === "number" ? String(first) : "collection"}`;
};

const queryKeyNameFromInput = (queryKey: CollectionQuerySyncKey): string => {
  try {
    return queryKeyName(queryKey);
  } catch {
    return "query:collection";
  }
};

const querySyncKeyGuidance =
  "Collection query sync keys must be plain cache identity data. Move host Promise work into queryFn or sync adapter Effects, and do not store direct Effect values in query keys.";

const querySyncKeyError = (cause: unknown): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation: "Collection.querySync.queryKey",
    cause,
    guidance: querySyncKeyGuidance,
  });

const detachQuerySyncKey = (queryKey: CollectionQuerySyncKey): CollectionQuerySyncKey => {
  try {
    const input = Array.from(queryKey);
    const executable = collectionExecutableValuePath(input, "$.queryKey");
    if (executable !== undefined) {
      throw querySyncKeyError(
        new TypeError(
          `Collection query sync key contains ${executable.reason} at ${executable.path}.`,
        ),
      );
    }
    return cloneCollectionValue(input) as CollectionQuerySyncKey;
  } catch (cause) {
    if (cause instanceof EffectInputCallbackError) {
      throw cause;
    }
    throw querySyncKeyError(cause);
  }
};

type QuerySyncKeyState =
  | {
      readonly _tag: "Valid";
      readonly queryKey: CollectionQuerySyncKey;
      readonly name: string;
    }
  | {
      readonly _tag: "Invalid";
      readonly error: EffectInputCallbackError;
      readonly name: string;
    };

const initialQuerySyncKeyState = (queryKey: CollectionQuerySyncKey): QuerySyncKeyState => {
  const name = queryKeyNameFromInput(queryKey);
  try {
    const owned = detachQuerySyncKey(queryKey);
    return {
      _tag: "Valid",
      queryKey: owned,
      name: queryKeyName(owned),
    };
  } catch (cause) {
    return {
      _tag: "Invalid",
      error: cause instanceof EffectInputCallbackError ? cause : querySyncKeyError(cause),
      name,
    };
  }
};

/**
 * Convert a sync adapter into `Collection.define` options.
 *
 * The Collection Runtime owns the first-load versus forced-refetch decision.
 * This Adapter maps sync `load` and `refetch` callbacks independently and wires
 * mutation callbacks to optimistic transaction handlers.
 *
 * @example
 * const todos = Collection.define(collectionSyncOptions({
 *   name: "todos",
 *   getKey: (todo) => todo.id,
 *   sync: todoSync
 * }))
 */
export const collectionSyncOptions = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
>(
  options: CollectionSyncOptions<A, K, E, R>,
): CollectionOptions<A, K, E | EffectInputCallbackError, R> => {
  const hasLoad = options.sync.load !== undefined || options.sync.refetch !== undefined;
  const hasRefetch = options.sync.refetch !== undefined;

  return {
    name: options.name,
    getKey: options.getKey,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.policy === undefined
      ? {}
      : { policy: options.policy as CollectionPolicy<E | EffectInputCallbackError> }),
    ...(options.persistence === undefined
      ? {}
      : {
          persistence: options.persistence as CollectionPersistenceConfig<
            E | EffectInputCallbackError,
            R
          >,
        }),
    sync: {
      adapter: options.sync.name,
    },
    ...(options.indexes === undefined ? {} : { indexes: options.indexes }),
    ...(options.initialData === undefined ? {} : { initialData: options.initialData }),
    ...(hasLoad
      ? {
          load: () =>
            runSyncCallback(() =>
              options.sync.load !== undefined ? options.sync.load() : options.sync.refetch!(),
            ),
        }
      : {}),
    ...(hasRefetch ? { refetch: () => runSyncCallback(() => options.sync.refetch!()) } : {}),
    ...(options.sync.insert === undefined
      ? {}
      : {
          onInsert: (values, context) =>
            runSyncCallback(() =>
              options.sync.insert!({
                values,
                transaction: context.transaction,
              }),
            ),
        }),
    ...(options.sync.update === undefined
      ? {}
      : {
          onUpdate: (updates, context) =>
            runSyncCallback(() =>
              options.sync.update!({
                updates,
                transaction: context.transaction,
              }),
            ),
        }),
    ...(options.sync.delete === undefined
      ? {}
      : {
          onDelete: (deletes, context) =>
            runSyncCallback(() =>
              options.sync.delete!({
                deletes,
                transaction: context.transaction,
              }),
            ),
        }),
  } satisfies CollectionOptions<A, K, E | EffectInputCallbackError, R>;
};

/**
 * Build a sync adapter from an `@effect-ui/core` Resource ref.
 *
 * Preload calls `Resource.prefetchEffect`; refetch calls
 * `Resource.refreshEffect`. Optional mutation callbacks can still write through
 * to a remote system.
 */
export const collectionResourceSyncAdapter = <
  I,
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
>(
  options: CollectionResourceSyncAdapterOptions<I, A, K, E, R>,
): CollectionSyncAdapter<A, K, Resource.LoadError<E>, R> => ({
  name: options.name ?? `resource:${options.ref.family.options.name}`,
  load: () => Resource.prefetchEffect(options.ref),
  refetch: () => Resource.refreshEffect(options.ref),
  ...(options.insert === undefined ? {} : { insert: options.insert }),
  ...(options.update === undefined ? {} : { update: options.update }),
  ...(options.delete === undefined ? {} : { delete: options.delete }),
});

/**
 * Build a sync adapter from a query-client style cache.
 *
 * Fetches go through `queryClient.fetchQuery`. Refetches and successful
 * mutations invalidate the query key unless disabled.
 */
export const collectionQuerySyncAdapter = <
  A extends object,
  K extends CollectionKey = string,
  E = never,
  R = never,
>(
  options: CollectionQuerySyncAdapterOptions<A, K, E, R>,
): CollectionSyncAdapter<A, K, E | EffectInputCallbackError, R> => {
  const queryKey = initialQuerySyncKeyState(options.queryKey);
  const queryKeyInput = (): CollectionQuerySyncKey => {
    if (queryKey._tag === "Invalid") {
      throw queryKey.error;
    }
    return detachQuerySyncKey(queryKey.queryKey);
  };
  const queryKeyInputEffect = (): Effect.Effect<CollectionQuerySyncKey, EffectInputCallbackError> =>
    Effect.try({
      try: queryKeyInput,
      catch: (cause) =>
        cause instanceof EffectInputCallbackError ? cause : querySyncKeyError(cause),
    });
  const fetch = (): Effect.Effect<ReadonlyArray<A>, E | EffectInputCallbackError, R> =>
    Effect.gen(function* () {
      const input = yield* queryKeyInputEffect();
      return yield* runSyncCallback(() =>
        options.queryClient.fetchQuery({
          queryKey: input,
          queryFn: () => options.queryFn(),
        }),
      );
    });
  const invalidate = (): Effect.Effect<void, E | EffectInputCallbackError, R> =>
    options.queryClient.invalidateQueries
      ? Effect.gen(function* () {
          const input = yield* queryKeyInputEffect();
          yield* runSyncCallback(() => options.queryClient.invalidateQueries!({ queryKey: input }));
        })
      : Effect.succeed(undefined);
  const invalidateAfterMutation = (): Effect.Effect<void, E | EffectInputCallbackError, R> =>
    options.mutationInvalidation === "rollback-on-failure"
      ? invalidate()
      : invalidate().pipe(Effect.catchCause(() => Effect.void));

  return {
    name: options.name ?? queryKey.name,
    load: fetch,
    refetch: (): Effect.Effect<ReadonlyArray<A>, E | EffectInputCallbackError, R> =>
      Effect.gen(function* () {
        if (options.invalidateOnRefetch !== false && options.queryClient.invalidateQueries) {
          yield* invalidate();
        }
        return yield* fetch();
      }),
    ...(options.insert === undefined
      ? {}
      : {
          insert: (
            payload: CollectionSyncInsertPayload<A, K>,
          ): Effect.Effect<void, E | EffectInputCallbackError, R> =>
            Effect.gen(function* () {
              yield* runSyncCallback(() => options.insert!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidateAfterMutation();
              }
            }),
        }),
    ...(options.update === undefined
      ? {}
      : {
          update: (
            payload: CollectionSyncUpdatePayload<A, K>,
          ): Effect.Effect<void, E | EffectInputCallbackError, R> =>
            Effect.gen(function* () {
              yield* runSyncCallback(() => options.update!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidateAfterMutation();
              }
            }),
        }),
    ...(options.delete === undefined
      ? {}
      : {
          delete: (
            payload: CollectionSyncDeletePayload<A, K>,
          ): Effect.Effect<void, E | EffectInputCallbackError, R> =>
            Effect.gen(function* () {
              yield* runSyncCallback(() => options.delete!(payload));
              if (options.invalidateOnMutation !== false) {
                yield* invalidateAfterMutation();
              }
            }),
        }),
  };
};

/**
 * Sync adapter namespace for collection transport helpers.
 */
export namespace CollectionSync {
  export type InsertPayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncInsertPayload<A, K>;
  export type UpdatePayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncUpdatePayload<A, K>;
  export type DeletePayload<
    A extends object,
    K extends CollectionKey,
  > = CollectionSyncDeletePayload<A, K>;
  export type Adapter<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSyncAdapter<A, K, E, R>;
  export type Options<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionSyncOptions<A, K, E, R>;
  export type ResourceAdapterOptions<
    I,
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionResourceSyncAdapterOptions<I, A, K, E, R>;
  export type QueryKeyPart = CollectionQuerySyncKeyPart;
  export type QueryKey = CollectionQuerySyncKey;
  export type QueryFetchOptions<
    A extends object,
    E = never,
    R = never,
  > = CollectionQuerySyncFetchOptions<A, E, R>;
  export type QueryInvalidateOptions = CollectionQuerySyncInvalidateOptions;
  export type QueryClient<A extends object, E = never, R = never> = CollectionQuerySyncClient<
    A,
    E,
    R
  >;
  export type QueryAdapterOptions<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionQuerySyncAdapterOptions<A, K, E, R>;
  export type QueryMutationInvalidationPolicy = CollectionQuerySyncMutationInvalidationPolicy;
  export type ChangeFeedUnsubscribe<E = never, R = never> = CollectionChangeFeedUnsubscribe<E, R>;
  export type ChangeFeedSubscription<E = never, R = never> = CollectionChangeFeedSubscription<E, R>;
  export type ChangeFeedContext<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
  > = CollectionChangeFeedContext<A, K, E, R>;
  export type ChangeFeedAdapter<
    A extends object,
    K extends CollectionKey = string,
    E = never,
    R = never,
    CollectionError = never,
    CollectionRequirements = never,
  > = CollectionChangeFeedAdapter<A, K, E, R, CollectionError, CollectionRequirements>;
  export type ChangeFeedSubscribeOptions = CollectionChangeFeedSubscribeOptions;

  /** Convert a sync adapter into `Collection.define` options. */
  export const options = collectionSyncOptions;
  /** Adapt an `@effect-ui/core` Resource ref into a sync adapter. */
  export const resourceAdapter = collectionResourceSyncAdapter;
  /** Adapt a query-client style cache into a sync adapter. */
  export const queryAdapter = collectionQuerySyncAdapter;
}
