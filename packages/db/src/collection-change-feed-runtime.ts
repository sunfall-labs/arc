import {
  invokeEffectInput,
  type EffectInput,
  type EffectInputCallbackError
} from "@effect-ui/core";
import { Cause, Deferred, Effect, Exit, Scope } from "effect";
import { scopedCollectionChangeFeedDispatcherEffect } from "./change-feed-dispatcher.js";
import type {
  CollectionChange,
  CollectionKey,
  CollectionRuntimeError,
  CollectionWriteOptions
} from "./collection-contract.js";
import type {
  CollectionChangeFeedAdapter,
  CollectionChangeFeedSubscribeOptions,
  CollectionChangeFeedSubscription,
  CollectionChangeFeedUnsubscribe
} from "./sync-adapter.js";

/**
 * Store-local dependencies required to run a scoped collection change feed.
 *
 * The Collection Runtime supplies row-application and failure-publication
 * Effects so this module can own subscription lifecycle without owning mutable
 * Collection Store state.
 */
export interface CollectionChangeFeedRuntimeOptions<
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError,
  FeedRequirements
> {
  /** Public collection name passed to adapter contexts and diagnostics. */
  readonly collection: string;
  /** Adapter that subscribes to a remote feed and receives Effect-first emitters. */
  readonly adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements, E, R>;
  /** Default write and dispatcher policies for emitted change batches. */
  readonly options?: CollectionChangeFeedSubscribeOptions;
  /** Apply one accepted change-feed batch to the subscribed Collection Store. */
  readonly applyChanges: (
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ) => Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Publish an asynchronous emission failure without failing the subscription fiber. */
  readonly publishFailure: (error: unknown) => Effect.Effect<void>;
}

const collectionChangeFeedInputCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection callback", callback);

const changeFeedUnsubscribe = (
  subscription: CollectionChangeFeedSubscription
): CollectionChangeFeedUnsubscribe | undefined =>
  typeof subscription === "function"
    ? subscription
    : subscription?.unsubscribe;

const changeFeedFailureError = <E>(cause: Cause.Cause<CollectionRuntimeError<E>>): unknown =>
  cause.reasons.find(Cause.isFailReason)?.error ?? Cause.squash(cause);

/**
 * Subscribe a change-feed adapter into one Collection Store runtime.
 *
 * `emit(...)` returns an Effect for composed adapters. `emitChanges(...)` is
 * the host-callback helper for websocket, worker, and observer feeds; it queues
 * into a scoped dispatcher and deterministically drops late emissions after the
 * subscription Scope closes.
 */
export const subscribeCollectionChangeFeedRuntimeEffect = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError = never,
  FeedRequirements = never
>(
  runtime: CollectionChangeFeedRuntimeOptions<A, K, E, R, FeedError, FeedRequirements>
): Effect.Effect<void, CollectionRuntimeError<E> | FeedError, R | FeedRequirements | Scope.Scope> =>
  Effect.gen(function* () {
    const options = runtime.options ?? {};
    const dispatcher = yield* scopedCollectionChangeFeedDispatcherEffect<A, K, CollectionRuntimeError<E>>(options.dispatch);

    yield* dispatcher.takeEffect().pipe(
      Effect.flatMap((emission) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            runtime.applyChanges(emission.changes, emission.options ?? options.write)
          );
          if (Exit.isFailure(exit)) {
            yield* runtime.publishFailure(changeFeedFailureError(exit.cause));
          }
          if (emission.completed) {
            yield* Deferred.done(emission.completed, exit).pipe(Effect.asVoid);
          }
        })
      ),
      Effect.forever,
      Effect.forkScoped
    );

    yield* Effect.acquireRelease(
      collectionChangeFeedInputCallbackEffect<CollectionChangeFeedSubscription, FeedError, FeedRequirements>(() =>
        runtime.adapter.subscribe({
          collection: runtime.collection,
          emit: (changes, writeOptions) => dispatcher.emitEffect(changes, writeOptions),
          emitChanges: (changes, writeOptions) => {
            dispatcher.emitChanges(changes, writeOptions);
          }
        })
      ),
      (subscription) => {
        const unsubscribe = changeFeedUnsubscribe(subscription);
        return unsubscribe
          ? collectionChangeFeedInputCallbackEffect(() => unsubscribe()).pipe(
              Effect.catch((error) =>
                runtime.publishFailure(error).pipe(Effect.catch(() => Effect.void))
              )
            )
          : Effect.void;
      }
    );
  }).pipe(Effect.asVoid);
