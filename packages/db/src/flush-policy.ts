import { toEffect, type EffectInput } from "@effect-ui/core";
import { Effect } from "effect";
import type {
  AnyCollection,
  CollectionError,
  CollectionRequirements,
  CollectionTransaction
} from "./collection-contract.js";

type IterableCollection<Collections> =
  Collections extends Iterable<infer Collection>
    ? Extract<Collection, AnyCollection>
    : never;

/**
 * Per-collection context passed to a flush skip predicate.
 */
export interface FlushCollectionPendingMutationsContext {
  readonly collection: AnyCollection;
  readonly index: number;
}

/**
 * Static or per-collection predicate that skips flushing.
 *
 * The predicate is Effect-aware; its error and requirement channels are unioned
 * into the flush result Effect.
 */
export type FlushCollectionPendingMutationsSkip<SkipError = never, SkipRequirements = never> =
  | EffectInput<boolean, SkipError, SkipRequirements>
  | ((
      context: FlushCollectionPendingMutationsContext
    ) => EffectInput<boolean, SkipError, SkipRequirements>);

/**
 * Options for flushing pending mutations across collections.
 */
export interface FlushCollectionsPendingMutationsOptions<SkipError = never, SkipRequirements = never> {
  readonly skip?: FlushCollectionPendingMutationsSkip<SkipError, SkipRequirements>;
}

type AnyCollectionTransaction = CollectionTransaction<any, any>;

export interface FlushCollectionPendingMutationsFlushedResult {
  readonly _tag: "Flushed";
  readonly collection: string;
  readonly transactions: ReadonlyArray<AnyCollectionTransaction>;
}

export interface FlushCollectionPendingMutationsSkippedResult {
  readonly _tag: "Skipped";
  readonly collection: string;
  readonly transactions: ReadonlyArray<never>;
}

/**
 * Result for one collection in a multi-collection flush.
 */
export type FlushCollectionPendingMutationsResult =
  | FlushCollectionPendingMutationsFlushedResult
  | FlushCollectionPendingMutationsSkippedResult;

export type FlushCollectionsPendingMutationsError<
  Collections extends Iterable<AnyCollection>,
  SkipError = never
> = CollectionError<IterableCollection<Collections>> | SkipError;

export type FlushCollectionsPendingMutationsRequirements<
  Collections extends Iterable<AnyCollection>,
  SkipRequirements = never
> = CollectionRequirements<IterableCollection<Collections>> | SkipRequirements;

/**
 * Reason a background sync decision is being evaluated.
 */
export type CollectionBackgroundSyncTrigger = "manual" | "online" | "visibility" | "mutation" | "restore" | (string & {});

/**
 * Pending mutation summary used for background sync decisions.
 */
export interface CollectionBackgroundSyncPending {
  readonly collection: string;
  readonly transactions: ReadonlyArray<AnyCollectionTransaction>;
}

/**
 * Context passed to a background sync adapter.
 */
export interface CollectionBackgroundSyncAdapterContext {
  readonly trigger: CollectionBackgroundSyncTrigger;
  readonly collections: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<CollectionBackgroundSyncPending>;
}

/**
 * Policy adapter that decides whether pending mutations should flush now.
 *
 * Use this to gate sync on connectivity, visibility, metering, auth state, or a
 * custom scheduler. Adapter errors and requirements are preserved in Effect.
 */
export interface CollectionBackgroundSyncAdapter<AdapterError = never, AdapterRequirements = never> {
  readonly name: string;
  readonly shouldFlush: (
    context: CollectionBackgroundSyncAdapterContext
  ) => EffectInput<boolean, AdapterError, AdapterRequirements>;
}

/**
 * Options for background sync pending mutation flushing.
 */
export interface CollectionBackgroundSyncOptions<
  AdapterError = never,
  AdapterRequirements = never,
  SkipError = never,
  SkipRequirements = never
> extends FlushCollectionsPendingMutationsOptions<SkipError, SkipRequirements> {
  readonly adapter?: CollectionBackgroundSyncAdapter<AdapterError, AdapterRequirements>;
  readonly trigger?: CollectionBackgroundSyncTrigger;
  readonly flushEmpty?: boolean;
}

export interface CollectionBackgroundSyncIdleResult {
  readonly _tag: "Idle";
  readonly trigger: CollectionBackgroundSyncTrigger;
  readonly pending: ReadonlyArray<CollectionBackgroundSyncPending>;
  readonly results: ReadonlyArray<never>;
}

export interface CollectionBackgroundSyncDeferredResult {
  readonly _tag: "Deferred";
  readonly trigger: CollectionBackgroundSyncTrigger;
  readonly adapter: string;
  readonly pending: ReadonlyArray<CollectionBackgroundSyncPending>;
  readonly results: ReadonlyArray<never>;
}

export interface CollectionBackgroundSyncFlushedResult {
  readonly _tag: "Flushed";
  readonly trigger: CollectionBackgroundSyncTrigger;
  readonly adapter?: string;
  readonly pending: ReadonlyArray<CollectionBackgroundSyncPending>;
  readonly results: ReadonlyArray<FlushCollectionPendingMutationsResult>;
}

export type CollectionBackgroundSyncResult =
  | CollectionBackgroundSyncIdleResult
  | CollectionBackgroundSyncDeferredResult
  | CollectionBackgroundSyncFlushedResult;

export type CollectionBackgroundSyncError<
  Collections extends Iterable<AnyCollection>,
  AdapterError = never,
  SkipError = never
> = FlushCollectionsPendingMutationsError<Collections, SkipError> | AdapterError;

export type CollectionBackgroundSyncRequirements<
  Collections extends Iterable<AnyCollection>,
  AdapterRequirements = never,
  SkipRequirements = never
> = FlushCollectionsPendingMutationsRequirements<Collections, SkipRequirements> | AdapterRequirements;

const shouldSkipCollection = <SkipError, SkipRequirements>(
  skip: FlushCollectionPendingMutationsSkip<SkipError, SkipRequirements> | undefined,
  context: FlushCollectionPendingMutationsContext
): Effect.Effect<boolean, SkipError, SkipRequirements> => {
  if (!skip) {
    return Effect.succeed(false);
  }

  const value = typeof skip === "function" ? skip(context) : skip;
  return toEffect(value);
};

const backgroundSyncPending = (
  collections: ReadonlyArray<AnyCollection>
): Effect.Effect<ReadonlyArray<CollectionBackgroundSyncPending>> =>
  Effect.forEach(collections, (collection) =>
    Effect.map(collection.pendingMutationsEffect(), (pending) => ({
      collection: collection.name,
      transactions: pending.map((entry) => entry.transaction)
    }))
  );

/**
 * Flush queued optimistic mutations for each collection in order.
 *
 * Collection handler errors, requirements, and optional skip predicate channels
 * are reflected in the returned Effect.
 *
 * @example
 * yield* flushCollectionsPendingMutationsEffect([todos, projects])
 */
export const flushCollectionsPendingMutationsEffect = <
  const Collections extends Iterable<AnyCollection>,
  SkipError = never,
  SkipRequirements = never
>(
  collections: Collections,
  options: FlushCollectionsPendingMutationsOptions<SkipError, SkipRequirements> = {}
): Effect.Effect<
  ReadonlyArray<FlushCollectionPendingMutationsResult>,
  FlushCollectionsPendingMutationsError<Collections, SkipError>,
  FlushCollectionsPendingMutationsRequirements<Collections, SkipRequirements>
> =>
  Effect.gen(function* () {
    const results: Array<FlushCollectionPendingMutationsResult> = [];
    let index = 0;

    for (const collection of collections) {
      const context: FlushCollectionPendingMutationsContext = {
        collection,
        index
      };
      const skipped = yield* shouldSkipCollection(options.skip, context);

      if (skipped) {
        results.push({
          _tag: "Skipped",
          collection: collection.name,
          transactions: []
        });
      } else {
        const transactions = yield* collection.flushPendingMutationsEffect();
        results.push({
          _tag: "Flushed",
          collection: collection.name,
          transactions
        });
      }

      index++;
    }

    return results;
  });

/**
 * Decide whether to flush pending mutations for a background sync trigger.
 *
 * Returns `Idle` when nothing is pending, `Deferred` when the adapter declines
 * the flush, or `Flushed` with per-collection results.
 */
export const backgroundSyncCollectionsPendingMutationsEffect = <
  const Collections extends Iterable<AnyCollection>,
  AdapterError = never,
  AdapterRequirements = never,
  SkipError = never,
  SkipRequirements = never
>(
  collections: Collections,
  options: CollectionBackgroundSyncOptions<AdapterError, AdapterRequirements, SkipError, SkipRequirements> = {}
): Effect.Effect<
  CollectionBackgroundSyncResult,
  CollectionBackgroundSyncError<Collections, AdapterError, SkipError>,
  CollectionBackgroundSyncRequirements<Collections, AdapterRequirements, SkipRequirements>
> =>
  Effect.gen(function* () {
    const collectionArray = Array.from(collections);
    const pending = yield* backgroundSyncPending(collectionArray);
    const trigger = options.trigger ?? "manual";
    const hasPending = pending.some((entry) => entry.transactions.length > 0);

    if (!hasPending && options.flushEmpty !== true) {
      return {
        _tag: "Idle",
        trigger,
        pending,
        results: []
      } satisfies CollectionBackgroundSyncIdleResult;
    }

    if (options.adapter) {
      const shouldFlush = yield* (
        toEffect(options.adapter.shouldFlush({
          trigger,
          collections: collectionArray.map((collection) => collection.name),
          pending
        }))
      );

      if (!shouldFlush) {
        return {
          _tag: "Deferred",
          trigger,
          adapter: options.adapter.name,
          pending,
          results: []
        } satisfies CollectionBackgroundSyncDeferredResult;
      }
    }

    const results = yield* flushCollectionsPendingMutationsEffect(collectionArray, options);
    return {
      _tag: "Flushed",
      trigger,
      ...(options.adapter === undefined ? {} : { adapter: options.adapter.name }),
      pending,
      results
    } satisfies CollectionBackgroundSyncFlushedResult;
  });
